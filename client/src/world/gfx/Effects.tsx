// The effects chunk's entry (Graphics.tsx loads it on Medium and High): takes over drawing the frame from R3F with
// the post-processing pipeline, and adds High's contact shadows. Unmounting it hands drawing back to R3F, exactly as
// on Low. With the frame loop stopped (a panel covering the view, a hidden tab) nothing here runs.
// Each tier's pipeline is kept once built, and the other tier's is built and drawn once a few seconds after the first
// shows, so Auto stepping between Medium and High never stops a frame to build passes and compile their shaders
// (#294). They're freed a minute after the office drops to Low.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { ContactShadows } from './ContactShadows';
import { photoActive } from '../../photo/gate';
import { hitchNote } from '../../hitches';
import { createPipeline, type Pipeline } from './pipeline';
import type { Tier } from './quality';
import { gfxBlocked, gfxShown, setPipelineStats } from './useGraphics';

type EffectsTier = Exclude<Tier, 'low'>;

interface Kept {
  scene: THREE.Scene;
  camera: THREE.Camera;
  pipe: Pipeline;
}

const kept = new Map<EffectsTier, Kept>();
/** How R3F had the renderer before the first pipeline took it over, for handing it back. */
let saved: { autoClear: boolean; autoReset: boolean } | null = null;
let dropTimer: ReturnType<typeof setTimeout> | undefined;
/** After the first pipeline shows, the other tier's is built and drawn once this much later. */
const WARM_MS = 4000;
const KEEP_AT_LOW_MS = 60_000;

function pipelineFor(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: EffectsTier): Pipeline {
  clearTimeout(dropTimer);
  saved ??= { autoClear: gl.autoClear, autoReset: gl.info.autoReset };
  const k = kept.get(tier);
  if (k && k.scene === scene && k.camera === camera) return k.pipe;
  k?.pipe.drop();
  const pipe = createPipeline(gl, scene, camera, tier);
  kept.set(tier, { scene, camera, pipe });
  return pipe;
}

/** The effects are gone (Low): R3F draws again, and the kept pipelines go if they aren't wanted back soon. */
function handBack(gl: THREE.WebGLRenderer) {
  if (saved) {
    gl.autoClear = saved.autoClear;
    gl.info.autoReset = saved.autoReset;
    saved = null;
  }
  gl.setRenderTarget(null);
  clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    for (const k of kept.values()) k.pipe.drop();
    kept.clear();
  }, KEEP_AT_LOW_MS);
}

export default function Effects({ tier }: { tier: EffectsTier }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const shown = useRef(false);
  const warm = useRef<{ at: number; done: boolean }>({ at: 0, done: false });

  // Built in an effect (not during render). Errors reach Graphics.tsx's guard.
  useLayoutEffect(() => {
    const p = pipelineFor(gl, scene, camera, tier);
    shown.current = false;
    setPipe(p);
    return () => {
      setPipelineStats(null);
      gfxShown('low');
    };
  }, [gl, scene, camera, tier]);

  useEffect(() => () => handBack(gl), [gl]);

  useLayoutEffect(() => pipe?.setSize(size.width, size.height), [pipe, size, dpr]);

  // Stats for __swarmGfx, refreshed now and then rather than every frame.
  useEffect(() => {
    if (!pipe) return;
    const t = setInterval(() => setPipelineStats(pipe.stats()), 1000);
    return () => clearInterval(t);
  }, [pipe]);

  // Priority 1: R3F stops drawing the frame itself while this is mounted.
  useFrame((_, delta) => {
    if (photoActive()) return; // photo mode draws the frame from its own camera (photo/PhotoScene.tsx)
    if (!pipe) {
      gl.render(scene, camera);
      return;
    }
    try {
      // Warming up: the other tier's pipeline draws once (compiling its shaders), then this one draws over it.
      const w = warm.current;
      if (!w.done && w.at && performance.now() >= w.at) {
        w.done = true;
        const other: EffectsTier = tier === 'high' ? 'medium' : 'high';
        if (!kept.has(other)) {
          const t0 = performance.now();
          const p = pipelineFor(gl, scene, camera, other);
          p.setSize(size.width, size.height);
          p.render(delta);
          hitchNote('warmup', `${other} effects built in ${Math.round(performance.now() - t0)} ms`);
        }
      }
      pipe.render(delta);
    } catch (err) {
      // The frame loop is outside React's error handling: switch the effects off rather than throw every frame.
      gfxBlocked('they stopped with an error', err);
      gl.render(scene, camera);
      return;
    }
    if (!shown.current) {
      shown.current = true;
      if (!warm.current.at) warm.current.at = performance.now() + WARM_MS;
      setPipelineStats(pipe.stats());
      gfxShown(tier);
    }
  }, 1);

  return tier === 'high' ? <ContactShadows /> : null;
}
