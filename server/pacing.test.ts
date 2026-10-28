import { describe, expect, it } from 'vitest';
import { clampPacingSessions, clock, mayStart, pacingMessage, resumeRefusal, usageLabel, usageView, waived, warningView, type WorkKind } from './pacing.ts';

const NOW = new Date(2026, 8, 28, 12, 0).getTime();
const HOUR = 60 * 60_000;
const at = (over: Partial<Parameters<typeof mayStart>[1]> = {}) => ({ now: NOW, pausedUntil: 0, pacingUntil: 0, running: 0, pacingSessions: 3, ...over });
const KINDS: WorkKind[] = ['issue', 'qa', 'fix', 'ceo'];

describe('mayStart', () => {
  it('starts everything when usage is normal, however much is running', () => {
    for (const kind of KINDS) expect(mayStart(kind, at({ running: 20 }))).toBe(true);
  });

  it('starts new issues while pacing only under the cap', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 2 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 3 }))).toBe(false);
    expect(mayStart('issue', at({ pacingUntil: NOW + HOUR, running: 9, pacingSessions: 10 }))).toBe(true);
  });

  it('keeps starting QA, fixes and CEO jobs while pacing', () => {
    for (const kind of ['qa', 'fix', 'ceo'] as const) expect(mayStart(kind, at({ pacingUntil: NOW + HOUR, running: 12 }))).toBe(true);
  });

  it('starts nothing at all once Claude rejects a session, pacing or not', () => {
    for (const kind of KINDS) {
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR }))).toBe(false);
      expect(mayStart(kind, at({ pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR }))).toBe(false);
    }
  });

  it('stops pacing when it expires', () => {
    expect(mayStart('issue', at({ pacingUntil: NOW, running: 10 }))).toBe(true);
    expect(mayStart('issue', at({ pacingUntil: NOW - 1, pausedUntil: NOW - 1, running: 10 }))).toBe(true);
  });
});

describe('usageView and usageLabel', () => {
  it('is normal, pacing or paused, with the pause first', () => {
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: 0 })).toEqual({ state: 'normal', until: null, warning: null });
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR })).toEqual({ state: 'pacing', until: NOW + HOUR, warning: null });
    expect(usageView({ now: NOW, pausedUntil: NOW + HOUR, pacingUntil: NOW + 2 * HOUR })).toEqual({ state: 'paused', until: NOW + HOUR, warning: null });
    expect(usageView({ now: NOW, pausedUntil: NOW, pacingUntil: NOW })).toEqual({ state: 'normal', until: null, warning: null });
  });

  it("carries the last warning's limit, fill and reset for the usage meter", () => {
    const warning = warningView({ resetsAt: NOW + HOUR, rateLimitType: 'seven_day', utilization: 0.91 }, NOW);
    expect(warning).toEqual({ limit: 'límite semanal', pct: 91, resetsAt: NOW + HOUR, at: NOW });
    expect(usageView({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR }, warning)).toEqual({ state: 'pacing', until: NOW + HOUR, warning });
    expect(warningView({ resetsAt: null, rateLimitType: null, utilization: null }, NOW)).toEqual({ limit: null, pct: null, resetsAt: null, at: NOW });
  });

  it('reads as the CEO sees it in company_status', () => {
    expect(usageLabel({ state: 'normal', until: null }, NOW)).toBe('normal');
    expect(usageLabel({ state: 'pacing', until: NOW + 150 * 60_000 }, NOW)).toBe('ritmo reducido hasta las 14:30');
    expect(usageLabel({ state: 'paused', until: NOW + 5 * 60_000 }, NOW)).toBe('en pausa hasta las 12:05');
  });

  it('names the day when the window resets on another day', () => {
    expect(clock(NOW + 3 * 24 * HOUR, NOW)).toMatch(/^(?:lun|mar|mié|jue|vie|sáb|dom)\.? 12:00$/);
  });
});

describe('pacingMessage', () => {
  it('says which limit, how full, until when and how many sessions', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'five_hour', utilization: 0.82 }, NOW + 150 * 60_000, 3, NOW)).toBe(
      "🐢 El uso de Claude está subiendo (límite de 5 horas, 82%). Hasta las 14:30, la oficina termina primero el trabajo abierto y arranca como mucho 3 sesiones a la vez.",
    );
  });

  it('copes with a percentage and with missing details', () => {
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('(límite semanal, 91%)');
    expect(pacingMessage({ resetsAt: null, rateLimitType: 'seven_day', utilization: 91 }, NOW + HOUR, 1, NOW)).toContain('como mucho 1 sesión a la vez');
    expect(pacingMessage({ resetsAt: null, rateLimitType: null, utilization: null }, NOW + HOUR, 3, NOW)).toMatch(/^🐢 El uso de Claude está subiendo\. Hasta las 13:00/);
  });
});

it('clamps the pacing cap to 1-32, default 3', () => {
  expect(clampPacingSessions(5)).toBe(5);
  expect(clampPacingSessions('7')).toBe(7);
  expect(clampPacingSessions(100)).toBe(32);
  expect(clampPacingSessions(0)).toBe(3);
  expect(clampPacingSessions(-4)).toBe(3);
  expect(clampPacingSessions('lots')).toBe(3);
  expect(clampPacingSessions(2.6)).toBe(3);
});

describe('resume full speed', () => {
  it('clears pacing, but never a hard pause and never when there is nothing to clear', () => {
    expect(resumeRefusal({ now: NOW, pausedUntil: 0, pacingUntil: NOW + HOUR })).toBeNull();
    expect(resumeRefusal({ now: NOW, pausedUntil: NOW + 5 * 60_000, pacingUntil: NOW + HOUR })).toBe(
      "Claude ha rechazado una sesión por el límite de uso: no se empieza nada nuevo hasta las 12:05. Esa pausa no se puede quitar antes de tiempo.",
    );
    expect(resumeRefusal({ now: NOW, pausedUntil: 0, pacingUntil: 0 })).toBe('La oficina ya está funcionando a toda velocidad.');
    expect(resumeRefusal({ now: NOW, pausedUntil: NOW - 1, pacingUntil: NOW })).toBe('La oficina ya está funcionando a toda velocidad.');
  });

  it("ignores later warnings about the window the manager waived, but not another limit's or a new window's", () => {
    const waiver = { until: NOW + 2 * HOUR, limit: 'five_hour' };
    const warn = (rateLimitType: string | null, resetsAt: number | null) => ({ rateLimitType, resetsAt, utilization: 0.85 });
    expect(waived(warn('five_hour', NOW + 2 * HOUR), waiver, NOW)).toBe(true);
    expect(waived(warn('five_hour', NOW + 2 * HOUR + 30_000), waiver, NOW)).toBe(true); // the same reset, reported a little differently
    expect(waived(warn('five_hour', null), waiver, NOW)).toBe(true);
    expect(waived(warn(null, NOW + HOUR), waiver, NOW)).toBe(true);
    expect(waived(warn('seven_day', NOW + 30 * HOUR), waiver, NOW)).toBe(false);
    expect(waived(warn('five_hour', NOW + 7 * HOUR), waiver, NOW)).toBe(false); // the usage was reset: a new window
    expect(waived(warn('five_hour', NOW + 2 * HOUR), waiver, NOW + 2 * HOUR)).toBe(false); // the waived window is over
    expect(waived(warn('five_hour', NOW + 2 * HOUR), null, NOW)).toBe(false);
  });
});
