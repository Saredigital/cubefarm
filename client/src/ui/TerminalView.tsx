import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CareerCard } from './CareerCard';
import { api } from '../api';
import { isBusy, kanbanFor, agentsOnRepo, useStore } from '../store';
import { AgentSetup } from './AgentSettings';
import { confirmDialog } from './Confirm';
import { LiveTerminal } from './LiveTerminal';
import { effectiveModel } from '../../../shared/models';
import { assignChoices } from '../pocket/pocketData';
import { agentLabel, signInFor, workerCli } from './floorRows';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { closeOverlay, Panel } from './Panel';
import { loadScreenshot } from '../screenshot';
import { toolVerb } from './toolVerb';

const STATUS_LABEL: Record<string, string> = {
  idle: 'libre',
  preparing: 'preparándose',
  working: 'trabajando',
  done: 'terminado',
  error: 'necesita ayuda',
  stopped: 'parado',
};

const QA_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  testing: 'probando',
  passed: 'superado',
  failed: 'fallido',
  fixing: 'en corrección',
  'needs-human': 'te necesita',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function elapsed(from: number | null, to: number | null) {
  if (!from) return '';
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TerminalView({ agentId }: { agentId: string }) {
  const agent = useStore((s) => s.agents[agentId]);
  const log = useStore((s) => s.logs[agentId]) ?? [];
  const shotAt = useStore((s) => s.screens[agentId]);
  const repo = useStore((s) => s.repos.find((r) => r.id === s.agents[agentId]?.repoId));
  const allAgents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCareer, setShowCareer] = useState(false);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The browser pane shows the last screenshot that loaded, never a broken image. The loaded <img> itself goes in
  // the pane, so showing it never asks the server again.
  const shotView = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<{ agentId: string; img: HTMLImageElement } | null>(null);
  const shotTime = agent?.hasScreenshot ? (shotAt ?? agent.screenshotAt) : null;

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () =>
      loadScreenshot(agentId, shotTime, (img) => {
        img.alt = 'Última captura del navegador del agente';
        setShot({ agentId, img });
      }),
    [agentId, shotTime],
  );
  useEffect(() => {
    shotView.current?.replaceChildren(...(shot?.agentId === agentId ? [shot.img] : []));
  }, [shot, agentId, agent?.hasScreenshot]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const qaRecords = useStore((s) => s.qa);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qaRecords) : null), [repo, allAgents, qaRecords]);
  // Any free agent takes either: an issue from the backlog, or a pull request waiting for QA.
  const choices = assignChoices(cols);
  const chosen = choices.find((c) => c.key === pick);

  if (!agent || !repo) {
    return (
      <Panel title="Terminal">
        <p className="muted">Ese agente ya no está en el equipo.</p>
      </Panel>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  };
  const working = isBusy(agent);
  const cli = workerCli(agent, settings);
  const issueUrl = agent.issueNumber ? `https://github.com/${repo.fullName}/issues/${agent.issueNumber}` : null;
  const canMessage = working || (agent.task !== 'qa' && !!agent.branch && agent.status !== 'idle');
  const qaRec = agent.prNumber ? qaRecords[`${repo.id}#${agent.prNumber}`] : undefined;
  const signIn = signInFor(agent, settings);
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void run(() => api.message(agent.id, body));
  };

  return (
    <Panel
      wide
      accent={agent.color}
      title={
        <div className="term-title">
          <span className="avatar" style={{ background: agent.color }}>
            {agent.name[0]}
          </span>
          <span>{agent.name}</span>
          <span className="chip" title="Su agente de código">
            ⌨️ {agentLabel(agent, settings, clis)}
          </span>
          <StatusPill status={agent.status} />
          {signIn && (
            <span className="chip sign-in-chip" title={`Esperando a que inicies sesión en ${signIn}, en su terminal`}>
              🔑 falta iniciar sesión
            </span>
          )}
          {working && agent.currentTool && <span className="muted small">{toolVerb(agent.currentTool)}…</span>}
          <span className="spacer" />
          {agent.career && (
            <button className={`btn btn-small setup-toggle ${showCareer ? 'setup-toggle-on' : ''}`} aria-expanded={showCareer} title={`Trayectoria de ${agent.name} en el equipo`} onClick={() => setShowCareer((v) => !v)}>
              🏅 Trayectoria
            </button>
          )}
          <button
            className={`btn btn-small setup-toggle ${showSetup ? 'setup-toggle-on' : ''}`}
            aria-expanded={showSetup}
            aria-controls="agent-setup"
            title={`Nombre, aspecto, agente de código, modelo y esfuerzo de ${agent.name}`}
            onClick={() => setShowSetup((v) => !v)}
          >
            ⚙️ Configuración
          </button>
        </div>
      }
    >
      <div className="term-meta">
        {agent.task === 'qa' && agent.status !== 'idle' ? (
          <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
            Probando la PR #{agent.prNumber}: {agent.issueTitle}
          </a>
        ) : agent.task === 'fix' && agent.status !== 'idle' ? (
          <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
            Corrigiendo la PR #{agent.prNumber} tras el QA: {agent.issueTitle}
          </a>
        ) : agent.issueNumber && agent.status !== 'idle' ? (
          <a href={issueUrl!} target="_blank" rel="noreferrer">
            Issue #{agent.issueNumber}: {agent.issueTitle}
          </a>
        ) : (
          <span className="muted">Nada asignado</span>
        )}
        {agent.prUrl && agent.task === 'issue' && (
          <a href={agent.prUrl} target="_blank" rel="noreferrer" className="chip chip-good">
            PR #{agent.prNumber}
          </a>
        )}
        {qaRec && agent.status !== 'idle' && (
          <span className={`chip ${qaRec.status === 'passed' ? 'chip-good' : ''}`}>
            QA: {QA_STATUS_LABEL[qaRec.status] ?? qaRec.status}
            {qaRec.round > 1 ? ` · ronda ${qaRec.round}` : ''}
          </span>
        )}
        {qaRec?.commentUrl && (
          <a href={qaRec.commentUrl} target="_blank" rel="noreferrer">
            Informe de QA ↗
          </a>
        )}
        {agent.branch && <code>{agent.branch}</code>}
        <span className="muted">
          {(agent.role === 'ceo' ? agent.model : effectiveModel(agent.model, cli, settings, 'claude-opus-5-5')) || 'modelo por defecto'} · esfuerzo{' '}
          {agent.effort || settings.defaultEffort}
        </span>
        {agent.startedAt && <span className="muted">⏱ {elapsed(agent.startedAt, working ? null : agent.endedAt)}</span>}
        {agent.turns > 0 && <span className="muted">{agent.turns} {agent.turns === 1 ? 'turno' : 'turnos'}</span>}
        {agent.costUsd > 0 && <span className="muted" title="Coste equivalente en API que informa el agente de código; el uso con suscripción se factura según el plan">≈${agent.costUsd.toFixed(2)}</span>}
      </div>
      {agent.lastError && agent.status !== 'working' && !signIn && <div className="term-error">⚠️ {agent.lastError}</div>}
      {signIn && (
        <div className="sign-in-note" role="status">
          <span className="grow">
            <b>
              🔑 Inicia sesión en {signIn} para {agent.name}
            </b>
            <br />
            {signIn === 'Codex'
              ? 'Abre el enlace de su terminal, inicia sesión en ChatGPT ahí e introduce el código de un solo uso que muestra el terminal.'
              : 'Abre el enlace de su terminal, apruébalo con tu cuenta de Claude y luego pega en el terminal el código que te da la página y pulsa Enter.'}{' '}
            Su máquina en la nube guarda la sesión{agent.task && isBusy(agent) ? ', y su tarea empieza en cuanto esté hecho' : ''}.
          </span>
          <button className="btn btn-small" disabled={busy} title="Cerrar este inicio de sesión y mostrar un enlace nuevo" onClick={() => run(() => api.signIn(agent.id))}>
            ↻ Empezar de nuevo
          </button>
        </div>
      )}
      {showCareer && <CareerCard agent={agent} />}
      {showSetup && (
        <div id="agent-setup" className="setup-wrap">
          <AgentSetup agent={agent} />
        </div>
      )}

      <div className={`term-split ${agent.hasScreenshot ? 'term-split-2' : ''}`}>
        {agent.terminal ? (
          <LiveTerminal agentId={agent.id} />
        ) : (
          <div
            className="term"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {log.length === 0 && <div className="term-line term-system">(aún no hay salida)</div>}
            {log.map((l) => (
              <div key={l.id} className={`term-line term-${l.kind}`}>
                {l.text || ' '}
              </div>
            ))}
            {working && <div className="term-line term-spin">✻ {agent.status === 'preparing' ? (agent.currentTool ?? 'Preparando el worktree') : toolVerb(agent.currentTool) || 'Pensando'}… ({elapsed(agent.startedAt, null)})</div>}
          </div>
        )}
        {agent.hasScreenshot && (
          <div className="browser">
            <div className="browser-bar">🔒 {agent.browserUrl ?? 'about:blank'}</div>
            <div className="browser-view" ref={shotView} />
            <div className="muted small">Última captura de Playwright{agent.screenshotAt ? ` · ${new Date(agent.screenshotAt).toLocaleTimeString('es-ES')}` : ''}</div>
          </div>
        )}
      </div>

      <form
        className="term-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <MessageBox
          value={text}
          onChange={setText}
          aria-label={`Mensaje para ${agent.name}`}
          title="Enter envía · Shift+Enter añade una línea nueva"
          placeholder={
            working
              ? `Dile algo a ${agent.name} mientras trabaja${agent.terminal ? ' (se escribe en su terminal)' : ''}…`
              : canMessage
                ? `Pide a ${agent.name} un seguimiento (retoma su sesión)…`
                : `Dale a ${agent.name} un issue o una PR que probar para que empiece`
          }
          disabled={!canMessage}
          autoFocus={!agent.terminal}
        />
        <MicButton kind="agent" value={text} onChange={setText} onSend={send} disabled={!canMessage} />
        <button className="btn" disabled={busy || !canMessage || !text.trim()}>
          Enviar
        </button>
      </form>

      <div className="term-actions">
        {working ? (
          <button className="btn btn-bad" disabled={busy} onClick={() => run(() => api.stop(agent.id))}>
            ■ Parar
          </button>
        ) : (
          <>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Trabajo que darle">
              <option value="">{choices.length ? 'Elige un issue que construir o una PR que probar…' : 'No hay nada que coger'}</option>
              {(['issue', 'qa'] as const).map((kind) => {
                const group = choices.filter((c) => c.kind === kind);
                return (
                  group.length > 0 && (
                    <optgroup key={kind} label={kind === 'qa' ? 'Pull requests que probar' : 'Issues que construir'}>
                      {group.map((c) => (
                        <option key={c.key} value={c.key}>
                          {kind === 'qa' ? 'PR ' : ''}#{c.number} {c.title}
                        </option>
                      ))}
                    </optgroup>
                  )
                );
              })}
            </select>
            <button
              className="btn btn-good"
              disabled={busy || !chosen}
              onClick={() =>
                chosen &&
                run(async () => {
                  if (chosen.kind === 'qa') await api.sendToQa(repo.id, chosen.number, agent.id);
                  else await api.assign(agent.id, chosen.number);
                  setPick('');
                })
              }
            >
              {chosen?.kind === 'qa' ? `🔍 Probar la PR #${chosen.number}` : '▶ Empezar issue'}
            </button>
            {agent.status !== 'idle' && (
              <button className="btn" disabled={busy} onClick={() => run(() => api.reset(agent.id))}>
                ↺ Despejar puesto
              </button>
            )}
          </>
        )}
        <span className="spacer" />
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const ok = await confirmDialog({
                tone: 'danger',
                icon: '👋',
                title: `¿Despedir a ${agent.name}?`,
                body: 'Se elimina su worktree. Las ramas que subió se quedan en GitHub.',
                confirm: `Despedir a ${agent.name}`,
              });
              if (!ok) return;
              await api.fireAgent(agent.id);
              closeOverlay();
            });
          }}
        >
          Despedir
        </button>
      </div>
    </Panel>
  );
}
