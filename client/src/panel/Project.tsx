// One project in the control panel: its header and actions (sync, preview, plan with the CEO, launch a task) and three
// tabs: the board (the office's Kanban), its agents and its settings.
import { useEffect, useMemo, useState } from 'react';
import type { RepoView } from '../../../shared/types';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore } from '../store';
import { pipelineOf } from '../pocket/pocketData';
import { confirmDialog } from '../ui/Confirm';
import { KanbanView } from '../ui/KanbanView';
import { AgentGrid, HireButton } from './Agents';
import { PipelineChips, PreviewChip } from './Overview';
import { shortName, type ProjectTab } from './panelData';
import type { Go } from './ControlPanel';

const TABS: [ProjectTab, string][] = [
  ['board', 'Tablero'],
  ['agents', 'Agentes'],
  ['settings', 'Ajustes'],
];

/** Runs an API call with the button disabled; errors were already toasted by api(). */
function useRun() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) useStore.getState().pushToast('success', done);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function Settings({ repo, go }: { repo: RepoView; go: Go }) {
  const [mission, setMission] = useState(repo.mission);
  const [busy, run] = useRun();
  useEffect(() => setMission(repo.mission), [repo.mission]);
  const toggle = (key: 'autoAssign' | 'autoMerge' | 'browserTesting', label: string, hint: string) => (
    <label className="cp-check" style={{ alignItems: 'flex-start' }}>
      <input type="checkbox" checked={repo[key]} disabled={busy} onChange={(e) => void run(() => api.updateRepo(repo.id, { [key]: e.target.checked }))} />
      <span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span className="cp-hint" style={{ display: 'block' }}>
          {hint}
        </span>
      </span>
    </label>
  );
  const disconnect = async () => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: `¿Desconectar ${shortName(repo.fullName)}?`,
      body: 'Sus agentes se van y deja de aparecer en el panel. El repositorio de GitHub y tus carpetas no se tocan.',
      confirm: 'Desconectar',
    });
    if (ok) await run(() => api.disconnectRepo(repo.id)).then(() => go({ page: 'overview' }));
  };
  return (
    <div className="cp-form" style={{ maxWidth: 720 }}>
      <section className="cp-card cp-card-pad cp-form">
        <h2>Cómo trabaja el equipo</h2>
        {toggle('autoAssign', 'Asignación automática', 'Los agentes libres cogen solos la siguiente issue desbloqueada del backlog.')}
        {toggle('autoMerge', 'Merge automático', 'Las PRs se fusionan solas cuando superan QA y los checks de GitHub están en verde.')}
        {toggle('browserTesting', 'QA en el navegador', 'QA abre la app con Playwright y adjunta capturas a cada PR.')}
      </section>
      <section className="cp-card cp-card-pad cp-form">
        <div className="cp-field">
          <label className="cp-label" htmlFor="cp-mission">
            Misión del proyecto
          </label>
          <textarea id="cp-mission" className="cp-textarea" rows={4} value={mission} onChange={(e) => setMission(e.target.value)} />
          <div className="cp-hint">Lo que se está construyendo. El CEO la usa para planificar y priorizar.</div>
        </div>
        <div className="cp-actions">
          <button className="cp-btn cp-btn-primary" disabled={busy || mission === repo.mission} onClick={() => void run(() => api.updateRepo(repo.id, { mission }), 'Misión guardada')}>
            Guardar misión
          </button>
        </div>
      </section>
      <section className="cp-card cp-card-pad cp-form">
        <h2>Zona peligrosa</h2>
        <div className="cp-actions">
          <button className="cp-btn cp-btn-danger" disabled={busy} onClick={() => void disconnect()}>
            Desconectar proyecto
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProjectPage({ repoId, tab, go, launch }: { repoId: string; tab: ProjectTab; go: Go; launch: (repoId: string) => void }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const [busy, run] = useRun();
  const team = useMemo(() => agentsOnRepo(agents, repoId).filter((a) => a.role !== 'ceo'), [agents, repoId]);
  const p = useMemo(() => (repo ? pipelineOf(kanbanFor(repo, team, qa)) : null), [repo, team, qa]);

  // Watch this project's floor, so its agents' terminal lines come to this tab (shared/watch.ts).
  useEffect(() => {
    if (repo) useStore.setState({ floor: repo.floor });
  }, [repo?.floor]);

  if (!repo || !p) return <p className="cp-empty">Ese proyecto ya no está conectado.</p>;
  const name = shortName(repo.fullName);
  const plan = async () => {
    const ok = await confirmDialog({
      title: `¿Pedir al CEO que planifique ${name}?`,
      body: 'Revisa la misión y lo que hay en GitHub y crea las issues que falten, con sus dependencias.',
      confirm: 'Planificar',
    });
    if (ok) await run(() => api.planFloor(repo.id), 'El CEO se pone con el plan');
  };

  return (
    <>
      <div className="cp-crumbs">
        <button className="cp-link-btn" style={{ fontWeight: 400, color: 'inherit' }} onClick={() => go({ page: 'overview' })}>
          Proyectos
        </button>{' '}
        / {name}
      </div>
      <header className="cp-header">
        <div className="cp-header-text">
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {name} <PreviewChip repo={repo} />
          </h1>
          <div className="cp-sub">
            {repo.localPath ? (
              <span>Carpeta local</span>
            ) : (
              <a href={repo.url} target="_blank" rel="noreferrer">
                {repo.fullName}
              </a>
            )}{' '}
            · rama {repo.defaultBranch} · {team.length} {team.length === 1 ? 'agente' : 'agentes'}
            {repo.summary ? ` · ${repo.summary}` : ''}
          </div>
        </div>
        <div className="cp-actions">
          <button className="cp-btn" disabled={busy} onClick={() => void run(() => api.syncRepo(repo.id), 'Sincronizado con GitHub')}>
            Sincronizar
          </button>
          <button className="cp-btn" onClick={() => useStore.getState().openOverlay({ kind: 'app', repoId: repo.id })}>
            Vista previa
          </button>
          <button className="cp-btn" disabled={busy} onClick={() => void plan()}>
            Planificar con el CEO
          </button>
          <button className="cp-btn cp-btn-primary" onClick={() => launch(repo.id)}>
            + Lanzar tarea
          </button>
        </div>
      </header>
      {repo.syncError && <div className="cp-banner cp-banner-bad">No se pudo sincronizar con GitHub: {repo.syncError}</div>}
      {repo.cloneStatus === 'error' && <div className="cp-banner cp-banner-bad">No se pudo clonar el repositorio: {repo.cloneError}</div>}
      <PipelineChips p={p} />

      <div className="cp-tabs" role="tablist" aria-label="Secciones del proyecto">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => go({ page: 'project', repoId: repo.id, tab: k })}>
            {label}
            {k === 'agents' ? ` · ${team.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <div className="cp-embed">
          <KanbanView key={repo.id} repoId={repo.id} embedded />
        </div>
      )}
      {tab === 'agents' && (
        <section>
          <div className="cp-section-title">
            <span className="cp-muted cp-small">Haz clic en un agente para ver su terminal, asignarle trabajo, escribirle o pararlo.</span>
            <span style={{ marginLeft: 'auto' }}>
              <HireButton repoId={repo.id} />
            </span>
          </div>
          <AgentGrid agents={team} />
        </section>
      )}
      {tab === 'settings' && <Settings repo={repo} go={go} />}
    </>
  );
}
