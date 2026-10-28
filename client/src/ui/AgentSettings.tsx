import { Fragment, useEffect, useId, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { isBusy, useStore, type Agent } from '../store';
import type { AgentCli, AgentPromptView, CliView, CloudMachineState, EffortLevel, MachineHost } from '../../../shared/types';
import { CEO_CLIS, CEO_MODELS, CLAUDE_MODELS, ceoCli, effectiveModel, modelSuggestions } from '../../../shared/models';
import { workerCli } from './floorRows';
import { confirmDialog } from './Confirm';

// One agent's setup (name, coding agent, model, effort), edited in place: the Team tab's row cells and the
// ⚙️ Setup section of their panel share these. Every change is a PATCH; the `agent` event updates all views.

export const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const cliName = (clis: CliView[], id: AgentCli) => clis.find((c) => c.id === id)?.label ?? id;

type Patch = Parameters<typeof api.updateAgent>[1];

async function save(id: string, patch: Patch) {
  try {
    await api.updateAgent(id, patch);
  } catch {
    // api() already toasted the error
  }
}

/** The coding agents to pick from, installed ones first, each saying if it's missing on this machine. */
export function CliOptions({ clis }: { clis: CliView[] }) {
  return (
    <>
      {[...clis].sort((a, b) => Number(b.installed) - Number(a.installed)).map((c) => (
        <option key={c.id} value={c.id} disabled={!c.installed}>
          {c.label}
          {c.installed ? '' : ' (no instalado)'}
        </option>
      ))}
    </>
  );
}

interface FieldProps {
  agent: Agent;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export function NameInput({ agent, id, className = 'inline', style }: FieldProps) {
  return (
    <input
      id={id}
      key={`n-${agent.name}`}
      className={className}
      style={style}
      defaultValue={agent.name}
      maxLength={24}
      aria-label={id ? undefined : 'Nombre'}
      onBlur={(e) => e.target.value.trim() && e.target.value !== agent.name && void save(agent.id, { name: e.target.value })}
    />
  );
}

export function CliSelect({ agent, id, style }: FieldProps) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  if (agent.role === 'ceo') {
    return (
      <select id={id} value={ceoCli(agent.cli)} title="El agente de código del CEO" aria-label={id ? undefined : 'Agente de código'} style={style} onChange={(e) => void save(agent.id, { cli: e.target.value as AgentCli })}>
        {CEO_CLIS.map((c) => {
          const missing = clis.some((v) => v.id === c && !v.installed);
          return (
            <option key={c} value={c} disabled={missing}>
              {cliName(clis, c)}
              {missing ? ' (no instalado)' : ''}
            </option>
          );
        })}
      </select>
    );
  }
  return (
    <select id={id} value={agent.cli} title="Su agente de código" aria-label={id ? undefined : 'Agente de código'} style={style} onChange={(e) => void save(agent.id, { cli: e.target.value as AgentCli | '' })}>
      <option value="">{cliName(clis, settings.defaultCli)} (predeterminado)</option>
      <CliOptions clis={clis} />
    </select>
  );
}

/** A cloud agent's Box, in words. */
export const CLOUD_STATE: Record<CloudMachineState, string> = {
  none: 'aún sin Box',
  creating: 'creando su Box…',
  'setting-up': 'preparando su Box…',
  ready: 'Box listo',
  paused: 'Box en pausa (se activa con su próxima tarea)',
  disconnected: 'reconectando con su Box…',
  error: 'no se ha podido preparar su Box',
};

/** Where they work: this computer or an Upstash Box of their own (docs/cloud.md). A move waits until they have no task. */
export function HostSelect({ agent, id, style }: FieldProps) {
  const settings = useStore((s) => s.settings);
  const keySet = useStore((s) => s.cloud.keySet);
  const box = agent.host === 'box';
  const opencode = workerCli(agent, settings) === 'opencode';
  const busy = !!agent.task || isBusy(agent);
  const move = async (to: MachineHost) => {
    const ok = await confirmDialog({
      title: to === 'box' ? `¿Mover a ${agent.name} a la nube?` : `¿Devolver a ${agent.name} a este ordenador?`,
      body: `Se elimina su máquina ${to === 'box' ? 'de aquí' : 'en la nube'} (antes, el trabajo que no esté en GitHub se guarda en leftovers) y su próxima sesión empieza de cero${to === 'box' ? ' en un Upstash Box propio' : ''}.`,
      confirm: 'Mover',
    });
    if (ok) await save(agent.id, { host: to });
  };
  return (
    <select id={id} value={box ? 'box' : 'local'} disabled={busy} style={style} title={busy ? 'Muévelo cuando termine su tarea' : 'Dónde trabaja'} aria-label={id ? undefined : 'Trabaja en'} onChange={(e) => void move(e.target.value as MachineHost)}>
      <option value="local">🖥️ Este ordenador</option>
      <option value="box" disabled={!box && (!keySet || opencode)}>
        ☁️ Upstash Box{!box && !keySet ? ' (conecta antes Upstash en Ajustes)' : !box && opencode ? ' (OpenCode no puede ejecutarse allí)' : ''}
      </option>
    </select>
  );
}

export function ModelInput({ agent, id, className = 'inline', style }: FieldProps) {
  const settings = useStore((s) => s.settings);
  const listId = useId();
  const cli = workerCli(agent, settings);
  return (
    <>
      <input
        id={id}
        key={`m-${agent.model}-${cli}`}
        className={className}
        style={style}
        list={listId}
        defaultValue={agent.model}
        placeholder={(agent.role === 'ceo' ? CEO_MODELS[ceoCli(agent.cli)] : effectiveModel('', cli, settings, CLAUDE_MODELS[0])) || 'predeterminado del agente'}
        title={agent.role === 'ceo' ? 'El modelo del CEO' : "Su modelo ('' = el predeterminado de su agente de código)"}
        aria-label={id ? undefined : 'Modelo'}
        onBlur={(e) => e.target.value !== agent.model && void save(agent.id, { model: e.target.value })}
      />
      <datalist id={listId}>
        {modelSuggestions(cli).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

export function EffortSelect({ agent, id, style }: FieldProps) {
  const defaultEffort = useStore((s) => s.settings.defaultEffort);
  return (
    <select id={id} value={agent.effort} title={agent.role === 'ceo' ? 'El esfuerzo del CEO' : 'Su esfuerzo'} aria-label={id ? undefined : 'Esfuerzo'} style={style} onChange={(e) => void save(agent.id, { effort: e.target.value as EffortLevel | '' })}>
      {(agent.role !== 'ceo' || !agent.effort) && <option value="">predeterminado ({defaultEffort})</option>}
      {EFFORTS.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
}

/**
 * "What they're told": what the office gives them on each kind of task (the CEO: its one prompt), read-only, with
 * <placeholders> for each task's details. Fetched when opened and again whenever something in it changes.
 */
export function PromptPreview({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<AgentPromptView | null>(null);
  const [failed, setFailed] = useState(false);
  // The floor's (or, for the CEO, the office's) settings that appear in the prompt: changing one refreshes it.
  const context = useStore((s) => {
    const r = s.repos.find((x) => x.id === agent.repoId);
    const o = s.settings;
    return JSON.stringify(r ? [r.fullName, r.defaultBranch, r.autoMerge, r.browserTesting, r.links, r.mission, r.summary, r.qaBrief] : [o.companyName, o.managerName, o.sessionLimit, o.maxAgents, o.scaling]);
  });
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.agentPrompt(agent.id).then(
      (p) => {
        if (!live) return;
        setPrompt(p);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, agent.id, agent.name, context]);
  return (
    <details className="prompt-preview" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Qué instrucciones recibe</summary>
      {failed && !prompt && <p className="muted small">No se ha podido cargar su prompt.</p>}
      {!prompt && !failed && <p className="muted small">Cargando…</p>}
      {prompt && (
        <>
          <p className="muted small">
            {prompt.kind === 'ceo'
              ? 'Las instrucciones del CEO para cada trabajo. Todas son de la propia oficina.'
              : 'El flujo de trabajo y las normas de seguridad de la oficina para cada tipo de tarea, iguales para todos los agentes y enviadas en cada sesión; los <marcadores> se rellenan en cada tarea.'}
          </p>
          {prompt.parts.map((p) => (
            <Fragment key={p.label}>
              <p className="small">
                <b>{p.label}</b> <span className="muted">· {p.text.length.toLocaleString('es-ES')} caracteres</span>
              </p>
              <pre className="prompt-text" tabIndex={0} aria-label={`Prompt de ${agent.name}: ${p.label}`}>
                {p.text}
              </pre>
            </Fragment>
          ))}
        </>
      )}
    </details>
  );
}

/** The ⚙️ Setup section of an agent's panel. The CEO picks Claude Code or Codex, a model and an effort. */
export function AgentSetup({ agent }: { agent: Agent }) {
  const terminal = useStore((s) => s.settings.runtime === 'terminal');
  const id = useId();
  const ceo = agent.role === 'ceo';
  return (
    <section className="card agent-setup" aria-label={`Configuración de ${agent.name}`}>
      <div className="row wrap">
        <h3 className="grow">⚙️ Configuración</h3>
        {isBusy(agent) && (
          <span className="chip chip-warn" role="status">
            Se aplica desde su próxima tarea
          </span>
        )}
      </div>
      <div className="setup-grid">
        {!ceo && (
          <label className="field" htmlFor={`${id}-name`}>
            <span>Nombre</span>
            <NameInput agent={agent} id={`${id}-name`} className="" />
          </label>
        )}
        {(ceo || terminal || agent.host === 'box') && (
          <label className="field" htmlFor={`${id}-cli`}>
            <span>Agente de código</span>
            <CliSelect agent={agent} id={`${id}-cli`} />
          </label>
        )}
        {!ceo && (
          <label className="field" htmlFor={`${id}-host`}>
            <span>
              Trabaja en{agent.host === 'box' && agent.cloud && <span className="muted"> · {CLOUD_STATE[agent.cloud]}</span>}
            </span>
            <HostSelect agent={agent} id={`${id}-host`} />
          </label>
        )}
        <label className="field" htmlFor={`${id}-model`}>
          <span>Modelo</span>
          <ModelInput agent={agent} id={`${id}-model`} className="" />
        </label>
        <label className="field" htmlFor={`${id}-effort`}>
          <span>Esfuerzo</span>
          <EffortSelect agent={agent} id={`${id}-effort`} />
        </label>
      </div>
      <PromptPreview agent={agent} />
      <p className="muted small">El nombre y el modelo se guardan al salir del campo; lo demás, en cuanto lo eliges. Las sesiones en marcha no se reinician.</p>
    </section>
  );
}
