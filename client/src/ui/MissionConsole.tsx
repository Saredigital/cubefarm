import { useEffect } from 'react';
import { api } from '../api';
import { fmtDuration, fmtPct, fmtUsd, usageMeter } from '../ops';
import { useStore } from '../store';
import type { DoctorFinding, DoctorFix, OpsAlarm, OpsNumbers, RepoView } from '../../../shared/types';
import { confirmDialog } from './Confirm';

// The manager's console → Mission control: Claude's usage with "Resume full speed", what needs you (the alarms the
// lobby wall's beacon rings for), the office doctor's findings with their one-click fixes, and every floor's numbers
// from the wall as a table.

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

/** "Resume full speed": asks first, then clears pacing. From the console's button and E on the lobby's usage meter. */
export async function confirmResume() {
  const { usage, settings } = useStore.getState();
  if (usage.state !== 'pacing') return;
  if (document.pointerLockElement) document.exitPointerLock();
  const m = usageMeter(usage, Date.now());
  const ok = await confirmDialog({
    icon: '⏩',
    tone: 'warn',
    title: '¿Volver a toda velocidad?',
    body: (
      <>
        <p>
          Claude avisó de que el uso está alto{usage.warning ? ` (${m.limit})` : ''}, así que hasta {m.resets} los issues nuevos solo empiezan mientras haya menos de {settings.pacingSessions} sesi{settings.pacingSessions === 1 ? 'ón' : 'ones'} en marcha.
        </p>
        <p>Vuelve a toda velocidad si has recargado saldo o se ha reiniciado tu uso. Si Claude sigue rechazando una sesión por el límite, la oficina se pausa hasta que se reinicie.</p>
      </>
    ),
    confirm: 'Volver a toda velocidad',
  });
  if (ok) await attempt(() => api.resumeFullSpeed());
}

function UsageCard({ hot }: { hot: boolean }) {
  const usage = useStore((s) => s.usage);
  const sessions = useStore((s) => s.settings.pacingSessions);
  const demo = useStore((s) => s.demo);
  const m = usageMeter(usage, Date.now());
  const why =
    usage.state === 'pacing'
      ? `Hasta ${m.resets}, los issues nuevos solo empiezan mientras haya menos de ${sessions} sesi${sessions === 1 ? 'ón' : 'ones'} en marcha; el QA, las correcciones y el CEO siguen. ¿Has recargado saldo o se ha reiniciado tu uso? Vuelve a toda velocidad.`
      : usage.state === 'paused'
        ? `Claude rechazó una sesión por el límite, así que no empieza nada nuevo hasta ${m.resets}. No se puede quitar antes; las sesiones que ya están en marcha siguen.`
        : 'El trabajo nuevo empieza a toda velocidad. Cuando Claude avisa de que el uso está alto, la oficina se modera (Ajustes → Sesiones en modo moderado).';
  return (
    <div id="ops-card-usage" className={`card usage-card usage-${m.tone} ${hot ? 'ops-card-hot' : ''}`}>
      <div className="row wrap">
        <b>🤖 Uso de Claude</b>
        <span className={`pill usage-pill-${m.tone}`}>{m.state}</span>
        <span className="spacer" />
        <button
          className="btn btn-small btn-good"
          disabled={usage.state !== 'pacing'}
          title={usage.state === 'paused' ? 'Una pausa por el límite no se puede quitar antes' : usage.state === 'normal' ? 'Ya va a toda velocidad' : 'Dejar de moderar los issues nuevos ahora'}
          onClick={() => void confirmResume()}
        >
          ⏩ Volver a toda velocidad
        </button>
      </div>
      <div className="usage-gauge" role="meter" aria-label="Uso de Claude en el último aviso" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pct ?? 0}>
        <div style={{ width: `${Math.min(100, m.pct ?? 0)}%`, background: (m.pct ?? 0) >= 90 ? 'var(--bad)' : (m.pct ?? 0) >= 75 ? 'var(--warn)' : 'var(--good)' }} />
      </div>
      <div className="small">
        <b>{m.limit}</b>
        {m.resets && ` · se reinicia ${m.resets}`}
      </div>
      <div className="muted small">{why}</div>
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('warning'))}>
            Simular un aviso de uso
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('limit'))}>
            Simular que se llega al límite
          </button>
        </div>
      )}
    </div>
  );
}

function AlarmCard({ alarm, repo, hot }: { alarm: OpsAlarm; repo: RepoView | undefined; hot: boolean }) {
  const openOverlay = useStore((s) => s.openOverlay);
  const goToFloor = useStore((s) => s.goToFloor);
  const pr = alarm.prNumber !== null ? repo?.pulls.find((p) => p.number === alarm.prNumber) : undefined;
  return (
    <div id={`ops-card-${alarm.id}`} className={`card floor-card alarm-card ${hot ? 'ops-card-hot' : ''}`} style={{ ['--accent' as string]: repo?.color ?? '#ef476f' }}>
      <div className="row">
        <span className="floor-badge">{alarm.floor}</span>
        <div className="grow">
          <b>🚨 {alarm.text}</b>
          <div className="muted small">
            {repo?.fullName ?? alarm.repoId}
            {pr ? ` · ${pr.title}` : ''} · desde las {new Date(alarm.since).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
      <div className="row wrap">
        {alarm.kind === 'pr' && alarm.prNumber !== null ? (
          <>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId: alarm.repoId })}>
              📋 Abrir el tablero Kanban
            </button>
            <button className="btn btn-small btn-good" onClick={() => void attempt(() => api.sendToQa(alarm.repoId, alarm.prNumber!))}>
              Repetir QA
            </button>
            <button className="btn btn-small" title="Pasársela a su autor, o a cualquier agente libre, con lo que ha encontrado el QA" onClick={() => void attempt(() => api.sendBack(alarm.repoId, alarm.prNumber!))}>
              Devolver para corregir
            </button>
            {pr && (
              <a className="small" href={pr.url} target="_blank" rel="noreferrer">
                PR en GitHub ↗
              </a>
            )}
          </>
        ) : (
          alarm.agentId && (
            <>
              <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: alarm.agentId! })}>
                Terminal
              </button>
              <button className="btn btn-small btn-good" title="Despejar su puesto para que coja trabajo nuevo" onClick={() => void attempt(() => api.reset(alarm.agentId!))}>
                Despejar puesto
              </button>
            </>
          )
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-ghost" onClick={() => goToFloor(alarm.floor)}>
          Visitar la planta {alarm.floor}
        </button>
      </div>
    </div>
  );
}

const FIXES: Record<DoctorFix, [string, string]> = {
  clear: ['↺ Despejar puesto', 'Despejar su puesto para que coja trabajo nuevo'],
  stop: ['■ Parar', 'Parar su sesión'],
  requeue: ['↩ Volver a la cola', 'Pararlo y devolver el trabajo a la cola, sin penalización'],
  'retry-qa': ['Repetir QA', 'Poner la PR en cola para una nueva revisión de QA'],
  'send-back': ['Devolver para corregir', 'Pasar la PR a su autor, o a cualquier agente libre'],
  'close-issue': ['Cerrar issue', 'Cerrar el issue en GitHub como completado'],
};

async function applyFix(f: DoctorFinding, fix: DoctorFix) {
  if (fix === 'close-issue') {
    if (document.pointerLockElement) document.exitPointerLock();
    const ok = await confirmDialog({
      icon: '🩺',
      tone: 'warn',
      title: `¿Cerrar el issue #${f.issueNumber}?`,
      body: <p>Se cierra en GitHub como completado, con un comentario que dice que lo resolvió la PR #{f.prNumber}.</p>,
      confirm: 'Cerrar issue',
    });
    if (!ok) return;
  }
  await attempt(() => api.doctorFix(f.id, fix));
}

function DoctorCard({ finding: f, repo }: { finding: DoctorFinding; repo: RepoView | undefined }) {
  const openOverlay = useStore((s) => s.openOverlay);
  return (
    <div id={`ops-card-doctor-${f.id}`} className="card floor-card alarm-card doctor-card" style={{ ['--accent' as string]: repo?.color ?? '#7c6cf0' }}>
      <div className="row">
        <span className="floor-badge">{repo?.floor ?? '?'}</span>
        <div className="grow">
          <b>🩺 {f.text}</b>
          <div className="muted small">
            {repo?.fullName ?? f.repoId} · desde las {new Date(f.since).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
      <div className="row wrap">
        {f.fixes.map((fix, i) => (
          <button key={fix} className={`btn btn-small ${i === 0 ? 'btn-good' : ''}`} title={FIXES[fix][1]} onClick={() => void applyFix(f, fix)}>
            {FIXES[fix][0]}
          </button>
        ))}
        {f.agentId && (
          <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: f.agentId! })}>
            Terminal
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-ghost" title="Ocultarlo hasta que desaparezca" onClick={() => void attempt(() => api.doctorIgnore(f.id))}>
          Ignorar
        </button>
      </div>
    </div>
  );
}

async function demoDoctor(action: Parameters<typeof api.demoDoctor>[0]) {
  const r = await attempt(() => api.demoDoctor(action));
  if (r) useStore.getState().pushToast('info', r.text);
}

function DoctorSection({ hot }: { hot: boolean }) {
  const doctor = useStore((s) => s.doctor);
  const repos = useStore((s) => s.repos);
  const demo = useStore((s) => s.demo);
  return (
    <div id="ops-card-doctor" className={hot ? 'ops-card-hot' : ''}>
      <h3 className="section">🩺 Médico de la oficina {doctor.length > 0 && <span className="badge">{doctor.length}</span>}</h3>
      {doctor.length === 0 && (
        <p className="muted small">Nada atascado. Cada minuto, el vigilante da un toque a las sesiones calladas, libera los puestos atascados y devuelve a la cola el trabajo huérfano por su cuenta; lo que no puede arreglar con seguridad aparece aquí.</p>
      )}
      {doctor.map((f) => (
        <DoctorCard key={f.id} finding={f} repo={repos.find((r) => r.id === f.repoId)} />
      ))}
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" title="Reiniciar con puestos desaparecidos y trabajo terminado en GitHub mientras tanto" onClick={() => void demoDoctor('restart')}>
            Simular un reinicio
          </button>
          <button className="btn btn-small btn-ghost" title="La sesión de alguien se queda callada 20 minutos" onClick={() => void demoDoctor('stuck')}>
            Atascar una sesión
          </button>
          <button className="btn btn-small btn-ghost" title="Pasan diez minutos más para las sesiones atascadas" onClick={() => void demoDoctor('later')}>
            10 minutos después
          </button>
          <button className="btn btn-small btn-ghost" title="Una PR fusionada cuyo issue nunca se cerró" onClick={() => void demoDoctor('unclosed')}>
            Dejar un issue abierto
          </button>
        </div>
      )}
    </div>
  );
}

const COLUMNS: [string, (n: OpsNumbers) => string, string?][] = [
  ['Listos', (n) => String(n.ready), 'Issues del backlog que pueden empezar ya'],
  ['En construcción', (n) => String(n.building)],
  ['En QA', (n) => String(n.inQa)],
  ['En corrección', (n) => String(n.fixing), 'De vuelta con un agente: hallazgos de QA, checks o un conflicto'],
  ['Para fusionar', (n) => String(n.toMerge)],
  ['Te necesitan', (n) => `${n.needsYou}${n.triage ? ` (+${n.triage} 🧭)` : ''}`, '🧭: el CEO lo está mirando primero'],
  ['Fusionadas hoy', (n) => `${n.mergedToday} (${n.mergedHour} en la última hora)`],
  ['Tiempo de entrega', (n) => fmtDuration(n.leadMs), 'Mediana de issue → merge en las últimas 24 horas'],
  ['Espera de QA', (n) => fmtDuration(n.qaWaitMs), 'Mediana de espera hasta un agente libre en las últimas 24 horas'],
  ['CI', (n) => (n.ciRuns ? `${fmtPct(n.ciPass)} · ${fmtDuration(n.ciMs)}` : '—'), 'Checks de GitHub en 7 días: tasa de éxito · tiempo mediano'],
  ['Equipo', (n) => `${n.busy} ocupados · ${n.idle} libres${n.errors ? ` · ${n.errors} con error` : ''}`],
  ['Coste de hoy', (n) => `~${fmtUsd(n.costToday)}`, 'Una estimación a partir del coste que informan las sesiones terminadas'],
];

function OpsTable() {
  const ops = useStore((s) => s.ops);
  const repos = useStore((s) => s.repos);
  const rows: [string, string, OpsNumbers][] = [
    ...ops.floors.map((f): [string, string, OpsNumbers] => {
      const r = repos.find((x) => x.id === f.repoId);
      return [`${f.floor} · ${r?.fullName.split('/')[1] ?? f.repoId}`, r?.color ?? '#ccc', f];
    }),
    ['Todas las plantas', '#1f1d2b', ops.total],
  ];
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th />
            {rows.map(([name, color]) => (
              <th key={name} style={{ ['--accent' as string]: color }} className="ops-col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COLUMNS.map(([label, value, tip]) => (
            <tr key={label}>
              <th title={tip}>{label}</th>
              {rows.map(([name, , n]) => (
                <td key={name}>{value(n)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ops.ceoCostToday > 0 && <div className="muted small">Sesiones del CEO hoy: ~{fmtUsd(ops.ceoCostToday)} (incluidas en el coste de Todas las plantas).</div>}
    </div>
  );
}

export function OpsTab({ card }: { card?: string }) {
  const alarms = useStore((s) => s.ops.alarms);
  const repos = useStore((s) => s.repos);
  useEffect(() => {
    if (card) document.getElementById(`ops-card-${card}`)?.scrollIntoView({ block: 'center' });
  }, [card]);
  return (
    <div className="tab-grid">
      <div>
        <UsageCard hot={card === 'usage'} />
        <h3 className="section">🚨 Te necesita {alarms.length > 0 && <span className="badge">{alarms.length}</span>}</h3>
        {alarms.length === 0 && <p className="muted small">Todo en orden. Aquí aparecen las PRs que te necesitan y los agentes que llevan 10 minutos atascados en un error.</p>}
        {alarms.map((a) => (
          <AlarmCard key={a.id} alarm={a} repo={repos.find((r) => r.id === a.repoId)} hot={a.id === card} />
        ))}
        <DoctorSection hot={card === 'doctor'} />
      </div>
      <div>
        <h3 className="section">🛰️ Las cifras</h3>
        <OpsTable />
      </div>
    </div>
  );
}
