// The Settings tab's Voice section: who reads messages aloud, the ElevenLabs key (write-only), the voice, and a Test;
// then talking instead of typing: who turns speech into text, auto-send and hands-free. The key lives on the server;
// the browser only ever sees its last 4 characters.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { SAMPLE_LINE } from '../../../shared/speech';
import { cacheLabel, clampKeepDays, KEEP_DAYS_MAX, KEEP_DAYS_MIN } from '../../../shared/voiceClips';
import { CEO_ID, type ListenProvider, type ListenSettings, type VoiceOption, type VoiceProvider, type VoiceSettings as Voice } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { micCaps, setHandsFree } from './mic';
import { cantListen } from './micText';
import { getAudioPrefs } from './sfx';
import { keyName } from './controls';
import { Key } from './Key';
import { browserVoices, searchVoices, voiceLabels, type BrowserVoice } from './voicePicker';
import { playClip, speakLine, stopVoice } from './voicePlayback';

const DOCS = 'https://github.com/Saredigital/cubefarm/blob/main/docs/voice.md';

const PROVIDERS: [VoiceProvider, string, string][] = [
  ['off', 'Desactivado', ''],
  ['browser', 'Voz del navegador', 'gratis, integrada'],
  ['elevenlabs', 'ElevenLabs', 'voces naturales, con tu propia clave'],
];

const LISTENERS: [ListenProvider, string, string][] = [
  ['off', 'Desactivado', 'sin 🎙️'],
  ['browser', 'Navegador', 'gratis, integrado'],
  ['elevenlabs', 'ElevenLabs Speech to Text', 'con tu propia clave'],
];

type Save = (patch: Partial<Voice>) => void;

/** What's playing: a voice's preview (its id), the Test line, or nothing. */
type Playing = string | null;

function hintMuted() {
  if (getAudioPrefs().muted) useStore.getState().pushToast('info', `🔇 El sonido está desactivado: pulsa ${keyName('mute')} para oírlo`);
}

/** The browser's voices, which arrive asynchronously; null where the browser can't speak. */
function useBrowserVoices(): BrowserVoice[] | null {
  const read = () => (typeof speechSynthesis === 'undefined' ? null : browserVoices(speechSynthesis.getVoices(), navigator.language));
  const [voices, setVoices] = useState(read);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(read());
    speechSynthesis.addEventListener('voiceschanged', update);
    update();
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

function ElevenLabsKey() {
  const keySet = useStore((s) => s.voiceKeySet);
  const hint = useStore((s) => s.voiceKeyHint);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.setVoiceKey(value);
      setKey(''); // the key is never kept or shown again once it's saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (keySet && !editing)
    return (
      <div className="row wrap">
        <span className="grow">
          🔑 Clave guardada <code>••••{hint}</code>
        </span>
        <button className="btn btn-small" onClick={() => setEditing(true)}>
          Sustituir
        </button>
        <button
          className="btn btn-small btn-ghost"
          disabled={busy}
          onClick={() =>
            void confirmDialog({ tone: 'danger', title: '¿Quitar la clave de ElevenLabs?', body: 'Se borra de este PC. ElevenLabs no leerá los mensajes en voz alta hasta que vuelvas a añadir una clave.', confirm: 'Quitar' }).then(
              (ok) => {
                if (ok) void save('');
              },
            )
          }
        >
          Quitar
        </button>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void save(key.trim());
      }}
    >
      <label className="field">
        <span>Clave de API de ElevenLabs</span>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={keySet ? 'Pega la clave nueva' : 'Pega tu clave'}
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
        <button className="btn btn-small btn-good" disabled={busy || !key.trim()}>
          {busy ? 'Comprobando…' : 'Guardar clave'}
        </button>
        {editing && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setEditing(false);
              setKey('');
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

function VoiceRow({ v, chosen, playing, onChoose, onPreview }: { v: VoiceOption; chosen: boolean; playing: boolean; onChoose: () => void; onPreview: () => void }) {
  const labels = voiceLabels(v);
  return (
    <div className={`voice-row ${chosen ? 'voice-row-on' : ''}`}>
      <label className="toggle grow">
        <input type="radio" name="elevenlabs-voice" checked={chosen} onChange={onChoose} />
        <span>
          <b>{v.name}</b>
          {v.labels?.description && <span className="muted"> · {v.labels.description}</span>}
          {labels && <span className="muted small voice-labels">{labels}</span>}
        </span>
      </label>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        aria-label={playing ? `Parar la muestra de ${v.name}` : `Escuchar una muestra de ${v.name}`}
        title={v.previewUrl ? undefined : 'Dice la frase de prueba con esta voz'}
        onClick={onPreview}
      >
        {playing ? '■ Parar' : '▶ Escuchar'}
      </button>
    </div>
  );
}

function ElevenLabsVoices({ voice, save, playing, setPlaying }: { voice: Voice; save: Save; playing: Playing; setPlaying: (p: Playing) => void }) {
  const hint = useStore((s) => s.voiceKeyHint);
  const [list, setList] = useState<VoiceOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(false);
    api.voices().then(
      (l) => live && setList(l),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [hint]);
  // Show the chosen voice when the list arrives, even when it's far down.
  useEffect(() => {
    const el = listRef.current;
    const row = el?.querySelector<HTMLElement>('.voice-row-on');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
  }, [list]);
  const preview = async (v: VoiceOption) => {
    if (playing === v.id) return stopVoice();
    hintMuted();
    setPlaying(v.id);
    try {
      // Library voices may have no preview of their own: then it's the test line, made once and cached.
      const ok = await playClip(v.previewUrl ?? (await api.voiceSample(v.id)));
      if (!ok) useStore.getState().pushToast('error', `No se ha podido reproducir la muestra de ${v.name}`);
    } catch {
      // api already toasted the error
    } finally {
      setPlaying(null);
    }
  };
  if (failed) return <p className="muted small">No se han podido cargar las voces.</p>;
  if (!list) return <p className="muted small">Cargando las voces…</p>;
  const { recommended, others } = searchVoices(list, query);
  const row = (v: VoiceOption) => (
    <VoiceRow key={v.id} v={v} chosen={voice.voiceId === v.id} playing={playing === v.id} onChoose={() => save({ voiceId: v.id, voiceName: v.name })} onPreview={() => void preview(v)} />
  );
  return (
    <>
      <label className="field">
        <span>
          Voz{voice.voiceName && <span className="muted"> · {voice.voiceName}</span>}
        </span>
        <input type="search" aria-label="Buscar voces" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca por nombre, acento, edad…" />
      </label>
      <div ref={listRef} className="voice-list" role="radiogroup" aria-label="Voces de ElevenLabs">
        {recommended.length > 0 && <div className="voice-group">⭐ Recomendadas</div>}
        {recommended.map(row)}
        {others.length > 0 && <div className="voice-group">Todas las voces</div>}
        {others.map(row)}
        {recommended.length + others.length === 0 && <div className="muted small">Ninguna voz coincide con “{query}”.</div>}
      </div>
    </>
  );
}

function BrowserVoices({ voice, save }: { voice: Voice; save: Save }) {
  const voices = useBrowserVoices();
  if (!voices) return <p className="muted small">Este navegador no puede hablar. Prueba con Chrome o Edge, o elige ElevenLabs.</p>;
  const chosen = voices.some((v) => v.name === voice.voiceName) ? voice.voiceName : '';
  return (
    <label className="field">
      <span>Voz del navegador</span>
      <select value={chosen} onChange={(e) => save({ voiceName: e.target.value })}>
        <option value="">La del navegador por defecto</option>
        {voices.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name}
            {v.lang && ` (${v.lang})`}
          </option>
        ))}
      </select>
      {voices.length === 0 && <span className="muted small">El navegador aún no ha listado sus voces; se usa su voz por defecto.</span>}
    </label>
  );
}

/** How long ElevenLabs clips are kept for the phone's ▶, how much is saved now, and a way to clear it. */
function SavedClips({ voice, save }: { voice: Voice; save: Save }) {
  const cache = useStore((s) => s.voiceCache);
  const [days, setDays] = useState(String(voice.keepDays));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDays(String(voice.keepDays)), [voice.keepDays]);
  const commit = () => {
    const n = clampKeepDays(days);
    setDays(String(n));
    if (n !== voice.keepDays) save({ keepDays: n });
  };
  const clear = async () => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: '¿Borrar los clips guardados?',
      body: 'Después de esto, los mensajes leídos por ElevenLabs no se podrán volver a reproducir desde el móvil. Los mensajes nuevos se guardan otra vez según llegan.',
      confirm: 'Borrar',
    });
    if (!ok) return;
    setBusy(true);
    await api.clearVoiceCache().catch(() => undefined);
    setBusy(false);
  };
  return (
    <div className="voice-clips">
      <label className="field">
        <span>Guardar los clips de voz durante</span>
        <span className="row">
          <input
            type="number"
            min={KEEP_DAYS_MIN}
            max={KEEP_DAYS_MAX}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            style={{ width: '5em' }}
          />
          <span>días</span>
        </span>
      </label>
      <div className="row wrap">
        <span className="grow small">
          💾 {cacheLabel(cache.clips, cache.bytes)}
          <span className="muted"> · los 20 mensajes más recientes del CEO siempre conservan el suyo, así que ▶ en el móvil los reproduce gratis</span>
        </span>
        <button className="btn btn-small btn-ghost" disabled={busy || cache.clips === 0} onClick={() => void clear()}>
          Borrar los clips guardados
        </button>
      </div>
    </div>
  );
}

export function VoiceSettings() {
  const voice = useStore((s) => s.settings.voice);
  const keySet = useStore((s) => s.voiceKeySet);
  const cache = useStore((s) => s.voiceCache);
  const [playing, setPlaying] = useState<Playing>(null);
  const radioName = useId();
  useEffect(() => stopVoice, []); // closing the console stops a preview
  const save: Save = (patch) => void api.updateSettings({ voice: { ...voice, ...patch } }).catch(() => undefined);
  const eleven = voice.provider === 'elevenlabs';
  const canTest = voice.provider === 'browser' || (eleven && keySet && !!voice.voiceId);
  const test = async () => {
    if (playing === 'test') return stopVoice();
    hintMuted();
    setPlaying('test');
    try {
      const ok = eleven ? await playClip(await api.voiceSample(voice.voiceId)) : await speakLine(SAMPLE_LINE, voice.voiceName);
      if (!ok) useStore.getState().pushToast('error', eleven ? 'No se ha podido reproducir la prueba' : 'El navegador no ha podido decir la frase de prueba');
    } catch {
      // api already toasted the error
    } finally {
      setPlaying(null);
    }
  };
  return (
    <div className="card">
      <h3>🔊 Voz</h3>
      <p className="muted small">Escucha los mensajes del CEO leídos en voz alta en cuanto llegan, sin abrir el móvil.</p>
      <div role="radiogroup" aria-labelledby={`${radioName}-label`}>
        <div id={`${radioName}-label`} className="field">
          Leer los mensajes
        </div>
        {PROVIDERS.map(([p, label, note]) => (
          <label key={p} className="toggle block">
            <input type="radio" name={radioName} checked={voice.provider === p} onChange={() => save({ provider: p })} />
            <span>
              <b>{label}</b>
              {note && ` (${note})`}
            </span>
          </label>
        ))}
      </div>
      {eleven && (
        <>
          <p className="muted small">
            Consigue una clave en{' '}
            <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">
              elevenlabs.io
            </a>{' '}
            (Developers → API Keys). Se queda en este PC y no se vuelve a mostrar. Los costes y consejos sobre voces están en{' '}
            <a href={DOCS} target="_blank" rel="noreferrer">
              docs/voice.md
            </a>
            .
          </p>
          <ElevenLabsKey />
          {keySet && <ElevenLabsVoices voice={voice} save={save} playing={playing} setPlaying={setPlaying} />}
        </>
      )}
      {voice.provider === 'browser' && <BrowserVoices voice={voice} save={save} />}
      {voice.provider !== 'off' && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={voice.speakOffice} onChange={(e) => save({ speakOffice: e.target.checked })} /> Leer también los avisos de la oficina
          </label>
          <div className="row">
            <button className="btn btn-small" disabled={!canTest} onClick={() => void test()} title={canTest ? undefined : 'Primero guarda una clave y elige una voz'}>
              {playing === 'test' ? '■ Parar' : '🔈 Probar'}
            </button>
            <span className="muted small">Las muestras y pruebas suenan a tu volumen; M las silencia.</span>
          </div>
        </>
      )}
      {(eleven || cache.clips > 0) && <SavedClips voice={voice} save={save} />}
      <Listening keyShown={eleven} />
    </div>
  );
}

/** Talking instead of typing: who turns speech into text, sending when you stop talking, and the hands-free phone. */
function Listening({ keyShown }: { keyShown: boolean }) {
  const listen = useStore((s) => s.settings.listen);
  const keySet = useStore((s) => s.voiceKeySet);
  const voiceOn = useStore((s) => s.settings.voice.provider !== 'off');
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'el CEO');
  const radioName = useId();
  if (!listen) return null;
  const save = (patch: Partial<ListenSettings>) => void api.updateSettings({ listen: { ...listen, ...patch } }).catch(() => undefined);
  const why = listen.provider === 'off' ? '' : cantListen(listen.provider, micCaps(), keySet || listen.provider !== 'elevenlabs');
  return (
    <div className="listen-settings">
      <h4>🎙️ Habla en lugar de escribir</h4>
      <p className="muted small">
        Mantén pulsado el 🎙️ junto a Enviar (o mantén <Key action="talk" /> en el cuadro de mensaje) y habla: tus palabras llenan el cuadro para que las edites antes de enviar. Un toque rápido escucha hasta que dejas de hablar. <kbd>Esc</kbd> deja de escuchar.
      </p>
      <div role="radiogroup" aria-labelledby={`${radioName}-label`}>
        <div id={`${radioName}-label`} className="field">
          Convertir la voz en texto con
        </div>
        {LISTENERS.map(([p, label, note]) => (
          <label key={p} className="toggle block">
            <input type="radio" name={radioName} checked={listen.provider === p} onChange={() => save({ provider: p })} />
            <span>
              <b>{label}</b> ({note})
            </span>
          </label>
        ))}
      </div>
      {why && <p className="term-error small">{why}</p>}
      {listen.provider === 'elevenlabs' && (
        <>
          <p className="muted small">
            Lo que dices se graba en este navegador (60 segundos como mucho) y se envía a través de la oficina a ElevenLabs, que cobra según la duración del audio. Una clave restringida necesita el permiso{' '}
            <b>Speech to Text</b>.
          </p>
          {!keyShown && <ElevenLabsKey />}
        </>
      )}
      {listen.provider !== 'off' && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={listen.autoSend} onChange={(e) => save({ autoSend: e.target.checked })} /> Enviar automáticamente cuando deje de hablar
          </label>
          <label className="toggle" title={voiceOn ? undefined : `Necesita la voz de ${ceoName}: elige una en Leer los mensajes`}>
            <input type="checkbox" checked={listen.handsFree} disabled={!voiceOn && !listen.handsFree} onChange={(e) => void setHandsFree(e.target.checked, ceoName)} /> Manos libres en el móvil: después de la respuesta hablada de{' '}
            {ceoName}, escuchar hasta 8 s y enviar lo que diga{!voiceOn && <span className="muted"> (necesita Leer los mensajes, arriba)</span>}
          </label>
        </>
      )}
    </div>
  );
}
