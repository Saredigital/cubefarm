// Settings → Accessibility: captions, colour-blind-safe status, motion comfort, UI scale and readability, and how to
// use the office by keyboard. Everything is saved in this browser (a11y.ts) and applies at once. In pocket mode the
// 3D-only parts (motion, the field of view) are left out.
import { useId, type ReactNode } from 'react';
import { resetA11y, setA11y, useA11y } from './a11y';
import { DEFAULT_A11Y, LIMITS, reducesMotion, showsShapes, type A11yPrefs, type ReduceMotion } from './a11yPrefs';
import { KIND_ICON, KIND_WORD, kindStrong, PALETTE_LABELS, PALETTES, STATUS_KINDS, type Palette } from './statusLook';

function Toggle({ k, children, hint, disabled }: { k: 'captions' | 'statusShapes' | 'headBob' | 'cameraShake' | 'centerDot' | 'readableFont' | 'highContrast'; children: ReactNode; hint?: string; disabled?: boolean }) {
  const on = useA11y((s) => s.prefs[k]);
  const hintId = useId();
  return (
    <label className="toggle block">
      <input type="checkbox" checked={on || !!disabled} disabled={disabled} onChange={(e) => setA11y({ [k]: e.target.checked })} aria-describedby={hint ? hintId : undefined} />
      <span>
        <b>{children}</b>
        {hint && (
          <span className="muted small a11y-hint" id={hintId}>
            {' '}
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function Slider({ k, label, unit, describe }: { k: 'captionSize' | 'captionBg' | 'fov' | 'uiScale'; label: string; unit: string; describe?: (v: number) => string }) {
  const v = useA11y((s) => s.prefs[k]);
  const { min, max, step } = LIMITS[k];
  return (
    <label className="a11y-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} aria-valuetext={`${v}${unit}${describe ? `, ${describe(v)}` : ''}`} onChange={(e) => setA11y({ [k]: Number(e.target.value) })} />
      <b>
        {v}
        {unit}
      </b>
      {v !== DEFAULT_A11Y[k] && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setA11y({ [k]: DEFAULT_A11Y[k] })} aria-label={`Restablecer ${label.toLowerCase()}`}>
          Restablecer
        </button>
      )}
    </label>
  );
}

/** Each kind of status as it looks now: its colour and shape, and its name. */
function Swatches({ palette, shapes }: { palette: Palette; shapes: boolean }) {
  return (
    <ul className="status-swatches" aria-label="Cómo se ven los estados">
      {STATUS_KINDS.map((k) => (
        <li key={k} className={`status-kind status-kind-${k}`} style={{ ['--kind' as string]: kindStrong(k, palette) }}>
          {shapes && <span aria-hidden>{KIND_ICON[k]}</span>} {KIND_WORD[k]}
        </li>
      ))}
    </ul>
  );
}

const MOTION_LABELS: Record<ReduceMotion, string> = { system: 'Seguir el ajuste de mi sistema', on: 'Reducir siempre el movimiento', off: 'Movimiento completo' };

export function AccessibilitySettings({ pocket = false }: { pocket?: boolean }) {
  const prefs = useA11y((s) => s.prefs);
  const systemReduced = useA11y((s) => s.systemReduced);
  const name = useId();
  const shapes = showsShapes(prefs);
  const set = (p: Partial<A11yPrefs>) => setA11y(p);
  return (
    <>
      <section className="card a11y-card" aria-labelledby={`${name}-cap`}>
        <h3 id={`${name}-cap`}>💬 Subtítulos</h3>
        <Toggle k="captions" hint="Los mensajes del CEO escritos mientras se leen en voz alta y subtítulos breves para los sonidos importantes (el gong, la ovación de un merge, las alarmas, la jukebox) con una flecha hacia donde se han oído.">
          Mostrar subtítulos
        </Toggle>
        <Slider k="captionSize" label="Tamaño de los subtítulos" unit="%" />
        <Slider k="captionBg" label="Fondo de los subtítulos" unit="%" />
        <div className="captions captions-preview" aria-hidden style={{ ['--caption-scale' as string]: prefs.captionSize / 100, ['--caption-bg' as string]: prefs.captionBg / 100 }}>
          <div className="caption">[gong] ↗</div>
          <div className="caption caption-speech">
            <b>CEO:</b> La PR número 12 está lista para el merge.
          </div>
        </div>
      </section>

      <section className="card a11y-card" aria-labelledby={`${name}-col`}>
        <h3 id={`${name}-col`}>🎨 Color y estado</h3>
        <fieldset className="a11y-fieldset">
          <legend>Colores de estado</legend>
          {PALETTES.map((p) => (
            <label key={p} className="toggle block">
              <input type="radio" name={`${name}-palette`} checked={prefs.palette === p} onChange={() => set({ palette: p })} /> {PALETTE_LABELS[p]}
            </label>
          ))}
        </fieldset>
        <Toggle k="statusShapes" disabled={prefs.palette !== 'standard'} hint={prefs.palette !== 'standard' ? 'Siempre activadas con una paleta para daltonismo.' : 'En las etiquetas de nombre, la pizarra, las tarjetas del Kanban, las píldoras de estado y los avisos.'}>
          Formas junto a los colores de estado (✓ ✕ ! ⏳)
        </Toggle>
        <Swatches palette={prefs.palette} shapes={shapes} />
      </section>

      {!pocket && (
        <section className="card a11y-card" aria-labelledby={`${name}-mot`}>
          <h3 id={`${name}-mot`}>🌀 Movimiento</h3>
          <Slider k="fov" label="Campo de visión" unit="°" describe={(v) => (v < 72 ? 'más estrecho' : v > 72 ? 'más amplio' : 'normal')} />
          <Toggle k="headBob">Balanceo de la cabeza al caminar</Toggle>
          <Toggle k="cameraShake" hint="Cualquier balanceo o temblor de la pantalla.">
            Balanceo y temblor de la cámara
          </Toggle>
          <fieldset className="a11y-fieldset">
            <legend>Reducir el movimiento</legend>
            {(Object.keys(MOTION_LABELS) as ReduceMotion[]).map((m) => (
              <label key={m} className="toggle block">
                <input type="radio" name={`${name}-motion`} checked={prefs.reduceMotion === m} onChange={() => set({ reduceMotion: m })} /> {MOTION_LABELS[m]}
                {m === 'system' && <span className="muted small">(tu sistema {systemReduced ? 'pide menos movimiento' : 'no pide menos movimiento'})</span>}
              </label>
            ))}
            <p className="muted small">
              Movimiento reducido: los paneles, avisos e insignias aparecen sin moverse.{' '}
              {reducesMotion(prefs.reduceMotion, systemReduced) ? 'Activado ahora.' : 'Desactivado ahora.'}
            </p>
          </fieldset>
          <Toggle k="centerDot" hint="Un punto fijo en el centro de la vista, que ayuda a algunas personas con el mareo.">
            Punto central
          </Toggle>
        </section>
      )}

      <section className="card a11y-card" aria-labelledby={`${name}-read`}>
        <h3 id={`${name}-read`}>🔎 Tamaño y legibilidad</h3>
        <Slider k="uiScale" label="Escala de la interfaz" unit="%" />
        <p className="muted small">El HUD, el móvil, la consola y todos los paneles, del 80 % al 150 %.</p>
        <Toggle k="readableFont" hint="Verdana, con más espacio entre letras, palabras y líneas, como recomiendan las guías de estilo para la dislexia.">
          Fuente adaptada a la dislexia
        </Toggle>
        <Toggle k="highContrast" hint="Paneles blancos lisos, texto gris más oscuro, bordes y anillos de foco más gruesos.">
          Paneles de alto contraste
        </Toggle>
      </section>

      {!pocket && (
        <section className="card a11y-card" aria-labelledby={`${name}-kb`}>
          <h3 id={`${name}-kb`}>⌨️ Teclado y lectores de pantalla</h3>
          <p className="small">
            <kbd>Ctrl</kbd>+<kbd>K</kbd> lanza una tarea desde cualquier página. En cualquier panel,{' '}
            <kbd>Tab</kbd> y <kbd>Shift</kbd>+<kbd>Tab</kbd> pasan de un control a otro, <kbd>Enter</kbd> o <kbd>Space</kbd> lo usan y <kbd>Esc</kbd> cierra el panel; el foco vuelve a donde estaba.
            Los lectores de pantalla leen los mensajes del CEO y las alarmas en el momento.
          </p>
        </section>
      )}

      <div className="row">
        <button className="btn btn-ghost btn-small" onClick={resetA11y}>
          Restablecer los ajustes de accesibilidad
        </button>
      </div>
    </>
  );
}
