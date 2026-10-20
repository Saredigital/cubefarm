import { describe, expect, it } from 'vitest';
import { clearRing, guessCause, HITCH_MS, isFrameHitch, newRing, newStuck, notesBefore, pushRing, ringItems, statsLine, STUCK_MS, stuckStep, summarize, type Hitch } from './hitchLog';

const hitch = (over: Partial<Hitch> = {}): Hitch => ({
  kind: 'frame',
  at: 0,
  wall: '',
  ms: 150,
  cause: '',
  detail: '',
  floor: 1,
  camera: 'first',
  overlay: null,
  dpr: 1.75,
  gfx: 'high',
  programs: 0,
  textures: 0,
  uploads: 0,
  ws: [],
  notes: [],
  events: [],
  scripts: [],
  ...over,
});

describe('the ring', () => {
  it('keeps the last N, oldest first, and counts everything', () => {
    const r = newRing<number>(3);
    expect(ringItems(r)).toEqual([]);
    for (let i = 1; i <= 5; i++) pushRing(r, i);
    expect(ringItems(r)).toEqual([3, 4, 5]);
    expect(r.total).toBe(5);
    clearRing(r);
    expect(ringItems(r)).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('is in order before it fills', () => {
    const r = newRing<string>(50);
    pushRing(r, 'a');
    pushRing(r, 'b');
    expect(ringItems(r)).toEqual(['a', 'b']);
  });
});

describe('what counts as a hitch', () => {
  it('is a gap of HITCH_MS or more, not one after a pause', () => {
    expect(isFrameHitch(HITCH_MS - 1, false)).toBe(false);
    expect(isFrameHitch(HITCH_MS, false)).toBe(true);
    expect(isFrameHitch(5000, true)).toBe(false);
    expect(isFrameHitch(Number.NaN, false)).toBe(false);
  });

  it('keeps the notes from the second before it and its gap', () => {
    const notes = [
      { at: 100, kind: 'dpr', detail: 'old' },
      { at: 1900, kind: 'dpr', detail: 'recent' },
      { at: 2950, kind: 'gfx', detail: 'in the gap' },
      { at: 3100, kind: 'gfx', detail: 'after' },
    ];
    expect(notesBefore(notes, 3000, 200).map((n) => n.detail)).toEqual(['recent', 'in the gap']);
  });
});

describe('the cause', () => {
  it('names shader compiles first', () => {
    expect(guessCause(hitch({ programs: 3, notes: [{ at: 0, kind: 'dpr', detail: '1.75 → 1.5' }] }))).toBe('shader compile (3 programs)');
  });

  it('then tier and resolution changes, chunks and websocket applies', () => {
    expect(guessCause(hitch({ notes: [{ at: 0, kind: 'dpr', detail: '1.75 → 1.5' }] }))).toBe('resolution change (1.75 → 1.5)');
    expect(guessCause(hitch({ notes: [{ at: 0, kind: 'dpr', detail: 'x' }, { at: 1, kind: 'gfx', detail: 'high → medium' }] }))).toBe('graphics tier change (high → medium)');
    expect(guessCause(hitch({ notes: [{ at: 0, kind: 'chunk', detail: 'Plane.js' }] }))).toBe('chunk loaded (Plane.js)');
    expect(guessCause(hitch({ ws: [{ type: 'agents', bytes: 2000, ms: 2 }, { type: 'snapshot', bytes: 200 * 1024, ms: 80 }] }))).toBe('websocket snapshot (200 KB, 80 ms to apply)');
  });

  it('ignores small, quick messages and a texture upload or two', () => {
    expect(guessCause(hitch({ ws: [{ type: 'agents', bytes: 2000, ms: 2 }], uploads: 6 }))).toBe('main thread busy (unknown)');
    expect(guessCause(hitch({ uploads: 20 }))).toBe('texture uploads (20 uploads, 0 new)');
  });

  it('uses the browser attribution when nothing else explains it', () => {
    expect(guessCause(hitch({ scripts: ['apply @ store.ts (120 ms)'] }))).toBe('script: apply @ store.ts (120 ms)');
  });

  it('is the detail for pauses and stalls', () => {
    expect(guessCause(hitch({ kind: 'paused', detail: 'kanban covers the view' }))).toBe('kanban covers the view');
  });
});

describe('the summary', () => {
  it('counts frame hitches, the worst and the causes, and the other kinds apart', () => {
    const s = summarize([
      hitch({ ms: 120, cause: 'shader compile (1 program)' }),
      hitch({ ms: 300, cause: 'shader compile (4 programs)' }),
      hitch({ ms: 200, cause: 'resolution change (1.75 → 1.5)' }),
      hitch({ kind: 'paused', ms: 5000 }),
      hitch({ kind: 'stuck', ms: 400 }),
    ]);
    expect(s.frames).toBe(3);
    expect(s.worst?.ms).toBe(300);
    expect(s.paused).toBe(1);
    expect(s.stuck).toBe(1);
    expect(s.causes).toEqual([
      ['shader compile', 2],
      ['resolution change', 1],
    ]);
    expect(statsLine(s)).toBe('3 hitches · worst 300 ms (shader compile)');
    expect(statsLine(summarize([]))).toBe('no hitches');
  });
});

describe('walking without moving', () => {
  it('reports once after STUCK_MS held still, and re-arms when moving or letting go', () => {
    const s = newStuck();
    expect(stuckStep(s, true, false, STUCK_MS - 10)).toBe(false);
    expect(stuckStep(s, true, false, 20)).toBe(true);
    expect(stuckStep(s, true, false, 1000)).toBe(false);
    expect(stuckStep(s, true, true, 16)).toBe(false);
    expect(stuckStep(s, true, false, STUCK_MS)).toBe(true);
    expect(stuckStep(s, false, false, 16)).toBe(false);
    expect(s.ms).toBe(0);
  });
});
