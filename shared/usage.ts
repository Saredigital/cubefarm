// How Claude's usage reads, on the server (phone messages, the CEO's company status) and in the office (the usage
// meter, the HUD's pacing chip): clock times and the names of Claude's limits.

/** "14:30", with the weekday when it isn't today. */
export function clock(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date(now).toDateString() ? hm : `${d.toLocaleDateString('es-ES', { weekday: 'short' })} ${hm}`;
}

const LIMIT_NAMES: Record<string, string> = {
  five_hour: 'límite de 5 horas',
  seven_day: 'límite semanal',
  seven_day_opus: 'límite semanal de Opus',
  seven_day_sonnet: 'límite semanal de Sonnet',
};

/** A rate limit type as Claude reports it ("five_hour"), as people say it ("límite de 5 horas"). */
export const limitName = (type: string) => LIMIT_NAMES[type] ?? type.replace(/_/g, ' ');

/** How full a limit is, 0-100: Claude reports a fraction (0.82) or a percentage (82). */
export const usedPercent = (utilization: number) => Math.round(utilization <= 1 ? utilization * 100 : utilization);
