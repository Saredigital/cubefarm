import { describe, expect, it, vi } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type nodemailer from 'nodemailer';
import { GraphMailProvider, GraphTokenSource } from './graph.ts';
import { ImapMailProvider } from './imap.ts';
import { boundedJson, type OutboundMail } from './provider.ts';
import { inspectTextAttachment } from './attachments.ts';
import { simpleParser } from 'mailparser';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const base = 'https://graph.microsoft.com/v1.0/users/mail';
const outgoing: OutboundMail = { mailboxId: 'box', from: 'from@example.test', to: ['a@example.test', 'b@example.test'],
  cc: [], bcc: [], subject: 'Revisión', body: 'Texto', attachmentIds: [], attachments: [] };
describe('provider simulators', () => {
  it('Graph follows delta pages, deduplicates at service boundary and never follows foreign nextLink', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ value: [{ id: 'one', subject: '<script>attack</script>', body: { contentType: 'html', content: '<script>attack()</script><p>Texto<img src="https://evil.test"></p>' } }], '@odata.nextLink': `${base}/next` }))
      .mockResolvedValueOnce(json({ value: [{ id: 'old', '@removed': {} }], '@odata.deltaLink': `${base}/delta` }));
    const provider = new GraphMailProvider('mail', { token: async () => 'secret' }, request);
    const result = await provider.sync('inbox');
    expect(result.messages[0].body).toContain('Texto');
    expect(result.messages[0].body).not.toContain('attack');
    expect(result.messages[0].body).not.toContain('evil');
    expect(result.removedIds).toEqual(['old']);
    request.mockReset().mockResolvedValue(json({ value: [], '@odata.nextLink': 'https://evil.test/steal' }));
    await expect(provider.sync('inbox')).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('Graph recovers an expired cursor with full reset and exposes no credential in errors', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private provider detail', { status: 410 }))
      .mockResolvedValueOnce(json({ value: [], '@odata.deltaLink': `${base}/fresh` }));
    const provider = new GraphMailProvider('mail', { token: async () => 'secret' }, request);
    expect((await provider.sync('inbox', `${base}/expired`)).reset).toBe(true);
    request.mockReset().mockResolvedValue(new Response('secret refresh_token', { status: 401 }));
    await expect(provider.sync('inbox')).rejects.toThrow('renovar');
    await expect(provider.sync('inbox')).rejects.not.toThrow('refresh_token');
  });
  it('Graph fetches and inspects actual text attachments while quarantining active formats', async () => {
    const bytes = Buffer.from('Texto seguro', 'utf8');
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ value: [{ id: 'one', hasAttachments: true }], '@odata.deltaLink': `${base}/delta` }))
      .mockResolvedValueOnce(json({ value: [{ id: 'txt', name: 'brief.txt', contentType: 'text/plain', size: bytes.length },
        { id: 'html', name: 'attack.html', contentType: 'text/html', size: 100 }] }))
      .mockResolvedValueOnce(json({ contentBytes: bytes.toString('base64') }));
    const batch = await new GraphMailProvider('mail', { token: async () => 'secret' }, request).sync('inbox');
    expect(batch.messages[0].attachments[0].quarantined).toBe(false);
    expect(batch.messages[0].attachments[1].quarantined).toBe(true);
    expect(batch.attachments).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('Graph does not retry an uncertain send or treat missing sent evidence as failure', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network cut with secret'));
    const provider = new GraphMailProvider('mail', { token: async () => 'secret' }, request);
    expect(await provider.send(outgoing, 'attempt')).toEqual({ status: 'uncertain' });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValue(json({ value: [] }));
    expect(await provider.reconcile('attempt')).toEqual({ status: 'uncertain' });
  });
  it('Graph submits one immutable approved MIME reply with exact recipients, text and attachment bytes', async () => {
    const bytes = Buffer.from('Adjunto revisado\n', 'utf8');
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const provider = new GraphMailProvider('mail', { token: async () => 'secret' }, request);
    const payload: OutboundMail = { ...outgoing, replyMessageId: '<source@example.test>', cc: ['cc@example.test'], bcc: ['blind@example.test'],
      attachments: [{ name: 'brief.txt', contentType: 'text/plain', contentBase64: bytes.toString('base64'), sha256: inspectTextAttachment(bytes, 'text/plain').sha256 }] };
    expect((await provider.send(payload, 'once')).status).toBe('accepted');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`${base}/sendMail`);
    const options = request.mock.calls[0][1]!;
    expect(options.headers).toMatchObject({ 'content-type': 'text/plain' });
    const mime = await simpleParser(Buffer.from(String(options.body), 'base64'));
    expect(mime.from?.value.map(item => item.address)).toEqual([payload.from]);
    for (const field of ['to', 'cc', 'bcc'] as const) {
      const value = mime[field];
      const actual = (Array.isArray(value) ? value : value ? [value] : []).flatMap(item => item.value.map(entry => entry.address));
      expect(actual).toEqual(payload[field]);
    }
    expect(mime.subject).toBe(payload.subject);
    expect(mime.text?.trimEnd()).toBe(payload.body);
    expect(mime.inReplyTo).toBe(payload.replyMessageId);
    expect(mime.references).toBe(payload.replyMessageId);
    expect(mime.messageId).toBe('<once@sareoffice.invalid>');
    expect(mime.attachments[0].content).toEqual(bytes);
    request.mockResolvedValue(json({ value: [{ id: 'receipt', internetMessageId: '<once@sareoffice.invalid>' }] }));
    expect(await provider.reconcile('once')).toEqual({ status: 'accepted', receipt: 'receipt' });
  });
  it('bounds streaming response bodies, caches tokens and rejects non-text bytes', async () => {
    await expect(boundedJson(new Response('x'.repeat(1024)), 100)).rejects.toThrow();
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: 'token', expires_in: 3600 }));
    const token = new GraphTokenSource({ tenantId: 'tenant', clientId: 'client', clientSecret: 'private' }, request);
    expect(await token.token()).toBe('token');
    expect(await token.token()).toBe('token');
    expect(request).toHaveBeenCalledTimes(1);
    expect(inspectTextAttachment(Buffer.from([0, 255]), 'text/plain').allowed).toBe(false);
    expect(inspectTextAttachment(Buffer.from('<script>x</script>'), 'text/html').allowed).toBe(false);
  });
  it('IMAP checks size before source fetch, advances oversized messages and detects deleted UIDs', async () => {
    const fetchAll = vi.fn().mockResolvedValueOnce([
      { uid: 2, size: 5_000_001, flags: new Set(), envelope: { subject: 'Grande' } },
      { uid: 3, size: 100, flags: new Set() },
    ]).mockResolvedValueOnce([{ uid: 3, size: 100, flags: new Set(['\\Seen']), source: Buffer.from('From: a@example.test\r\nTo: b@example.test\r\nSubject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHola') }]);
    const client = { on: vi.fn(), connect: vi.fn(), getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      mailbox: { uidValidity: 1n }, search: vi.fn().mockResolvedValue([2, 3]), fetchAll,
      logout: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
    const provider = new ImapMailProvider({ host: 'imap.example.test', port: 993, user: 'u', password: 'p',
      smtp: { host: 'smtp.example.test', port: 465, user: 'u', password: 'p' } }, () => client as unknown as ImapFlow);
    const batch = await provider.sync('INBOX', JSON.stringify({ validity: '1', last: 1, ids: [1] }));
    expect(fetchAll.mock.calls[0][1]).not.toHaveProperty('source');
    expect(fetchAll.mock.calls[1][0]).toEqual([3]);
    expect(batch.messages[0].body).toContain('omitido');
    expect(JSON.parse(batch.cursor).last).toBe(3);
    expect(batch.removedIds).toEqual([JSON.stringify(['INBOX', '1', 1])]);
  });
  it('SMTP records partial acceptance and never repeats accepted recipients', async () => {
    const smtp = { sendMail: vi.fn().mockResolvedValue({ accepted: ['a@example.test'], rejected: ['b@example.test'], messageId: 'receipt' }), close: vi.fn() };
    const provider = new ImapMailProvider({ host: 'imap.example.test', port: 993, user: 'u', password: 'p',
      smtp: { host: 'smtp.example.test', port: 465, user: 'u', password: 'p' } }, undefined,
    () => smtp as unknown as ReturnType<typeof nodemailer.createTransport>);
    const result = await provider.send({ ...outgoing, replyMessageId: '<source@example.test>' }, 'once');
    expect(result.status).toBe('accepted');
    expect(result.rejectedRecipients).toEqual(['b@example.test']);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail.mock.calls[0][0]).toMatchObject({ inReplyTo: '<source@example.test>', references: ['<source@example.test>'], from: outgoing.from });
    await provider.send({ ...outgoing, replyMessageId: '<source@example.test>\r\nBcc: evil@example.test' }, 'bad');
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
  });
});
