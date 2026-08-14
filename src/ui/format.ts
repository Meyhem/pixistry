/** "1084.6°C" / "100°C" -- one decimal place, trailing ".0" dropped. */
export function formatCelsius(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}°C`;
}

/** "1m 32s" / "48s" -- whole seconds, minutes only shown once there are any. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
