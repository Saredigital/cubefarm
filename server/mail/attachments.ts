/** Only bounded UTF-8 plain text is released; every other attachment remains quarantined. */
import { createHash } from 'node:crypto';
import type { MailAttachment } from '../../shared/mail.ts';

export interface ProviderAttachment {
  providerMessageId: string;
  attachmentId: string;
  contentBase64: string;
}
export interface StoredAttachment {
  metadata: MailAttachment;
  mailboxId: string;
  messageId: string;
  contentBase64: string;
}
export interface OutboundAttachment { name: string; contentType: string; contentBase64: string; sha256: string }

export function inspectTextAttachment(bytes: Uint8Array, contentType: string): { sha256: string; allowed: boolean } {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (contentType.toLowerCase().split(';')[0].trim() !== 'text/plain' || bytes.length > 200_000) return { sha256, allowed: false };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { sha256, allowed: !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) };
  } catch { return { sha256, allowed: false }; }
}
export function attachmentIdentity(mailboxId: string, sourceId: string, metadata: MailAttachment): string {
  return createHash('sha256').update(JSON.stringify({ mailboxId, sourceId, hash: metadata.sha256, name: metadata.name, type: metadata.contentType })).digest('hex');
}
