import { useMemo, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { confirmDialog } from './Confirm';
import { Panel } from './Panel';

/** Who has the card; "QA" while they're testing it. */
function AgentChip({ agent, card }: { agent?: Agent; card: KanbanCard }) {
  if (!agent) return null;
  return (
    <span className="agent-chip">
      <span className="dot" style={{ background: agent.color }} />
      {agent.name}
      {agent.task === 'qa' && card.prNumber != null && agent.prNumber === card.prNumber && <span className="chip">QA</span>}
    </span>
  );
}

export function IssueForm({ repoId, agents, onDone }: { repoId: string; agents: Agent[]; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const free = agents.filter((a) => a.role !== 'ceo' && a.status !== 'working' && a.status !== 'preparing');
  return (
    <form
      className="issue-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await api.createIssue(repoId, title, body, assignTo || undefined);
          setTitle('');
          setBody('');
          setAssignTo('');
          onDone?.();
        } catch {
          // toasted
        } finally {
          setBusy(false);
        }
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del issue, p. ej. Añadir un interruptor de modo oscuro" aria-label="Título del issue" autoFocus />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe lo que quieres. Los criterios de aceptación ayudan mucho al agente que lo construye y al que lo prueba." aria-label="Descripción del issue" rows={5} />
      <div className="row">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Quién se encarga">
          <option value="">Dejar en el backlog (la asignación automática lo recoge si está activada)</option>
          {free.map((a) => (
            <option key={a.id} value={a.id}>
              Dárselo ya a {a.name}
            </option>
          ))}
        </select>
        <button className="btn btn-good" disabled={busy || !title.trim()}>
          {busy ? 'Creando…' : 'Crear issue en GitHub'}
        </button>
      </div>
    </form>
  );
}

/** The board's frame: a panel over the office, or (in pocket mode) a plain section of the page. */
function Frame({ embedded, ...props }: Parameters<typeof Panel>[0] & { embedded?: boolean }) {
  if (!embedded) return <Panel {...props} />;
  return (
    <section className="kanban-embedded" style={{ ['--accent' as string]: props.accent }}>
      <h2 className="kanban-embedded-title">{props.title}</h2>
      {props.children}
    </section>
  );
}

function QaLink({ card }: { card: KanbanCard }) {
  if (!card.qa?.commentUrl) return null;
  return (
    <a className="small" href={card.qa.commentUrl} target="_blank" rel="noreferrer" title={card.qa.summary ?? ''}>
      Informe de QA ↗
    </a>
  );
}

export function KanbanView({ repoId, embedded }: { repoId: string; embedded?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const usageState = useStore((s) => s.usage.state);
  const openOverlay = useStore((s) => s.openOverlay);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agents, qaRecords, { state: usageState }) : null), [repo, agents, qaRecords, usageState]);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (!repo || !cols) {
    return (
      <Frame title="Kanban" embedded={embedded}>
        <p className="muted">Esta planta ya no existe.</p>
      </Frame>
    );
  }

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    try {
      await fn();
    } catch {
      // toasted
    } finally {
      setPending(null);
    }
  };
  const workers = agents.filter((a) => a.role !== 'ceo');
  const free = workers.filter((a) => a.status === 'idle' || a.status === 'done' || a.status === 'stopped' || a.status === 'error');
  const merge = async (c: KanbanCard) => {
    const passed = c.qa?.status === 'passed';
    const ok = await confirmDialog(
      passed
        ? { icon: '🎉', title: `¿Hacer merge de la PR #${c.number}?`, body: `«${c.title}» ha pasado QA. Se hará un squash merge en ${repo.defaultBranch}.`, confirm: 'Squash y merge' }
        : {
            tone: 'warn',
            title: `¿Hacer merge de la PR #${c.number} sin QA?`,
            body: `«${c.title}» todavía no ha pasado QA. ¿Hacer merge en ${repo.defaultBranch} de todos modos?`,
            confirm: 'Merge de todos modos',
          },
    );
    if (ok) void act(c.key, () => api.mergePull(repo.id, c.number));
  };
  const sendBack = async (c: KanbanCard) => {
    let note = '';
    const ok = await confirmDialog({
      icon: '🔧',
      title: `¿Devolver la PR #${c.number} para corregirla?`,
      body: (
        <>
          <p>Su autor, o cualquier agente libre, la corrige con lo que ha encontrado QA y después se vuelve a probar.</p>
          <input
            maxLength={1000}
            placeholder="Nota opcional, p. ej. haz merge de main y conserva los dos tests e2e"
            aria-label="Nota para quien la corrija"
            ref={(el) => void (el && setTimeout(() => el.focus(), 0))}
            onChange={(e) => (note = e.target.value)}
          />
        </>
      ),
      confirm: 'Devolver',
    });
    if (ok) void act(c.key, () => api.sendBack(repo.id, c.number, note.trim() || undefined));
  };
  const closePr = async (c: KanbanCard) => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: `¿Cerrar la PR #${c.number}?`,
      body: `«${c.title}» se cerrará sin merge y se detendrá cualquier trabajo de QA o corrección sobre ella. Su issue sigue abierto y espera a que lo vuelvas a asignar. La rama se queda en GitHub.`,
      confirm: 'Cerrar PR',
    });
    if (ok) void act(c.key, () => api.closePull(repo.id, c.number));
  };
  const closeButton = (c: KanbanCard) => (
    <button className="btn btn-small btn-ghost" disabled={pending === c.key} onClick={() => void closePr(c)}>
      Cerrar
    </button>
  );
  const previewButton = (c: KanbanCard) => (
    <button className="btn btn-small" title={`Arrancar la PR #${c.number} junto a ${repo.defaultBranch} y abrirla en el visor de la app`} onClick={() => openOverlay({ kind: 'app', repoId: repo.id, pr: c.number })}>
      Vista previa
    </button>
  );
  const terminalButton = (c: KanbanCard) =>
    c.agent && (
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: c.agent!.id })}>
        Terminal
      </button>
    );

  const column = (title: string, cls: string, cards: KanbanCard[], render: (c: KanbanCard) => React.ReactNode, empty: string) => (
    <div className={`kcol ${cls}`}>
      <div className="kcol-head">
        {title} <span className="count">{cards.length}</span>
      </div>
      <div className="kcol-body">
        {cards.length === 0 && <div className="muted small kempty">{empty}</div>}
        {cards.map((c) => (
          <div key={c.key} className={`kcard ${c.tone ? `kcard-${c.tone}` : ''}`}>
            <div className="kcard-title">
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.prNumber ? 'PR ' : ''}#{c.number}
                </a>
              ) : (
                <b>#{c.number}</b>
              )}{' '}
              {c.title}
            </div>
            {render(c)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Frame
      embedded={embedded}
      wide
      accent={repo.color}
      title={
        <span>
          📋 {repo.fullName}{' '}
          <a className="small" href={repo.url} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </span>
      }
    >
      <div className="kanban-toolbar">
        <button className="btn btn-good" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Nuevo issue'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => void api.updateRepo(repo.id, { autoAssign: e.target.checked }).catch(() => undefined)} />
          ⚡ Asignar trabajo automáticamente a los agentes libres
        </label>
        <label className="toggle" title="Hacer merge de una PR en cuanto QA haya aprobado su último commit y los checks de GitHub estén en verde">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => void api.updateRepo(repo.id, { autoMerge: e.target.checked }).catch(() => undefined)} />
          🔀 Auto-merge cuando pasen QA y los checks
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })} title="Abrir la app en marcha de esta planta">
          🖥️ Ver la app
        </button>
        <span className="muted small">{repo.lastSync ? `Sincronizado a las ${new Date(repo.lastSync).toLocaleTimeString('es-ES')}` : 'Sincronizando…'}</span>
        <button className="btn" disabled={pending === 'sync'} onClick={() => act('sync', () => api.syncRepo(repo.id))}>
          ⟳ Sincronizar
        </button>
      </div>
      {repo.syncError && <div className="term-error">⚠️ {repo.syncError}</div>}
      {showForm && <IssueForm repoId={repo.id} agents={workers} onDone={() => setShowForm(false)} />}

      <div className="kanban kanban-5">
        {column(
          '📋 Backlog',
          'kcol-backlog',
          cols.backlog,
          (c) => (
            <div className="kcard-foot">
              {c.note && <span className="muted small">{c.note}</span>}
              <select
                value=""
                disabled={pending === c.key || free.length === 0}
                onChange={(e) => e.target.value && act(c.key, () => api.assign(e.target.value, c.number))}
                aria-label={`Asignar el issue #${c.number}`}
              >
                <option value="">{free.length ? 'Asignar a…' : 'Todo el mundo está ocupado'}</option>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ),
          'No hay issues abiertos. ¡Crea uno arriba!',
        )}
        {column(
          '🔨 En curso',
          'kcol-progress',
          cols.progress,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} card={c} />
              <span className="muted small">{c.note}</span>
              <span className="spacer" />
              {terminalButton(c)}
            </div>
          ),
          'Ahora mismo no programa nadie.',
        )}
        {column(
          '🔍 En QA',
          'kcol-qa',
          cols.qa,
          (c) => {
            const st = c.qa?.status;
            return (
              <div className="kcard-foot kcard-foot-wrap">
                <AgentChip agent={c.agent} card={c} />
                <span className="muted small">{c.note}</span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                {(st === 'testing' || st === 'fixing') && terminalButton(c)}
                {(!st || st === 'needs-human') && (
                  <button className="btn btn-small btn-good" disabled={pending === c.key} onClick={() => act(c.key, () => api.sendToQa(repo.id, c.number))}>
                    {st === 'needs-human' ? 'Reintentar QA' : 'Enviar a QA'}
                  </button>
                )}
                {(st === 'needs-human' || st === 'failed') && (
                  <button className="btn btn-small" disabled={pending === c.key} title="Pásasela a su autor, o a cualquier agente libre, con lo que ha encontrado QA y tu nota, sin otra ronda de QA antes" onClick={() => sendBack(c)}>
                    Devolver para corregir
                  </button>
                )}
                {st === 'needs-human' && (
                  <button className="btn btn-small btn-ghost" disabled={pending === c.key} onClick={() => merge(c)}>
                    Merge de todos modos
                  </button>
                )}
                {closeButton(c)}
              </div>
            );
          },
          'No hay nada esperando a ser probado.',
        )}
        {column(
          '✅ Listas para merge',
          'kcol-review',
          cols.ready,
          (c) => {
            const pr = repo.pulls.find((p) => p.number === c.prNumber);
            return (
              <div className="kcard-foot kcard-foot-wrap">
                <AgentChip agent={c.agent} card={c} />
                <span className="muted small">
                  {c.note}
                  {pr ? ` · +${pr.additions} −${pr.deletions}` : ''}
                </span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                <button className="btn btn-small btn-good" disabled={pending === c.key || pr?.isDraft} onClick={() => merge(c)}>
                  Hacer merge
                </button>
                {closeButton(c)}
              </div>
            );
          },
          'Todavía no hay pull requests probadas.',
        )}
        {column(
          '🎉 Fusionadas',
          'kcol-merged',
          cols.merged,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} card={c} />
            </div>
          ),
          'Todavía no se ha fusionado nada.',
        )}
      </div>
    </Frame>
  );
}
