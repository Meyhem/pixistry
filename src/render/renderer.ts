// Raw WebGL2 quad + fragment shader, per the design doc ("PixiJS dropped --
// this project draws exactly one sprite"). The grid's specId array is
// mapped to RGBA through a small per-specId color LUT and blitted as a
// single nearest-filtered texture; no per-cell geometry.
import { EMPTY, PhaseCode } from '../sim/grid';
import { AMBIENT_TEMPERATURE_K } from '../sim/heat';
import { pressureKPa } from '../sim/pressure';

export interface FrameData {
  specId: Uint16Array;
  phase: Uint8Array;
  tempK: Float32Array;
  n: Uint8Array;
}

export interface Renderer {
  setColorForSpec(specId: number, hex: string): void;
  drawFrame(frame: FrameData): void;
}

const VERTEX_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vec2(vUv.x, 1.0 - vUv.y));
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  return program;
}

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b, 255];
}

const BACKGROUND_RGBA: [number, number, number, number] = [12, 12, 16, 255];
const MISSING_SPEC_RGBA: [number, number, number, number] = [255, 0, 255, 255];

// Gas cells' alpha channel doubles as a pressure readout: a near-vacuum gas
// cell is barely visible, full opacity is reached around 3 atm. Solids and
// liquids don't carry a mole count (grid.n stays 0, see pressure.ts) so
// they're left fully opaque regardless of this scale.
const PRESSURE_ALPHA_MIN = 40;
const PRESSURE_ALPHA_FULL_KPA = 3 * 101.325;

// Temperature overlay: cells warmer than ambient tint red, cooler tint
// blue, saturating at +-TEMP_OVERLAY_RANGE_K away from ambient.
const TEMP_OVERLAY_RANGE_K = 300;
const TEMP_OVERLAY_MAX_STRENGTH = 0.55;
const HOT_RGB: [number, number, number] = [255, 40, 20];
const COLD_RGB: [number, number, number] = [40, 120, 255];

function applyTemperatureOverlay(rgba: [number, number, number, number], tempK: number): [number, number, number, number] {
  const deviation = tempK - AMBIENT_TEMPERATURE_K;
  if (deviation === 0) return rgba;
  const frac = Math.max(-1, Math.min(1, deviation / TEMP_OVERLAY_RANGE_K));
  const strength = Math.abs(frac) * TEMP_OVERLAY_MAX_STRENGTH;
  const tint = frac > 0 ? HOT_RGB : COLD_RGB;
  return [
    rgba[0] + (tint[0] - rgba[0]) * strength,
    rgba[1] + (tint[1] - rgba[1]) * strength,
    rgba[2] + (tint[2] - rgba[2]) * strength,
    rgba[3],
  ];
}

export function createRenderer(canvas: HTMLCanvasElement, width: number, height: number): Renderer {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not supported in this browser');

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = linkProgram(gl, vs, fs);
  gl.useProgram(program);

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const colorLUT = new Map<number, [number, number, number, number]>();
  const pixelBuffer = new Uint8Array(width * height * 4);

  return {
    setColorForSpec(specId: number, hex: string): void {
      colorLUT.set(specId, hexToRgba(hex));
    },

    drawFrame({ specId: specIdGrid, phase, tempK, n }: FrameData): void {
      for (let i = 0; i < specIdGrid.length; i++) {
        const specId = specIdGrid[i];
        const o = i * 4;
        if (specId === EMPTY) {
          pixelBuffer[o] = BACKGROUND_RGBA[0];
          pixelBuffer[o + 1] = BACKGROUND_RGBA[1];
          pixelBuffer[o + 2] = BACKGROUND_RGBA[2];
          pixelBuffer[o + 3] = BACKGROUND_RGBA[3];
          continue;
        }

        let rgba = colorLUT.get(specId as number) ?? MISSING_SPEC_RGBA;
        rgba = applyTemperatureOverlay(rgba, tempK[i] as number);

        let alpha = rgba[3];
        if (phase[i] === PhaseCode.Gas) {
          const pressure = pressureKPa(n[i] as number, tempK[i] as number);
          const frac = Math.max(0, Math.min(1, pressure / PRESSURE_ALPHA_FULL_KPA));
          alpha = PRESSURE_ALPHA_MIN + frac * (255 - PRESSURE_ALPHA_MIN);
        }

        pixelBuffer[o] = rgba[0];
        pixelBuffer[o + 1] = rgba[1];
        pixelBuffer[o + 2] = rgba[2];
        pixelBuffer[o + 3] = alpha;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
