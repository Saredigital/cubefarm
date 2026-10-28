import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CompanySecurity, DEMO_PASSWORD } from '../company-security/security.ts';
import { EncryptedStore } from '../company-security/vault.ts';
import { demoMailDatabase, SimulatedMailProvider } from './demo.ts';
import { MailService, type MailDatabase } from './service.ts';
import type { MailProvider } from './provider.ts';
import type { MailContent, MailDraft } from '../../shared/mail.ts';

function fixture(store?: EncryptedStore<MailDatabase>, now?: () => number) {
  const security = new CompanySecurity({ demo: true, now });
  const login = security.login(DEMO_PASSWORD);
  const authority = security.authority({ headers: { cookie: `company_session=${login.token}` } });
  const provider = new SimulatedMailProvider('test');
  const providers = new Map<string, MailProvider>([['mail-operaciones', provider], ['mail-negocio', new SimulatedMailProvider('negocio')]]);
  const service = new MailService(security, providers, store, demoMailDatabase(), now);
  const draft = () => service.createDraft(authority, { mailboxId: 'mail-operaciones', messageId: 'mail-operaciones-mensaje',
    to: ['cliente@example.test'], cc: [], bcc: [], subject: 'Respuesta', body: 'Propuesta revisable' });
  return { security, authority, service, provider, providers, draft };
}
describe('private mail and exact send approval', () => {
  it('filters mailbox lists, direct reads, search context and derived drafts by all sources', () => {
    const f = fixture();
    f.service.setGrant(f.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: ['read', 'draft'] });
    const agent = f.security.issueAgent('a');
    expect(f.service.state(agent.authority).messages).toHaveLength(1);
    expect(() => f.service.read(agent.authority, 'mail-negocio-mensaje')).toThrow();
    expect(f.security.scope(agent.authority).mailboxIds).toEqual(['mail-operaciones']);
    const draft = f.service.createDraft(agent.authority, { mailboxId: 'mail-operaciones', to: ['cliente@example.test'], subject: 'Resumen', body: 'Derivado' });
    expect(draft.provenance.mailboxIds).toEqual(['mail-operaciones']);
    expect(() => f.service.approve(agent.authority, draft.id, draft.version, draft.contentHash)).toThrow();
    expect(f.service.context(agent.authority, draft.provenance)[0].content).toContain('presencia digital');
  });
  it('requires human approval, invalidates all edits including recipients, and prevents stale versions', async () => {
    const f = fixture();
    const first = f.draft();
    await expect(f.service.send(f.authority, first.id, first.version, first.contentHash)).rejects.toThrow();
    f.service.approve(f.authority, first.id, first.version, first.contentHash);
    const edited = f.service.editDraft(f.authority, first.id, { version: 1, bcc: ['otro@example.test'] });
    expect(edited.approval).toBeUndefined();
    await expect(f.service.send(f.authority, first.id, first.version, first.contentHash)).rejects.toThrow();
    await expect(f.service.send(f.authority, edited.id, edited.version, edited.contentHash)).rejects.toThrow();
    expect(f.provider.sent).toHaveLength(0);
  });
  it('consumes approval synchronously so double click sends only once', async () => {
    const f = fixture();
    const draft = f.draft();
    f.service.approve(f.authority, draft.id, draft.version, draft.contentHash);
    const outcomes = await Promise.allSettled([
      f.service.send(f.authority, draft.id, draft.version, draft.contentHash),
      f.service.send(f.authority, draft.id, draft.version, draft.contentHash),
    ]);
    expect(outcomes.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(f.provider.sent).toHaveLength(1);
    expect(f.service.state(f.authority).drafts[0].outcome).toContain('no confirma la entrega');
  });
  it('never reuses an approval for another draft or after expiry', () => {
    let now = 0;
    const f = fixture(undefined, () => now);
    const one = f.draft(), two = f.draft();
    f.service.approve(f.authority, one.id, one.version, one.contentHash);
    expect(f.service.state(f.authority).drafts.find(item => item.id === two.id)?.status).toBe('draft');
    now = 16 * 60_000;
    return expect(f.service.send(f.authority, one.id, one.version, one.contentHash)).rejects.toThrow();
  });
  it('revocation invalidates approval and current contexts; failed persistence does not grant', () => {
    const f = fixture();
    const draft = f.draft();
    f.service.approve(f.authority, draft.id, draft.version, draft.contentHash);
    f.service.setGrant(f.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: ['read'] });
    expect(f.service.state(f.authority).drafts[0].approval).toBeUndefined();
    const store = { load: () => demoMailDatabase(), save: vi.fn() } as unknown as EncryptedStore<MailDatabase>;
    const g = fixture(store);
    vi.mocked(store.save).mockImplementation(() => { throw new Error('disk full'); });
    expect(() => g.service.setGrant(g.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: ['read'] })).toThrow();
    expect(g.security.canAssign('a', { mailboxIds: ['mail-operaciones'], sourceIds: [] })).toBe(false);
  });
  it('persists unknown outcomes and cannot blindly retry after restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'company-send-'));
    try {
      const store = new EncryptedStore<MailDatabase>(path.join(directory, 'mail.enc'), randomBytes(32));
      const f = fixture(store);
      f.provider.outcome = { status: 'uncertain' };
      const draft = f.draft();
      f.service.approve(f.authority, draft.id, draft.version, draft.contentHash);
      expect((await f.service.send(f.authority, draft.id, draft.version, draft.contentHash)).status).toBe('uncertain');
      const restarted = fixture(store);
      await expect(restarted.service.send(restarted.authority, draft.id, draft.version, draft.contentHash)).rejects.toThrow();
      expect((await restarted.service.reconcile(restarted.authority, draft.id)).status).toBe('uncertain');
      expect(restarted.provider.sent).toHaveLength(0);
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it('a crash while submission is pending restores uncertain and never creates a second submission', async () => {
    let persisted = demoMailDatabase();
    const store = { load: () => structuredClone(persisted), save: (value: MailDatabase) => { persisted = structuredClone(value); } } as unknown as EncryptedStore<MailDatabase>;
    const f = fixture(store);
    let complete!: (value: { status: 'uncertain' }) => void;
    const send = vi.fn(() => new Promise<{ status: 'uncertain' }>(resolve => { complete = resolve; }));
    f.provider.send = send;
    const draft = f.draft();
    f.service.approve(f.authority, draft.id, draft.version, draft.contentHash);
    const pending = f.service.send(f.authority, draft.id, draft.version, draft.contentHash);
    expect(persisted.drafts[0].status).toBe('sending');
    const restarted = fixture(store);
    expect(restarted.service.state(restarted.authority).drafts[0].status).toBe('uncertain');
    await expect(restarted.service.send(restarted.authority, draft.id, draft.version, draft.contentHash)).rejects.toThrow();
    expect(restarted.provider.sent).toHaveLength(0);
    complete({ status: 'uncertain' }); await pending;
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('deduplicates synchronization and excludes content from returned global status', async () => {
    const f = fixture();
    await f.service.sync(f.authority, 'mail-operaciones');
    await f.service.sync(f.authority, 'mail-operaciones');
    expect(f.service.state(f.authority).messages.filter(item => item.providerId === 'test-consulta')).toHaveLength(1);
    expect(JSON.stringify(f.security.status())).not.toContain('colaboración');
  });
  it('rejects sender spoofing, header injection, quarantined attachments and organization without grant', async () => {
    const f = fixture();
    expect(() => f.service.createDraft(f.authority, { mailboxId: 'mail-operaciones', from: 'fake@example.test', to: ['a@example.test'], subject: 'a', body: 'b' })).toThrow();
    expect(() => f.service.createDraft(f.authority, { mailboxId: 'mail-operaciones', to: ['a@example.test\r\nBcc: other@example.test'], subject: 'a', body: 'b' })).toThrow();
    expect(() => f.service.editDraft(f.authority, f.draft().id, { version: 1, attachmentIds: ['evil'] })).toThrow();
    f.service.setGrant(f.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: ['read'] });
    await expect(f.service.organize(f.security.issueAgent('a').authority, 'mail-operaciones-mensaje', true)).rejects.toThrow();
  });
  it('binds safe attachment bytes and source to approval while preventing cross-mailbox download', async () => {
    const f = fixture();
    const attachment = f.service.state(f.authority, 'mail-operaciones').messages[0].attachments[0];
    expect(attachment.quarantined).toBe(false);
    const draft = f.service.createDraft(f.authority, { mailboxId: 'mail-operaciones', to: ['client@example.test'],
      subject: 'Adjunto revisado', body: 'Texto', attachmentIds: [attachment.id] });
    expect(draft.attachments?.[0].sha256).toBe(attachment.sha256);
    f.service.approve(f.authority, draft.id, draft.version, draft.contentHash);
    await f.service.send(f.authority, draft.id, draft.version, draft.contentHash);
    const payload = f.provider.sent[0].content as unknown as { attachments: { sha256: string; contentBase64: string }[] };
    expect(payload.attachments[0].sha256).toBe(attachment.sha256);
    expect(Buffer.from(payload.attachments[0].contentBase64, 'base64').toString()).toContain('diagnóstico');
    const stranger = f.security.issueAgent('stranger');
    expect(() => f.service.attachment(stranger.authority, attachment.id)).toThrow();
  });
  it('mailbox inventory does not disclose message content and selected state taints only selected mailbox', () => {
    const f = fixture();
    expect(f.service.mailboxes(f.authority)).toHaveLength(2);
    expect(f.security.scope(f.authority).mailboxIds).toEqual([]);
    expect(f.service.state(f.authority, 'mail-negocio').messages).toHaveLength(1);
    expect(f.security.scope(f.authority).mailboxIds).toEqual(['mail-negocio']);
  });
  it('pins server source threading inside the approved hash and ignores caller header overrides', async () => {
    const f = fixture();
    const input = { mailboxId: 'mail-operaciones', messageId: 'mail-operaciones-mensaje', to: ['cliente@example.test'],
      subject: 'Respuesta', body: 'Texto', replyMessageId: '<spoof@example.test>' } as Partial<MailContent>;
    const draft = f.service.createDraft(f.authority, input);
    expect(draft.replyMessageId).toBe('<mail-operaciones-consulta@example.test>');
    const edited = f.service.editDraft(f.authority, draft.id, { version: 1, replyMessageId: '<changed@example.test>' } as Partial<MailContent> & { version: number });
    expect(edited.replyMessageId).toBe(draft.replyMessageId);
    f.service.approve(f.authority, edited.id, edited.version, edited.contentHash);
    await f.service.send(f.authority, edited.id, edited.version, edited.contentHash);
    expect((f.provider.sent[0].content as MailDraft).replyMessageId).toBe(draft.replyMessageId);
  });
  it('durable mailbox fingerprint survives restart and failed persistence does not advance it', () => {
    let persisted = demoMailDatabase();
    const store = { load: () => structuredClone(persisted), save: vi.fn((value: MailDatabase) => { persisted = structuredClone(value); }) } as unknown as EncryptedStore<MailDatabase>;
    const f = fixture(store);
    const provenance = { mailboxIds: ['mail-operaciones'], sourceIds: [] };
    const before = f.service.permissionFingerprint(provenance);
    f.service.setGrant(f.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: ['read'] });
    const after = f.service.permissionFingerprint(provenance);
    expect(after).not.toBe(before);
    expect(fixture(store).service.permissionFingerprint(provenance)).toBe(after);
    vi.mocked(store.save).mockImplementation(() => { throw new Error('disk full'); });
    expect(() => f.service.setGrant(f.authority, { agentId: 'a', mailboxId: 'mail-operaciones', capabilities: [] })).toThrow();
    expect(f.service.permissionFingerprint(provenance)).toBe(after);
  });
});
