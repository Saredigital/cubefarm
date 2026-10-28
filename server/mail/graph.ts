/** Microsoft Graph adapter. No automatic retry of a write or ambiguous submission. */
import { boundedJson, plainMail, safeMessageId, ProviderError, type MailProvider, type MailSync, type ProviderOutcome, type OutboundMail } from './provider.ts';
import { inspectTextAttachment, type ProviderAttachment } from './attachments.ts';
import { approvedMime } from './mime.ts';

type Fetch = typeof fetch;
export interface GraphCredentials { tenantId: string; clientId: string; clientSecret: string }
export class GraphTokenSource {
  private cached?: { value: string; expires: number };
  constructor(private credentials: GraphCredentials, private request: Fetch = fetch) {}
  async token(): Promise<string> {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.value;
    const { tenantId, clientId, clientSecret } = this.credentials;
    if (!/^[a-zA-Z0-9-]+$/.test(tenantId)) throw new ProviderError('invalid');
    let response: Response;
    try {
      response = await this.request(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
      });
    } catch { throw new ProviderError('temporary'); }
    if (!response.ok) throw new ProviderError('auth');
    const data = await boundedJson<{ access_token?: string; expires_in?: number }>(response, 100_000);
    if (!data.access_token) throw new ProviderError('auth');
    this.cached = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 300) * 1000 };
    return this.cached.value;
  }
}

interface GraphMessage {
  id: string; conversationId?: string; subject?: string; body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string } }; toRecipients?: { emailAddress: { address: string } }[];
  ccRecipients?: { emailAddress: { address: string } }[]; receivedDateTime?: string; isRead?: boolean;
  internetMessageId?: string; replyTo?: { emailAddress: { address: string } }[];
  '@removed'?: unknown; hasAttachments?: boolean;
}
export class GraphMailProvider implements MailProvider {
  readonly mode = 'live' as const;
  private base: string;
  constructor(userId: string, private tokens: { token(): Promise<string> }, private request: Fetch = fetch) {
    this.base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}`;
  }
  private async call(url: string, method = 'GET', body?: unknown, mime = false): Promise<Response> {
    const parsed = new URL(url);
    // nextLink/deltaLink may not redirect credentials to another host or mailbox.
    if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.href.startsWith(`${this.base}/`)) throw new ProviderError('invalid');
    let response: Response;
    try {
      response = await this.request(url, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${await this.tokens.token()}`, 'content-type': mime ? 'text/plain' : 'application/json', Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' },
        ...(body === undefined ? {} : { body: mime ? String(body) : JSON.stringify(body) }) });
    } catch { throw new ProviderError('temporary'); }
    if (!response.ok) throw new ProviderError(response.status === 410 ? 'expired-cursor' : response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate-limit' : 'temporary',
      Math.min(3600, Number(response.headers.get('retry-after')) || 0));
    return response;
  }
  async sync(folder: string, cursor?: string): Promise<MailSync> {
    const initialUrl = `${this.base}/mailFolders/${encodeURIComponent(folder)}/messages/delta?$select=id,conversationId,internetMessageId,replyTo,subject,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments&$top=50`;
    let url = cursor ?? initialUrl;
    let reset = false;
    const messages: MailSync['messages'] = [];
    const removedIds: string[] = [];
    const attachmentContents: ProviderAttachment[] = [];
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      if (seen.has(url)) throw new ProviderError('invalid');
      seen.add(url);
      let response: Response;
      try { response = await this.call(url); }
      catch (error) {
        if (cursor && !reset && error instanceof ProviderError && error.code === 'expired-cursor') {
          reset = true; url = initialUrl; messages.length = 0; removedIds.length = 0; attachmentContents.length = 0; seen.clear(); continue;
        }
        throw error;
      }
      const data = await boundedJson<{ value: GraphMessage[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(response);
      if (!Array.isArray(data.value) || data.value.length > 1000) throw new ProviderError('invalid');
      for (const message of data.value) {
        if (typeof message.id !== 'string' || message.id.length > 2048) throw new ProviderError('invalid');
        if (message['@removed']) { removedIds.push(message.id); continue; }
        const attachments: MailSync['messages'][number]['attachments'] = [];
        if (message.hasAttachments) {
          const metadata = await boundedJson<{ value: { id: string; name: string; contentType: string; size: number }[] }>(
            await this.call(`${this.base}/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size`), 200_000);
          if (!Array.isArray(metadata.value) || metadata.value.length > 100) throw new ProviderError('invalid');
          for (const attachment of metadata.value) {
            const entry = { id: attachment.id, name: plainMail(attachment.name).slice(0, 255), contentType: attachment.contentType,
              size: attachment.size, sha256: '', quarantined: true };
            if (attachment.contentType === 'text/plain' && attachment.size <= 200_000 && attachmentContents.length < 25) {
              const full = await boundedJson<{ contentBytes?: string }>(await this.call(`${this.base}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}`), 300_000);
              if (full.contentBytes) {
                const bytes = Buffer.from(full.contentBytes, 'base64');
                const inspection = inspectTextAttachment(bytes, attachment.contentType);
                entry.sha256 = inspection.sha256; entry.quarantined = !inspection.allowed; entry.size = bytes.length;
                if (inspection.allowed) attachmentContents.push({ providerMessageId: message.id, attachmentId: attachment.id, contentBase64: bytes.toString('base64') });
              }
            }
            attachments.push(entry);
          }
        }
        messages.push({ providerId: message.id, conversationId: message.conversationId ?? message.id, folder,
          internetMessageId: safeMessageId(message.internetMessageId), replyTo: (message.replyTo ?? []).map(item => item.emailAddress.address),
          from: message.from?.emailAddress?.address ?? '', to: (message.toRecipients ?? []).map(item => item.emailAddress.address),
          cc: (message.ccRecipients ?? []).map(item => item.emailAddress.address), subject: plainMail(message.subject ?? ''),
          body: plainMail(message.body?.content ?? '', message.body?.contentType?.toLowerCase() === 'html'),
          receivedAt: message.receivedDateTime ?? new Date(0).toISOString(), read: !!message.isRead, attachments });
      }
      if (data['@odata.nextLink']) { url = data['@odata.nextLink']; continue; }
      if (!data['@odata.deltaLink']) throw new ProviderError('invalid');
      return { messages, removedIds, cursor: data['@odata.deltaLink'], reset, attachments: attachmentContents };
    }
    throw new ProviderError('temporary');
  }
  async organize(providerId: string, change: { read: boolean }): Promise<void> {
    await this.call(`${this.base}/messages/${encodeURIComponent(providerId)}`, 'PATCH', { isRead: change.read });
  }
  async send(content: Readonly<OutboundMail>, attemptId: string): Promise<ProviderOutcome> {
    try {
      // A single immutable MIME submission avoids a remotely editable draft between review and send.
      const mime = await approvedMime(content, attemptId);
      await this.call(`${this.base}/sendMail`, 'POST', mime.toString('base64'), true);
      return { status: 'accepted', receipt: attemptId };
    } catch { return { status: 'uncertain' }; }
  }
  async reconcile(attemptId: string): Promise<ProviderOutcome> {
    // A bounded recent-sent inspection can confirm acceptance; absence always remains uncertain.
    const response = await this.call(`${this.base}/mailFolders/sentitems/messages?$top=100&$select=id,internetMessageId,internetMessageHeaders&$orderby=sentDateTime%20desc`);
    const data = await boundedJson<{ value: { id: string; internetMessageId?: string; internetMessageHeaders?: { name: string; value: string }[] }[] }>(response);
    if (!Array.isArray(data.value) || data.value.length > 100) throw new ProviderError('invalid');
    const found = data.value.find(item => item.internetMessageId === `<${attemptId}@sareoffice.invalid>` ||
      item.internetMessageHeaders?.some(header => header.name.toLowerCase() === 'x-sareoffice-attempt' && header.value === attemptId));
    return found ? { status: 'accepted', receipt: found.id } : { status: 'uncertain' };
  }
}
