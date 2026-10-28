// The manager's tabs, shown in the control panel's Settings: projects and the office's own update, the CEO, the team,
// issues, and the office settings (agents, the CEO's rules, how agents run, the company, cloud, voice, notifications).
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamStats } from './CareerCard';
import { api } from '../api';
import { PreviewPill, PreviewSettings } from './AppViewer';
import { agentsOnRepo, pendingRequests, useStore } from '../store';
import { CEO_ID, DEFAULT_MAX_AGENTS, FLOOR_SEATS, type AgentCli, type EffortLevel, type OfficeUpdateView, type RepoView } from '../../../shared/types';
import { CLAUDE_MODELS, modelSuggestions } from '../../../shared/models';
import { CliOptions, CliSelect, cliName, EFFORTS, EffortSelect, ModelInput, NameInput, PromptPreview } from './AgentSettings';
import { canPostpone, canUpdateNow, drainDeadline, officeUpdateText } from '../officeUpdate';
import { confirmDialog } from './Confirm';
import { IssueForm } from './KanbanView';
import { LiveTerminal } from './LiveTerminal';
import { MicButton } from './MicButton';
import { NotifySettings } from './NotifySettings';
import { Resume } from './Phone';
import { ProjectPicker } from './ProjectPicker';
import { StatusPill } from './TerminalView';
import { VoiceSettings } from './VoiceSettings';
import { CloudSettings } from './CloudSettings';

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

// ---------- floors ----------

const NO_LAUNCHER = 'Arranca la oficina con npm run dev o npm start para que pueda instalar actualizaciones y reiniciarse sola.';

/** The office itself: the commit it runs and its own update. Hidden on servers that can't update themselves. */
function OfficeRow({ update }: { update: OfficeUpdateView }) {
  const commit = useStore((s) => s.officeCommit);
  const autoUpdate = useStore((s) => s.settings.autoUpdate);
  const [busy, setBusy] = useState(false);
  const act = (action: 'now' | 'later') => {
    setBusy(true);
    void attempt(() => api.updateOffice(action)).finally(() => setBusy(false));
  };
  const deadline = drainDeadline(update);
  const pending = update.state !== 'none';
  const tone = update.state === 'failed' ? 'office-state-bad' : update.state === 'none' ? 'office-state-ok' : 'office-state-busy';
  const tip = (enabled: boolean, text: string) => (update.launcher ? (enabled ? text : undefined) : NO_LAUNCHER);
  return (
    <div className="card office-card">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          🏢
        </span>
        <div className="grow">
          <b>Oficina</b> <span className="muted small">ejecutando {commit ? <code>{commit}</code> : 'un commit desconocido'}</span>
          <div className={`small office-state ${tone}`} role="status">
            {officeUpdateText(update)}
          </div>
        </div>
        {pending && (
          <div className="office-actions" title={update.launcher ? undefined : NO_LAUNCHER}>
            <button
              className="btn btn-small btn-good"
              disabled={busy || !canUpdateNow(update)}
              title={tip(canUpdateNow(update), 'No empezar nada nuevo, dejar que terminen las sesiones en marcha y luego actualizar y reiniciar la oficina')}
              onClick={() => act('now')}
            >
              Actualizar ahora
            </button>
            <button className="btn btn-small btn-ghost" disabled={busy || !canPostpone(update)} title={tip(canPostpone(update), 'Seguir trabajando; volver a preguntar en 2 horas o cuando llegue un commit más nuevo')} onClick={() => act('later')}>
              Más tarde
            </button>
          </div>
        )}
      </div>
      {update.detail && update.state !== 'failed' && <div className="muted small">{update.detail}</div>}
      {deadline && update.running > 0 && (
        <div className="muted small">Las sesiones que sigan en marcha a las {new Date(deadline).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} se detienen y su trabajo vuelve a la cola.</div>
      )}
      {!update.launcher && pending && <div className="muted small">{NO_LAUNCHER}</div>}
      {typeof autoUpdate === 'boolean' && (
        <label className="toggle" title="Cuando haya una actualización lista, no empezar nada nuevo, dejar que terminen las sesiones en marcha y luego actualizar y reiniciar la oficina">
          <input type="checkbox" checked={autoUpdate} onChange={(e) => void attempt(() => api.updateSettings({ autoUpdate: e.target.checked }))} /> Actualizar automáticamente
        </label>
      )}
    </div>
  );
}

function FloorRow({ repo, all }: { repo: RepoView; all: RepoView[] }) {
  const agents = useStore((s) => s.agents);
  const goToFloor = useStore((s) => s.goToFloor);
  const openOverlay = useStore((s) => s.openOverlay);
  // The office's own folder isn't fast-forwarded; its update is on the Office row instead.
  const officeFolder = useStore((s) => !!s.officeUpdate) && !!repo.folderSync?.startsWith('update ready');
  const team = agentsOnRepo(agents, repo.id);
  const others = all.filter((r) => r.id !== repo.id);
  const patch = (p: Parameters<typeof api.updateRepo>[1]) => void attempt(() => api.updateRepo(repo.id, p));
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="row">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <a href={repo.url} target="_blank" rel="noreferrer">
            <b>{repo.fullName}</b>
          </a>
          {repo.summary && <div className="small">🧠 {repo.summary}</div>}
          <div className="muted small">
            {team.length} agentes · {repo.issues.length} issues abiertos · {repo.pulls.filter((p) => p.state === 'OPEN').length} PRs abiertas · rama por defecto <code>{repo.defaultBranch}</code>
            {repo.cloneStatus !== 'ready' && ` · copia local: ${repo.cloneStatus}`}
          </div>
          <div className="muted small" title={repo.localPath ? 'Tu propia carpeta de proyecto' : 'Un clon que gestiona la oficina'}>
            📁 <code>{repo.checkoutPath}</code>
            {officeFolder ? ' · la carpeta de la propia oficina, se actualiza desde la fila Oficina' : repo.folderSync && <span title={repo.folderSync}> · {repo.folderSync}</span>}{' '}
            <button className="btn btn-small btn-ghost" title="Hacer fast-forward a la rama por defecto de GitHub, cuando sea seguro" onClick={() => void attempt(() => api.syncFolder(repo.id))}>
              ⟳ Sincronizar ahora
            </button>
          </div>
          {repo.cloneError && <div className="term-error small">falló el clon: {repo.cloneError}</div>}
          {repo.syncError && <div className="term-error small">falló la sincronización: {repo.syncError}</div>}
        </div>
        <input type="color" value={repo.color} onChange={(e) => patch({ color: e.target.value })} title="Color de la planta" aria-label={`Color de la planta ${repo.floor}`} />
        <button className="btn btn-small" onClick={() => goToFloor(repo.floor)}>
          Visitar
        </button>
      </div>
      <div className="row wrap">
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => patch({ autoAssign: e.target.checked })} /> ⚡ Asignar issues automáticamente
        </label>
        <label className="toggle" title="Fusionar una PR en cuanto el QA haya aprobado su último commit y los checks de GitHub estén en verde">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => patch({ autoMerge: e.target.checked })} /> 🔀 Auto-merge
        </label>
        <label className="toggle">
          <input type="checkbox" checked={repo.browserTesting} onChange={(e) => patch({ browserTesting: e.target.checked })} /> 🌐 Pruebas en navegador (Playwright MCP)
        </label>
        <span className="spacer" />
        <button
          className="btn btn-small btn-ghost"
          onClick={() => {
            void confirmDialog({
              tone: 'danger',
              title: `¿Desconectar ${repo.fullName}?`,
              body: `Se despide a todo el equipo de esta planta. No se borra nada en GitHub, y ${repo.localPath ? 'tu carpeta se queda exactamente como está' : 'el clon local se queda en el disco'}.`,
              confirm: 'Desconectar',
            }).then((ok) => ok && attempt(() => api.disconnectRepo(repo.id)));
          }}
        >
          Desconectar
        </button>
      </div>
      {others.length > 0 && (
        <div className="row wrap links">
          <span className="muted small">🔗 Los agentes de aquí pueden leer:</span>
          {others.map((o) => (
            <label key={o.id} className="toggle small">
              <input
                type="checkbox"
                checked={repo.links.includes(o.id)}
                onChange={(e) => patch({ links: e.target.checked ? [...repo.links, o.id] : repo.links.filter((l) => l !== o.id) })}
              />
              {o.fullName}
            </label>
          ))}
        </div>
      )}
      <details className="small preview-details">
        <summary>
          🖥️ Vista previa de la app · <PreviewPill status={repo.preview.status} />
          {repo.previewConfig.command ? (
            <>
              {' '}
              <code>{repo.previewConfig.command}</code>
            </>
          ) : (
            ' comando detectado automáticamente'
          )}
        </summary>
        <PreviewSettings repo={repo} />
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })}>
          Abrir el visor de la app
        </button>
      </details>
    </div>
  );
}

export function FloorsTab() {
  const repos = useStore((s) => s.repos);
  const officeUpdate = useStore((s) => s.officeUpdate);
  return (
    <div className="tab-grid">
      <div>
        {officeUpdate && <OfficeRow update={officeUpdate} />}
        <h3 className="section">🏢 Plantas</h3>
        {repos.length === 0 && <p className="muted">Aún no hay plantas. Añade un proyecto →</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorRow key={r.id} repo={r} all={repos} />
        ))}
      </div>
      <div className="card">
        <h3>➕ Añadir un proyecto</h3>
        <ProjectPicker />
      </div>
    </div>
  );
}

// ---------- CEO ----------

function FloorBrief({ repo }: { repo: RepoView }) {
  const [mission, setMission] = useState(repo.mission);
  useEffect(() => setMission(repo.mission), [repo.mission]);
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="row">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <b>{repo.fullName}</b>
          <div className="muted small">{repo.summary ? `🧠 ${repo.summary}` : 'El CEO aún no ha estudiado esta planta.'}</div>
        </div>
        <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.onboardFloor(repo.id))} title="Volver a estudiar el repositorio y replantear el plan y el tamaño del equipo">
          Volver a estudiar
        </button>
      </div>
      <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={2} placeholder="Brief: ¿qué debería construir ahora esta planta? El CEO lo convierte en issues y en un tamaño de equipo." />
      <div className="row">
        <button className="btn btn-small" disabled={mission === repo.mission} onClick={() => void attempt(() => api.updateRepo(repo.id, { mission }))}>
          Guardar brief
        </button>
        <span className="spacer" />
        <button className="btn btn-small btn-good" disabled={!mission.trim()} onClick={() => void attempt(() => api.planFloor(repo.id, mission))}>
          🧠 Pedir al CEO que lo planifique
        </button>
      </div>
      <details className="small">
        <summary>Instrucciones de QA{repo.qaBrief ? '' : ' (aún no hay)'}</summary>
        <textarea
          key={repo.qaBrief}
          rows={4}
          defaultValue={repo.qaBrief}
          placeholder="Lo que cada revisión de QA debe comprobar en este proyecto."
          onBlur={(e) => e.target.value !== repo.qaBrief && void attempt(() => api.updateRepo(repo.id, { qaBrief: e.target.value }))}
        />
      </details>
    </div>
  );
}

export function CeoTab() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const log = useStore((s) => s.logs[CEO_ID]) ?? [];
  const info = useStore((s) => s.ceo);
  const repos = useStore((s) => s.repos);
  const requests = useStore((s) => s.requests);
  const openOverlay = useStore((s) => s.openOverlay);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  if (!ceo) return <p className="muted">El despacho de la esquina está vacío.</p>;
  const working = ceo.status === 'working';
  const pending = pendingRequests(requests);
  const send = (t: string) => {
    if (!t.trim()) return;
    setText('');
    void attempt(() => api.messageCeo(t));
  };
  const decided = requests.filter((r) => r.status !== 'pending').slice(-6).reverse();
  return (
    <div className="tab-grid">
      <div>
        <div className="card">
          <div className="row">
            <span className="avatar" style={{ background: ceo.color }}>
              {ceo.name[0]}
            </span>
            <NameInput agent={ceo} style={{ maxWidth: 140, fontWeight: 700 }} />
            <span className="muted small">CEO</span>
            <StatusPill status={ceo.status} />
          </div>
          <div className="row wrap">
            <CliSelect agent={ceo} style={{ width: 'auto' }} />
            <ModelInput agent={ceo} style={{ maxWidth: 150 }} />
            <EffortSelect agent={ceo} style={{ width: 'auto' }} />
          </div>
          <div className="small">
            <b>Ahora:</b> {working ? info.job?.label : 'libre'}
            {info.queue.length > 0 && (
              <>
                {' '}
                · <b>A continuación:</b> {info.queue.map((j) => j.label).join(' → ')}
              </>
            )}
          </div>
          <div className="muted small">
            {info.nextReviewAt ? `Próxima revisión de la empresa hacia las ${new Date(info.nextReviewAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} (se salta si no ha cambiado nada).` : 'Las revisiones periódicas están desactivadas (Ajustes).'}
          </div>
          <PromptPreview agent={ceo} />
          {ceo.terminal ? (
            <LiveTerminal agentId={ceo.id} className="ceo-term" />
          ) : (
            <div className="term ceo-term" ref={scroller}>
              {log.length === 0 && <div className="term-line term-system">(aún nada)</div>}
              {log.map((l) => (
                <div key={l.id} className={`term-line term-${l.kind}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          )}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensaje para ${ceo.name} (o pulsa P en cualquier sitio para sacar el móvil)…`} />
            <MicButton kind="console" value={text} onChange={setText} onSend={send} />
            <button className="btn" disabled={!text.trim()}>
              Enviar
            </button>
          </form>
          <div className="row">
            {working && (
              <button className="btn btn-small btn-bad" onClick={() => void attempt(() => api.stop(ceo.id))}>
                ■ Parar
              </button>
            )}
            <button className="btn btn-small" disabled={repos.length === 0} onClick={() => void attempt(() => api.ceoReview())}>
              🔎 Revisar la empresa ahora
            </button>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'phone', tab: 'chat' })}>
              📱 Abrir el móvil
            </button>
          </div>
        </div>
      </div>
      <div>
        <h3 className="section">📄 Cambios de equipo {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
        {pending.length === 0 && <p className="muted small">No hay ninguno pendiente. El CEO amplía o reduce el equipo de una planta cuando su trabajo lo pide (Ajustes → Cambios de equipo del CEO).</p>}
        {pending.map((r) => (
          <Resume key={r.id} req={r} />
        ))}
        {decided.length > 0 && (
          <details className="small" style={{ marginBottom: 12 }}>
            <summary>Decisiones recientes</summary>
            {decided.map((r) => (
              <Resume key={r.id} req={r} />
            ))}
          </details>
        )}
        <h3 className="section">🗺️ Briefs de proyecto</h3>
        {repos.length === 0 && <p className="muted small">Primero conecta un repositorio.</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorBrief key={r.id} repo={r} />
        ))}
      </div>
    </div>
  );
}

// ---------- team ----------

interface NewAgent {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
}

const NO_SETUP: NewAgent = { name: '', cli: '', model: '', effort: '' };

/** A floor's "+ Agent": an optional name and their coding agent, model and effort ('' = the office's defaults). */
function AddAgent({ repo, size }: { repo: RepoView; size: number }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [draft, setDraft] = useState<NewAgent>(NO_SETUP);
  const [busy, setBusy] = useState(false);
  const terminal = settings.runtime === 'terminal';
  const cli = terminal ? draft.cli || settings.defaultCli : 'claude';
  const full = size >= settings.maxAgents;
  const edit = (p: Partial<NewAgent>) => setDraft({ ...draft, ...p });
  const add = () => {
    setBusy(true);
    const { name, ...setup } = draft;
    void attempt(() => api.hireAgent(repo.id, { ...setup, name: name.trim() || undefined }))
      .then((a) => a && setDraft(NO_SETUP))
      .finally(() => setBusy(false));
  };
  return (
    <div className="row wrap">
      <input value={draft.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Nombre (opcional)" maxLength={24} aria-label={`Nombre del nuevo agente en la planta ${repo.floor}`} style={{ maxWidth: 150 }} />
      {terminal && (
        <select value={draft.cli} onChange={(e) => edit({ cli: e.target.value as AgentCli | '' })} aria-label="Agente de código del nuevo agente" style={{ width: 'auto' }}>
          <option value="">{cliName(clis, settings.defaultCli)} (por defecto)</option>
          <CliOptions clis={clis} />
        </select>
      )}
      <input value={draft.model} onChange={(e) => edit({ model: e.target.value })} list={`new-agent-models-${repo.floor}`} placeholder="modelo por defecto" aria-label="Modelo del nuevo agente" style={{ maxWidth: 150 }} />
      <datalist id={`new-agent-models-${repo.floor}`}>
        {modelSuggestions(cli).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <select value={draft.effort} onChange={(e) => edit({ effort: e.target.value as EffortLevel | '' })} aria-label="Esfuerzo del nuevo agente" style={{ width: 'auto' }}>
        <option value="">esfuerzo por defecto ({settings.defaultEffort})</option>
        {EFFORTS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span title={full ? `La planta ${repo.floor} tiene su máximo de agentes (${settings.maxAgents}): cámbialo en Ajustes → Máximo de agentes por planta` : undefined}>
        <button className="btn btn-small btn-good" disabled={busy || full} onClick={add}>
          + Agente
        </button>
      </span>
    </div>
  );
}

export function TeamTab() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const openOverlay = useStore((s) => s.openOverlay);
  const terminal = settings.runtime === 'terminal';
  if (repos.length === 0) return <p className="muted">Primero conecta un repositorio; los agentes necesitan una planta donde sentarse.</p>;
  return (
    <div>
      <TeamStats />
      {[...repos].sort((a, b) => a.floor - b.floor).map((repo) => {
        const team = agentsOnRepo(agents, repo.id).filter((a) => a.role !== 'ceo');
        return (
          <div key={repo.id} className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
            <div className="row wrap">
              <span className="floor-badge">{repo.floor}</span>
              <b className="grow">{repo.fullName}</b>
              <span className="muted small">
                {team.length} de {settings.maxAgents} agentes
              </span>
            </div>
            <AddAgent repo={repo} size={team.length} />
            {team.length === 0 && <div className="muted small">Aquí aún no trabaja nadie.</div>}
            <table className="team">
              <tbody>
                {team.map((a) => (
                  <Fragment key={a.id}>
                  <tr>
                    <td>
                      <span className="dot" style={{ background: a.color }} />
                    </td>
                    <td>
                      <NameInput agent={a} />
                      {a.host === 'box' && (
                        <span className="cloud-badge" title="Trabaja en un Upstash Box: sigue trabajando aunque la oficina esté cerrada">
                          ☁
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="small">{a.status === 'idle' ? <span className="muted">—</span> : a.task === 'qa' ? `probando la PR #${a.prNumber}` : a.task === 'fix' ? `corrigiendo la PR #${a.prNumber}` : `#${a.issueNumber ?? ''} ${a.issueTitle ?? ''}`.slice(0, 40)}</td>
                    {terminal && (
                      <td>
                        <CliSelect agent={a} style={{ width: 112 }} />
                      </td>
                    )}
                    <td>
                      <ModelInput agent={a} style={{ minWidth: 110 }} />
                    </td>
                    <td>
                      <EffortSelect agent={a} style={{ width: 124 }} />
                    </td>
                    <td className="nowrap">
                      {a.host === 'box' && a.needsSignIn && (
                        <>
                          <button className="btn btn-small btn-good" title={`La máquina en la nube de ${a.name} necesita que inicies sesión en su agente de código`} onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                            🔑 Iniciar sesión
                          </button>{' '}
                        </>
                      )}
                      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                        Terminal
                      </button>{' '}
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() =>
                          void confirmDialog({ tone: 'danger', icon: '👋', title: `¿Despedir a ${a.name}?`, body: 'Se elimina su worktree. Las ramas que subió se quedan en GitHub.', confirm: `Despedir a ${a.name}` }).then(
                            (ok) => ok && attempt(() => api.fireAgent(a.id)),
                          )
                        }
                      >
                        Despedir
                      </button>
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ---------- issues ----------

export function IssuesTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const allAgents = useStore((s) => s.agents);
  const [repoId, setRepoId] = useState(initialRepo ?? repos[0]?.id ?? '');
  const repo = repos.find((r) => r.id === repoId);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  if (repos.length === 0) return <p className="muted">Primero conecta un repositorio.</p>;
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>📝 Crear un issue nuevo</h3>
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)} aria-label="Planta">
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Planta {r.floor} · {r.fullName}
            </option>
          ))}
        </select>
        {repo && <IssueForm key={repo.id} repoId={repo.id} agents={agents} />}
      </div>
      <div className="card">
        <h3>Issues abiertos en {repo?.fullName}</h3>
        <div className="repo-list tall">
          {repo?.issues.length === 0 && <div className="muted small">Ninguno. ¡Bien!</div>}
          {repo?.issues.map((i) => {
            const holder = agents.find((a) => a.role !== 'ceo' && a.task !== 'qa' && a.issueNumber === i.number && a.status !== 'idle');
            return (
              <div key={i.number} className="repo-row">
                <div>
                  <a href={i.url} target="_blank" rel="noreferrer">
                    #{i.number}
                  </a>{' '}
                  {i.title}
                  {i.labels.length > 0 && <div className="muted small">{i.labels.join(', ')}</div>}
                </div>
                <span className="repo-row-actions">
                  {holder ? (
                    <span className="agent-chip">
                      <span className="dot" style={{ background: holder.color }} />
                      {holder.name}
                    </span>
                  ) : (
                    <select value="" onChange={(e) => e.target.value && void attempt(() => api.assign(e.target.value, i.number))} aria-label={`Asignar el issue #${i.number}`}>
                      <option value="">Asignar…</option>
                      {agents
                        .filter((a) => a.role !== 'ceo' && a.status !== 'working' && a.status !== 'preparing')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    className="btn btn-small btn-ghost"
                    title="Cerrarlo en GitHub como no planificado"
                    onClick={() =>
                      void confirmDialog({
                        tone: 'danger',
                        title: `¿Cerrar el #${i.number}?`,
                        body: `“${i.title}” se cerrará en GitHub como no planificado${holder ? ` y ${holder.name} dejará de trabajar en él` : ''}.`,
                        confirm: 'Cerrar issue',
                      }).then((ok) => ok && attempt(() => api.closeIssue(repo.id, i.number)))
                    }
                  >
                    Cerrar
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- settings ----------

export function SettingsTab() {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const user = useStore((s) => s.user);
  const machinesRoot = useStore((s) => s.machinesRoot);
  const demo = useStore((s) => s.demo);
  const version = useStore((s) => s.version);
  const commit = useStore((s) => s.officeCommit);
  const set = (p: Parameters<typeof api.updateSettings>[0]) => void attempt(() => api.updateSettings(p));
  const terminal = settings.runtime === 'terminal';
  const defaultCli = terminal ? settings.defaultCli : 'claude';
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>🧠 Agentes</h3>
        {terminal && (
          <label className="field">
            <span>Agente de código por defecto</span>
            <select value={settings.defaultCli} onChange={(e) => set({ defaultCli: e.target.value as AgentCli })}>
              <CliOptions clis={clis} />
            </select>
          </label>
        )}
        <label className="field">
          <span>Modelo por defecto{terminal ? ` para ${cliName(clis, settings.defaultCli)}` : ''}</span>
          <input
            key={`${settings.defaultCli}:${settings.defaultModel}`}
            list={defaultCli === 'claude' ? 'models-s' : undefined}
            defaultValue={settings.defaultModel}
            placeholder="el propio del agente por defecto"
            onBlur={(e) => e.target.value !== settings.defaultModel && set({ defaultModel: e.target.value })}
          />
          <datalist id="models-s">
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Esfuerzo por defecto</span>
          <select value={settings.defaultEffort} onChange={(e) => set({ defaultEffort: e.target.value as EffortLevel })}>
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {terminal
            ? 'Cada agente puede usar su propio agente de código, modelo y esfuerzo (pestaña Equipo); el CEO elige entre Claude Code y Codex en su pestaña. Claude Code informa de cada paso; Codex y OpenCode son experimentales: la oficina ve su tarea, no cada paso.'
            : 'El Agent SDK ejecuta Claude Code. Cada agente puede usar su propio modelo y esfuerzo (pestaña Equipo).'}
        </p>
        <label className="field">
          <span>Límite de sesiones</span>
          <input type="number" min={0} placeholder="Sin límite" defaultValue={settings.sessionLimit || ''} onBlur={(e) => set({ sessionLimit: Number(e.target.value) || 0 })} />
        </label>
        <p className="muted small">
          Déjalo vacío para que todos los agentes con trabajo se ejecuten a la vez. Los agentes con el mismo agente de código comparten los límites de uso de su suscripción, y cada uno es un proceso propio en este
          PC, así que pon un límite si llegas a alguno de los dos.
        </p>
        <label className="field">
          <span>Sesiones en modo moderado</span>
          <input
            key={settings.pacingSessions}
            type="number"
            min={1}
            max={32}
            defaultValue={settings.pacingSessions}
            onBlur={(e) => Number(e.target.value) !== settings.pacingSessions && set({ pacingSessions: Number(e.target.value) || 3 })}
          />
        </label>
        <p className="muted small">Cuando Claude avisa de que el uso está alto, los issues nuevos solo empiezan mientras haya menos sesiones que estas en marcha. El QA, las correcciones y el CEO siguen.</p>
        <label className="field">
          <span>Máximo de agentes por proyecto</span>
          <input
            key={settings.maxAgents}
            type="number"
            min={1}
            max={FLOOR_SEATS}
            defaultValue={settings.maxAgents}
            onBlur={(e) => {
              const n = Math.min(FLOOR_SEATS, Math.max(1, Math.round(Number(e.target.value)) || DEFAULT_MAX_AGENTS));
              if (n !== settings.maxAgents) set({ maxAgents: n });
            }}
          />
        </label>
        <p className="muted small">Como mucho {FLOOR_SEATS}, uno por puesto. No se pueden añadir más agentes por encima, ni a mano ni el CEO.</p>
        <h3>🧠 El CEO</h3>
        <div role="radiogroup" aria-label="Cambios de equipo del CEO">
          <div className="small">
            <b>Cambios de equipo del CEO</b>
          </div>
          <label className="toggle block">
            <input type="radio" name="scaling" checked={settings.scaling === 'approve'} onChange={() => set({ scaling: 'approve' })} />
            <span>
              <b>Los apruebo uno a uno</b> (recomendado): las incorporaciones y salidas esperan en Aprobaciones, donde puedes cambiar el agente de código, modelo y esfuerzo antes de incorporar a alguien.
            </span>
          </label>
          <label className="toggle block">
            <input type="radio" name="scaling" checked={settings.scaling === 'auto'} onChange={() => set({ scaling: 'auto' })} />
            <span>
              <b>Aplicarlos directamente</b>, hasta el máximo de agentes por proyecto. Primero se van los agentes sin tarea; los ocupados terminan la suya.
            </span>
          </label>
        </div>
        <label className="field">
          <span>Revisión de la empresa cada (minutos, 0 = desactivada)</span>
          <input type="number" min={0} max={1440} defaultValue={settings.ceoHeartbeatMin} onBlur={(e) => set({ ceoHeartbeatMin: Number(e.target.value) })} />
        </label>
        <p className="muted small">Una revisión comprueba el tamaño de los equipos, las PRs atascadas y los perfiles de las plantas, y se salta si no ha cambiado nada desde la última. Nunca crea issues: el trabajo nuevo solo sale de ti. El agente de código, el modelo y el esfuerzo del propio CEO están en la pestaña CEO.</p>
      </div>
      <div className="card">
        <h3>⌨️ Cómo se ejecutan los agentes</h3>
        <label className="toggle block">
          <input type="radio" checked={settings.runtime === 'terminal'} onChange={() => set({ runtime: 'terminal' })} />
          <span>
            <b>Terminales reales</b> (recomendado): cada agente es su agente de código real ejecutándose en su propio terminal. Abre su terminal desde el panel para verlo en directo o escribir en él.
          </span>
        </label>
        <label className="toggle block">
          <input type="radio" checked={settings.runtime === 'sdk'} onChange={() => set({ runtime: 'sdk' })} />
          <span>
            <b>Agent SDK</b>: Claude Code a través del Claude Agent SDK, mostrado como un registro de sus pasos. Solo Claude Code.
          </span>
        </label>
        <p className="muted small">
          Los agentes trabajan como tus propios agentes de código en un terminal, con tus skills, servidores MCP y ajustes, y no se paran a preguntar. El flujo de trabajo de la oficina (ramas, pull requests,
          informes de QA) está en sus instrucciones.
        </p>
        <h3>🏢 Empresa</h3>
        <label className="field">
          <span>Tu nombre</span>
          <input defaultValue={settings.managerName} placeholder={user ?? 'Jefe'} onBlur={(e) => e.target.value !== settings.managerName && set({ managerName: e.target.value })} />
        </label>
        <label className="field">
          <span>Nombre de la empresa</span>
          <input defaultValue={settings.companyName} placeholder="sareoffice" onBlur={(e) => e.target.value !== settings.companyName && set({ companyName: e.target.value })} />
        </label>
        <label className="field">
          <span>Carpeta de proyectos (aquí se crean los proyectos nuevos)</span>
          <input key={settings.projectsDir} defaultValue={settings.projectsDir} onBlur={(e) => e.target.value.trim() && e.target.value !== settings.projectsDir && set({ projectsDir: e.target.value })} />
        </label>
        <label className="field">
          <span>Liberar máquinas sin uso tras (minutos, 0 = nunca)</span>
          <input
            key={settings.trimIdleDesksMin}
            type="number"
            min={0}
            max={10080}
            defaultValue={settings.trimIdleDesksMin}
            onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.trimIdleDesksMin && set({ trimIdleDesksMin: Number(e.target.value) })}
          />
        </label>
        <p className="muted small">Una máquina de agente sin uso durante este tiempo pierde su node_modules y los artefactos de compilación para ahorrar espacio en disco. Su siguiente tarea los vuelve a instalar.</p>
        <h3>ℹ️ Entorno</h3>
        <div className="small">
          sareoffice: <b>{version ?? 'desconocida'}</b>
          {commit && (
            <>
              {' '}
              (<code>{commit}</code>)
            </>
          )}
          <br />
          GitHub: <b>{user ?? 'sin sesión iniciada'}</b>
          {demo && ' (demo)'}
          <br />
          Máquinas de los agentes: <code>{machinesRoot}</code>
        </div>
      </div>
      <CloudSettings />
      <VoiceSettings />
      <NotifySettings />
    </div>
  );
}
