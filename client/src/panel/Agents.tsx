// The control panel's agents: a card per agent (opening their terminal, with every action of the office's panel),
// a grid of them, and the Agents page with every project's team.
import { useState } from 'react';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { api } from '../api';
import { agentsOnRepo, useStore, type Agent } from '../store';
import { agentLabel } from '../ui/floorRows';
import { doing } from '../pocket/pocketData';
import { agentState, initials, shortName } from './panelData';
import type { Go } from './ControlPanel';

export function Avatar({ agent, small }: { agent: Pick<Agent, 'name' | 'color'>; small?: boolean }) {
  return (
    <span className={`cp-avatar ${small ? 'cp-avatar-sm' : ''}`} style={{ background: agent.color }} aria-hidden>
      {initials(agent.name)}
    </span>
  );
}

export function AgentCard({ agent, repo }: { agent: Agent; repo?: RepoView }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const latest = useStore((s) => s.latest[agent.id]);
  const state = agentState(agent);
  const what = doing(agent);
  const where = agent.host === 'box' ? 'nube' : 'local';
  return (
    <button className="cp-agent" onClick={() => useStore.getState().openOverlay({ kind: 'terminal', agentId: agent.id })} aria-label={`${agent.name}: ${state.label}. Abrir su terminal`}>
      <div className="cp-agent-head">
        <Avatar agent={agent} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{agent.name}</div>
          <div className="cp-small cp-muted">
            {agentLabel(agent, settings, clis)} · {where}
            {repo ? ` · ${shortName(repo.fullName)}` : ''}
          </div>
        </div>
        <span className={`cp-chip cp-tone-${state.tone}`}>{state.label}</span>
      </div>
      <div className="cp-small">{what || 'Esperando una tarea'}</div>
      {latest && agent.status !== 'idle' && <div className="cp-agent-line cp-ellipsis">{latest.text}</div>}
      {agent.needsSignIn && <span className="cp-chip cp-tone-warn">Necesita que inicies sesión en su terminal</span>}
    </button>
  );
}

export function AgentGrid({ agents, repos }: { agents: Agent[]; repos?: RepoView[] }) {
  if (!agents.length) return <p className="cp-empty">Aquí aún no trabaja nadie.</p>;
  return (
    <div className="cp-agents">
      {agents.map((a) => (
        <AgentCard key={a.id} agent={a} repo={repos?.find((r) => r.id === a.repoId)} />
      ))}
    </div>
  );
}

/** Hires one more agent on a project, with the office's defaults (refused past the most agents per project). */
export function HireButton({ repoId }: { repoId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="cp-btn cp-btn-small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const a = await api.hireAgent(repoId);
          useStore.getState().pushToast('success', `${a.name} se une al equipo`);
        } catch {
          // toasted
        } finally {
          setBusy(false);
        }
      }}
    >
      + Añadir agente
    </button>
  );
}

export function AgentsPage({ go }: { go: Go }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const ceoInfo = useStore((s) => s.ceo);
  const ceo = agents[CEO_ID];
  const workers = Object.values(agents).filter((a) => a.role !== 'ceo');
  const busy = workers.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  return (
    <>
      <header className="cp-header">
        <div className="cp-header-text">
          <h1>Agentes</h1>
          <div className="cp-sub">
            {workers.length} {workers.length === 1 ? 'agente' : 'agentes'} · {busy} trabajando · haz clic en uno para ver su terminal, asignarle trabajo, escribirle o pararlo
          </div>
        </div>
      </header>
      {ceo && (
        <section className="cp-card cp-card-pad cp-agent-head">
          <Avatar agent={ceo} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>
              {ceo.name} <span className="cp-muted cp-small">CEO</span>
            </div>
            <div className="cp-small cp-muted">{ceo.status === 'working' ? (ceoInfo.job?.label ?? 'Trabajando') : ceoInfo.queue.length ? `Siguiente: ${ceoInfo.queue[0]!.label}` : 'Libre'}</div>
          </div>
          <button className="cp-btn cp-btn-small" style={{ marginLeft: 'auto' }} onClick={() => go({ page: 'ceo' })}>
            Hablar con el CEO
          </button>
        </section>
      )}
      {repos.length === 0 && <p className="cp-empty">Aún no hay proyectos, así que no hay equipo.</p>}
      {repos.map((repo) => (
        <section key={repo.id}>
          <div className="cp-section-title">
            <h2>
              <button className="cp-link-btn" onClick={() => go({ page: 'project', repoId: repo.id, tab: 'agents' })}>
                {shortName(repo.fullName)}
              </button>
            </h2>
            <span className="cp-muted cp-small">{agentsOnRepo(agents, repo.id).length} agentes</span>
            <span style={{ marginLeft: 'auto' }}>
              <HireButton repoId={repo.id} />
            </span>
          </div>
          <AgentGrid agents={agentsOnRepo(agents, repo.id).filter((a) => a.role !== 'ceo')} />
        </section>
      ))}
    </>
  );
}
