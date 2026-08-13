// Raw WebGL2 quad + fragment shader, per the design doc ("PixiJS dropped --
// this project draws exactly one sprite"). The grid's specId array is
// mapped to RGBA through a small per-specId color LUT and blitted as a
// single nearest-filtered texture; no per-cell geometry.
//
// The backing texture (and the canvas's own drawing-buffer size) is
// SUPERSAMPLE cells wide/tall per grid cell, not 1:1 -- this is what makes
// the per-cell temperature border (see buildPixelBuffer) possible at all:
// at 1 texel per cell there's no sub-cell detail to draw a ring into. CSS
// (`image-rendering: pixelated`) then scales the whole thing up further,
// so each grid cell ends up as a crisp SUPERSAMPLE x SUPERSAMPLE block of
// screen pixels with the border as its outer ring and the pure species
// color in the middle.
import { EMPTY, PhaseCode } from '../sim/grid';
import { AMBIENT_TEMPERATURE_K } from '../sim/heat';

export const SUPERSAMPLE = 3;

export interface FrameData {
  specId: Uint16Array;
  phase: Uint8Array;
  tempK: Float32Array;
  radiatorRadius: Uint8Array;
  radiatorTargetK: Float32Array;
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

// Temperature border: a cell's own color is left untouched in the interior
// of its supersampled block: only the outer ring gets tinted, so the
// species color always stays readable and the temperature reads as a
// two-tone "pixel with an outline" rather than a full-cell wash. The tint
// hue itself sweeps neutral -> mid -> strong as the deviation grows (light
// blue -> strong blue when cooling, orange -> red when heating), and BORDER
// blend strength ramps up separately so a barely-off-ambient cell gets a
// faint ring rather than an abrupt one.
export const BORDER_RANGE_K = 150;
const BORDER_MAX_STRENGTH = 0.85;
const HOT_MID_RGB: [number, number, number] = [255, 150, 30];
const HOT_STRONG_RGB: [number, number, number] = [255, 30, 20];
const COLD_MID_RGB: [number, number, number] = [140, 190, 255];
const COLD_STRONG_RGB: [number, number, number] = [20, 60, 220];

// Persistent glow: a soft, subtle wash (interior *and* border alike, plus
// spilling into empty background cells) around every placed radiator cell,
// out to the current radiation radius, so the tool's reach is visible on
// the grid without having to hover over it -- doubles as the only visual
// marker for a radiator's location now that it's not physical matter with
// its own color. Kept weak (GLOW_MAX_STRENGTH) so it reads as a halo, not a
// repaint.
const GLOW_MAX_STRENGTH = 0.22;

// Gas-phase wash: a cell's own species color is unchanged by phase in
// colorLUT (there's no per-phase color data, same as density -- see
// species.ts's buoyantDensityOf comment for why gas density needed its own
// derivation but color didn't get one here), so without this, boiled water
// rising through liquid water as steam was pixel-identical to the liquid it
// came from -- visually invisible even once it could actually move.
// Lightening toward white on Gas phase gives it a distinct, washed-out look
// (steam/vapor rather than solid liquid color) using only the phase flag
// already threaded through FrameData, no new per-species data.
const GAS_LIGHTEN_STRENGTH = 0.45;
const GAS_LIGHTEN_RGB: [number, number, number] = [255, 255, 255];

/** Lerps rgb toward `hue` by `strength` (0..1), alpha untouched. */
function tintTowards(rgba: [number, number, number, number], hue: readonly [number, number, number], strength: number): [number, number, number, number] {
  return [
    rgba[0] + (hue[0] - rgba[0]) * strength,
    rgba[1] + (hue[1] - rgba[1]) * strength,
    rgba[2] + (hue[2] - rgba[2]) * strength,
    rgba[3],
  ];
}

/** The border ring's tint color + blend strength for a cell's temperature,
 * or null if it's close enough to ambient that no border should show. */
function borderTint(tempK: number): { hue: readonly [number, number, number]; strength: number } | null {
  const deviation = tempK - AMBIENT_TEMPERATURE_K;
  if (deviation === 0) return null;
  const frac = Math.max(-1, Math.min(1, deviation / BORDER_RANGE_K));
  const absFrac = Math.abs(frac);
  const strength = absFrac * BORDER_MAX_STRENGTH;
  const hue = frac > 0 ? lerpRgb(HOT_MID_RGB, HOT_STRONG_RGB, absFrac) : lerpRgb(COLD_MID_RGB, COLD_STRONG_RGB, absFrac);
  return { hue, strength };
}

function lerpRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function createRenderer(canvas: HTMLCanvasElement, width: number, height: number): Renderer {
  canvas.width = width * SUPERSAMPLE;
  canvas.height = height * SUPERSAMPLE;

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

  const texWidth = width * SUPERSAMPLE;
  const texHeight = height * SUPERSAMPLE;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, texWidth, texHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const colorLUT = new Map<number, [number, number, number, number]>();
  const pixelBuffer = new Uint8Array(texWidth * texHeight * 4);

  // Per-grid-cell (not per-subpixel) glow strength, recomputed every frame
  // from the current radiator overlay -- cheap since it only walks radiator
  // cells and each one's own (small, player-bounded) radius, same cost
  // class as heat.ts's own applyPointHeatSource. Since the radiator tool no
  // longer has separate heater/cooler kinds, which bucket a given radiator
  // falls into for coloring purposes is derived from its own target
  // relative to ambient (see AMBIENT_TEMPERATURE_K) rather than a stored
  // sign.
  let heaterGlow = new Float32Array(width * height);
  let coolerGlow = new Float32Array(width * height);

  function accumulateGlow(radiatorRadius: Uint8Array, radiatorTargetK: Float32Array): void {
    heaterGlow.fill(0);
    coolerGlow.fill(0);

    for (let i = 0; i < radiatorRadius.length; i++) {
      const radius = radiatorRadius[i] as number;
      if (radius <= 0) continue;

      const cx = i % width;
      const cy = Math.floor(i / width);
      const targetK = radiatorTargetK[i] as number;
      const glow = targetK >= AMBIENT_TEMPERATURE_K ? heaterGlow : coolerGlow;
      const r2 = radius * radius;

      const minX = Math.max(0, cx - radius);
      const maxX = Math.min(width - 1, cx + radius);
      const minY = Math.max(0, cy - radius);
      const maxY = Math.min(height - 1, cy + radius);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const falloff = 1 - Math.sqrt(d2) / radius;
          const idx = y * width + x;
          if (falloff > (glow[idx] as number)) glow[idx] = falloff;
        }
      }
    }
  }

  return {
    setColorForSpec(specId: number, hex: string): void {
      colorLUT.set(specId, hexToRgba(hex));
    },

    drawFrame({ specId: specIdGrid, phase: phaseGrid, tempK, radiatorRadius, radiatorTargetK }: FrameData): void {
      accumulateGlow(radiatorRadius, radiatorTargetK);

      for (let cy = 0; cy < height; cy++) {
        for (let cx = 0; cx < width; cx++) {
          const i = cy * width + cx;
          const specId = specIdGrid[i];
          const hGlow = heaterGlow[i] as number;
          const cGlow = coolerGlow[i] as number;

          let baseRgba: [number, number, number, number];
          let border: { hue: readonly [number, number, number]; strength: number } | null = null;

          if (specId === EMPTY) {
            baseRgba = BACKGROUND_RGBA;
          } else {
            baseRgba = colorLUT.get(specId as number) ?? MISSING_SPEC_RGBA;
            if ((phaseGrid[i] as PhaseCode) === PhaseCode.Gas) {
              baseRgba = tintTowards(baseRgba, GAS_LIGHTEN_RGB, GAS_LIGHTEN_STRENGTH);
            }
            border = borderTint(tempK[i] as number);
          }

          let interiorRgba = baseRgba;
          if (hGlow > 0) interiorRgba = tintTowards(interiorRgba, HOT_MID_RGB, hGlow * GLOW_MAX_STRENGTH);
          if (cGlow > 0) interiorRgba = tintTowards(interiorRgba, COLD_MID_RGB, cGlow * GLOW_MAX_STRENGTH);

          let ringRgba = interiorRgba;
          if (border) ringRgba = tintTowards(interiorRgba, border.hue, border.strength);

          const blockX = cx * SUPERSAMPLE;
          const blockY = cy * SUPERSAMPLE;
          for (let sy = 0; sy < SUPERSAMPLE; sy++) {
            const onRingY = sy === 0 || sy === SUPERSAMPLE - 1;
            const texY = blockY + sy;
            for (let sx = 0; sx < SUPERSAMPLE; sx++) {
              const onRing = onRingY || sx === 0 || sx === SUPERSAMPLE - 1;
              const rgba = onRing ? ringRgba : interiorRgba;
              const o = (texY * texWidth + (blockX + sx)) * 4;
              pixelBuffer[o] = rgba[0];
              pixelBuffer[o + 1] = rgba[1];
              pixelBuffer[o + 2] = rgba[2];
              pixelBuffer[o + 3] = rgba[3];
            }
          }
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texWidth, texHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
