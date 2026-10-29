import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { isBusy, useStore } from '../store';
import { CEO_ID, type AgentCli, type CliView, type EffortLevel, type HireRequestView, type MachineHost, type PhoneMessage, type SwarmSettings } from '../../../shared/types';
import { Markdown } from './Markdown';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { handsFreeProblem, setHandsFree } from './mic';
import { replayKind } from './voiceQueue';
import { CLAUDE_MODELS, effectiveModel, modelSuggestions } from '../../../shared/models';
import { currentStep } from '../../../shared/watch';

// The CEO's chat and the cards for team changes (a new agent, or one leaving), shared by the control panel and
// pocket mode.

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

const clock = (t: number) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function Avatar({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }}>
      {name[0]}
    </span>
  );
}

// ---------- team changes ----------

/** Every reasoning effort, lowest first ('' = the office default). */
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** A coding agent's name, as the office lists it. */
export const cliLabel = (clis: CliView[], id: AgentCli) => clis.find((c) => c.id === id)?.label ?? id;

/** The coding agent a new agent will run: their own pick, else the office default; the Agent SDK runtime is Claude Code for everyone. */
export const hireCli = (cli: AgentCli | '', settings: Pick<SwarmSettings, 'runtime' | 'defaultCli'>): AgentCli =>
  settings.runtime !== 'terminal' ? 'claude' : cli || settings.defaultCli;

/** What the manager can set up on a new agent before hiring them: the CEO's picks to start with ('' = the office default). */
export interface HireSetup {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
  host: MachineHost | ''; // where they'll work ('' = the office default, Settings → Cloud agents)
}

export const setupOf = (r: HireRequestView): HireSetup => ({ name: r.name, cli: r.cli, model: r.model, effort: r.effort, host: r.host ?? '' });

/** The approval's overrides: the setup as the manager left it, an emptied name back to the CEO's pick. */
export const hireOverrides = (r: HireRequestView, s: HireSetup) => ({ name: s.name.trim() || r.name, cli: s.cli, model: s.model.trim(), effort: s.effort, host: s.host });

/** "Claude Code · claude-opus-5-5 · medium effort": what they'll run, the office defaults filled in. */
export function setupLine(s: Pick<HireSetup, 'cli' | 'model' | 'effort'>, settings: SwarmSettings, clis: CliView[]) {
  const cli = hireCli(s.cli, settings);
  return `${cliLabel(clis, cli)} · ${effectiveModel(s.model, cli, settings, CLAUDE_MODELS[0]) || 'su modelo por defecto'} · esfuerzo ${s.effort || settings.defaultEffort}`;
}

/** A new agent's settings, edited before they're created: the lobby's card and the phone's both use these. */
export function HireSetupFields({ value, onChange, disabled }: { value: HireSetup; onChange: (v: HireSetup) => void; disabled?: boolean }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const id = useId();
  const cloudKey = useStore((s) => s.cloud.keySet);
  const sdk = settings.runtime !== 'terminal';
  const cli = hireCli(value.cli, settings);
  const set = (patch: Partial<HireSetup>) => onChange({ ...value, ...patch });
  return (
    <div className="hire-setup">
      <label className="field" htmlFor={`${id}-name`}>
        <span>Nombre</span>
        <input id={`${id}-name`} value={value.name} maxLength={24} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-cli`}>
        <span>Agente de código</span>
        <select
          id={`${id}-cli`}
          value={sdk ? '' : value.cli}
          disabled={disabled || sdk}
          title={sdk ? 'El Agent SDK ejecuta Claude Code para todos los agentes (Ajustes → Cómo se ejecutan los agentes)' : undefined}
          onChange={(e) => set({ cli: e.target.value as AgentCli | '' })}
        >
          <option value="">{sdk ? 'Claude Code' : `${cliLabel(clis, settings.defaultCli)} (por defecto)`}</option>
          {[...clis]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((c) => (
              <option key={c.id} value={c.id} disabled={!c.installed}>
                {c.label}
                {c.installed ? '' : ' (no instalado)'}
              </option>
            ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-model`}>
        <span>Modelo</span>
        <input
          id={`${id}-model`}
          list={`${id}-models`}
          value={value.model}
          disabled={disabled}
          placeholder={effectiveModel('', cli, settings, CLAUDE_MODELS[0]) || 'el del agente por defecto'}
          title="Vacío: el modelo por defecto de su agente de código"
          onChange={(e) => set({ model: e.target.value })}
        />
        <datalist id={`${id}-models`}>
          {modelSuggestions(cli).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field" htmlFor={`${id}-effort`}>
        <span>Esfuerzo</span>
        <select id={`${id}-effort`} value={value.effort} disabled={disabled} onChange={(e) => set({ effort: e.target.value as EffortLevel | '' })}>
          <option value="">por defecto ({settings.defaultEffort})</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      {(cloudKey || value.host === 'box') && (
        <label className="field" htmlFor={`${id}-host`}>
          <span>Trabaja en</span>
          <select id={`${id}-host`} value={value.host} disabled={disabled} onChange={(e) => set({ host: e.target.value as MachineHost | '' })}>
            <option value="">{settings.cloud.machineKind === 'box' ? '☁️ Upstash Box' : '🖥️ Este ordenador'} (por defecto)</option>
            <option value="local">🖥️ Este ordenador</option>
            <option value="box" disabled={cli === 'opencode'}>
              ☁️ Upstash Box{cli === 'opencode' ? ' (OpenCode no puede ejecutarse ahí)' : ''}
            </option>
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * One team change as a card (the phone, the console, pocket mode): a new agent, with what they'll run and a way to
 * change it before hiring them, or an agent the CEO would let go. The CEO's reason either way.
 */
export function Resume({ req, highlight }: { req: HireRequestView; highlight?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === req.repoId));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [setup, setSetup] = useState(() => setupOf(req));
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  const pending = req.status === 'pending';
  const hire = req.kind === 'hire';
  const name = (hire && pending && setup.name.trim()) || req.name;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(fn);
    setBusy(false);
  };
  const outcome = req.status === 'approved' ? (hire ? '✅ contratado' : '👋 se ha ido') : hire ? '✋ rechazado' : '🤝 se queda';
  return (
    <div ref={ref} className={`resume ${hire ? '' : 'resume-letgo'} ${highlight ? 'resume-hot' : ''} ${pending ? '' : 'resume-done'}`}>
      <div className="resume-head">
        <Avatar name={name} color={req.color} size={42} />
        <div className="grow">
          <div className="resume-name">{hire ? name : `¿Despedir a ${req.name}?`}</div>
          <div className="resume-title">{hire ? 'Un candidato' : 'Deja el equipo'}</div>
        </div>
        {!pending && <span className={`chip ${req.status === 'approved' ? 'chip-good' : ''}`}>{outcome}</span>}
      </div>
      <div className="resume-meta">
        <span className="chip" style={{ background: repo?.color }}>
          Planta {repo?.floor ?? '?'}
        </span>
        <span className="muted small">{repo?.fullName.split('/')[1] ?? 'planta eliminada'}</span>
      </div>
      {req.reason && <Markdown className="resume-reason" text={req.reason} />}
      {hire && (
        <div className="resume-meta small">
          <span className="grow">⚙️ {setupLine(pending ? setup : req, settings, clis)}</span>
          {pending && (
            <button className="linkish small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Hecho' : 'Cambiar'}
            </button>
          )}
        </div>
      )}
      {hire && pending && editing && <HireSetupFields value={setup} onChange={setSetup} disabled={busy} />}
      {!pending && req.note && <div className="muted small">Tu nota: “{req.note}”</div>}
      {pending && !declining && (
        <div className="row">
          <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => setDeclining(true)}>
            {hire ? 'Rechazar' : 'Que se quede'}
          </button>
          <span className="spacer" />
          <button className="btn btn-small btn-good" disabled={busy} onClick={() => act(() => api.approveRequest(req.id, hire ? hireOverrides(req, setup) : {}))}>
            {hire ? `Contratar a ${name}` : `Despedir a ${req.name}`}
          </button>
        </div>
      )}
      {pending && declining && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.rejectRequest(req.id, note));
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="¿Por qué no? (opcional, el CEO lo lee)" autoFocus />
          <button className="btn btn-small btn-bad" disabled={busy}>
            {hire ? 'Rechazar' : 'Mantener'}
          </button>
        </form>
      )}
    </div>
  );
}

function ReplayButton({ m }: { m: PhoneMessage }) {
  const saved = useStore((s) => s.voiceCache.saved.includes(m.id));
  const playing = useStore((s) => s.voiceSpeaking === m.id);
  const kind = replayKind(m, saved, typeof speechSynthesis !== 'undefined');
  if (!kind) return null;
  const gone = kind === 'gone';
  return (
    <button
      type="button"
      className={`bubble-play ${playing ? 'bubble-play-on' : ''}`}
      disabled={gone && !playing}
      title={gone ? 'El audio ya no está guardado' : undefined}
      aria-label={playing ? 'Parar este mensaje' : 'Reproducir este mensaje'}
      onClick={() => void import('./voiceMessages').then((v) => (playing ? v.stopSpeaking() : kind !== 'gone' && v.replayMessage(m, kind)))}
    >
      {playing ? '⏹' : '▶'}
    </button>
  );
}

const QUICK = ['¿En qué está trabajando todo el mundo?', '¿Debería crecer algún equipo?', 'Planifica el siguiente hito de la planta con más trabajo.'];

/** The hands-free conversation's switch: after the CEO's spoken reply, the phone listens for up to 8 s. */
function HandsFreeToggle({ ceoName }: { ceoName: string }) {
  const listen = useStore((s) => s.settings.listen);
  useStore((s) => `${s.voiceKeySet}:${s.settings.voice.provider}`); // handsFreeProblem() follows the key and the voice
  if (!listen || listen.provider === 'off') return null;
  const on = listen.handsFree;
  const why = handsFreeProblem(ceoName);
  return (
    <button
      type="button"
      className={`hands-free ${on ? 'hands-free-on' : ''}`}
      aria-pressed={on}
      title={on ? `Manos libres activado: después de la respuesta hablada de ${ceoName}, el móvil escucha hasta 8 s y envía lo que digas. Esc o M cierran el micro.` : why || `Manos libres: habla con ${ceoName} sin tocar nada`}
      onClick={() => void setHandsFree(!on, ceoName)}
    >
      🎧 {on ? 'Manos libres activado' : 'Manos libres'}
    </button>
  );
}

function Bubble({ m, ceoName }: { m: PhoneMessage; ceoName: string }) {
  const req = useStore((s) => (m.requestId ? s.requests.find((r) => r.id === m.requestId) : undefined));
  if (m.from === 'office') return <div className="bubble-office">{m.text}</div>;
  const mine = m.from === 'manager';
  return (
    <div className={`bubble-row ${mine ? 'bubble-row-me' : ''}`}>
      <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'}`}>
        {!mine && <div className="bubble-from">{ceoName}</div>}
        {mine ? <div className="bubble-text">{m.text}</div> : <Markdown className="bubble-md" text={m.text} />}
        {req && req.status === 'pending' && m.from === 'ceo' && <Resume req={req} />}
        <div className="bubble-time">
          {!mine && <ReplayButton m={m} />}
          {clock(m.at)}
        </div>
      </div>
    </div>
  );
}

/** The thread with the CEO; pocket mode shows it as its Chat tab, where the keyboard waits for a tap. */
export function Chat({ autoFocus = true }: { autoFocus?: boolean }) {
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const settings = useStore((s) => s.settings);
  const running = useStore((s) => Object.values(s.agents).filter(isBusy).length);
  // What the CEO is doing right now, from its log (the chat watches it): a tool call, a thought or a reply.
  const step = useStore((s) => {
    const c = s.agents[CEO_ID];
    return c?.status === 'working' ? currentStep(s.logs[CEO_ID] ?? [], c.startedAt) : null;
  });
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // Reading the thread marks it read.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.from === 'ceo');
    if (last && last.at > readAt) void attempt(() => api.phoneRead(last.at));
  }, [messages, readAt]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, info.job?.kind]);

  if (!ceo) return <p className="muted phone-empty">El despacho de la esquina está vacío.</p>;
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void attempt(() => api.messageCeo(body));
  };
  const replying = ceo.status === 'working' && info.job?.kind === 'chat';
  const chatQueued = info.queue.some((j) => j.kind === 'chat');
  const presence =
    ceo.status === 'working'
      ? replying
        ? 'escribiendo…'
        : `ocupado: ${info.job?.label ?? 'trabajando'}`
      : chatQueued
        ? settings.sessionLimit && running >= settings.sessionLimit
          ? `responderá cuando quede libre una sesión (${running}/${settings.sessionLimit} ocupadas)`
          : 'leyendo tu mensaje…'
        : info.queue.length
          ? `a continuación: ${info.queue[0].label}`
          : 'disponible';

  return (
    <div className="phone-chat">
      <div className="chat-head">
        <Avatar name={ceo.name} color={ceo.color} />
        <div className="grow">
          <b>{ceo.name}</b> <span className="muted small">CEO</span>
          <div className={`small ${ceo.status === 'working' ? 'presence-busy' : 'muted'}`}>{presence}</div>
          {step && (
            <div className="small muted ceo-step" title={step}>
              {step}
            </div>
          )}
        </div>
        <HandsFreeToggle ceoName={ceo.name} />
      </div>
      <div className="chat-log" ref={scroller} aria-label={`Mensajes con ${ceo.name}`} tabIndex={0}>
        {messages.length === 0 && (
          <p className="muted small phone-empty">
            Saluda a {ceo.name}. Pregunta cómo van las cosas, pásale el brief de un proyecto o pregunta si algún equipo debería crecer. Las respuestas llegan aquí, y el móvil vibra cuando {ceo.name} te necesita.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} ceoName={ceo.name} />
        ))}
        {replying && (
          <div className="bubble-row">
            <div className="bubble bubble-them bubble-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} className="quick-chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <MessageBox value={text} onChange={setText} placeholder={`Mensaje para ${ceo.name}…`} aria-label={`Mensaje para ${ceo.name}`} title="Enter envía · Shift+Enter añade una línea nueva" autoFocus={autoFocus} />
        <MicButton kind="phone" value={text} onChange={setText} onSend={send} />
        <button className="btn btn-small btn-good" disabled={!text.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}

// ---------- company at a glance ----------
