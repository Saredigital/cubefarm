// The adaptive resolution's decisions (perf.tsx feeds it frame-rate samples): the pixel ratio steps down after
// sustained slow frames and back up only after sustained headroom, the wait before the next step up doubling every
// time one didn't hold. So walking between a busy and a quiet part of a floor never bounces it back and forth (each
// step resizes the canvas and every post-processing buffer), yet it never stops trying: after a busy spell it comes
// back up within minutes, not "stuck at the lowest resolution for the rest of the day".

export interface DprConfig {
  /** The pixel ratios it steps between. */
  min: number;
  max: number;
  step: number;
  /** Below this share of the display's refresh rate is slow, for downAfterMs straight... */
  downShare: number;
  downAfterMs: number;
  /** ...at or above this share is headroom, for upAfterMs straight (doubling up to maxUpAfterMs after a failed step up). */
  upShare: number;
  upAfterMs: number;
  maxUpAfterMs: number;
  /** A step down this soon after a step up means the step up failed. */
  failWindowMs: number;
  /** Samples ignored after a change, a pause or a graphics tier change. */
  settleMs: number;
}

export const DPR: DprConfig = {
  min: 1,
  max: 1.75,
  step: 0.25,
  downShare: 0.6,
  downAfterMs: 3_000,
  upShare: 0.9,
  upAfterMs: 10_000,
  maxUpAfterMs: 320_000,
  failWindowMs: 20_000,
  settleMs: 2_500,
};

export interface DprState {
  dpr: number;
  settle: number;
  slowMs: number;
  fastMs: number;
  upAfterMs: number;
  /** Time since the last step up, while it may still turn out to have failed; null otherwise. */
  sinceUpMs: number | null;
  /** The highest frame rate measured, snapped to a display rate (60, 120, 144). */
  hz: number;
}

export const newDpr = (start: number, cfg: DprConfig = DPR): DprState => ({ dpr: Math.min(cfg.max, Math.max(cfg.min, start)), settle: cfg.settleMs, slowMs: 0, fastMs: 0, upAfterMs: cfg.upAfterMs, sinceUpMs: null, hz: 60 });

/**
 * The display's refresh rate from the highest frame rate seen. A burst of catch-up frames can overshoot it (and then
 * nothing would ever count as headroom), so it snaps to a common display rate.
 */
export const displayHz = (measured: number) => (measured > 130 ? 144 : measured > 100 ? 120 : 60);

/** Ignore the next samples and start the runs again: after a pause or a graphics tier change. */
export function dprSettle(s: DprState, cfg: DprConfig = DPR) {
  s.settle = cfg.settleMs;
  s.slowMs = 0;
  s.fastMs = 0;
}

/** One sample: the average `fps` over `ms` of drawing. Returns the new pixel ratio when it steps, else null. */
export function dprSample(s: DprState, fps: number, ms: number, cfg: DprConfig = DPR): number | null {
  if (!Number.isFinite(fps) || !Number.isFinite(ms) || ms <= 0) return null;
  s.hz = Math.max(s.hz, displayHz(fps));
  if (s.sinceUpMs !== null) {
    s.sinceUpMs += ms;
    if (s.sinceUpMs > cfg.failWindowMs) {
      s.sinceUpMs = null;
      s.upAfterMs = cfg.upAfterMs;
    }
  }
  if (s.settle > 0) {
    s.settle -= ms;
    return null;
  }
  if (fps < s.hz * cfg.downShare) {
    s.slowMs += ms;
    s.fastMs = 0;
  } else if (fps >= s.hz * cfg.upShare) {
    s.fastMs += ms;
    s.slowMs = 0;
  } else {
    s.slowMs = 0;
    s.fastMs = 0;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  if (s.slowMs >= cfg.downAfterMs && s.dpr > cfg.min) {
    if (s.sinceUpMs !== null) s.upAfterMs = Math.min(cfg.maxUpAfterMs, s.upAfterMs * 2);
    s.sinceUpMs = null;
    s.dpr = round(Math.max(cfg.min, s.dpr - cfg.step));
    dprSettle(s, cfg);
    return s.dpr;
  }
  if (s.fastMs >= s.upAfterMs && s.dpr < cfg.max) {
    s.sinceUpMs = 0;
    s.dpr = round(Math.min(cfg.max, s.dpr + cfg.step));
    dprSettle(s, cfg);
    return s.dpr;
  }
  return null;
}
