import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AdaptiveResolution, currentDpr, FrameWhilePaused, HitchProbe, ScenePrecompile, StatsProbe, statsEnabled, usePageHidden, useRenderPaused } from '../perf';
import { hitchPaused } from '../hitches';
import { setOfficeCanvas, usePhotoGate } from '../photo/gate';
import { coversView, repoOnFloor, useStore } from '../store';
import { useA11y } from '../ui/a11y';
import { ding, whoosh } from '../ui/sfx';
import { Batches } from './Batched';
import { CameraRig } from './camera/CameraRig';
import { cameraMode } from './camera/rig';
import { Chatter } from './Chatter';
import { CUT_PLANES } from './camera/rig';
import { lobbyColliders, officeColliders, ROOF, roofColliders } from './layout';
import { decorRects } from './decor/decor';
import { Graphics } from './gfx/Graphics';
import { Lobby } from './Lobby';
import { OfficeFloor } from './OfficeFloor';
import { Outside } from './Outside';
import { City } from './outside/City';
import { Player } from './Player';
import { Presence } from './presence/Presence';
import { DayLights } from './sky/DayLights';
import { Sky } from './sky/Sky';
import { DayClock } from './sky/useDayTime';
import { SoundListener } from './SoundListener';
import { Soundscape } from './Soundscape';
import { useTheme } from './themes/active';
import { ThemeLayer } from './themes/ThemeLayer';
import { decorColliders } from './themes/themes';
import { TypingSounds } from './TypingSounds';
import { Weather } from './weather/Weather';
import { WorldEvents } from './events/WorldEvents';
import { runningEvents } from './events/eventsState';

// The roof is its own chunk: fetched as the elevator heads up there, never by a floor that doesn't go.
const loadRoof = () => import('./roof/Roof');
const Roof = lazy(loadRoof);
// Photo mode's camera and drawing load the first time it's opened.
const PhotoScene = lazy(() => import('../photo/PhotoScene'));

const eventIds = () => runningEvents().map((r) => r.id);

/** Tells the hitch recorder (hitches.ts) whenever the 3D view stops drawing, and why. */
function usePauseLog(frozen: boolean) {
  const overlay = useStore((s) => (coversView(s.overlay) ? s.overlay!.kind : null));
  const hidden = usePageHidden();
  const reason = hidden ? 'tab hidden' : overlay ? `${overlay} covers the view` : frozen ? 'photo mode frozen' : null;
  useEffect(() => hitchPaused(reason), [reason]);
}

/** The floor's room, re-rendered when its own repo changes (OfficeFloor is memoised on it), not Game. */
function OfficeRoom({ repoId }: { repoId: string }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  return repo ? <OfficeFloor repo={repo} /> : null;
}

function Travel() {
  const travel = useStore((s) => s.travel);
  const finish = useStore((s) => s.finishTravel);
  useEffect(() => {
    if (!travel) return;
    if (travel.phase === 'closing') whoosh(0.75);
    const t = setTimeout(
      () => {
        if (travel.phase === 'closing') {
          finish('arrived');
          ding();
        } else finish('done');
      },
      travel.phase === 'closing' ? 750 : 650,
    );
    return () => clearTimeout(t);
  }, [travel, finish]);
  return null;
}

/** The field of view from Settings → Accessibility (72°, the camera's own, unless changed). */
function FieldOfView() {
  const fov = useA11y((s) => s.prefs.fov);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || camera.fov === fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, fov, invalidate]);
  return null;
}

export function Game() {
  const floor = useStore((s) => s.floor);
  const onRoof = floor === ROOF;
  // Only this floor's id: a change to any floor (a websocket patch) re-rendering Game would re-render the whole scene.
  const repoId = useStore((s) => (floor === 0 || onRoof ? null : (repoOnFloor(s.repos, floor)?.id ?? null)));
  const isOffice = !!repoId;
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const placed = useStore((s) => (repoId ? s.progress.floors[repoId]?.placed : undefined));
  const theme = useTheme((s) => s.id);
  const colliders = useMemo(
    () =>
      onRoof
        ? roofColliders()
        : [...(isOffice ? [...officeColliders(), ...decorRects(placed ?? {})] : lobbyColliders()), ...decorColliders(theme, isOffice ? 'office' : 'lobby')],
    [onRoof, isOffice, placed, theme],
  );
  const toRoof = useStore((s) => s.travel?.to === ROOF);
  useEffect(() => {
    if (toRoof) void loadRoof();
  }, [toRoof]);
  // Stop drawing while nobody can see the office; switching back to 'always' draws a fresh frame at once.
  const paused = useRenderPaused();
  // Photo mode's freeze stops the frame loop too: nothing in the office moves (the server and its events carry on).
  const photo = usePhotoGate((s) => s.active);
  const frozen = usePhotoGate((s) => s.frozen);
  usePauseLog(frozen);

  return (
    <Canvas
      shadows
      frameloop={paused || frozen ? 'never' : 'always'}
      dpr={currentDpr()}
      camera={{ fov: 72, near: 0.05, far: 560, position: [0, 1.65, 10] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        setOfficeCanvas(gl.domElement);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.clippingPlanes = CUT_PLANES; // the overview's cutaway, out of the way until it's used (camera/rig.ts)
      }}
    >
      <DayClock />
      <Weather kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} />
      <Sky />
      <DayLights />
      <City />
      <WorldEvents kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} />
      {/* the floor's repeated parts (desks, chairs, props, people) are drawn as instanced batches (Batched.tsx) */}
      <Batches key={onRoof ? 'roof' : (repoId ?? 'lobby')}>
        <Suspense fallback={null}>{onRoof ? <Roof top={top} /> : repoId ? <OfficeRoom key={repoId} repoId={repoId} /> : <Lobby />}</Suspense>
      </Batches>
      {!onRoof && <Outside key={isOffice ? floor : 0} kind={isOffice ? 'office' : 'lobby'} floor={isOffice ? floor : 0} top={top} />}
      <ThemeLayer key={onRoof ? ROOF : isOffice ? floor : 0} kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} floor={onRoof ? ROOF : isOffice ? floor : 0} top={top} repoId={repoId} />
      <Player colliders={colliders} floor={floor} />
      <Presence />
      <FieldOfView />
      <CameraRig />
      <Travel />
      <SoundListener />
      <Soundscape kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} repoId={repoId} />
      <TypingSounds />
      <Chatter />
      <FrameWhilePaused paused={paused} />
      <AdaptiveResolution paused={paused || frozen} />
      <ScenePrecompile paused={paused || frozen} watch={`${floor}:${theme}`} />
      <Graphics paused={paused || photo} />
      <HitchProbe paused={paused || frozen} camera={cameraMode} events={eventIds} />
      {statsEnabled && <StatsProbe paused={paused} />}
      {photo && (
        <Suspense fallback={null}>
          <PhotoScene />
        </Suspense>
      )}
    </Canvas>
  );
}
