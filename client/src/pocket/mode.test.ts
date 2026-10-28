import { describe, expect, it } from 'vitest';
import { pickMode } from './mode';

describe('view mode', () => {
  const screen = { narrow: false, touch: false, saved: null, param: null };

  it('is the control panel on a computer and pocket mode on narrow or touch-only screens', () => {
    expect(pickMode(screen)).toBe('panel');
    expect(pickMode({ ...screen, narrow: true })).toBe('pocket');
    expect(pickMode({ ...screen, touch: true })).toBe('pocket');
  });

  it("follows this device's own choice over the screen, the old 3D office's included", () => {
    expect(pickMode({ ...screen, narrow: true, saved: 'panel' })).toBe('panel');
    expect(pickMode({ ...screen, narrow: true, saved: 'office' })).toBe('panel');
    expect(pickMode({ ...screen, saved: 'pocket' })).toBe('pocket');
    expect(pickMode({ ...screen, narrow: true, saved: 'nonsense' })).toBe('pocket');
  });

  it('follows ?pocket in the URL over the saved choice', () => {
    expect(pickMode({ ...screen, param: '' })).toBe('pocket');
    expect(pickMode({ ...screen, param: '1' })).toBe('pocket');
    expect(pickMode({ ...screen, narrow: true, saved: 'pocket', param: '0' })).toBe('panel');
    expect(pickMode({ ...screen, param: 'false' })).toBe('panel');
  });

  it('follows ?view over everything, and ignores an unknown one', () => {
    expect(pickMode({ ...screen, saved: 'pocket', param: '1', view: 'panel' })).toBe('panel');
    expect(pickMode({ ...screen, view: 'pocket' })).toBe('pocket');
    expect(pickMode({ ...screen, view: 'office' })).toBe('panel');
  });
});
