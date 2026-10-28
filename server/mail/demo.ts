/** Synthetic providers intentionally have no network transport or real credentials. */
import type { MailContent } from '../../shared/mail.ts';
import type { MailProvider, MailSync, ProviderOutcome } from './provider.ts';
import { emptyMailDatabase, type MailDatabase } from './service.ts';
import { attachmentIdentity, inspectTextAttachment } from './attachments.ts';

export class SimulatedMailProvider implements MailProvider {
  readonly mode = 'simulated' as const;
  readonly sent: { content: MailContent; attemptId: string }[] = [];
  outcome: ProviderOutcome = { status: 'accepted' };
  constructor(private name: string) {}
  async sync(folder: string): Promise<MailSync> {
    return { messages: [{ providerId: `${this.name}-consulta`, conversationId: `${this.name}-conversacion`, folder,
      internetMessageId: `<${this.name}-consulta@example.test>`,
      from: 'cliente@example.test', to: [`${this.name}@example.test`], cc: [], subject: 'Propuesta de colaboración (simulada)',
      body: 'Nos gustaría recibir una propuesta para mejorar nuestra presencia digital. ¿Podéis indicar los siguientes pasos?',
      receivedAt: '2026-10-20T09:00:00.000Z', read: false, attachments: [] }],
      removedIds: [], cursor: 'simulated-v1' };
  }
  async organize(): Promise<void> {}
  async send(content: Readonly<MailContent>, attemptId: string): Promise<ProviderOutcome> {
    this.sent.push({ content: structuredClone(content), attemptId });
    return { ...this.outcome, ...(this.outcome.status === 'accepted' ? { receipt: `simulated:${attemptId}` } : {}) };
  }
  async reconcile(attemptId: string): Promise<ProviderOutcome> {
    return this.sent.some(item => item.attemptId === attemptId) && this.outcome.status === 'accepted'
      ? { status: 'accepted', receipt: `simulated:${attemptId}` } : { status: 'uncertain' };
  }
}
export function demoMailDatabase(): MailDatabase {
  const data = emptyMailDatabase();
  data.mailboxes = [
    { id: 'mail-operaciones', name: 'Operaciones · demo', address: 'operaciones@example.test', provider: 'graph', enabled: true, permissionVersion: 1, folders: ['inbox'] },
    { id: 'mail-negocio', name: 'Negocio · demo', address: 'negocio@example.test', provider: 'imap', enabled: true, permissionVersion: 1, folders: ['inbox'] },
  ];
  data.messages = data.mailboxes.map(mailbox => ({
    id: `${mailbox.id}-mensaje`, mailboxId: mailbox.id, providerId: `${mailbox.id}-consulta`, conversationId: `${mailbox.id}-conversacion`,
    internetMessageId: `<${mailbox.id}-consulta@example.test>`,
    folder: 'inbox', from: 'cliente@example.test', to: [mailbox.address], cc: [],
    subject: 'Propuesta de colaboración (simulada)', body: 'Queremos una propuesta para mejorar nuestra presencia digital. ¿Podéis indicar los siguientes pasos?',
    receivedAt: '2026-10-20T09:00:00.000Z', read: false, attachments: [],
    provenance: { mailboxIds: [mailbox.id], sourceIds: [`${mailbox.id}-mensaje`] },
  }));
  const first = data.messages[0];
  const bytes = Buffer.from('Alcance de ejemplo: diagnóstico, propuesta y seguimiento. Documento simulado.', 'utf8');
  const metadata = { id: '', name: 'encargo-demo.txt', contentType: 'text/plain', size: bytes.length,
    sha256: inspectTextAttachment(bytes, 'text/plain').sha256, quarantined: false };
  metadata.id = attachmentIdentity(first.mailboxId, first.id, metadata);
  first.attachments.push(metadata);
  data.attachments[metadata.id] = { metadata, mailboxId: first.mailboxId, messageId: first.id, contentBase64: bytes.toString('base64') };
  return data;
}
