// The hitch recorder's pure parts (hitches.ts is its browser side): what counts as a hitch, the ring of the last few,
// the best guess at what caused one, the summary for ?stats and the report, and the "walking but not moving" check.

/** A gap this long between two drawn frames is a hitch (a 60 Hz frame is 16.7 ms). */
export const HITCH_MS = 100;
/** How many hitches are kept. */
export const HITCH_KEEP = 50;
/** What happened this long before a hitch is kept with it (resolution and tier changes, chunks, focus...). */
export const CONTEXT_MS = 1000;
/** A movement key held this long without the player moving (no travel, no perch, no panel) is a stall. */
export const STUCK_MS = 400;
/** A websocket message bigger than this, or slower than this to apply, is named as the cause. */
export const BIG_WS_BYTES = 64 * 1024;
export const SLOW_WS_MS = 30;
/** More texture uploads than this in one gap is unusual (a few a frame are the batches' and the screens' own). */
export const UPLOADS_MANY = 12;

export type HitchKind = 'frame' | 'paused' | 'input' | 'stuck';

/** Something that happened, kept a second or so in case a hitch follows: a DPR step, a tier change, a chunk... */
export interface HitchNote {
  at: number;
  kind: string;
  detail: string;
}

/** A websocket message handled in a hitch's gap: its type, size and how long parsing and applying it took. */
export interface WsNote {
  type: string;
  bytes: number;
  ms: number;
}

export interface Hitch {
  kind: HitchKind;
  /** performance.now() when it was noticed, and the clock time. */
  at: number;
  wall: string;
  /** The gap between frames, how long the loop was paused, or how long the player was stuck. */
  ms: number;
  cause: string;
  /** For pauses, input losses and stalls: why (the panel, the tab, what took focus, where). */
  detail: string;
  floor: number;
  camera: string;
  overlay: string | null;
  dpr: number;
  gfx: string;
  /** Shader programs compiled, textures created and texture uploads (texImage/texSubImage) during the gap. */
  programs: number;
  textures: number;
  uploads: number;
  ws: WsNote[];
  notes: HitchNote[];
  /** World events running (a plane, fireworks...). */
  events: string[];
  /** The browser's long-animation-frame attribution for the gap, where it has one: the slowest scripts. */
  scripts: string[];
}

// ---------- the ring ----------

export interface Ring<T> {
  items: (T | undefined)[];
  next: number;
  /** Everything ever pushed, kept or not. */
  total: number;
}

export const newRing = <T>(size: number): Ring<T> => ({ items: new Array<T | undefined>(size), next: 0, total: 0 });

export function pushRing<T>(r: Ring<T>, item: T) {
  r.items[r.next] = item;
  r.next = (r.next + 1) % r.items.length;
  r.total++;
}

/** Oldest first. */
export function ringItems<T>(r: Ring<T>): T[] {
  const out: T[] = [];
  const n = r.items.length;
  for (let i = 0; i < n; i++) {
    const item = r.items[(r.next + i) % n];
    if (item !== undefined) out.push(item);
  }
  return out;
}

export function clearRing<T>(r: Ring<T>) {
  r.items.fill(undefined);
  r.next = 0;
  r.total = 0;
}

// ---------- deciding ----------

/** Whether a gap between frames is a hitch: not when the loop has just come back from a pause or a hidden tab. */
export const isFrameHitch = (gapMs: number, resumed: boolean) => !resumed && Number.isFinite(gapMs) && gapMs >= HITCH_MS;

/** The likeliest cause of a hitch, most specific first. */
export function guessCause(h: Pick<Hitch, 'kind' | 'programs' | 'textures' | 'uploads' | 'ws' | 'notes' | 'scripts' | 'detail'>): string {
  if (h.kind !== 'frame') return h.detail;
  if (h.programs > 0) return `shader compile (${h.programs} program${h.programs > 1 ? 's' : ''})`;
  const note = (kind: string) => h.notes.findLast((n) => n.kind === kind);
  const gfx = note('gfx');
  if (gfx) return `graphics tier change (${gfx.detail})`;
  const dpr = note('dpr');
  if (dpr) return `resolution change (${dpr.detail})`;
  const chunk = note('chunk');
  if (chunk) return `chunk loaded (${chunk.detail})`;
  const ws = h.ws.reduce<WsNote | null>((worst, w) => (!worst || w.ms > worst.ms ? w : worst), null);
  if (ws && (ws.ms >= SLOW_WS_MS || ws.bytes >= BIG_WS_BYTES)) return `websocket ${ws.type} (${Math.round(ws.bytes / 1024)} KB, ${Math.round(ws.ms)} ms to apply)`;
  const floor = note('floor');
  if (floor) return `floor change (${floor.detail})`;
  if (h.textures > 0 || h.uploads > UPLOADS_MANY) return `texture uploads (${h.uploads} uploads, ${h.textures} new)`;
  if (h.scripts.length) return `script: ${h.scripts[0]}`;
  const focus = h.notes.findLast((n) => n.kind === 'focus' || n.kind === 'visibility' || n.kind === 'lock');
  if (focus) return `${focus.kind} (${focus.detail})`;
  return 'main thread busy (unknown)';
}

/** The notes from the `CONTEXT_MS` before `at` (and in the gap), oldest first. */
export const notesBefore = (notes: readonly HitchNote[], at: number, gapMs: number) => notes.filter((n) => n.at <= at && n.at >= at - Math.max(gapMs, 0) - CONTEXT_MS);

export interface HitchSummary {
  /** Frame hitches kept, and the worst of them. */
  frames: number;
  worst: Hitch | null;
  paused: number;
  input: number;
  stuck: number;
  /** Frame hitches by cause, most first (causes cut to their first words so similar ones count together). */
  causes: [string, number][];
}

/** Cuts the numbers off a cause, so "shader compile (3 programs)" and "(1 program)" count together. */
export const causeGroup = (cause: string) => cause.replace(/\s*\(.*$/, '');

export function summarize(hitches: readonly Hitch[]): HitchSummary {
  const out: HitchSummary = { frames: 0, worst: null, paused: 0, input: 0, stuck: 0, causes: [] };
  const causes = new Map<string, number>();
  for (const h of hitches) {
    if (h.kind !== 'frame') {
      out[h.kind]++;
      continue;
    }
    out.frames++;
    if (!out.worst || h.ms > out.worst.ms) out.worst = h;
    const g = causeGroup(h.cause);
    causes.set(g, (causes.get(g) ?? 0) + 1);
  }
  out.causes = [...causes.entries()].sort((a, b) => b[1] - a[1]);
  return out;
}

/** The `?stats` line's part: "2 hitches · worst 180 ms (shader compile)", or "no hitches". */
export function statsLine(s: HitchSummary): string {
  if (!s.frames) return 'no hitches';
  return `${s.frames} hitch${s.frames > 1 ? 'es' : ''} · worst ${Math.round(s.worst!.ms)} ms (${causeGroup(s.worst!.cause)})`;
}

// ---------- walking without moving ----------

export interface StuckState {
  ms: number;
  reported: boolean;
}

export const newStuck = (): StuckState => ({ ms: 0, reported: false });

/**
 * One frame of the player: whether a movement key is held where walking should move them (`trying`) and whether
 * they moved. True once, when they've been held still for STUCK_MS; moving or letting go re-arms it.
 */
export function stuckStep(s: StuckState, trying: boolean, moved: boolean, dtMs: number): boolean {
  if (!trying || moved) {
    s.ms = 0;
    s.reported = false;
    return false;
  }
  s.ms += dtMs;
  if (s.reported || s.ms < STUCK_MS) return false;
  s.reported = true;
  return true;
}
