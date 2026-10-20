import { describe, expect, it } from 'vitest';
import { cpuStats, eventType, floorsToVisit, frameStats, medianRun, parseReadout, portProblem, routeTour, wsStats, yawTo, type BenchRun } from './benchSteps.mjs';

describe('the benchmark', () => {
  it('never uses the live office or the preview ports', () => {
    expect(portProblem(4398)).toBeNull();
    expect(portProblem(4317)).toContain('live office');
    expect(portProblem(5317)).toContain('live office');
    expect(portProblem(6305)).toContain('preview');
    expect(portProblem(0)).toContain('not a port');
  });

  it('visits the lobby, the first, a middle and the top floor', () => {
    expect(floorsToVisit(10)).toEqual([0, 1, 5, 10]);
    expect(floorsToVisit(2)).toEqual([0, 1, 2]);
    expect(floorsToVisit(10, [3, 3, 12, 0])).toEqual([3, 0]);
  });

  it('turns frame timestamps into a frame rate and frame-time percentiles', () => {
    const stamps = [0];
    for (let i = 1; i <= 100; i++) stamps.push(stamps[i - 1] + (i % 20 === 0 ? 50 : 16));
    const s = frameStats(stamps);
    expect(s.frames).toBe(100);
    expect(s.fps).toBeCloseTo(100_000 / (95 * 16 + 5 * 50), 0);
    expect(s.frameMs.p50).toBe(16);
    expect(s.frameMs.p95).toBe(16);
    expect(s.frameMs.p99).toBe(50);
    expect(frameStats([5]).fps).toBe(0);
  });

  it('turns CPU time over a window into milliseconds per frame', () => {
    const before = { Timestamp: 100, ThreadTime: 10, ScriptDuration: 4, ProcessTime: 20 };
    const after = { Timestamp: 110, ThreadTime: 16, ScriptDuration: 7, ProcessTime: 32 };
    expect(cpuStats(before, after, 600)).toEqual({ mainMsPerFrame: 10, scriptMsPerFrame: 5, processMsPerFrame: 20, mainBusy: 0.6 });
    expect(cpuStats(null, after, 600).mainMsPerFrame).toBeNull();
  });

  it("reads the ?stats readout's counters", () => {
    expect(parseReadout('58 fps · 17.2 ms · 412 calls · 96k tris · dpr 1.00')).toEqual({ calls: 412, triangles: 96_000 });
    expect(parseReadout('30 fps · 33 ms · 1204 calls · 1.2M tris · dpr 1.00')).toEqual({ calls: 1204, triangles: 1_200_000 });
    expect(parseReadout('measuring…')).toBeNull();
  });

  it('adds up websocket traffic by event type', () => {
    expect(eventType('{"type":"log","agentId":"a"}')).toBe('log');
    expect(eventType('[1,2]')).toBe('other');
    const s = wsStats(
      [
        { bytes: 900, type: 'agent' },
        { bytes: 100, type: 'log' },
        { bytes: 100, type: 'log' },
      ],
      2,
    );
    expect(s).toEqual({ bytesPerSecond: 550, messagesPerSecond: 1.5, types: { agent: { perSecond: 0.5, bytesPerSecond: 450 }, log: { perSecond: 1, bytesPerSecond: 100 } } });
  });

  it('keeps the median of each number across runs', () => {
    const run = (fps: number, calls: number): BenchRun => ({
      frames: 10,
      fps,
      frameMs: { p50: 1000 / fps, p95: 2000 / fps, p99: null, max: null },
      renderer: { calls, triangles: calls * 100 },
      heapMB: 50,
      audioNodes: 10,
      ws: { bytesPerSecond: 1000, messagesPerSecond: 5, types: {} },
    });
    expect(medianRun([run(60, 300), run(20, 900), run(50, 320)])).toMatchObject({ fps: 50, drawCalls: 320, triangles: 32_000, heapMB: 50, wsBytesPerSecond: 1000 });
  });

  it('counts frames over 100 ms (the stalls p95 hides)', () => {
    expect(frameStats([0, 16, 32, 250, 266]).frameMs.over100).toBe(1);
  });

  it('walks a floor from the board to the coffee, the windows and the desks, and back', () => {
    const spots = ['elevator', 'desk-0', 'desk-1', 'desk-2', 'desk-3', 'window-w-0', 'coffee', 'board-0', 'gong'].map((id, i) => ({ id, x: i, z: 0 }));
    expect(routeTour(spots).map((s) => s.id)).toEqual(['board-0', 'coffee', 'window-w-0', 'desk-0', 'desk-3', 'elevator', 'desk-3', 'desk-0', 'window-w-0', 'coffee']);
    expect(routeTour([])).toEqual([]);
  });

  it('turns to face where it walks', () => {
    // The office walks toward (-sin yaw, -cos yaw): north (-z) is yaw 0, west (-x) is a quarter turn left.
    expect(yawTo({ x: 0, z: 0 }, { x: 0, z: -5 })).toBeCloseTo(0);
    expect(yawTo({ x: 0, z: 0 }, { x: -5, z: 0 })).toBeCloseTo(Math.PI / 2);
  });
});
