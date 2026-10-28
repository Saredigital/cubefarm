// Settings → Notifications (docs/pocket.md): which events, the office URL messages link to, this device (desktop
// notifications, Web Push) and ntfy. Its topic URL and token are write-only: the browser sees a hint of them.
import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { NOTIFY_EVENTS } from '../../../shared/notify';
import type { NotifyChannel, NotifySettings as Notify, NotifyWebhook } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { showTestNote } from '../notifications';
import { currentPush, disablePush, enablePush, pushSupport } from '../pwa';

const DOCS = 'https://github.com/Saredigital/cubefarm/blob/main/docs/pocket.md';

type Field = { key: string; label: string; placeholder: string; secret: boolean; optional?: boolean };

const WEBHOOKS: { id: NotifyWebhook; label: string; help: string; fields: Field[] }[] = [
  {
    id: 'ntfy',
    label: 'ntfy',
    help: 'Elige un tema largo y difícil de adivinar y suscríbete a él en la app de ntfy. Cualquiera que conozca el tema puede leerlo.',
    fields: [
      { key: 'url', label: 'URL del tema', placeholder: 'https://ntfy.sh/mi-oficina-7f3k9q', secret: true },
      { key: 'token', label: 'Token de acceso (opcional)', placeholder: 'tk_…', secret: true, optional: true },
    ],
  },
];

type Save = (patch: Partial<Notify>) => void;

/** A Test button's answer, shown beside it. */
function useTest(channel: NotifyChannel) {
  const [state, setState] = useState<{ busy: boolean; result: string | null; ok: boolean }>({ busy: false, result: null, ok: false });
  const run = async () => {
    setState({ busy: true, result: null, ok: false });
    try {
      await api.testNotify(channel);
      setState({ busy: false, result: '✓ Enviado', ok: true });
    } catch (err) {
      setState({ busy: false, result: err instanceof Error ? err.message : String(err), ok: false });
    }
  };
  return { ...state, run };
}

function TestResult({ result, ok }: { result: string | null; ok: boolean }) {
  if (!result) return null;
  return (
    <span className={`small ${ok ? 'notify-ok' : 'term-error'}`} role="status">
      {result}
    </span>
  );
}

function WebhookRow({ hook, notify, save }: { hook: (typeof WEBHOOKS)[number]; notify: Notify; save: Save }) {
  const view = useStore((s) => s.notifyChannels.webhooks[hook.id]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const test = useTest(hook.id);
  const errorId = useId();
  const store = async (body: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      await api.setWebhook(hook.id, body);
      setValues({}); // never kept or shown again once saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const on = notify.channels[hook.id];
  return (
    <div className="notify-hook">
      <div className="row wrap">
        <b className="grow">{hook.label}</b>
        {view.set && (
          <label className="toggle small">
            <input type="checkbox" checked={on} onChange={(e) => save({ channels: { ...notify.channels, [hook.id]: e.target.checked } })} /> Activado
          </label>
        )}
      </div>
      {view.set && !editing ? (
        <div className="row wrap">
          <span className="grow small">
            🔑 Guardado <code>{view.hint}</code>
          </span>
          <button className="btn btn-small" disabled={test.busy} onClick={() => void test.run()}>
            {test.busy ? 'Enviando…' : 'Probar'}
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>
            Sustituir
          </button>
          <button
            className="btn btn-small btn-ghost"
            disabled={busy}
            onClick={() =>
              void confirmDialog({ tone: 'danger', title: `¿Quitar los ajustes de ${hook.label}?`, body: 'Se borran de la oficina. No se envía nada más ahí hasta que los vuelvas a añadir.', confirm: 'Quitar' }).then((ok) => {
                if (ok) void store({});
              })
            }
          >
            Quitar
          </button>
          <TestResult result={test.result} ok={test.ok} />
        </div>
      ) : (
        <form
          className="notify-form"
          onSubmit={(e) => {
            e.preventDefault();
            void store(values);
          }}
        >
          <p className="muted small">{hook.help}</p>
          {hook.fields.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
              />
            </label>
          ))}
          {error && (
            <div id={errorId} className="term-error small" role="alert">
              {error}
            </div>
          )}
          <div className="row">
            <button className="btn btn-small btn-good" disabled={busy || hook.fields.some((f) => !f.optional && !values[f.key]?.trim())}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  setEditing(false);
                  setValues({});
                  setError('');
                }}
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

const permissionNow = (): NotificationPermission | 'unsupported' => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/** Desktop notifications and Web Push, for the device this page is open on. */
function ThisDevice({ notify, save }: { notify: Notify; save: Save }) {
  const devices = useStore((s) => s.notifyChannels.pushDevices);
  const [permission, setPermission] = useState(permissionNow);
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pushTest = useTest('push');
  const support = typeof window === 'undefined' ? 'unsupported' : pushSupport();
  useEffect(() => {
    if (support === 'ok') void currentPush().then((s) => setHere(!!s), () => setHere(false));
  }, [support, devices]);
  const allow = async () => setPermission(await Notification.requestPermission());
  const togglePush = async (on: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (on) await enablePush();
      else await disablePush();
      setHere(on);
      setPermission(permissionNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Notificaciones de escritorio</b>
          <label className="toggle small">
            <input type="checkbox" checked={notify.channels.desktop} onChange={(e) => save({ channels: { ...notify.channels, desktop: e.target.checked } })} /> Activado
          </label>
        </div>
        <p className="muted small">Desde cualquier navegador con la oficina abierta en una pestaña en segundo plano.</p>
        <div className="row wrap">
          {permission === 'granted' && <span className="small grow">✓ Permitidas en este navegador</span>}
          {permission === 'denied' && <span className="small grow term-error">Bloqueadas en este navegador: permite las notificaciones de este sitio en sus ajustes.</span>}
          {permission === 'unsupported' && <span className="small grow muted">Este navegador no puede mostrar notificaciones.</span>}
          {permission === 'default' && (
            <button className="btn btn-small btn-good" onClick={() => void allow()}>
              Permitir en este navegador
            </button>
          )}
          {permission === 'granted' && (
            <button className="btn btn-small" onClick={() => void showTestNote()}>
              Probar
            </button>
          )}
        </div>
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Push a mis dispositivos</b>
          <label className="toggle small">
            <input type="checkbox" checked={notify.channels.push} onChange={(e) => save({ channels: { ...notify.channels, push: e.target.checked } })} /> Activado
          </label>
        </div>
        <p className="muted small">
          Llega a un móvil o a un PC aunque la oficina esté cerrada. {devices ? `${devices} ${devices === 1 ? 'dispositivo registrado' : 'dispositivos registrados'}.` : 'Aún no hay dispositivos registrados.'}
        </p>
        {support === 'insecure' && (
          <p className="small term-error">
            Las notificaciones push necesitan HTTPS (o localhost en el propio PC de la oficina). Abre la oficina con una dirección HTTPS, como Tailscale Serve: consulta <a href={DOCS}>docs/pocket.md</a>.
          </p>
        )}
        {support === 'unsupported' && <p className="small muted">Este navegador no tiene Web Push. En un iPhone, añade primero la oficina a la pantalla de inicio y activa el push desde ahí.</p>}
        {support === 'dev' && <p className="small muted">El push funciona con la oficina compilada (npm run build), no con el servidor de desarrollo.</p>}
        {support === 'ok' && (
          <div className="row wrap">
            {here ? (
              <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void togglePush(false)}>
                Dejar de enviar push a este dispositivo
              </button>
            ) : (
              <button className="btn btn-small btn-good" disabled={busy || here === null} onClick={() => void togglePush(true)}>
                {busy ? 'Registrando…' : 'Enviar push a este dispositivo'}
              </button>
            )}
            <button className="btn btn-small" disabled={pushTest.busy || !devices} onClick={() => void pushTest.run()}>
              Enviar prueba
            </button>
            <TestResult result={pushTest.result} ok={pushTest.ok} />
          </div>
        )}
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
      </div>
    </>
  );
}

export function NotifySettings() {
  const notify = useStore((s) => s.settings.notify);
  const [url, setUrl] = useState(notify.officeUrl);
  useEffect(() => setUrl(notify.officeUrl), [notify.officeUrl]);
  const save: Save = (patch) => void api.updateSettings({ notify: { ...notify, ...patch } }).catch(() => undefined);
  return (
    <div className="card notify-settings">
      <h3>🔔 Notificaciones</h3>
      <p className="muted small">Lo que te cuenta la oficina cuando no estás mirando. Como mucho una de cada tipo por minuto; una ráfaga llega como un solo resumen.</p>
      <div className="notify-events" role="group" aria-label="Avísame cuando">
        {NOTIFY_EVENTS.map((e) => (
          <label key={e.id} className="toggle block">
            <input type="checkbox" checked={notify.events[e.id]} onChange={(ev) => save({ events: { ...notify.events, [e.id]: ev.target.checked } })} />
            <span>{e.label}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Dirección de la oficina para los enlaces (opcional)</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url.trim() !== notify.officeUrl && save({ officeUrl: url.trim() })}
          placeholder="https://oficina.tu-tailnet.ts.net"
          inputMode="url"
        />
      </label>
      <h4 className="notify-h">Este dispositivo</h4>
      <ThisDevice notify={notify} save={save} />
      <h4 className="notify-h">App del móvil</h4>
      {WEBHOOKS.map((h) => (
        <WebhookRow key={h.id} hook={h} notify={notify} save={save} />
      ))}
      <p className="muted small">
        El tema y el token se quedan en el PC de la oficina y no se vuelven a mostrar. Cómo configurar cada uno, y cómo llegar a la oficina desde el móvil de forma segura: <a href={DOCS}>docs/pocket.md</a>.
      </p>
    </div>
  );
}
