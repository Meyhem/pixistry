/** "1084.6°C" / "100°C" -- one decimal place, trailing ".0" dropped. */
export function formatCelsius(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}°C`;
}
