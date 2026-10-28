/** Provider adapters only receive an immutable payload after the broker consumes approval. */
import type { MailContent, MailMessage } from '../../shared/mail.ts';
import type { OutboundAttachment, ProviderAttachment } from './attachments.ts';

export interface MailSync {
  messages: Omit<MailMessage, 'id' | 'mailboxId' | 'provenance'>[];
  removedIds: string[];
  cursor: string;
  reset?: boolean;
  attachments?: ProviderAttachment[];
  flagUpdates?: { providerId: string; read: boolean }[];
}
export interface OutboundMail extends MailContent { attachments: OutboundAttachment[]; replyMessageId?: string }

/** Deliberately restricted Message-ID grammar; malformed provider headers never become outbound headers. */
export function safeMessageId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 998 && /^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+>$/.test(value) ? value : undefined;
}
export interface ProviderOutcome {
  status: 'accepted' | 'uncertain' | 'failed';
  receipt?: string;
  acceptedRecipients?: string[];
  rejectedRecipients?: string[];
}
export interface MailProvider {
  readonly mode: 'simulated' | 'live';
  sync(folder: string, cursor?: string): Promise<MailSync>;
  organize(providerId: string, change: { read: boolean }): Promise<void>;
  send(content: Readonly<OutboundMail>, attemptId: string): Promise<ProviderOutcome>;
  reconcile(attemptId: string): Promise<ProviderOutcome>;
}

export class ProviderError extends Error {
  constructor(public code: 'auth' | 'rate-limit' | 'temporary' | 'invalid' | 'expired-cursor', public retryAfterSeconds = 0) {
    super(code === 'auth' ? 'La conexión requiere renovar la autorización.'
      : code === 'rate-limit' ? 'El proveedor ha limitado las peticiones. Inténtalo más tarde.'
        : 'El proveedor no está disponible. No se ha modificado el estado local.');
  }
}

export async function boundedJson<T>(response: Response, limit = 6_000_000): Promise<T> {
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new ProviderError('invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.length;
      if (total > limit) throw new ProviderError('invalid');
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } finally { await reader.cancel().catch(() => {}); }
}

/** Strip active content before anything leaves the provider boundary. Never return provider HTML. */
export function plainMail(value: string, isHtml = false): string {
  const text = isHtml ? value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&') : value;
  return text.replace(/\0/g, '').slice(0, 100_000);
}
