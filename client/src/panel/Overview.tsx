// The control panel's overview: the office's numbers, every project's pipeline, what waits on the manager, recent
// activity and the agents.
import { useMemo } from 'react';
import type { PreviewStatus, RepoView } from '../../../shared/types';
import { agentsOnRepo, kanbanFor, useStore } from '../store';
import { approvalsBadge, pipelineOf, waitingOnYou, type Pipeline } from '../pocket/pocketData';
import { AgentGrid, Avatar } from './Agents';
import { ago, shortName, type Tone } from './panelData';
import type { Go } from './ControlPanel';

const STAGES: [keyof Pipeline, string, Tone | ''][] = [
  ['backlog', 'pendientes', ''],
  ['building', 'en curso', 'build'],
  ['qa', 'en QA', 'qa'],
  ['fixing', 'corrigiendo', 'fix'],
  ['ready', 'listas', 'good'],
  ['needsYou', 'te necesitan', 'warn'],
];

const PREVIEW: Record<PreviewStatus, [string, Tone | '']> = {
  running: ['● En marcha', 'good'],
  stopped: ['○ Parada', ''],
  unconfigured: ['Sin configurar', ''],
  preparing: ['Arrancando…', 'build'],
  installing: ['Instalando…', 'build'],
  starting: ['Arrancando…', 'build'],
  error: ['▲ Error', 'bad'],
};

export function PreviewChip({ repo }: { repo: RepoView }) {
  const [label, tone] = PREVIEW[repo.preview.status];
  return <span className={`cp-chip ${tone ? `cp-tone-${tone}` : ''}`}>{label}</span>;
}

export function PipelineChips({ p }: { p: Pipeline }) {
  const shown = STAGES.filter(([k]) => p[k] > 0);
  if (!shown.length) return <span className="cp-chip">Sin trabajo abierto</span>;
  return (
    <div className="cp-chips">
      {shown.map(([k, label, tone]) => (
        <span key={k} className={`cp-chip ${tone ? `cp-tone-${tone}` : ''}`}>
          {p[k]} {label}
        </span>
      ))}
    </div>
  );
}

export function Overview({ go, launch, connect }: { go: Go; launch: () => void; connect: () => void }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const ops = useStore((s) => s.ops);
  const ticker = useStore((s) => s.ticker);
  const now = Date.now();

  const rows = useMemo(
    () =>
      repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id).filter((a) => a.role !== 'ceo');
        const last = [...ticker].reverse().find((t) => t.repoId === repo.id);
        return { repo, team, p: pipelineOf(kanbanFor(repo, team, qa)), last };
      }),
    [repos, agents, qa, ticker],
  );
  const workers = Object.values(agents).filter((a) => a.role !== 'ceo');
  const busy = workers.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  const inQa = rows.reduce((n, r) => n + r.p.qa + r.p.fixing, 0);
  const fixing = rows.reduce((n, r) => n + r.p.fixing, 0);
  const w = waitingOnYou(repos, qa, requests);
  const waiting = approvalsBadge(w) + w.ready.length;
  const busyFirst = [...workers].sort((a, b) => Number(b.status !== 'idle') - Number(a.status !== 'idle'));
  const repoName = (id: string) => shortName(repos.find((r) => r.id === id)?.fullName ?? id);
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <>
      <header className="cp-header">
        <div className="cp-header-text">
          <h1>Resumen</h1>
          <div className="cp-sub">
            {today[0]!.toUpperCase() + today.slice(1)} · {repos.length} {repos.length === 1 ? 'proyecto' : 'proyectos'} · {workers.length} {workers.length === 1 ? 'agente' : 'agentes'}
          </div>
        </div>
        <button className="cp-btn cp-btn-primary" onClick={launch}>
          + Lanzar tarea <span className="cp-kbd">Ctrl K</span>
        </button>
      </header>

      <section className="cp-kpis" aria-label="Indicadores">
        <div className="cp-card cp-kpi">
          <div className="cp-kpi-label">Agentes trabajando</div>
          <div className="cp-kpi-n">
            {busy} <small>de {workers.length}</small>
          </div>
          <div className="cp-kpi-note">{workers.length - busy} libres para tareas nuevas</div>
        </div>
        <div className="cp-card cp-kpi">
          <div className="cp-kpi-label">PRs en QA</div>
          <div className="cp-kpi-n">{inQa}</div>
          <div className="cp-kpi-note">{fixing ? `${fixing} devueltas a corregir` : 'Ninguna devuelta a corregir'}</div>
        </div>
        <div className={`cp-card cp-kpi ${waiting ? 'cp-kpi-hot' : ''}`}>
          <div className="cp-kpi-label">Esperan tu aprobación</div>
          <div className="cp-kpi-n">{waiting}</div>
          <div className="cp-kpi-note">{waiting ? <button onClick={() => go({ page: 'approvals' })}>Revisar ahora</button> : 'Nada pendiente'}</div>
        </div>
        <div className="cp-card cp-kpi">
          <div className="cp-kpi-label">Fusionadas hoy</div>
          <div className="cp-kpi-n">{ops.total.mergedToday}</div>
          <div className="cp-kpi-note">{ops.total.mergedHour} en la última hora</div>
        </div>
      </section>

      <div className="cp-split">
        <section className="cp-card cp-split-main" style={{ overflow: 'hidden' }}>
          <div className="cp-card-head" style={{ padding: '16px 16px 0' }}>
            <h2>Proyectos</h2>
            <button className="cp-btn cp-btn-small" onClick={connect}>
              + Conectar repo o carpeta
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="cp-empty" style={{ padding: '0 16px 16px' }}>
              Aún no hay proyectos. Conecta un repositorio de GitHub o una carpeta para empezar.
            </p>
          ) : (
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>Proyecto</th>
                    <th>Flujo</th>
                    <th>Agentes</th>
                    <th>Vista previa</th>
                    <th>Última actividad</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ repo, team, p, last }) => (
                    <tr key={repo.id}>
                      <td>
                        <button className="cp-link-btn" onClick={() => go({ page: 'project', repoId: repo.id })}>
                          {shortName(repo.fullName)}
                        </button>
                        <div className="cp-small cp-muted">{repo.localPath ? 'Carpeta local' : repo.fullName}</div>
                      </td>
                      <td>
                        <PipelineChips p={p} />
                      </td>
                      <td>
                        {team.length ? (
                          <span className="cp-avatars" title={team.map((a) => a.name).join(', ')}>
                            {team.slice(0, 5).map((a) => (
                              <Avatar key={a.id} agent={a} small />
                            ))}
                          </span>
                        ) : (
                          <span className="cp-small cp-muted">Sin agentes</span>
                        )}
                      </td>
                      <td>
                        <PreviewChip repo={repo} />
                      </td>
                      <td className="cp-muted">{last ? ago(last.at, now) : repo.lastSync ? ago(repo.lastSync, now) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="cp-split-side">
          <section className="cp-card cp-card-pad">
            <div className="cp-card-head">
              <h2>Esperan tu aprobación</h2>
              <button className="cp-btn cp-btn-small" onClick={() => go({ page: 'approvals' })}>
                Ver todo
              </button>
            </div>
            {waiting === 0 && <p className="cp-empty">Nada espera tu respuesta.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {w.requests.slice(0, 3).map((r) => (
                <div key={r.id} className="cp-wait">
                  <div className="cp-chips">
                    <span className="cp-chip cp-tone-build">Cambio de equipo</span>
                    <span className="cp-small cp-muted">{repoName(r.repoId)}</span>
                  </div>
                  <div style={{ fontWeight: 500 }}>{r.kind === 'hire' ? `Incorporar a ${r.name}` : `Que ${r.name} deje el equipo`}</div>
                </div>
              ))}
              {[...w.stuck.map((s) => ({ ...s, ready: false })), ...w.ready.map((s) => ({ ...s, ready: true }))].slice(0, 4).map(({ repo, qa: q, ready }) => (
                <div key={`${repo.id}#${q.prNumber}`} className="cp-wait">
                  <div className="cp-chips">
                    <span className={`cp-chip ${ready ? 'cp-tone-good' : 'cp-tone-warn'}`}>{ready ? 'QA superada' : 'Te necesita'}</span>
                    <span className="cp-small cp-muted">{shortName(repo.fullName)}</span>
                  </div>
                  <div style={{ fontWeight: 500 }}>
                    PR #{q.prNumber} · {repo.pulls.find((p) => p.number === q.prNumber)?.title ?? ''}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="cp-card cp-card-pad">
            <h2 style={{ marginBottom: 12 }}>Actividad</h2>
            {ticker.length === 0 && <p className="cp-empty">Todavía no ha pasado nada hoy.</p>}
            <ol className="cp-feed">
              {[...ticker]
                .reverse()
                .slice(0, 8)
                .map((t) => (
                  <li key={t.id}>
                    <span className={`cp-dot cp-dot-${t.tone === 'good' ? 'good' : t.tone === 'bad' ? 'bad' : 'info'}`} />
                    <div>
                      {t.text} <span className="cp-muted">· {repoName(t.repoId)}</span>
                      <div className="cp-muted">{ago(t.at, now)}</div>
                    </div>
                  </li>
                ))}
            </ol>
          </section>
        </div>
      </div>

      <section className="cp-card cp-card-pad">
        <div className="cp-card-head">
          <h2>Agentes</h2>
          <button className="cp-btn cp-btn-small" onClick={() => go({ page: 'agents' })}>
            Ver todos
          </button>
        </div>
        <AgentGrid agents={busyFirst.slice(0, 8)} repos={repos} />
      </section>
    </>
  );
}
