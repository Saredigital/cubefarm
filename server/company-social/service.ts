import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CompanyAuthority, Provenance } from '../../shared/companySecurity.ts';
import { combineProvenance } from '../../shared/companySecurity.ts';
import type { SocialAccount, SocialAsset, SocialDraft, SocialSnapshot } from '../../shared/companySocial.ts';
import { HttpError } from '../httpError.ts';
import type { CompanySecurity } from '../company-security/security.ts';
import { accountView, digest, socialAccountConfigSchema, type SocialAccountConfig } from './config.ts';
import { inspectMedia } from './media.ts';
import { ProviderFailure, type SocialProvider, type SocialPublishInput, type SocialResult } from './provider.ts';

const id = z.string().min(1).max(200);
const optionsSchema = z.object({ privacy: z.string().max(100).nullable().default(null), disableComment: z.boolean().default(true), disableDuet: z.boolean().default(true), disableStitch: z.boolean().default(true), brandContent: z.boolean().default(false), brandOrganic: z.boolean().default(false), aiGenerated: z.boolean().default(false) }).strict();
const inputSchema = z.object({ accountId: id, deliveryMode: z.enum(['api', 'manual']).default('api'), deliverableId: id, version: z.number().int().positive(), text: z.string().min(1).max(5000), assetIds: z.array(id).max(4), scheduledAt: z.string().datetime({ offset: true }).nullable().default(null), options: optionsSchema.default(() => optionsSchema.parse({})) }).strict();
const uploadSchema = z.object({ filename: z.string().regex(/^[^/\\\x00-\x1f]{1,180}$/), mimeType: z.enum(['image/jpeg', 'video/mp4']), dataBase64: z.string() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new HttpError(400, 'Datos de redes sociales no válidos.'); return result.data; }
export interface SocialSource { currentVersion: number; hash: string; provenance: Provenance; accepted: boolean }
export interface SocialDatabase { schemaVersion: 1; permissionEpoch: number; drafts: SocialDraft[]; assets: (SocialAsset & { dataBase64: string; width: number | null; height: number | null })[]; verified: Record<string, { permissionVersion: string; at: string; creatorInfo: SocialAccount['creatorInfo'] }>; audit: { id: string; actorId: string; action: string; resourceId: string; fingerprint: string | null; at: string; provenance: Provenance }[] }
export interface SocialStorage { load(fallback: () => SocialDatabase): SocialDatabase; save(data: SocialDatabase): void }
export const emptySocialDatabase = (): SocialDatabase => ({ schemaVersion: 1, permissionEpoch: 1, drafts: [], assets: [], verified: {}, audit: [] });
const timestamp = z.string().datetime({ offset: true });
const provenanceSchema = z.object({ mailboxIds: z.array(id).max(200), sourceIds: z.array(id).max(1000) }).strict();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const creatorSchema = z.object({ username: z.string().max(500), privacyOptions: z.array(z.string().max(100)).max(20), commentDisabled: z.boolean(), duetDisabled: z.boolean(), stitchDisabled: z.boolean(), maxDurationSeconds: z.number().positive().max(86400), checkedAt: timestamp }).strict();
const assetSchema = uploadSchema.extend({ id, size: z.number().int().positive().max(12 * 1024 * 1024), sha256: hashSchema, durationSeconds: z.number().finite().positive().nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(), provenance: provenanceSchema, createdAt: timestamp }).strict();
const draftSchema = inputSchema.extend({ id, channel: z.enum(['x', 'instagram', 'facebook', 'tiktok']), deliverableHash: hashSchema, provenance: provenanceSchema, fingerprint: hashSchema, state: z.enum(['draft', 'approved', 'scheduled', 'sending', 'accepted', 'published', 'failed', 'uncertain', 'cancelled', 'invalidated', 'exported', 'manual_recorded']), approval: z.object({ fingerprint: hashSchema, approverId: id, approvedAt: timestamp, expiresAt: timestamp, permissionEpoch: z.number().int().positive(), externalDisclosure: z.boolean() }).strict().nullable(), attemptId: id.nullable(), finalAttempted: z.boolean(), providerId: id.nullable(), providerPhase: z.enum(['container', 'post']).nullable(), manualEvidence: z.object({ url: z.string().max(1000), comment: z.string().max(2000), recordedBy: id, recordedAt: timestamp }).strict().nullable(), reason: z.string().max(1000).nullable(), createdAt: timestamp, updatedAt: timestamp }).strict();
const databaseSchema = z.object({ schemaVersion: z.literal(1), permissionEpoch: z.number().int().positive(), drafts: z.array(draftSchema).max(1000), assets: z.array(assetSchema).max(200), verified: z.record(z.string(), z.object({ permissionVersion: hashSchema, at: timestamp, creatorInfo: creatorSchema.nullable() }).strict()), audit: z.array(z.object({ id, actorId: id, action: id, resourceId: id, fingerprint: hashSchema.nullable(), at: timestamp, provenance: provenanceSchema }).strict()).max(10000) }).strict();
function validateDatabase(value: SocialDatabase) {
  if (!databaseSchema.safeParse(value).success || new Set(value.drafts.map(d => d.id)).size !== value.drafts.length || new Set(value.assets.map(a => a.id)).size !== value.assets.length) throw new Error('Almacén de redes sociales no válido.');
  for (const asset of value.assets) { const inspected = inspectMedia(asset.mimeType, asset.dataBase64); if (inspected.sha256 !== asset.sha256 || inspected.size !== asset.size || inspected.durationSeconds !== asset.durationSeconds || inspected.width !== asset.width || inspected.height !== asset.height) throw new Error('Integridad del medio no válida.'); }
  for (const draft of value.drafts) if (draft.assetIds.some(id => !value.assets.some(a => a.id === id)) || draft.finalAttempted && !draft.attemptId || draft.providerId && !draft.attemptId || ['approved', 'scheduled', 'sending'].includes(draft.state) && !draft.approval || draft.approval && draft.approval.fingerprint !== draft.fingerprint) throw new Error('Relaciones sociales no válidas.');
}

export class CompanySocialService {
  private db: SocialDatabase;
  private accounts: SocialAccountConfig[];
  private mediaTokens = new Map<string, { draftId: string; assetId: string; expires: number }>();
  private active = new Set<string>();
  private unsubscribe: () => void;
  private stopped = false;
  private bootPermissionVersion = randomUUID();
  constructor(private security: CompanySecurity, private storage: SocialStorage, accounts: SocialAccountConfig[], private providers: Map<string, SocialProvider>, private resolveSource: (id: string, version: number) => SocialSource, private now: () => number = Date.now, private demo = false, private sourcePermissionVersion?: (provenance: Provenance) => string) {
    this.accounts = accounts.map(config => socialAccountConfigSchema.parse(config));
    if (new Set(accounts.map(a => a.id)).size !== accounts.length) throw new Error('Identificadores sociales duplicados.');
    this.db = storage.load(emptySocialDatabase);
    validateDatabase(this.db);
    // A crash between intent persistence and the remote response must never create a second attempt.
    for (const draft of this.db.drafts) if (draft.state === 'sending') { draft.state = 'uncertain'; draft.reason = 'Reinicio durante un intento: consulta el proveedor; no se reintenta automáticamente.'; }
    this.refresh(); this.save();
    this.unsubscribe = security.onRevocation(() => {
      this.db.permissionEpoch++;
      for (const draft of this.db.drafts) if (draft.approval && !['published', 'failed', 'cancelled', 'manual_recorded'].includes(draft.state)) { draft.approval = null; draft.state = draft.attemptId ? 'uncertain' : 'invalidated'; draft.reason = 'Han cambiado los permisos de las fuentes. Requiere una revisión nueva.'; }
      this.record('security', 'permissions_changed', 'social', { mailboxIds: [], sourceIds: [] }); this.mediaTokens.clear(); this.save();
    });
  }
  private save() { this.storage.save(this.db); }
  private date() { return new Date(this.now()).toISOString(); }
  private record(actorId: string, action: string, resourceId: string, provenance: Provenance, fingerprint: string | null = null) { this.db.audit.push({ id: randomUUID(), actorId, action, resourceId, fingerprint, at: this.date(), provenance: structuredClone(provenance) }); this.db.audit = this.db.audit.slice(-10000); }
  private account(id: string) { const account = this.accounts.find(a => a.id === id); if (!account) throw new HttpError(404, 'Cuenta no disponible.'); return account; }
  private view(config: SocialAccountConfig): SocialAccount {
    const view = accountView(config, this.now());
    if (this.demo) return { ...view, status: 'demo', reason: 'SIMULACIÓN DEMO: no publica en redes reales.', verifiedAt: this.date(), creatorInfo: config.channel === 'tiktok' ? { username: 'cuenta_demo', privacyOptions: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSeconds: 60, checkedAt: this.date() } : null };
    const verified = this.db.verified[config.id];
    if (verified?.permissionVersion === view.permissionVersion && this.now() - Date.parse(verified.at) < 15 * 60_000 && view.reason === 'Verifica la identidad de la cuenta antes de aprobar.') return { ...view, status: 'ready', reason: null, verifiedAt: verified.at, creatorInfo: verified.creatorInfo };
    return view;
  }
  private read(authority: CompanyAuthority, provenance: Provenance) { this.security.assertAuthority(authority); if (!this.security.canRead(authority, provenance)) throw new HttpError(404, 'Recurso no disponible.'); this.security.absorb(authority, provenance); }
  private draft(authority: CompanyAuthority, id: string) { this.security.assertAuthority(authority); const draft = this.db.drafts.find(d => d.id === id); if (!draft) throw new HttpError(404, 'Borrador no disponible.'); this.read(authority, draft.provenance); return draft; }
  private fingerprint(draft: SocialDraft) { const config = this.accounts.find(a => a.id === draft.accountId); let permissions = 'general'; if (draft.provenance.mailboxIds.length) { try { permissions = this.sourcePermissionVersion?.(draft.provenance) ?? this.bootPermissionVersion; } catch { permissions = 'revoked'; } } return digest({ account: config ? digest(config) : 'removed', permissions, accountId: draft.accountId, channel: draft.channel, deliveryMode: draft.deliveryMode, deliverableId: draft.deliverableId, version: draft.version, deliverableHash: draft.deliverableHash, text: draft.text, assets: draft.assetIds.map(id => { const a = this.db.assets.find(a => a.id === id)!; return { id, hash: a.sha256, size: a.size, mime: a.mimeType, provenance: a.provenance }; }), scheduledAt: draft.scheduledAt, options: draft.options, provenance: draft.provenance }); }
  private sourceValid(draft: SocialDraft) { try { const source = this.resolveSource(draft.deliverableId, draft.version); return source.accepted && source.currentVersion === draft.version && source.hash === draft.deliverableHash; } catch { return false; } }
  private invalidate(draft: SocialDraft, reason: string) { draft.approval = null; if (!draft.attemptId) draft.state = 'invalidated'; draft.reason = reason; draft.updatedAt = this.date(); }
  private refresh() {
    let changed = false;
    for (const draft of this.db.drafts) if (draft.approval && !draft.attemptId && draft.state !== 'manual_recorded' && (!this.sourceValid(draft) || this.fingerprint(draft) !== draft.approval.fingerprint || draft.approval.permissionEpoch !== this.db.permissionEpoch || Date.parse(draft.approval.expiresAt) <= this.now())) { this.invalidate(draft, 'Ha cambiado el entregable, la cuenta, los permisos o la vigencia. Requiere una revisión nueva.'); changed = true; }
    if (changed) this.save();
  }
  snapshot(authority: CompanyAuthority): SocialSnapshot {
    this.security.assertAuthority(authority); this.refresh();
    const selected = this.security.scope(authority);
    const visible = (provenance: Provenance) => this.security.canRead(authority, provenance) && (authority.principal.kind !== 'manager' || provenance.mailboxIds.every(id => selected.mailboxIds.includes(id)));
    const drafts = this.db.drafts.filter(d => visible(d.provenance));
    const assets = this.db.assets.filter(a => visible(a.provenance));
    this.security.absorb(authority, combineProvenance(...drafts.map(d => d.provenance), ...assets.map(a => a.provenance)));
    return structuredClone({ mode: this.security.mode === 'local' ? 'blocked' : this.security.mode, accounts: this.accounts.map(a => this.view(a)), drafts, assets: assets.map(({ dataBase64: _data, width: _width, height: _height, ...asset }) => asset) });
  }
  async verify(authority: CompanyAuthority, id: string) {
    this.security.assertHuman(authority); const config = this.account(id); const view = accountView(config, this.now());
    if (!this.demo && view.reason !== 'Verifica la identidad de la cuenta antes de aprobar.') throw new HttpError(409, view.reason!);
    const provider = this.providers.get(id); if (!provider) throw new HttpError(503, 'Conector no disponible.');
    let result: Awaited<ReturnType<SocialProvider['verify']>>;
    try { result = await provider.verify(); } catch { throw new HttpError(502, 'No se ha podido verificar la cuenta. Revisa la configuración protegida.'); }
    this.security.assertHuman(authority);
    if (result.accountId !== config.providerAccountId) throw new HttpError(409, 'La identidad del proveedor no coincide con la cuenta configurada.');
    this.db.verified[id] = { permissionVersion: view.permissionVersion, at: this.date(), creatorInfo: result.creatorInfo }; this.record(authority.principal.id, 'account_verified', id, this.security.scope(authority)); this.save(); return this.view(config);
  }
  upload(authority: CompanyAuthority, body: unknown) {
    this.security.assertAuthority(authority); const input = parse(uploadSchema, body); const metadata = inspectMedia(input.mimeType, input.dataBase64);
    if (this.db.assets.length >= 200 || this.db.assets.reduce((sum, a) => sum + a.size, 0) + metadata.size > 128 * 1024 * 1024) throw new HttpError(409, 'Almacén de medios lleno. Revisa la retención en el servicio protegido.');
    const asset = { id: randomUUID(), ...input, ...metadata, provenance: this.security.scope(authority), createdAt: this.date() };
    this.db.assets.push(asset); this.record(authority.principal.id, 'asset_uploaded', asset.id, asset.provenance, asset.sha256); this.save(); const { dataBase64: _data, width: _width, height: _height, ...result } = asset; return structuredClone(result);
  }
  content(authority: CompanyAuthority, id: string) { const asset = this.db.assets.find(a => a.id === id); if (!asset) throw new HttpError(404, 'Medio no disponible.'); this.read(authority, asset.provenance); return { data: Buffer.from(asset.dataBase64, 'base64'), mimeType: asset.mimeType }; }
  create(authority: CompanyAuthority, body: unknown) { return this.write(authority, null, body); }
  update(authority: CompanyAuthority, id: string, body: unknown) { return this.write(authority, this.draft(authority, id), body); }
  private write(authority: CompanyAuthority, previous: SocialDraft | null, body: unknown) {
    this.security.assertAuthority(authority); if (previous?.attemptId || previous?.state === 'cancelled' || previous?.state === 'manual_recorded') throw new HttpError(409, 'El intento es inmutable. Crea un borrador nuevo tras revisar el resultado.');
    const input = parse(inputSchema, body); const account = this.account(input.accountId); const source = this.resolveSource(input.deliverableId, input.version);
    if (source.currentVersion !== input.version) throw new HttpError(409, 'Selecciona la versión actual del entregable.');
    this.read(authority, source.provenance);
    if (input.scheduledAt && (Date.parse(input.scheduledAt) <= this.now() || Date.parse(input.scheduledAt) > this.now() + 30 * 86400_000)) throw new HttpError(400, 'La fecha debe estar en los próximos 30 días.');
    if (input.deliveryMode === 'manual' && input.scheduledAt) throw new HttpError(400, 'La exportación manual no permite programar una publicación automática.');
    if (new Set(input.assetIds).size !== input.assetIds.length) throw new HttpError(400, 'Hay medios duplicados.');
    const assets = input.assetIds.map(id => { const asset = this.db.assets.find(a => a.id === id); if (!asset) throw new HttpError(404, 'Medio no disponible.'); this.read(authority, asset.provenance); return asset; });
    if (account.channel === 'x' && (input.text.length > 280 || assets.some(a => a.mimeType !== 'image/jpeg' || a.size > 5 * 1024 * 1024))) throw new HttpError(400, 'X admite hasta 280 caracteres y cuatro JPEG de hasta 5 MB.');
    if (account.channel === 'instagram' && (input.text.length > 2200 || assets.length !== 1 || assets[0].mimeType !== 'image/jpeg' || assets[0].size > 8 * 1024 * 1024 || !assets[0].width || !assets[0].height || assets[0].width < 320 || assets[0].width > 1440 || assets[0].width / assets[0].height < 0.8 || assets[0].width / assets[0].height > 1.91)) throw new HttpError(400, 'Instagram requiere un JPEG de hasta 8 MB, ancho 320–1440 y proporción entre 0,8 y 1,91; texto hasta 2200 caracteres.');
    if (account.channel === 'facebook' && (assets.length > 1 || assets.some(a => a.mimeType !== 'image/jpeg'))) throw new HttpError(400, 'Facebook admite texto y una imagen JPEG en esta versión.');
    if (account.channel === 'tiktok' && (input.text.length > 2200 || assets.length !== 1 || assets[0].mimeType !== 'video/mp4')) throw new HttpError(400, 'TikTok requiere un MP4 de hasta 12 MB y texto de hasta 2200 caracteres.');
    const provenance = combineProvenance(this.security.scope(authority), source.provenance, ...(previous ? [previous.provenance] : []), ...assets.map(a => a.provenance));
    if (!previous && this.db.drafts.length >= 1000) throw new HttpError(409, 'Se ha alcanzado el límite de borradores. Revisa la retención en el servicio protegido.');
    const draft: SocialDraft = { id: previous?.id ?? randomUUID(), ...input, channel: account.channel, deliverableHash: source.hash, provenance, state: 'draft', approval: null, fingerprint: '', attemptId: null, finalAttempted: false, providerId: null, providerPhase: null, manualEvidence: null, reason: null, createdAt: previous?.createdAt ?? this.date(), updatedAt: this.date() };
    draft.fingerprint = this.fingerprint(draft);
    if (previous) this.db.drafts[this.db.drafts.indexOf(previous)] = draft; else this.db.drafts.push(draft);
    this.record(authority.principal.id, previous ? 'draft_updated' : 'draft_created', draft.id, provenance, draft.fingerprint); this.save(); return structuredClone(draft);
  }
  approve(authority: CompanyAuthority, id: string, body: unknown) {
    this.security.assertHuman(authority); const draft = this.draft(authority, id); const input = parse(z.object({ fingerprint: z.string().length(64), externalDisclosure: z.boolean() }).strict(), body);
    this.checkSourcePermissions(draft.provenance);
    if (draft.attemptId || draft.state === 'cancelled' || draft.state === 'manual_recorded') throw new HttpError(409, 'Este intento no puede aprobarse de nuevo.');
    if (input.fingerprint !== draft.fingerprint || this.fingerprint(draft) !== input.fingerprint) throw new HttpError(409, 'El contenido o la cuenta ha cambiado. Abre y revisa el borrador actualizado.');
    if (!this.sourceValid(draft)) throw new HttpError(409, 'El entregable actual debe estar aceptado antes de autorizar su publicación.');
    const account = this.view(this.account(draft.accountId)); if (!account.enabled || draft.deliveryMode === 'api' && account.status === 'blocked') throw new HttpError(409, account.reason!);
    if (draft.provenance.mailboxIds.length && !input.externalDisclosure) throw new HttpError(403, 'Autoriza explícitamente la salida externa de los datos derivados de correo.');
    if (draft.deliveryMode === 'api') this.validateCreator(draft, account);
    if (draft.scheduledAt && Date.parse(draft.scheduledAt) <= this.now()) throw new HttpError(409, 'La fecha programada ha vencido. Revisa una fecha nueva.');
    draft.approval = { ...input, approverId: authority.principal.id, approvedAt: this.date(), expiresAt: new Date(draft.scheduledAt ? Date.parse(draft.scheduledAt) + 10 * 60_000 : this.now() + 86400_000).toISOString(), permissionEpoch: this.db.permissionEpoch };
    draft.state = draft.scheduledAt ? 'scheduled' : 'approved'; draft.reason = null; draft.updatedAt = this.date(); this.record(authority.principal.id, draft.state, draft.id, draft.provenance, draft.fingerprint); this.save(); return structuredClone(draft);
  }
  private validateCreator(draft: SocialDraft, account: SocialAccount) {
    if (draft.channel !== 'tiktok') return;
    const info = account.creatorInfo; const asset = this.db.assets.find(a => a.id === draft.assetIds[0])!;
    if (!info || !draft.options.privacy || !info.privacyOptions.includes(draft.options.privacy) || !asset.durationSeconds || asset.durationSeconds > info.maxDurationSeconds || info.commentDisabled && !draft.options.disableComment || info.duetDisabled && !draft.options.disableDuet || info.stitchDisabled && !draft.options.disableStitch || draft.options.brandContent && draft.options.privacy === 'SELF_ONLY') throw new HttpError(409, 'Revisa privacidad, interacciones, contenido comercial y duración con las opciones actuales del creador.');
  }
  private assertPublishable(draft: SocialDraft) {
    this.checkSourcePermissions(draft.provenance);
    const approval = draft.approval;
    if (this.stopped || !approval || approval.permissionEpoch !== this.db.permissionEpoch || approval.fingerprint !== this.fingerprint(draft) || Date.parse(approval.expiresAt) <= this.now() || !this.sourceValid(draft) || !['approved', 'scheduled', 'sending', 'accepted', 'uncertain', 'exported', 'manual_recorded'].includes(draft.state)) throw new HttpError(409, 'La autorización ya no es válida. Requiere una revisión nueva.');
    if (draft.provenance.mailboxIds.length && !approval.externalDisclosure) throw new HttpError(403, 'Falta la autorización de salida externa.');
    const account = this.view(this.account(draft.accountId));
    if (!account.enabled || draft.deliveryMode === 'api' && account.status === 'blocked') throw new HttpError(409, account.reason!);
    if (draft.deliveryMode === 'api') this.validateCreator(draft, account);
    if (draft.scheduledAt && Date.parse(draft.scheduledAt) > this.now()) throw new HttpError(409, 'La publicación está programada para más adelante.');
  }
  private checkSourcePermissions(provenance: Provenance) { if (provenance.mailboxIds.length && this.sourcePermissionVersion) { try { if (!this.sourcePermissionVersion(provenance)) throw new Error(); } catch { throw new HttpError(409, 'No se pueden verificar los permisos actuales de todas las fuentes.'); } } }
  async publish(authority: CompanyAuthority, id: string) { this.security.assertHuman(authority); const draft = this.draft(authority, id); if (draft.deliveryMode === 'manual') throw new HttpError(409, 'Este borrador se exporta para revisión y publicación manual.'); return this.execute(draft); }
  private async execute(draft: SocialDraft) {
    if (draft.attemptId || this.active.has(draft.id)) return structuredClone(draft);
    const provider = this.providers.get(draft.accountId); if (!provider) throw new HttpError(503, 'Conector no disponible.');
    this.active.add(draft.id);
    try {
      await this.refreshIdentity(draft);
      this.assertPublishable(draft); draft.attemptId = randomUUID(); draft.state = 'sending'; draft.updatedAt = this.date(); this.record(draft.approval!.approverId, 'attempt_started', draft.id, draft.provenance, draft.fingerprint); this.save();
      this.applyResult(draft, await provider.publish(this.publishInput(draft)));
    } catch (error) {
      if (!draft.attemptId) { this.invalidate(draft, 'No se ha podido verificar la cuenta o la autorización antes del intento.'); throw error instanceof HttpError ? error : new HttpError(502, 'No se ha podido verificar la cuenta antes de publicar.'); }
      draft.state = error instanceof ProviderFailure && !error.uncertain ? 'failed' : 'uncertain';
      draft.reason = draft.state === 'failed' ? 'El proveedor rechazó el intento. Revisa la cuenta y crea un borrador nuevo.' : 'El resultado es incierto. Consulta el proveedor antes de crear otro borrador; no se reintenta automáticamente.';
    } finally { draft.updatedAt = this.date(); this.active.delete(draft.id); this.record('provider', draft.state, draft.id, draft.provenance, draft.fingerprint); this.save(); }
    return structuredClone(draft);
  }
  private async refreshIdentity(draft: SocialDraft) {
    if (this.demo) return;
    const account = this.account(draft.accountId); const view = accountView(account, this.now());
    if (view.reason !== 'Verifica la identidad de la cuenta antes de aprobar.') throw new HttpError(409, view.reason!);
    const result = await this.providers.get(account.id)!.verify();
    if (result.accountId !== account.providerAccountId) throw new HttpError(409, 'La identidad de la cuenta ha cambiado.');
    this.db.verified[account.id] = { permissionVersion: view.permissionVersion, at: this.date(), creatorInfo: result.creatorInfo }; this.save();
  }
  private async continueContainer(draft: SocialDraft) {
    if (this.active.has(draft.id) || draft.finalAttempted) return;
    const provider = this.providers.get(draft.accountId); if (!provider?.resume) return;
    this.active.add(draft.id);
    try { await this.refreshIdentity(draft); this.assertPublishable(draft); this.applyResult(draft, await provider.resume(this.publishInput(draft))); }
    catch (error) { if (error instanceof HttpError) draft.approval = null; draft.state = 'uncertain'; draft.reason = 'No se ha podido continuar con la autorización vigente. Consulta el estado; no se repite el intento final.'; }
    finally { this.active.delete(draft.id); draft.updatedAt = this.date(); this.record('provider', draft.state, draft.id, draft.provenance, draft.fingerprint); this.save(); }
  }
  private publishInput(draft: SocialDraft): SocialPublishInput {
    return { draft: structuredClone(draft), assets: structuredClone(draft.assetIds.map(id => this.db.assets.find(a => a.id === id)!)), assertAllowed: () => this.assertPublishable(draft), beforePublish: () => { this.assertPublishable(draft); if (draft.finalAttempted) throw new HttpError(409, 'La publicación ya se ha intentado.'); draft.finalAttempted = true; this.record(draft.approval!.approverId, 'final_intent', draft.id, draft.provenance, draft.fingerprint); this.save(); }, checkpoint: (id, phase) => { draft.providerId = id; draft.providerPhase = phase; this.save(); }, mediaUrl: assetId => {
        this.assertPublishable(draft); if (!draft.assetIds.includes(assetId)) throw new HttpError(403, 'Medio no autorizado.');
        const origin = this.account(draft.accountId).publicMediaOrigin; if (!origin) throw new HttpError(409, 'Falta el origen público de medios.');
        const token = randomBytes(32).toString('base64url'); this.mediaTokens.set(token, { draftId: draft.id, assetId, expires: this.now() + 60 * 60_000 }); return `${origin}/api/company/social/media/${token}`;
    } };
  }
  private applyResult(draft: SocialDraft, result: SocialResult) { draft.state = result.state; draft.providerId = result.providerId; draft.providerPhase = result.phase; draft.reason = result.reason ?? (result.state === 'accepted' ? 'Aceptado por el proveedor; publicación pendiente de confirmar.' : null); }
  async reconcile(authority: CompanyAuthority, id: string) {
    this.security.assertHuman(authority); const draft = this.draft(authority, id);
    if (this.active.has(id)) throw new HttpError(409, 'El intento sigue en curso.');
    if (!draft.attemptId || !draft.providerId || !['accepted', 'uncertain'].includes(draft.state)) throw new HttpError(409, 'No existe una referencia conciliable. Revisa la cuenta en el proveedor; no se repetirá el intento.');
    const provider = this.providers.get(draft.accountId); if (!provider) throw new HttpError(503, 'Conector no disponible.');
    if (draft.channel === 'instagram' && draft.providerPhase === 'container' && !draft.finalAttempted && provider.resume) { await this.continueContainer(draft); return structuredClone(draft); }
    this.active.add(id);
    try {
      this.applyResult(draft, await provider.reconcile(structuredClone(draft)));
    } catch { draft.state = 'uncertain'; draft.reason = 'No se ha podido confirmar el estado. No se reintenta la publicación.'; }
    finally { this.active.delete(id); }
    draft.updatedAt = this.date(); this.record(authority.principal.id, 'reconciled', draft.id, draft.provenance, draft.fingerprint); this.save(); return structuredClone(draft);
  }
  cancel(authority: CompanyAuthority, id: string) {
    this.security.assertHuman(authority); const draft = this.draft(authority, id);
    if (['accepted', 'published', 'failed', 'uncertain', 'manual_recorded'].includes(draft.state)) throw new HttpError(409, 'El intento o su evidencia ya están registrados. Consulta el estado y gestiona su retirada en el proveedor.');
    draft.approval = null; draft.state = draft.attemptId ? 'uncertain' : 'cancelled'; draft.reason = draft.attemptId ? 'Cancelado durante un intento. El proveedor podría haberlo recibido; consulta su estado.' : 'Publicación cancelada antes del intento.';
    for (const [token, item] of this.mediaTokens) if (item.draftId === id) this.mediaTokens.delete(token);
    this.record(authority.principal.id, 'cancelled', draft.id, draft.provenance, draft.fingerprint); this.save(); return structuredClone(draft);
  }
  exportPackage(authority: CompanyAuthority, id: string) {
    this.security.assertHuman(authority); const draft = this.draft(authority, id);
    if (draft.deliveryMode !== 'manual') throw new HttpError(409, 'Selecciona exportación manual y revisa de nuevo el borrador.');
    this.assertPublishable(draft);
    const files = draft.assetIds.map(id => { const asset = this.db.assets.find(a => a.id === id)!; return { filename: asset.filename, mimeType: asset.mimeType, sha256: asset.sha256, dataBase64: asset.dataBase64 }; });
    if (draft.state !== 'manual_recorded') { draft.state = 'exported'; draft.reason = 'Paquete exportado por el responsable. No se ha publicado ni enviado a la red social.'; }
    this.record(authority.principal.id, 'manual_export', draft.id, draft.provenance, draft.fingerprint); this.save();
    return { draft: structuredClone(draft), files, notice: 'Publica manualmente en la cuenta revisada. Comprueba privacidad, música y divulgación comercial en el proveedor. Registrar una evidencia no verifica automáticamente su publicación.' };
  }
  recordEvidence(authority: CompanyAuthority, id: string, body: unknown) {
    this.security.assertHuman(authority); const draft = this.draft(authority, id);
    const input = parse(z.object({ url: z.string().url().max(1000), comment: z.string().trim().min(1).max(2000) }).strict(), body);
    if (draft.deliveryMode !== 'manual' || draft.state !== 'exported') throw new HttpError(409, 'Exporta primero el paquete aprobado y registra después la evidencia manual.');
    this.assertPublishable(draft);
    const url = new URL(input.url); const hosts = { x: ['x.com', 'www.x.com'], instagram: ['instagram.com', 'www.instagram.com'], facebook: ['facebook.com', 'www.facebook.com'], tiktok: ['tiktok.com', 'www.tiktok.com'] };
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[draft.channel].includes(url.hostname) || url.pathname === '/') throw new HttpError(400, 'Introduce un enlace HTTPS de la publicación en el canal revisado.');
    draft.manualEvidence = { ...input, recordedBy: authority.principal.id, recordedAt: this.date() }; draft.state = 'manual_recorded'; draft.reason = 'Evidencia aportada por el responsable. Publicación manual sin verificación automática.';
    this.record(authority.principal.id, 'manual_evidence', draft.id, draft.provenance, draft.fingerprint); this.save(); return structuredClone(draft);
  }
  publicMedia(token: string) {
    const entry = this.mediaTokens.get(token); if (!entry || entry.expires <= this.now()) throw new HttpError(404, 'Medio no disponible.');
    const draft = this.db.drafts.find(d => d.id === entry.draftId)!;
    if (!draft.approval || draft.approval.permissionEpoch !== this.db.permissionEpoch || draft.approval.fingerprint !== this.fingerprint(draft) || Date.parse(draft.approval.expiresAt) <= this.now() || this.view(this.account(draft.accountId)).status === 'blocked' || !['sending', 'accepted', 'published'].includes(draft.state) || !this.sourceValid(draft)) throw new HttpError(404, 'Medio no disponible.');
    const asset = this.db.assets.find(a => a.id === entry.assetId)!; return { data: Buffer.from(asset.dataBase64, 'base64'), mimeType: asset.mimeType };
  }
  async tick() {
    if (this.stopped) return;
    this.refresh();
    for (const draft of this.db.drafts) if (draft.state === 'scheduled' && draft.scheduledAt && Date.parse(draft.scheduledAt) <= this.now()) {
      try { await this.execute(draft); } catch { this.invalidate(draft, 'La cuenta o la autorización ya no está disponible. Revisa de nuevo antes de programar.'); this.save(); }
    }
    for (const draft of this.db.drafts) if (draft.channel === 'instagram' && draft.providerPhase === 'container' && !draft.finalAttempted && draft.approval && ['accepted', 'uncertain'].includes(draft.state)) await this.continueContainer(draft);
  }
  async close() { this.stopped = true; this.unsubscribe(); this.mediaTokens.clear(); while (this.active.size) await new Promise(resolve => setTimeout(resolve, 25)); }
}
