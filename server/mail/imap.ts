/** IMAP read/flags and SMTP submit with mandatory TLS; MIME attachments stay quarantined. */
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';
import { plainMail, safeMessageId, ProviderError, type MailProvider, type MailSync, type ProviderOutcome, type OutboundMail } from './provider.ts';
import { inspectTextAttachment, type ProviderAttachment } from './attachments.ts';
import { outboundOptions } from './mime.ts';

export interface ImapCredentials {
  host: string; port: number; user: string; password: string;
  smtp: { host: string; port: number; user: string; password: string };
  sentFolder?: string;
}
function addresses(value: AddressObject | AddressObject[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).flatMap(item => item.value.map(entry => entry.address ?? '')).filter(Boolean);
}
export class ImapMailProvider implements MailProvider {
  readonly mode = 'live' as const;
  constructor(private config: ImapCredentials, private clientFactory = () => new ImapFlow({
    host: config.host, port: config.port, secure: true,
    auth: { user: config.user, pass: config.password }, logger: false, logRaw: false,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, socketTimeout: 30_000,
  }), private smtpFactory = () => nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, requireTLS: true,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }, logger: false, debug: false,
    connectionTimeout: 30_000, socketTimeout: 30_000, disableFileAccess: true, disableUrlAccess: true,
  })) {}

  async sync(folder: string, cursor?: string): Promise<MailSync> {
    const client = this.clientFactory();
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        if (!client.mailbox) throw new ProviderError('invalid');
        const validity = String(client.mailbox.uidValidity);
        const previous = cursor ? JSON.parse(cursor) as { validity: string; last: number; ids?: number[] } : undefined;
        const reset = !!previous && previous.validity !== validity;
        const last = previous && !reset ? previous.last : 0;
        // Bounded batches, UIDVALIDITY included in identity. New sessions reconnect automatically.
        const found = await client.search({ all: true }, { uid: true });
        if ((found || []).length > 50_000) throw new ProviderError('invalid');
        const allIds = found || [];
        const ids = allIds.filter(uid => uid > last).slice(0, 100);
        const messages: MailSync['messages'] = [];
        const attachments: ProviderAttachment[] = [];
        if (ids.length) {
          const metadata = await client.fetchAll(ids, { flags: true, size: true, envelope: true }, { uid: true });
          const allowed = metadata.filter(item => (item.size ?? Infinity) <= 1_000_000);
          const total = allowed.reduce((sum, item) => sum + (item.size ?? 0), 0);
          if (total > 5_000_000) allowed.splice(1);
          const allowedIds = allowed.map(item => item.uid);
          const items = allowedIds.length ? await client.fetchAll(allowedIds, { source: true, flags: true, size: true }, { uid: true }) : [];
          for (const item of metadata.filter(item => !allowedIds.includes(item.uid))) {
            const providerId = JSON.stringify([folder, validity, item.uid]);
            messages.push({ providerId, folder, conversationId: item.envelope?.messageId ?? providerId,
              internetMessageId: safeMessageId(item.envelope?.messageId),
              from: item.envelope?.from?.[0]?.address ?? '', to: [], cc: [], subject: plainMail(item.envelope?.subject ?? ''),
              body: 'Contenido omitido por superar el límite de descarga segura. Revísalo en tu cliente de correo.',
              receivedAt: item.envelope?.date ? new Date(item.envelope.date).toISOString() : new Date(0).toISOString(), read: item.flags?.has('\\Seen') ?? false, attachments: [] });
          }
          for (const item of items) {
            if (!item.source || item.source.length > 1_000_000) {
              throw new ProviderError('invalid');
            }
            const parsed = await simpleParser(item.source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
            const providerId = JSON.stringify([folder, validity, item.uid]);
            messages.push({ providerId, folder, conversationId: parsed.inReplyTo ?? parsed.messageId ?? providerId,
              internetMessageId: safeMessageId(parsed.messageId), replyTo: addresses(parsed.replyTo),
              from: addresses(parsed.from)[0] ?? '', to: addresses(parsed.to), cc: addresses(parsed.cc),
              subject: plainMail(parsed.subject ?? ''), body: plainMail(parsed.text ?? (typeof parsed.html === 'string' ? parsed.html : ''), !parsed.text),
              receivedAt: parsed.date?.toISOString() ?? new Date(0).toISOString(), read: item.flags?.has('\\Seen') ?? false,
              attachments: parsed.attachments.slice(0, 100).map(attachment => {
                const inspection = inspectTextAttachment(attachment.content, attachment.contentType);
                const id = createHash('sha256').update(attachment.content).digest('hex');
                if (inspection.allowed) attachments.push({ providerMessageId: providerId, attachmentId: id, contentBase64: attachment.content.toString('base64') });
                return { id, name: attachment.filename ?? 'Adjunto', contentType: attachment.contentType,
                  size: attachment.size, sha256: inspection.sha256, quarantined: !inspection.allowed };
              }),
            });
          }
        }
        const removedIds = (previous?.ids ?? []).filter(uid => !allIds.includes(uid)).map(uid => JSON.stringify([folder, validity, uid]));
        const flagUpdates: NonNullable<MailSync['flagUpdates']> = [];
        // Flag reconciliation is bounded to a rotating page of existing messages.
        const oldIds = allIds.filter(uid => uid <= last);
        const offset = previous && 'flagOffset' in previous ? Number(previous.flagOffset) || 0 : 0;
        const flagIds = oldIds.slice(offset, offset + 100);
        if (flagIds.length) {
          for (const item of await client.fetchAll(flagIds, { flags: true }, { uid: true })) {
            flagUpdates.push({ providerId: JSON.stringify([folder, validity, item.uid]), read: item.flags?.has('\\Seen') ?? false });
          }
        }
        return { messages, removedIds, cursor: JSON.stringify({ validity, last: ids.at(-1) ?? last, ids: allIds,
          flagOffset: offset + 100 >= oldIds.length ? 0 : offset + 100 }), reset, attachments, flagUpdates };
      } finally { lock.release(); }
    } catch { throw new ProviderError('temporary'); }
    finally { await client.logout().catch(() => client.close()); }
  }
  async organize(providerId: string, change: { read: boolean }): Promise<void> {
    const [folder, validity, uid] = JSON.parse(providerId) as [string, string, number];
    const client = this.clientFactory();
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== validity) throw new ProviderError('invalid');
        if (change.read) await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
        else await client.messageFlagsRemove([uid], ['\\Seen'], { uid: true });
      } finally { lock.release(); }
    } catch { throw new ProviderError('temporary'); }
    finally { await client.logout().catch(() => client.close()); }
  }
  async send(content: Readonly<OutboundMail>, attemptId: string): Promise<ProviderOutcome> {
    const smtp = this.smtpFactory();
    try {
      const result = await smtp.sendMail(outboundOptions(content, attemptId));
      const asAddress = (value: string | { address: string }) => typeof value === 'string' ? value : value.address;
      return result.accepted.length ? { status: 'accepted', receipt: result.messageId,
        acceptedRecipients: result.accepted.map(asAddress), rejectedRecipients: result.rejected.map(asAddress) } : { status: 'failed' };
    } catch { return { status: 'uncertain' }; }
    finally { smtp.close(); }
  }
  async reconcile(attemptId: string): Promise<ProviderOutcome> {
    if (!this.config.sentFolder) return { status: 'uncertain' };
    const client = this.clientFactory();
    client.on('error', () => {});
    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.config.sentFolder);
      try {
        const found = await client.search({ header: { 'Message-ID': `<${attemptId}@sareoffice.invalid>` } }, { uid: true });
        return found && found.length ? { status: 'accepted', receipt: `<${attemptId}@sareoffice.invalid>` } : { status: 'uncertain' };
      } finally { lock.release(); }
    } catch { return { status: 'uncertain' }; }
    finally { await client.logout().catch(() => client.close()); }
  }
}
