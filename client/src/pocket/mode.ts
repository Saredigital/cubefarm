// Which view this device gets: the control panel (the default on a computer) or pocket mode (for phones and touch
// screens; docs/pocket.md). ?view=panel|pocket (or the older ?pocket=1 / ?pocket=0) decides for one visit; a choice
// made in the app is remembered on this device.
import { create } from 'zustand';

export type ViewMode = 'panel' | 'pocket';

const KEY = 'sareoffice:mode';

/** The mode to start in: the URL's say, then this device's last choice, then pocket on narrow or touch-only screens. */
export function pickMode(x: { view?: string | null; param: string | null; saved: string | null; narrow: boolean; touch: boolean }): ViewMode {
  if (x.view === 'panel' || x.view === 'pocket') return x.view;
  if (x.param !== null) return x.param === '0' || x.param === 'false' ? 'panel' : 'pocket';
  // 'office' was the 3D office, now gone: the panel took its place.
  if (x.saved === 'panel' || x.saved === 'office') return 'panel';
  if (x.saved === 'pocket') return 'pocket';
  return x.narrow || x.touch ? 'pocket' : 'panel';
}

function startMode(): ViewMode {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // no storage: decide from the screen
  }
  const params = new URLSearchParams(location.search);
  return pickMode({
    view: params.get('view'),
    param: params.get('pocket'),
    saved,
    narrow: matchMedia('(max-width: 760px)').matches,
    touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
  });
}

export const useMode = create<{ mode: ViewMode }>(() => ({ mode: typeof window === 'undefined' ? 'panel' : startMode() }));

/** Switches this device to `mode` and remembers it. */
export function setMode(mode: ViewMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // remembered for this visit only
  }
  useMode.setState({ mode });
}
