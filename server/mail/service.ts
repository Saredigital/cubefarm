/** Private mail state, exact-content approvals and durable at-most-once send attempts. */
import { createHash, randomUUID } from 'node:crypto';
import type { CompanyAuthority, MailGrant, Provenance } from '../../shared/companySecurity.ts';
import { combineProvenance } from '../../shared/companySecurity.ts';
import type { MailContent, MailDraft, MailMessage, MailState, Mailbox } from '../../shared/mail.ts';
import { CompanySecurity, validateGrant } from '../company-security/security.ts';
import type { EncryptedStore } from '../company-security/vault.ts';
import { HttpError } from '../httpError.ts';
import { safeMessageId, type MailProvider, type ProviderOutcome } from './provider.ts';
import { attachmentIdentity, inspectTextAttachment, type StoredAttachment } from './attachments.ts';

interface AuditEntry { at: string; principalId: string; action: string; resourceId: string; version?: number; hash?: string }
export interface MailDatabase {
  schemaVersion: 1;
  mailboxes: Mailbox[];
  messages: MailMessage[];
  drafts: MailDraft[];
  grants: MailGrant[];
  cursors: Record<string, string>;
  audit: AuditEntry[];
  attachments: Record<string, StoredAttachment>;
}
export function emptyMailDatabase(): MailDatabase {
  return { schemaVersion: 1, mailboxes: [], messages: [], drafts: [], grants: [], cursors: {}, audit: [], attachments: {} };
}
export function mailContentHash(content: MailContent & { replyMessageId?: string }, permissionVersion: number, version: number): string {
  return createHash('sha256').update(JSON.stringify({
    mailboxId: content.mailboxId, messageId: content.messageId ?? null, replyMessageId: content.replyMessageId ?? null, from: content.from,
    to: content.to, cc: content.cc, bcc: content.bcc, subject: content.subject, body: content.body,
    attachmentIds: content.attachmentIds, permissionVersion, version,
  })).digest('hex');
}
const address = /^[^\s<>,;\r\n@]+@[^\s<>,;\r\n@]+\.[^\s<>,;\r\n@]+$/;
function recipients(value: unknown, required = false): string[] {
  if (!Array.isArray(value) || value.length > 50 || (required && !value.length) ||
    value.some(item => typeof item !== 'string' || item.length > 254 || !address.test(item))) throw new HttpError(400, 'Destinatarios inválidos.');
  return [...value];
}
function checkedContent(input: Partial<MailContent>, mailbox: Mailbox): MailContent {
  if (typeof input.subject !== 'string' || input.subject.length > 500 || /[\r\n]/.test(input.subject) ||
      typeof input.body !== 'string' || input.body.length > 100_000) throw new HttpError(400, 'Contenido de correo inválido.');
  if (input.from !== undefined && input.from !== mailbox.address) throw new HttpError(400, 'El remitente debe coincidir con el buzón.');
  if (input.attachmentIds && (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 10 ||
    input.attachmentIds.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)))) throw new HttpError(400, 'Adjuntos inválidos.');
  return {
    mailboxId: mailbox.id, from: mailbox.address, messageId: input.messageId,
    to: recipients(input.to, true), cc: recipients(input.cc ?? []), bcc: recipients(input.bcc ?? []),
    subject: input.subject, body: input.body, attachmentIds: [...new Set(input.attachmentIds ?? [])],
  };
}

export class MailService {
  private data: MailDatabase;
  private syncs = new Set<string>();
  constructor(readonly security: CompanySecurity, private providers: Map<string, MailProvider>,
    private store?: EncryptedStore<MailDatabase>, initial: MailDatabase = emptyMailDatabase(), private now = Date.now) {
    this.data = store?.load(() => initial) ?? structuredClone(initial);
    if (this.data.schemaVersion !== 1) throw new Error('Versión del correo no compatible.');
    this.data.attachments ??= {};
    // Only the synthetic demo can manufacture identifiers for historical synthetic seed data.
    if (security.mode === 'demo') for (const message of this.data.messages) {
      message.internetMessageId ??= `<${createHash('sha256').update(message.id).digest('hex')}@example.test>`;
    }
    security.seedGrants(this.data.grants);
    for (const draft of this.data.drafts) {
      if (draft.status === 'sending') { draft.status = 'uncertain'; draft.outcome = 'El servicio se reinició durante el envío. Hay que reconciliar.'; }
      // Approval does not survive a server restart; no durable human session is restored.
      if (draft.status === 'approved') { draft.status = 'draft'; delete draft.approval; }
    }
    this.save();
  }

  private save(): void { this.store?.save(this.data); }
  /** Durable mailbox epochs are authoritative even if another service's revocation listener cannot save. */
  permissionFingerprint(provenance: Provenance): string {
    const epochs = [...new Set(provenance.mailboxIds)].sort().map(id => {
      const mailbox = this.mailbox(id);
      return [id, mailbox.enabled, mailbox.permissionVersion];
    });
    return createHash('sha256').update(JSON.stringify(epochs)).digest('hex');
  }
  private audit(authority: CompanyAuthority, action: string, resourceId: string, draft?: MailDraft): void {
    this.data.audit.push({ at: new Date(this.now()).toISOString(), principalId: authority.principal.id, action, resourceId,
      ...(draft ? { version: draft.version, hash: draft.contentHash } : {}) });
    this.data.audit = this.data.audit.slice(-10_000);
  }
  private mailbox(id: string): Mailbox {
    const item = this.data.mailboxes.find(mailbox => mailbox.id === id && mailbox.enabled);
    if (!item) throw new HttpError(404, 'Buzón no disponible.');
    return item;
  }
  private draft(authority: CompanyAuthority, id: string): MailDraft {
    this.security.assertAuthority(authority);
    const draft = this.data.drafts.find(item => item.id === id);
    if (!draft || !this.security.canRead(authority, draft.provenance)) throw new HttpError(404, 'Borrador no disponible.');
    this.security.absorb(authority, draft.provenance);
    return draft;
  }

  mailboxes(authority: CompanyAuthority): Mailbox[] {
    this.security.assertAuthority(authority);
    // Connection inventory is administration metadata, not a preview of mailbox contents.
    return structuredClone(this.data.mailboxes.filter(mailbox => this.security.canRead(authority, { mailboxIds: [mailbox.id], sourceIds: [] })));
  }
  state(authority: CompanyAuthority, mailboxId?: string): MailState {
    this.security.assertAuthority(authority);
    const mailboxes = this.mailboxes(authority).filter(mailbox => !mailboxId || mailbox.id === mailboxId);
    if (mailboxId && !mailboxes.length) throw new HttpError(404, 'Buzón no disponible.');
    const messages = this.data.messages.filter(message => (!mailboxId || message.mailboxId === mailboxId) && this.security.canRead(authority, message.provenance));
    const drafts = this.data.drafts.filter(draft => (!mailboxId || draft.mailboxId === mailboxId) && this.security.canRead(authority, draft.provenance));
    // Agents cannot later launder data they have obtained from list/search into general company resources.
    for (const item of [...messages, ...drafts]) this.security.absorb(authority, item.provenance);
    return structuredClone({ mailboxes, messages, drafts,
      grants: authority.principal.kind === 'manager' ? this.security.listGrants(authority) : [],
      integrations: (['graph', 'imap'] as const).map(provider => ({
        provider, mode: this.security.mode === 'demo' ? 'simulated' as const : this.security.mode !== 'isolated' ? 'blocked' as const
          : this.data.mailboxes.some(mailbox => mailbox.provider === provider && Object.keys(this.data.cursors).some(key => key.startsWith(`${mailbox.id}:`)))
            ? 'connected' as const : this.data.mailboxes.some(mailbox => mailbox.provider === provider) ? 'configured' as const : 'blocked' as const,
        label: provider === 'graph' ? 'Microsoft 365' : 'IMAP / SMTP',
      })),
    });
  }

  read(authority: CompanyAuthority, id: string): MailMessage {
    this.security.assertAuthority(authority);
    const message = this.data.messages.find(item => item.id === id);
    if (!message || !this.security.canRead(authority, message.provenance)) throw new HttpError(404, 'Mensaje no disponible.');
    this.security.absorb(authority, message.provenance);
    return structuredClone(message);
  }
  context(authority: CompanyAuthority, provenance: Provenance): { title: string; content: string }[] {
    this.security.absorb(authority, provenance);
    return provenance.sourceIds.filter(id => this.data.messages.some(message => message.id === id)).map(id => {
      const message = this.read(authority, id);
      return { title: message.subject, content: `Remitente: ${message.from}\nFecha: ${message.receivedAt}\n\n${message.body}` };
    });
  }
  attachment(authority: CompanyAuthority, id: string): StoredAttachment {
    const attachment = this.data.attachments[id];
    if (!attachment || !this.security.canRead(authority, { mailboxIds: [attachment.mailboxId], sourceIds: [attachment.messageId] })) {
      throw new HttpError(404, 'Adjunto no disponible o en cuarentena.');
    }
    this.security.absorb(authority, { mailboxIds: [attachment.mailboxId], sourceIds: [attachment.messageId] });
    return structuredClone(attachment);
  }
  private checkedAttachments(authority: CompanyAuthority, content: MailContent): StoredAttachment[] {
    return content.attachmentIds.map(id => {
      const attachment = this.attachment(authority, id);
      const bytes = Buffer.from(attachment.contentBase64, 'base64');
      const inspection = inspectTextAttachment(bytes, attachment.metadata.contentType);
      if (!inspection.allowed || inspection.sha256 !== attachment.metadata.sha256) throw new HttpError(409, 'El adjunto no supera la verificación de integridad.');
      return attachment;
    });
  }

  createDraft(authority: CompanyAuthority, input: Partial<MailContent>): MailDraft {
    const mailbox = this.mailbox(String(input.mailboxId));
    this.security.requireCapability(authority, mailbox.id, 'draft');
    const content = checkedContent(input, mailbox);
    const attachments = this.checkedAttachments(authority, content).map(item => item.metadata);
    const source = content.messageId ? this.read(authority, content.messageId) : undefined;
    if (source && source.mailboxId !== mailbox.id) throw new HttpError(400, 'La conversación pertenece a otro buzón.');
    const replyMessageId = safeMessageId(source?.internetMessageId);
    if (source && !replyMessageId) throw new HttpError(409, 'El mensaje no contiene una cabecera válida para responder en su conversación.');
    const approvedContent = { ...content, replyMessageId };
    const provenance = this.security.scope(authority, { mailboxIds: [mailbox.id], sourceIds: source ? [source.id] : [] });
    const draft: MailDraft = { ...approvedContent, id: randomUUID(), version: 1, status: 'draft',
      contentHash: mailContentHash(approvedContent, mailbox.permissionVersion, 1), provenance,
      createdBy: authority.principal.id, permissionVersion: mailbox.permissionVersion };
    draft.attachments = attachments;
    this.data.drafts.push(draft); this.audit(authority, 'draft.created', draft.id, draft); this.save();
    return structuredClone(draft);
  }

  editDraft(authority: CompanyAuthority, id: string, input: Partial<MailContent> & { version: number }): MailDraft {
    const draft = this.draft(authority, id);
    this.security.requireCapability(authority, draft.mailboxId, 'draft');
    if (input.version !== draft.version || !['draft', 'approved', 'failed'].includes(draft.status)) throw new HttpError(409, 'El borrador ha cambiado o ya se está enviando.');
    if (input.mailboxId !== undefined && input.mailboxId !== draft.mailboxId ||
      input.messageId !== undefined && input.messageId !== draft.messageId) throw new HttpError(400, 'No se puede cambiar el buzón o la conversación.');
    const content = checkedContent({ ...draft, ...input }, this.mailbox(draft.mailboxId));
    const attachments = this.checkedAttachments(authority, content).map(item => item.metadata);
    Object.assign(draft, content, { attachments, version: draft.version + 1, status: 'draft', provenance: combineProvenance(draft.provenance, this.security.scope(authority)) });
    draft.contentHash = mailContentHash(draft, draft.permissionVersion, draft.version);
    delete draft.approval; delete draft.attemptId; delete draft.providerReceipt;
    this.audit(authority, 'draft.edited', id, draft); this.save(); return structuredClone(draft);
  }

  approve(authority: CompanyAuthority, id: string, version: number, contentHash: string): MailDraft {
    this.security.assertHuman(authority);
    const draft = this.draft(authority, id);
    this.match(draft, version, contentHash);
    if (draft.status !== 'draft') throw new HttpError(409, 'Solo puede aprobarse un borrador pendiente.');
    draft.status = 'approved';
    draft.approval = { managerId: authority.principal.id, version, contentHash, expiresAt: new Date(this.now() + 15 * 60_000).toISOString() };
    this.audit(authority, 'draft.approved', id, draft); this.save(); return structuredClone(draft);
  }

  private match(draft: MailDraft, version: number, hash: string): void {
    if (draft.messageId && !safeMessageId(draft.replyMessageId)) throw new HttpError(409, 'Crea de nuevo la respuesta desde el mensaje sincronizado para conservar su conversación.');
    if (draft.version !== version || draft.contentHash !== hash || hash !== mailContentHash(draft, this.mailbox(draft.mailboxId).permissionVersion, version)) {
      throw new HttpError(409, 'El contenido o los permisos han cambiado. Revisa la versión actual.');
    }
  }

  async send(authority: CompanyAuthority, id: string, version: number, contentHash: string): Promise<MailDraft> {
    this.security.assertHuman(authority);
    const draft = this.draft(authority, id);
    this.match(draft, version, contentHash);
    if (draft.status !== 'approved' || !draft.approval || Date.parse(draft.approval.expiresAt) <= this.now() ||
      draft.approval.version !== version || draft.approval.contentHash !== contentHash) throw new HttpError(409, 'Falta una aprobación humana vigente.');
    const provider = this.providers.get(draft.mailboxId);
    if (!provider || (this.security.mode !== 'isolated' && provider.mode === 'live')) throw new HttpError(503, 'El envío real requiere el servicio protegido.');
    // No await before approval is consumed and the attempt is durable: double clicks cannot send twice.
    const attachments = this.checkedAttachments(authority, draft).map(item => ({ name: item.metadata.name,
      contentType: item.metadata.contentType, contentBase64: item.contentBase64, sha256: item.metadata.sha256 }));
    draft.status = 'sending'; draft.attemptId = randomUUID(); delete draft.approval;
    this.audit(authority, 'send.started', id, draft); this.save();
    let result: ProviderOutcome;
    try { result = await provider.send({ ...structuredClone(draft), attachments }, draft.attemptId); }
    catch { result = { status: 'uncertain' }; }
    draft.status = result.status; draft.providerReceipt = result.receipt;
    draft.acceptedRecipients = result.acceptedRecipients; draft.rejectedRecipients = result.rejectedRecipients;
    draft.outcome = result.status === 'accepted' ? result.rejectedRecipients?.length
      ? 'Aceptación parcial: algunos destinatarios fueron rechazados. No se reenviará a los ya aceptados.'
      : 'Aceptado por el proveedor; no confirma la entrega.'
      : result.status === 'uncertain' ? 'Resultado incierto. No se reenviará automáticamente.'
        : 'El proveedor rechazó el envío. Edita y solicita una nueva aprobación.';
    this.audit(authority, `send.${result.status}`, id, draft); this.save();
    return structuredClone(draft);
  }

  async reconcile(authority: CompanyAuthority, id: string): Promise<MailDraft> {
    this.security.assertHuman(authority);
    const draft = this.draft(authority, id);
    if (draft.status !== 'uncertain' || !draft.attemptId) throw new HttpError(409, 'No hay envío incierto que reconciliar.');
    const result = await this.providers.get(draft.mailboxId)!.reconcile(draft.attemptId);
    // An absence in Sent is not evidence that it was not submitted.
    if (result.status === 'accepted') {
      draft.status = 'accepted'; draft.providerReceipt = result.receipt;
      draft.outcome = 'Localizado en el proveedor; no confirma la entrega.';
      this.audit(authority, 'send.reconciled', id, draft); this.save();
    }
    return structuredClone(draft);
  }

  cancel(authority: CompanyAuthority, id: string): MailDraft {
    this.security.assertHuman(authority);
    const draft = this.draft(authority, id);
    if (!['draft', 'approved', 'failed'].includes(draft.status)) throw new HttpError(409, 'El envío ya se ha iniciado y no puede cancelarse aquí.');
    draft.status = 'cancelled'; delete draft.approval;
    this.audit(authority, 'draft.cancelled', id, draft); this.save(); return structuredClone(draft);
  }

  setGrant(authority: CompanyAuthority, grant: MailGrant): void {
    this.security.assertHuman(authority);
    validateGrant(grant);
    const previous = structuredClone(this.data);
    const mailbox = this.mailbox(grant.mailboxId);
    mailbox.permissionVersion++;
    this.data.grants = this.data.grants.filter(item => item.agentId !== grant.agentId || item.mailboxId !== grant.mailboxId);
    if (grant.capabilities.length) this.data.grants.push(structuredClone(grant));
    for (const draft of this.data.drafts) {
      if (draft.provenance.mailboxIds.includes(grant.mailboxId) && ['draft', 'approved'].includes(draft.status)) {
        draft.status = 'draft'; delete draft.approval;
        draft.permissionVersion = this.mailbox(draft.mailboxId).permissionVersion;
        draft.version++;
        draft.contentHash = mailContentHash(draft, draft.permissionVersion, draft.version);
      }
    }
    this.audit(authority, 'grant.changed', grant.mailboxId);
    try { this.save(); } catch (error) { this.data = previous; throw error; }
    // Persist the restrictive state before changing live sessions; no await between these steps.
    this.security.setGrant(authority, grant);
  }

  async sync(authority: CompanyAuthority, mailboxId: string, folder = 'inbox'): Promise<void> {
    this.security.requireCapability(authority, mailboxId, 'read');
    const mailbox = this.mailbox(mailboxId);
    if (!mailbox.folders.includes(folder)) throw new HttpError(400, 'Carpeta no permitida.');
    const key = `${mailboxId}:${folder}`;
    if (this.syncs.has(key)) throw new HttpError(409, 'La sincronización ya está en curso.');
    const provider = this.providers.get(mailboxId);
    if (!provider) throw new HttpError(503, 'Proveedor no configurado.');
    this.syncs.add(key);
    try {
      const batch = await provider.sync(folder, this.data.cursors[key]);
      this.security.requireCapability(authority, mailboxId, 'read');
      if (batch.reset) this.data.messages = this.data.messages.filter(item => item.mailboxId !== mailboxId || item.folder !== folder);
      for (const providerId of batch.removedIds) this.data.messages = this.data.messages.filter(item => item.mailboxId !== mailboxId || item.providerId !== providerId);
      for (const message of batch.messages) {
        const existing = this.data.messages.find(item => item.mailboxId === mailboxId && item.providerId === message.providerId);
        const id = existing?.id ?? randomUUID();
        const attachments = message.attachments.map(metadata => {
          const stored = batch.attachments?.find(item => item.providerMessageId === message.providerId && item.attachmentId === metadata.id);
          if (!stored || metadata.quarantined) return { ...metadata, quarantined: true };
          const bytes = Buffer.from(stored.contentBase64, 'base64');
          const inspection = inspectTextAttachment(bytes, metadata.contentType);
          if (!inspection.allowed || inspection.sha256 !== metadata.sha256) return { ...metadata, quarantined: true };
          const attachmentId = attachmentIdentity(mailboxId, id, metadata);
          const final = { ...metadata, id: attachmentId };
          this.data.attachments[attachmentId] = { metadata: final, mailboxId, messageId: id, contentBase64: bytes.toString('base64') };
          return final;
        });
        const entry: MailMessage = { ...message, attachments, id, mailboxId, provenance: { mailboxIds: [mailboxId], sourceIds: [id] } };
        if (existing) Object.assign(existing, entry); else this.data.messages.push(entry);
      }
      for (const update of batch.flagUpdates ?? []) {
        const message = this.data.messages.find(item => item.mailboxId === mailboxId && item.providerId === update.providerId);
        if (message) message.read = update.read;
      }
      this.data.cursors[key] = batch.cursor;
      this.audit(authority, 'mail.synced', mailboxId); this.save();
    } finally { this.syncs.delete(key); }
  }

  async organize(authority: CompanyAuthority, id: string, read: boolean): Promise<void> {
    const message = this.read(authority, id);
    this.security.requireCapability(authority, message.mailboxId, 'organize');
    if (typeof read !== 'boolean') throw new HttpError(400, 'Estado de lectura inválido.');
    await this.providers.get(message.mailboxId)!.organize(message.providerId, { read });
    this.security.requireCapability(authority, message.mailboxId, 'organize');
    this.data.messages.find(item => item.id === id)!.read = read;
    this.audit(authority, 'mail.organized', id); this.save();
  }
}
