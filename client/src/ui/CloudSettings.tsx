// Settings → Cloud agents (docs/cloud.md): where new agents work, the Upstash account their Boxes run in, and what
// they sign in with. Keys and tokens are write-only: the browser only sees whether each is there and where it's from.
// Without a key, each cloud agent's coding agent signs in in their own terminal (the 🔑 Sign in on their card).
import { useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { BOX_SIZE_INFO, BOX_SIZES, MAX_BOX_LIMIT } from '../../../shared/cloud';
import type { CloudCredentialView, CloudSettings as Cloud, CloudView } from '../../../shared/types';
import { confirmDialog } from './Confirm';

const DOCS = 'https://github.com/Saredigital/cubefarm/blob/main/docs/cloud.md';

/** A command to copy, with a Copy button. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cloud-cmd">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}

/** A write-only key or token: its hint once saved (Replace, Remove), else a field to paste one. */
function SecretField({ label, saved, hint, placeholder, help, save }: { label: string; saved: boolean; hint: string; placeholder: string; help?: string; save: (value: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const store = async (v: string) => {
    setBusy(true);
    setError('');
    try {
      await save(v);
      setValue(''); // never kept or shown again once saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (saved && !editing) {
    return (
      <div className="row wrap">
        <span className="grow small">
          🔑 Guardado: {label}{hint && <code> …{hint}</code>}
        </span>
        <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>
          Sustituir
        </button>
        <button
          className="btn btn-small btn-ghost"
          disabled={busy}
          onClick={() =>
            void confirmDialog({ tone: 'danger', title: `¿Quitar ${label}?`, body: 'Se borra de la oficina. Los agentes en la nube que lo necesiten no podrán iniciar sesión hasta que vuelvas a añadirlo.', confirm: 'Quitar' }).then((ok) => {
              if (ok) void store('');
            })
          }
        >
          Quitar
        </button>
      </div>
    );
  }
  return (
    <form
      className="notify-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store(value);
      }}
    >
      {help && <p className="muted small">{help}</p>}
      <label className="field">
        <span>{label}</span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && (
        <div id={errorId} className="term-error small" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button className="btn btn-small btn-good" disabled={busy || !value.trim()}>
          {busy ? 'Comprobando…' : 'Guardar'}
        </button>
        {editing && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setEditing(false);
              setValue('');
              setError('');
            }}
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

/** ✓ or ⚠, and where the credential comes from. */
function Status({ view, what }: { view: CloudCredentialView; what: Partial<Record<NonNullable<CloudCredentialView['source']>, string>> }) {
  return view.ready ? <span className="small notify-ok">✓ {view.source ? what[view.source] : 'Listo'}</span> : <span className="small term-error">⚠ Todavía sin configurar</span>;
}

function Boxes({ cloud }: { cloud: CloudView }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const b = cloud.boxes;
  const test = async () => {
    setBusy(true);
    setNote('');
    try {
      await api.testCloud();
      setNote('✓ Conectado');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap">
      <span className="grow small">
        {b ? `${b.total} Box${b.total === 1 ? '' : 'es'} en tu cuenta · esta oficina: ${b.running} en marcha, ${b.paused} en pausa` : 'Todavía no se han contado los Boxes.'}
        {cloud.keyError && <span className="term-error"> {cloud.keyError}</span>}
      </span>
      <button className="btn btn-small" disabled={busy} onClick={() => void test()}>
        {busy ? 'Comprobando…' : 'Probar'}
      </button>
      {!!b?.orphans && (
        <button
          className="btn btn-small btn-ghost"
          onClick={() =>
            void confirmDialog({
              tone: 'danger',
              title: `¿Borrar ${b.orphans} Box${b.orphans === 1 ? ' huérfano' : 'es huérfanos'}?`,
              body: 'Boxes de esta oficina cuyo agente ya no está. Se borran definitivamente de tu cuenta de Upstash.',
              confirm: 'Borrar',
            }).then((ok) => ok && void api.deleteCloudOrphans())
          }
        >
          Borrar {b.orphans} huérfano{b.orphans === 1 ? '' : 's'}
        </button>
      )}
      {note && (
        <span className={`small ${note.startsWith('✓') ? 'notify-ok' : 'term-error'}`} role="status">
          {note}
        </span>
      )}
    </div>
  );
}

export function CloudSettings() {
  const settings = useStore((s) => s.settings.cloud);
  const cloud = useStore((s) => s.cloud);
  const demo = useStore((s) => s.demo);
  const [error, setError] = useState('');
  const save = (patch: Partial<Cloud>) => {
    setError('');
    void api.updateSettings({ cloud: { ...settings, ...patch } }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="card notify-settings">
      <h3>☁️ Agentes en la nube</h3>
      <p className="muted small">
        Ejecuta agentes en <a href="https://upstash.com/docs/box/overall/quickstart">Upstash Boxes</a> en lugar de en este ordenador. Un agente en la nube sigue con su tarea aunque cierres la oficina o apagues el portátil, y
        la oficina se pone al día cuando vuelve. Los agentes en este ordenador siguen siendo la opción predeterminada.
      </p>

      <h4 className="notify-h">Cuenta de Upstash</h4>
      <div className="notify-hook">
        <SecretField
          label="Clave API de Upstash Box"
          saved={cloud.keySet}
          hint={cloud.keyHint}
          placeholder={demo ? 'En el modo demo vale cualquier texto' : 'Tu clave API de Box'}
          help="Créala en la consola de Upstash (console.upstash.com → Box → API Keys). Se queda en el ordenador de la oficina."
          save={(key) => api.setCloudKey(key)}
        />
        {cloud.keySet && <Boxes cloud={cloud} />}
      </div>

      <h4 className="notify-h">Dónde trabajan los agentes nuevos</h4>
      <div className="notify-hook" role="radiogroup" aria-label="Dónde trabajan los agentes nuevos">
        <label className="toggle block">
          <input type="radio" name="cloud-kind" checked={settings.machineKind === 'local'} onChange={() => save({ machineKind: 'local' })} />
          <span>🖥️ Este ordenador</span>
        </label>
        <label className="toggle block">
          <input type="radio" name="cloud-kind" checked={settings.machineKind === 'box'} disabled={!cloud.keySet} onChange={() => save({ machineKind: 'box' })} />
          <span>☁️ Un Upstash Box para cada uno{!cloud.keySet && ' (guarda antes tu clave API)'}</span>
        </label>
        <p className="muted small">Las nuevas incorporaciones trabajan aquí; en Aprobaciones puedes elegirlo para cada una. Mueve a un agente desde sus ajustes cuando no tenga tarea.</p>
        <div className="row wrap">
          <label className="field grow">
            <span>Tamaño del Box</span>
            <select value={settings.boxSize} onChange={(e) => save({ boxSize: e.target.value as Cloud['boxSize'] })}>
              {BOX_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} · {BOX_SIZE_INFO[s].spec} · ${BOX_SIZE_INFO[s].usdPerCpuHour.toFixed(2)} por hora de CPU activa
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Límite de Boxes de tu plan</span>
            <input
              type="number"
              min={1}
              max={MAX_BOX_LIMIT}
              value={settings.boxLimit}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 1) save({ boxLimit: n });
              }}
            />
          </label>
        </div>
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
      </div>

      <h4 className="notify-h">Cómo inician sesión los agentes en la nube</h4>
      <p className="muted small">
        GitHub se configura una sola vez para todos los Boxes. Los agentes de código inician sesión con tu propia suscripción en el terminal de cada agente en la nube, una vez por máquina, salvo que les des aquí una clave.
      </p>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">GitHub</b>
          <Status view={cloud.github} what={{ gh: 'Tu sesión de gh', token: 'Un token que has guardado' }} />
        </div>
        <p className="muted small">Se usa tu sesión de gh salvo que guardes un token fine-grained para los repos de tus plantas (Contents, Pull requests e Issues: lectura y escritura), que es más seguro.</p>
        <SecretField label="Token de GitHub" saved={cloud.github.source === 'token'} hint={cloud.github.hint} placeholder="github_pat_…" save={(v) => api.setCloudToken('github', v)} />
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Claude Code</b>
          <Status view={cloud.claude} what={{ login: 'Tu suscripción, por agente', subscription: 'Tu suscripción de Claude (SAREOFFICE_CLAUDE_TOKEN)', apiKey: 'Una clave API de Anthropic' }} />
        </div>
        {cloud.claude.source === 'login' && (
          <p className="muted small">
            Con tu suscripción de Claude (Pro o Max), cada agente en la nube inicia sesión una vez, en su propio terminal. Cuando alguno lo necesite, su puesto muestra una nota 🔑 y su ficha un 🔑 Inicia sesión: abre el enlace en su
            terminal, apruébalo y pega allí el código. Su máquina en la nube conserva la sesión; si alguna vez caduca, los mismos pasos vuelven a iniciarla.
          </p>
        )}
        {cloud.claude.source !== 'subscription' && (
          <>
            <p className="muted small">O paga por token con una clave API, que entonces usarán todos los agentes en la nube:</p>
            <SecretField label="Clave API de Anthropic" saved={cloud.claude.source === 'apiKey'} hint={cloud.claude.hint} placeholder="sk-ant-…" save={(v) => api.setCloudToken('anthropic', v)} />
            <details className="small">
              <summary>O un único token de suscripción para todos los agentes en la nube</summary>
              <ol className="cloud-steps">
                <li>
                  En un terminal: <Command text="claude setup-token" /> y apruébalo en el navegador. Muestra un token que dura un año.
                </li>
                <li>
                  Guárdalo en tu entorno como <code>SAREOFFICE_CLAUDE_TOKEN</code>. Windows: <Command text={'setx SAREOFFICE_CLAUDE_TOKEN "<token>"'} /> macOS o Linux: añade{' '}
                  <Command text={'export SAREOFFICE_CLAUDE_TOKEN="<token>"'} /> al perfil de tu shell.
                </li>
                <li>Reinicia la oficina.</li>
              </ol>
              <p className="muted">La oficina nunca lo guarda: las condiciones de Anthropic impiden que apps como esta almacenen tokens de Claude.</p>
            </details>
          </>
        )}
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Codex</b>
          <Status view={cloud.codex} what={{ login: 'Tu plan de ChatGPT, por agente', apiKey: 'Una clave API de OpenAI' }} />
        </div>
        <p className="muted small">
          Con tu plan de ChatGPT, cada agente en la nube inicia sesión una vez en su propio terminal: abre el enlace que muestra e introduce su código de un solo uso. O bien una clave API de OpenAI sirve en todos los Boxes:
        </p>
        <SecretField label="Clave API de OpenAI" saved={cloud.codex.source === 'apiKey'} hint={cloud.codex.hint} placeholder="sk-…" save={(v) => api.setCloudToken('openai', v)} />
      </div>
      {demo && cloud.keySet && (
        <div className="row wrap">
          <span className="grow muted small">Prueba qué pasa cuando caduca la sesión de un agente en la nube: se cierra la sesión en todos los Boxes y su agente pide volver a iniciarla.</span>
          <button className="btn btn-small btn-ghost" onClick={() => void api.expireSignIns()}>
            🔑 Hacer caducar las sesiones (demo)
          </button>
        </div>
      )}
      <p className="muted small">
        Los Boxes cuestan lo que consume su CPU mientras trabajan (los Boxes en pausa solo cuestan su disco) y el plan gratuito permite 10 Boxes. Configuración, costes y qué sigue funcionando con la oficina cerrada:{' '}
        <a href={DOCS}>docs/cloud.md</a>.
      </p>
    </div>
  );
}
