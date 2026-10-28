import { useEffect, useState, type FormEvent } from 'react';
import type { CompanySnapshot } from '../../../shared/company';
import type { SocialAccount, SocialDraft, SocialDraftInput, SocialSnapshot } from '../../../shared/companySocial';
import { companyRequest, companySessionEpoch, CompanyStaleResponseError } from './client';
import { CHANNEL_LABELS, localDate } from './logic';

const STATUS = { draft: 'Borrador', approved: 'Aprobado para publicar', scheduled: 'Programado', sending: 'Enviando al proveedor', accepted: 'Aceptado por el proveedor', published: 'Publicación confirmada', failed: 'Error del proveedor', uncertain: 'Resultado incierto', cancelled: 'Cancelado', invalidated: 'Aprobación invalidada', exported: 'Paquete aprobado exportado', manual_recorded: 'Publicación manual registrada por el responsable' };
interface ExportPacket { draft: SocialDraft; files: { filename: string; mimeType: string; sha256: string; dataBase64: string }[]; notice: string }
const PRIVACY_LABELS: Record<string, string> = { PUBLIC_TO_EVERYONE: 'Público', MUTUAL_FOLLOW_FRIENDS: 'Amigos', FOLLOWER_OF_CREATOR: 'Seguidores', SELF_ONLY: 'Solo yo' };
const inputDate = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
type Mutate = (path: string, body?: unknown, method?: string) => Promise<void>;

export function SocialWorkspace({ company }: { company: CompanySnapshot }) {
  const [state, setState] = useState<SocialSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [exported, setExported] = useState<ExportPacket | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void companyRequest<SocialSnapshot>('/social/state', 'GET', undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setState(value); }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se ha podido cargar la publicación.'); });
    return () => controller.abort();
  }, []);
  async function refresh() { setState(await companyRequest<SocialSnapshot>('/social/state')); }
  async function exportManual(draftId: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { const packet = await companyRequest<ExportPacket>(`/social/drafts/${draftId}/export`, 'POST'); setExported(packet); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se ha podido exportar el contenido aprobado.'); }
    finally { setBusy(false); }
  }
  const mutate: Mutate = async (path, body, method = 'POST') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await companyRequest<unknown>(`/social${path}`, method, body);
      await refresh();
      if (path === '/drafts' && result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') setSelected(result.id);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se ha podido completar la operación.'); }
    finally { setBusy(false); }
  };
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const epoch = companySessionEpoch();
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || !file.size) { setError('Selecciona una imagen JPEG o un vídeo MP4.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('El archivo supera el límite de 12 MB.'); return; }
    if (!['image/jpeg', 'video/mp4'].includes(file.type)) { setError('Solo se admiten imágenes JPEG y vídeos MP4.'); return; }
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('No se ha podido leer el archivo.')); reader.readAsDataURL(file); });
      if (epoch !== companySessionEpoch()) throw new CompanyStaleResponseError();
      await mutate('/assets', { filename: file.name, mimeType: file.type, dataBase64: data });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se ha podido preparar el archivo.'); }
  }
  const draft = state?.drafts.find((item) => item.id === selected);
  return <section className="co-social"><h3>Publicación y aprobación por canal</h3><p>La revisión editorial y la aprobación de una publicación son decisiones independientes. Comprueba la cuenta, el contenido exacto, los archivos y la fecha antes de autorizar una acción externa.</p>{error && <p role="alert" className="co-error">{error}</p>}{!state && !error && <p role="status">Cargando conectores…</p>}{state && <>
    <div className="co-grid">{state.accounts.map((account) => <article key={account.id} className="co-card"><h4>{CHANNEL_LABELS[account.channel]} · {account.label}</h4><span className="co-status">{account.status === 'demo' ? 'Simulado en demo' : account.status === 'ready' ? account.verifiedAt ? 'Cuenta verificada' : 'Configurada · pendiente de verificar' : 'Conexión no disponible'}</span><p>{account.reason ?? 'Configuración del servicio protegido'}</p><p>Identificador de cuenta: {account.providerAccountId || 'Sin configurar'}</p>{account.creatorInfo && <p>Creador verificado: {account.creatorInfo.username} · límite {account.creatorInfo.maxDurationSeconds} segundos</p>}<button className="btn" disabled={busy || !account.enabled} onClick={() => void mutate(`/accounts/${account.id}/verify`)}>Verificar cuenta de {CHANNEL_LABELS[account.channel]}</button></article>)}</div>
    <details className="co-create co-social-upload"><summary>Añadir imagen o vídeo para revisión</summary><div><p>El archivo se guarda en el servicio protegido y conserva las restricciones de la sesión. Revisa que puede compartirse antes de aprobar una publicación.</p><form className="co-form" onSubmit={(event) => void upload(event)}><label className="co-field"><span>Archivo JPEG o MP4 (máximo 12 MB)</span><input name="file" type="file" accept="image/jpeg,video/mp4" required disabled={busy} /></label><button className="btn" disabled={busy}>Añadir archivo a revisión</button></form>{state.assets.map((asset) => <article className="co-card" key={asset.id}><b>{asset.filename}</b><p>{asset.mimeType} · {asset.size.toLocaleString('es-ES')} bytes{asset.durationSeconds === null ? '' : ` · ${asset.durationSeconds} segundos`}</p><p>SHA256: {asset.sha256}</p>{asset.mimeType === 'image/jpeg' ? <img className="co-social-media" alt={asset.filename} src={`/api/company/social/assets/${asset.id}/content`} loading="lazy" /> : <video className="co-social-media" controls preload="metadata" src={`/api/company/social/assets/${asset.id}/content`} />}</article>)}</div></details>
    <details className="co-create co-social-create"><summary>Preparar publicación desde un entregable revisado</summary><div><SocialForm company={company} state={state} busy={busy} mutate={mutate} /></div></details>
    <div className="co-mail-grid"><div className="co-mail-list">{state.drafts.map((item) => <button className={`co-task ${selected === item.id ? 'co-selected' : ''}`} key={item.id} onClick={() => setSelected(item.id)}><span className="co-status">{STATUS[item.state]}</span><b>{CHANNEL_LABELS[item.channel]} · {state.accounts.find((account) => account.id === item.accountId)?.label}</b><span>{item.text.slice(0, 100)}</span><span>{localDate(item.scheduledAt)}</span></button>)}{!state.drafts.length && <p className="co-empty">Todavía no hay publicaciones preparadas.</p>}</div>{draft ? <SocialReview key={`${draft.id}-${draft.fingerprint}`} draft={draft} state={state} company={company} busy={busy} mutate={mutate} exportManual={exportManual} packet={exported?.draft.id === draft.id ? exported : null} /> : <p className="co-empty">Selecciona una publicación para revisar exactamente qué se enviará.</p>}</div>
    <button className="btn" disabled={busy} onClick={() => { setError(''); void refresh().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'No se ha podido actualizar.')); }}>Actualizar estado de publicaciones</button>
  </>}</section>;
}

function SocialForm({ company, state, busy, mutate, draft, onDirty }: { company: CompanySnapshot; state: SocialSnapshot; busy: boolean; mutate: Mutate; draft?: SocialDraft; onDirty?: () => void }) {
  const [accountId, setAccountId] = useState(draft?.accountId ?? '');
  const [sourceId, setSourceId] = useState(draft?.deliverableId ?? '');
  const [deliveryMode, setDeliveryMode] = useState<'api' | 'manual'>(draft?.deliveryMode ?? 'api');
  const [content, setContent] = useState(draft?.text ?? '');
  const account = state.accounts.find((item) => item.id === accountId);
  const sources = company.deliverables.filter((item) => { const version = item.versions.at(-1); return version && company.reviews.filter((review) => review.deliverableId === item.id && review.version === version.version).at(-1)?.decision === 'accepted'; });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const version = company.deliverables.find((item) => item.id === sourceId)?.versions.at(-1)?.version;
    if (!version || !account) return;
    const input: SocialDraftInput = { accountId, deliveryMode, deliverableId: sourceId, version, text: content, assetIds: data.getAll('assetIds').map(String), scheduledAt: deliveryMode === 'api' && data.get('scheduledAt') ? new Date(String(data.get('scheduledAt'))).toISOString() : null, options: { privacy: String(data.get('privacy') ?? '') || null, disableComment: account.creatorInfo?.commentDisabled || data.get('disableComment') === 'on', disableDuet: account.creatorInfo?.duetDisabled || data.get('disableDuet') === 'on', disableStitch: account.creatorInfo?.stitchDisabled || data.get('disableStitch') === 'on', brandContent: data.get('brandContent') === 'on', brandOrganic: data.get('brandOrganic') === 'on', aiGenerated: data.get('aiGenerated') === 'on' } };
    await mutate(draft ? `/drafts/${draft.id}` : '/drafts', input, draft ? 'PATCH' : 'POST');
  }
  return <form className="co-form" onSubmit={(event) => void save(event)} onChange={onDirty}><label className="co-field"><span>Cuenta de publicación</span><select value={accountId} onChange={(event) => { setAccountId(event.target.value); const next = state.accounts.find((item) => item.id === event.target.value); if (next?.channel === 'tiktok' || next?.status === 'blocked') setDeliveryMode('manual'); }} required><option value="">Selecciona una cuenta</option>{state.accounts.map((item) => <option key={item.id} value={item.id} disabled={!item.enabled}>{CHANNEL_LABELS[item.channel]} · {item.label}</option>)}</select></label><label className="co-field"><span>Forma de publicación</span><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as 'api' | 'manual')}><option value="api" disabled={account?.channel === 'tiktok' || account?.status === 'blocked'}>Publicación mediante conector autorizado</option><option value="manual">Exportar y publicar manualmente</option></select></label>{account?.channel === 'tiktok' && <p className="co-notice">TikTok: para esta oficina interna utiliza publicación manual. Descarga el vídeo y el texto aprobados, publícalos desde TikTok y registra la URL. Elige allí la privacidad, las interacciones y las divulgaciones comerciales.</p>}<label className="co-field"><span>Entregable de origen aprobado</span><select value={sourceId} required onChange={(event) => { setSourceId(event.target.value); setContent(company.deliverables.find((item) => item.id === event.target.value)?.versions.at(-1)?.content ?? ''); }}><option value="">Selecciona un entregable revisado</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.versions.at(-1)?.title} · v{item.versions.at(-1)?.version}</option>)}</select></label><label className="co-field"><span>Texto exacto de la publicación</span><textarea rows={7} value={content} onChange={(event) => setContent(event.target.value)} required /></label><label className="co-field"><span>Fecha propuesta de publicación</span><input type="datetime-local" name="scheduledAt" disabled={deliveryMode === 'manual'} defaultValue={inputDate(draft?.scheduledAt ?? null)} /></label><fieldset><legend>Archivos que se enviarán</legend>{state.assets.map((asset) => <label className="co-check" key={asset.id}><input type="checkbox" name="assetIds" value={asset.id} defaultChecked={draft?.assetIds.includes(asset.id)} /><span>{asset.filename} · {asset.size} bytes<br />SHA256: {asset.sha256}</span></label>)}{!state.assets.length && <p>Sin archivos. Instagram y TikTok necesitan material compatible con su canal.</p>}</fieldset>
    {account?.channel === 'tiktok' && deliveryMode === 'api' && <TikTokOptions key={`${account.id}-${account.creatorInfo?.checkedAt ?? 'unverified'}`} account={account} draft={draft} />}
    <button className="btn btn-primary" disabled={busy || !accountId || !sourceId}>{draft ? 'Guardar publicación e invalidar aprobación' : 'Guardar publicación para revisión'}</button>{!sources.length && <p className="co-notice">Acepta un entregable en Revisiones para poder usarlo como origen.</p>}
  </form>;
}
function TikTokOptions({ account, draft }: { account: SocialAccount; draft?: SocialDraft }) {
  return <fieldset><legend>Opciones de TikTok</legend><p>Verifica la cuenta para consultar las opciones que permite el creador. La privacidad necesita una selección explícita.</p><label className="co-field"><span>Privacidad de TikTok</span><select name="privacy" defaultValue={draft?.options.privacy ?? ''} required><option value="">Elige quién puede ver el vídeo</option>{account.creatorInfo?.privacyOptions.map((option) => <option key={option} value={option}>{PRIVACY_LABELS[option] ?? option}</option>)}</select></label>{[['disableComment', 'Desactivar comentarios', account.creatorInfo?.commentDisabled], ['disableDuet', 'Desactivar dúos', account.creatorInfo?.duetDisabled], ['disableStitch', 'Desactivar pegar', account.creatorInfo?.stitchDisabled], ['brandContent', 'Contenido comercial para terceros', false], ['brandOrganic', 'Contenido de mi propia marca', false], ['aiGenerated', 'Contenido generado por IA', false]].map(([id, label, forced]) => <label className="co-check" key={String(id)}><input name={String(id)} type="checkbox" defaultChecked={!!forced || !!draft?.options[id as keyof typeof draft.options]} disabled={!!forced} />{String(label)}</label>)}</fieldset>;
}
function SocialReview({ draft, state, company, busy, mutate, exportManual, packet }: { draft: SocialDraft; state: SocialSnapshot; company: CompanySnapshot; busy: boolean; mutate: Mutate; exportManual: (draftId: string) => Promise<void>; packet: ExportPacket | null }) {
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const immutable = ['sending', 'accepted', 'published', 'uncertain', 'cancelled', 'exported', 'manual_recorded'].includes(draft.state);
  const account = state.accounts.find((item) => item.id === draft.accountId);
  return <article className="co-card co-social-review"><h3>Revisar publicación exacta</h3><span className="co-status">{STATUS[draft.state]}</span><p><b>Canal y cuenta:</b> {CHANNEL_LABELS[draft.channel]} · {account?.label} · {account?.providerAccountId}</p><p><b>Forma de publicación:</b> {draft.deliveryMode === 'manual' ? 'Exportación y publicación manual por el responsable' : 'Conector autorizado'}</p><p><b>Versión del entregable:</b> {draft.version}</p><pre>{draft.text}</pre><p><b>Fecha aprobable:</b> {localDate(draft.scheduledAt)}</p>{draft.assetIds.map((id) => { const asset = state.assets.find((item) => item.id === id); return <p key={id}>Archivo: {asset?.filename ?? id}<br />SHA256: {asset?.sha256 ?? 'No disponible'}</p>; })}{draft.channel === 'tiktok' && <dl><dt>Privacidad</dt><dd>{draft.options.privacy ? PRIVACY_LABELS[draft.options.privacy] ?? draft.options.privacy : 'Sin seleccionar'}</dd><dt>Comentarios</dt><dd>{draft.options.disableComment ? 'Desactivados' : 'Permitidos'}</dd><dt>Dúos</dt><dd>{draft.options.disableDuet ? 'Desactivados' : 'Permitidos'}</dd><dt>Pegar</dt><dd>{draft.options.disableStitch ? 'Desactivado' : 'Permitido'}</dd><dt>Contenido comercial de terceros</dt><dd>{draft.options.brandContent ? 'Sí' : 'No'}</dd><dt>Marca propia</dt><dd>{draft.options.brandOrganic ? 'Sí' : 'No'}</dd><dt>Contenido generado por IA</dt><dd>{draft.options.aiGenerated ? 'Sí' : 'No'}</dd></dl>}<p><b>Huella del envío:</b></p><pre>{draft.fingerprint}</pre>{draft.reason && <p role="status">{draft.reason}</p>}{draft.providerId && <p>Referencia del proveedor: {draft.providerId}</p>}{draft.approval && <p>Aprobación válida hasta {localDate(draft.approval.expiresAt)}</p>}
    {!immutable && <><details className="co-create"><summary>Editar publicación antes de enviar</summary><div><SocialForm state={state} company={company} busy={busy} mutate={mutate} draft={draft} onDirty={() => { setDirty(true); setConfirmed(false); setDisclosure(false); }} /></div></details>{dirty && <p className="co-notice">Hay cambios sin guardar. Guarda y vuelve a revisar antes de aprobar.</p>}<label className="co-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={dirty || busy} />He revisado la cuenta, texto, archivos, opciones y fecha exactos de esta publicación.</label>{draft.provenance.mailboxIds.length > 0 && <label className="co-check"><input type="checkbox" checked={disclosure} onChange={(event) => setDisclosure(event.target.checked)} disabled={dirty || busy} />Autorizo expresamente divulgar el contenido derivado de los buzones restringidos de este trabajo en la red social indicada.</label>}<div className="co-actions"><button className="btn btn-primary" disabled={busy || dirty || !confirmed || (draft.provenance.mailboxIds.length > 0 && !disclosure) || draft.state === 'approved' || draft.state === 'scheduled'} onClick={() => void mutate(`/drafts/${draft.id}/approve`, { fingerprint: draft.fingerprint, externalDisclosure: disclosure })}>{draft.deliveryMode === 'manual' ? 'Aprobar paquete para publicación manual' : draft.scheduledAt ? 'Aprobar y programar publicación' : 'Aprobar publicación exacta'}</button>{draft.state !== 'scheduled' && draft.deliveryMode === 'api' && <button className="btn btn-primary" disabled={busy || dirty || !confirmed || draft.state !== 'approved' || draft.approval?.fingerprint !== draft.fingerprint} onClick={() => void mutate(`/drafts/${draft.id}/publish`)}>{draft.scheduledAt ? 'Programar publicación aprobada' : 'Publicar contenido aprobado'}</button>}<button className="btn" disabled={busy} onClick={() => void mutate(`/drafts/${draft.id}/cancel`)}>Cancelar publicación</button></div></>}{draft.deliveryMode === 'manual' && <ManualDelivery draft={draft} packet={packet} busy={busy} exportManual={exportManual} mutate={mutate} />}{['uncertain', 'accepted'].includes(draft.state) && <><p className={draft.state === 'uncertain' ? 'co-error' : 'co-notice'}>El proveedor no ha confirmado la publicación. Comprueba su estado antes de intentar otra acción.</p><button className="btn" disabled={busy} onClick={() => void mutate(`/drafts/${draft.id}/reconcile`)}>Comprobar publicación con el proveedor</button></>}
  </article>;
}

function ManualDelivery({ draft, packet, busy, exportManual, mutate }: { draft: SocialDraft; packet: ExportPacket | null; busy: boolean; exportManual: (draftId: string) => Promise<void>; mutate: Mutate }) {
  const [confirmed, setConfirmed] = useState(false);
  return <section><h4>Entrega para publicación manual</h4><p>La oficina no sube este paquete a la red social. Descarga los archivos, publica el contenido aprobado desde la aplicación del canal y registra después la evidencia.</p><button className="btn btn-primary" disabled={busy || !['approved', 'exported', 'manual_recorded'].includes(draft.state)} onClick={() => void exportManual(draft.id)}>Exportar texto y archivos aprobados</button>{packet && <ManualDownloads packet={packet} />}
    {draft.state === 'exported' && <form className="co-form" onSubmit={(event) => { event.preventDefault(); if (!confirmed) return; const data = new FormData(event.currentTarget); void mutate(`/drafts/${draft.id}/evidence`, { url: String(data.get('url')), comment: String(data.get('comment')) }); }}><label className="co-field"><span>URL de la publicación manual</span><input name="url" type="url" required defaultValue={draft.manualEvidence?.url ?? ''} /></label><label className="co-field"><span>Evidencia y comprobación de la publicación</span><textarea name="comment" required rows={3} defaultValue={draft.manualEvidence?.comment ?? ''} /></label><label className="co-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />He publicado manualmente y he comprobado que esta URL corresponde al contenido aprobado.</label><button className="btn" disabled={busy || !confirmed}>Registrar publicación manual</button><p className="muted">Este registro lo aporta el responsable. El proveedor no ha verificado automáticamente la publicación ni sus resultados.</p></form>}
    {draft.manualEvidence && <div className="co-notice"><b>Registro manual aportado por el responsable</b><p><a href={draft.manualEvidence.url} target="_blank" rel="noopener noreferrer">Consultar URL registrada</a></p><p>{draft.manualEvidence.comment}</p><p>{localDate(draft.manualEvidence.recordedAt)} · sin verificación automática del proveedor.</p></div>}
  </section>;
}
function ManualDownloads({ packet }: { packet: ExportPacket }) {
  const [downloads, setDownloads] = useState<{ name: string; url: string; sha256?: string }[]>([]);
  useEffect(() => {
    const files = packet.files.map((file) => {
      const bytes = Uint8Array.from(atob(file.dataBase64), (character) => character.charCodeAt(0));
      return { name: file.filename, url: URL.createObjectURL(new Blob([bytes], { type: file.mimeType })), sha256: file.sha256 };
    });
    const text = { name: `texto-${packet.draft.id}.txt`, url: URL.createObjectURL(new Blob([packet.draft.text], { type: 'text/plain;charset=utf-8' })) };
    const manifest = { name: `revision-${packet.draft.id}.json`, url: URL.createObjectURL(new Blob([JSON.stringify({ draftId: packet.draft.id, channel: packet.draft.channel, accountId: packet.draft.accountId, fingerprint: packet.draft.fingerprint, version: packet.draft.version, files: packet.files.map(({ filename, mimeType, sha256 }) => ({ filename, mimeType, sha256 })), notice: packet.notice }, null, 2)], { type: 'application/json' })) };
    const all = [text, ...files, manifest]; setDownloads(all);
    return () => { for (const file of all) URL.revokeObjectURL(file.url); };
  }, [packet]);
  return <div className="co-card"><h4>Paquete exacto aprobado</h4><p>{packet.notice}</p><ul>{downloads.map((file) => <li key={file.url}><a href={file.url} download={file.name}>Descargar {file.name}</a>{file.sha256 && <p>SHA256: {file.sha256}</p>}</li>)}</ul></div>;
}
