import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CompanyAuthority } from '../../shared/companySecurity.ts';
import type { SocialDraft } from '../../shared/companySocial.ts';
import { CompanySecurity } from '../company-security/security.ts';
import { EncryptedStore } from '../company-security/vault.ts';
import { demoSocialAccounts } from './router.ts';
import { DemoSocialProvider } from './adapters.ts';
import { CompanySocialService, type SocialDatabase, type SocialSource } from './service.ts';
import type { SocialProvider, SocialPublishInput, SocialResult } from './provider.ts';
import { ProviderFailure } from './provider.ts';

export function jpegFixture() { return Buffer.from([255, 216, 255, 192, 0, 11, 8, 1, 64, 1, 64, 1, 1, 17, 0, 255, 217]).toString('base64'); }
export function mp4Fixture() { const box = (type: string, data: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(8 + data.length); header.write(type, 4); return Buffer.concat([header, data]); }; const ftyp = box('ftyp', Buffer.from('isom0000')); const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(5000, 16); const hdlr = Buffer.alloc(16); hdlr.write('vide', 8); return Buffer.concat([ftyp, box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr)))])), box('mdat', Buffer.from([1, 2, 3, 4]))]).toString('base64'); }
const resources: { directory: string; services: CompanySocialService[]; security: CompanySecurity }[] = [];
afterEach(async () => { for (const resource of resources.splice(0)) { await Promise.all(resource.services.map(s => s.close())); resource.security.close(); rmSync(resource.directory, { recursive: true, force: true }); } });
function setup() {
  let now = Date.parse('2026-10-20T10:00:00.000Z'); const clock = () => now;
  let permissionVersion = 'durable-version-1';
  const directory = mkdtempSync(path.join(tmpdir(), 'sareoffice-social-test-')); const security = new CompanySecurity({ demo: true, now: clock });
  const session = security.login('demo-oficina'); const human = security.authority({ headers: { cookie: `company_session=${session.token}` } });
  const agent = security.issueAgent('redactor').authority;
  const source: SocialSource = { currentVersion: 1, hash: 'a'.repeat(64), accepted: true, provenance: { mailboxIds: [], sourceIds: ['deliverable:1'] } };
  const accounts = demoSocialAccounts(); const providers = new Map<string, SocialProvider>(accounts.map(a => [a.id, new DemoSocialProvider(a.providerAccountId)]));
  const storage = new EncryptedStore<SocialDatabase>(path.join(directory, 'social.enc'), Buffer.alloc(32, 5), 'social'); const services: CompanySocialService[] = [];
  resources.push({ directory, services, security });
  const make = () => { const service = new CompanySocialService(security, storage, accounts, providers, () => structuredClone(source), clock, true, () => permissionVersion); services.push(service); return service; };
  const service = make();
  const input = (channel = 'x', assetIds: string[] = [], scheduledAt: string | null = null) => ({ accountId: `demo-${channel}`, deliverableId: 'deliverable-1', version: 1, text: 'Pieza de campaña revisada.', assetIds, scheduledAt, ...(channel === 'tiktok' ? { options: { privacy: 'SELF_ONLY' } } : {}) });
  const approve = (draft: SocialDraft, externalDisclosure = false) => service.approve(human, draft.id, { fingerprint: draft.fingerprint, externalDisclosure });
  return { security, human, agent, source, providers, service, storage, make, input, approve, bumpPermissions() { permissionVersion += '-changed'; }, advance(ms: number) { now += ms; }, clock };
}

describe('publicación social con autorización exacta', () => {
  it('demuestra cuatro canales y distingue aceptación de publicación simulada', async () => {
    const t = setup();
    const image = t.service.upload(t.human, { filename: 'imagen.jpg', mimeType: 'image/jpeg', dataBase64: jpegFixture() });
    const video = t.service.upload(t.human, { filename: 'video.mp4', mimeType: 'video/mp4', dataBase64: mp4Fixture() });
    for (const channel of ['x', 'instagram', 'facebook', 'tiktok']) {
      const draft = t.service.create(t.human, t.input(channel, channel === 'instagram' ? [image.id] : channel === 'tiktok' ? [video.id] : []));
      t.approve(draft); expect((await t.service.publish(t.human, draft.id)).state).toBe('accepted');
      expect((await t.service.reconcile(t.human, draft.id)).state).toBe('published');
    }
    expect(t.service.snapshot(t.human).drafts).toHaveLength(4);
  });
  it('rechaza identidades construidas, agentes aprobadores y publicación sin revisión', async () => {
    const t = setup(); const draft = t.service.create(t.agent, t.input());
    expect(() => t.service.snapshot({ principal: { id: 'responsable', kind: 'manager' }, provenance: { mailboxIds: [], sourceIds: [] } } as CompanyAuthority)).toThrow();
    expect(() => t.service.approve(t.agent, draft.id, { fingerprint: draft.fingerprint, externalDisclosure: false })).toThrow();
    await expect(t.service.publish(t.agent, draft.id)).rejects.toThrow();
    await expect(t.service.publish(t.human, draft.id)).rejects.toThrow();
  });
  it('no permite mutar texto, cuenta, fecha o activos después de la aprobación', async () => {
    const t = setup(); const draft = t.service.create(t.human, t.input()); t.approve(draft);
    const changed = t.service.update(t.human, draft.id, { ...t.input('facebook'), text: 'Texto cambiado.' });
    expect(changed.approval).toBeNull(); expect(changed.fingerprint).not.toBe(draft.fingerprint);
    expect(() => t.service.approve(t.human, draft.id, { fingerprint: draft.fingerprint, externalDisclosure: false })).toThrow();
    await expect(t.service.publish(t.human, draft.id)).rejects.toThrow();
  });
  it('invalida versiones nuevas y revisión documental retirada', async () => {
    const t = setup(); const draft = t.service.create(t.human, t.input()); t.approve(draft); t.source.currentVersion = 2;
    expect(t.service.snapshot(t.human).drafts[0].state).toBe('invalidated'); await expect(t.service.publish(t.human, draft.id)).rejects.toThrow();
    t.source.currentVersion = 1; t.source.accepted = false;
    expect(() => t.approve(draft)).toThrow();
  });
  it('conserva restricciones al derivar y exige autorización explícita de salida de correo', async () => {
    const t = setup(); t.source.provenance.mailboxIds = ['buzon-privado'];
    t.security.seedGrants([{ agentId: 'redactor', mailboxId: 'buzon-privado', capabilities: ['read', 'draft'] }]);
    const draft = t.service.create(t.agent, t.input());
    expect(draft.provenance.mailboxIds).toEqual(['buzon-privado']);
    expect(() => t.approve(draft)).toThrow(); t.approve(draft, true);
    const freshSession = t.security.login('demo-oficina'); const fresh = t.security.authority({ headers: { cookie: `company_session=${freshSession.token}` } });
    expect(t.service.snapshot(fresh).drafts).toHaveLength(0);
    t.security.absorb(fresh, { mailboxIds: ['buzon-privado'], sourceIds: ['mensaje'] });
    expect(t.service.snapshot(fresh).drafts).toHaveLength(1);
    t.security.setGrant(t.human, { agentId: 'redactor', mailboxId: 'buzon-privado', capabilities: [] });
    expect(t.service.snapshot(t.human).drafts[0].approval).toBeNull();
    await expect(t.service.publish(t.human, draft.id)).rejects.toThrow();
  });
  it('no elimina el contexto acumulado al elegir un entregable general', () => {
    const t = setup(); t.security.absorb(t.human, { mailboxIds: ['correo'], sourceIds: ['mensaje'] });
    const asset = t.service.upload(t.human, { filename: 'imagen.jpg', mimeType: 'image/jpeg', dataBase64: jpegFixture() });
    const draft = t.service.create(t.human, t.input('x', [asset.id]));
    expect(asset.provenance.mailboxIds).toEqual(['correo']); expect(draft.provenance.mailboxIds).toEqual(['correo']);
    const other = t.security.issueAgent('sin-acceso').authority; expect(t.service.snapshot(other).drafts).toEqual([]); expect(() => t.service.content(other, asset.id)).toThrow();
  });
  it('programa durable sin duplicar tras reinicio y rechaza doble clic', async () => {
    const t = setup(); const date = new Date(t.clock() + 120_000).toISOString(); const draft = t.service.create(t.human, t.input('x', [], date));
    expect(t.approve(draft).state).toBe('scheduled'); await t.service.close(); const restarted = t.make(); t.advance(120_000);
    await Promise.all([restarted.tick(), restarted.tick()]);
    expect((t.providers.get('demo-x') as DemoSocialProvider).calls).toBe(1);
    await restarted.close(); const twice = t.make(); await twice.tick();
    await Promise.all([twice.publish(t.human, draft.id), twice.publish(t.human, draft.id)]);
    expect((t.providers.get('demo-x') as DemoSocialProvider).calls).toBe(1);
    expect(twice.snapshot(t.human).drafts[0].state).toBe('accepted');
  });
  it('cancela y caduca programados sin intentar publicar', async () => {
    const t = setup(); const date = new Date(t.clock() + 60_000).toISOString(); const one = t.service.create(t.human, t.input('x', [], date)); const two = t.service.create(t.human, t.input('x', [], date));
    t.approve(one); t.approve(two); t.service.cancel(t.human, one.id); t.advance(12 * 60_000); await t.service.tick();
    expect((t.providers.get('demo-x') as DemoSocialProvider).calls).toBe(0);
    expect(t.service.snapshot(t.human).drafts.map(d => d.state)).toEqual(['cancelled', 'invalidated']);
  });
  it('registra intención antes de red y conserva incierto tras corte y reinicio', async () => {
    const t = setup(); const publish = vi.fn(async (input: SocialPublishInput) => {
      const persisted = t.storage.load(() => { throw new Error(); }).drafts[0];
      expect(persisted.state).toBe('sending'); expect(persisted.attemptId).toBeTruthy(); input.beforePublish();
      throw new ProviderFailure(true);
    });
    t.providers.set('demo-x', { verify: async () => ({ accountId: 'demo_x', creatorInfo: null }), publish, reconcile: async () => { throw new Error(); } });
    const draft = t.service.create(t.human, t.input()); t.approve(draft); expect((await t.service.publish(t.human, draft.id)).state).toBe('uncertain');
    await t.service.close(); const restarted = t.make(); await restarted.tick(); await restarted.publish(t.human, draft.id);
    expect(publish).toHaveBeenCalledTimes(1); expect(restarted.snapshot(t.human).drafts[0].finalAttempted).toBe(true);
  });
  it('recupera sending como incierto sin repetir un intento abandonado', async () => {
    const t = setup(); const draft = t.service.create(t.human, t.input()); t.approve(draft); await t.service.close();
    const db = t.storage.load(() => { throw new Error(); }); db.drafts[0].state = 'sending'; db.drafts[0].attemptId = 'intent-before-crash'; t.storage.save(db);
    const restarted = t.make(); await restarted.tick(); expect(restarted.snapshot(t.human).drafts[0].state).toBe('uncertain'); expect((t.providers.get('demo-x') as DemoSocialProvider).calls).toBe(0);
  });
  it('reanuda el contenedor lento de Instagram una sola vez y no repite el intento final ambiguo', async () => {
    const t = setup(); const resume = vi.fn(async (input: SocialPublishInput): Promise<SocialResult> => { input.assertAllowed(); input.beforePublish(); throw new ProviderFailure(true); });
    const provider: SocialProvider = { verify: async () => ({ accountId: 'demo_instagram', creatorInfo: null }), publish: async input => { input.checkpoint('container_1', 'container'); return { state: 'accepted', providerId: 'container_1', phase: 'container' }; }, resume, reconcile: async () => ({ state: 'uncertain', providerId: 'container_1', phase: 'container' }) };
    t.providers.set('demo-instagram', provider); const asset = t.service.upload(t.human, { filename: 'imagen.jpg', mimeType: 'image/jpeg', dataBase64: jpegFixture() });
    const draft = t.service.create(t.human, t.input('instagram', [asset.id])); t.approve(draft); await t.service.publish(t.human, draft.id); await t.service.close();
    const restarted = t.make(); await Promise.all([restarted.tick(), restarted.tick()]); expect(resume).toHaveBeenCalledTimes(1);
    expect(restarted.snapshot(t.human).drafts[0].state).toBe('uncertain');
    await restarted.reconcile(t.human, draft.id); await restarted.tick(); expect(resume).toHaveBeenCalledTimes(1);
  });
  it('rechaza JSON extra, medios inválidos, fecha pasada y privacidad TikTok implícita', () => {
    const t = setup(); expect(() => t.service.create(t.human, { ...t.input(), principal: { kind: 'manager' } })).toThrow();
    expect(() => t.service.upload(t.human, { filename: '../x.jpg', mimeType: 'image/jpeg', dataBase64: jpegFixture() })).toThrow();
    expect(() => t.service.upload(t.human, { filename: 'x.jpg', mimeType: 'image/jpeg', dataBase64: 'PHNjcmlwdD4=' })).toThrow();
    expect(() => t.service.create(t.human, t.input('x', [], new Date(t.clock() - 1).toISOString()))).toThrow();
    const asset = t.service.upload(t.human, { filename: 'video.mp4', mimeType: 'video/mp4', dataBase64: mp4Fixture() });
    const draft = t.service.create(t.human, { ...t.input('tiktok', [asset.id]), options: {} }); expect(() => t.approve(draft)).toThrow();
  });
  it('bloquea almacenes truncados o con referencias manipuladas', async () => {
    const t = setup(); await t.service.close();
    const malformed = t.storage.load(() => { throw new Error(); }); malformed.permissionEpoch = -1; t.storage.save(malformed);
    expect(() => t.make()).toThrow('Almacén');
  });
  it('la URL pública de medios exige aprobación vigente, integridad y permisos en cada lectura', async () => {
    const t = setup(); await t.service.close(); const accounts = demoSocialAccounts().map(a => ({ ...a, publicMediaOrigin: 'https://broker.example.com' }));
    let token = '';
    t.providers.set('demo-instagram', { verify: async () => ({ accountId: 'demo_instagram', creatorInfo: null }), publish: async input => { token = new URL(input.mediaUrl(input.assets[0].id)).pathname.split('/').at(-1)!; input.beforePublish(); input.checkpoint('post', 'post'); return { state: 'accepted', providerId: 'post', phase: 'post' }; }, reconcile: async () => ({ state: 'published', providerId: 'post', phase: 'post' }) });
    const service = new CompanySocialService(t.security, t.storage, accounts, t.providers, () => structuredClone(t.source), t.clock, true);
    resources.at(-1)!.services.push(service);
    const asset = service.upload(t.human, { filename: 'foto.jpg', mimeType: 'image/jpeg', dataBase64: jpegFixture() }); const draft = service.create(t.human, t.input('instagram', [asset.id]));
    service.approve(t.human, draft.id, { fingerprint: draft.fingerprint, externalDisclosure: false }); await service.publish(t.human, draft.id);
    expect(service.publicMedia(token).mimeType).toBe('image/jpeg');
    t.source.currentVersion = 2; expect(() => service.publicMedia(token)).toThrow(); t.source.currentVersion = 1;
    t.advance(60 * 60_000 + 1); expect(() => service.publicMedia(token)).toThrow();
  });
  it('no publica tras revocación durable aunque falle guardar el estado social y se reinicie', async () => {
    const t = setup(); t.source.provenance.mailboxIds = ['buzon'];
    const draft = t.service.create(t.human, t.input('x', [], new Date(t.clock() + 60_000).toISOString())); t.approve(draft, true);
    t.bumpPermissions(); const save = vi.spyOn(t.storage, 'save').mockImplementation(() => { throw new Error('fallo de disco'); });
    expect(() => t.security.setGrant(t.human, { agentId: 'redactor', mailboxId: 'buzon', capabilities: [] })).toThrow('disco');
    save.mockRestore(); await t.service.close(); const restarted = t.make(); t.advance(60_000); await restarted.tick();
    expect(restarted.snapshot(t.human).drafts[0].state).toBe('invalidated'); expect((t.providers.get('demo-x') as DemoSocialProvider).calls).toBe(0);
  });
  it('exporta vídeo y texto aprobados de TikTok para publicación manual y registra evidencia sin afirmar publicado', async () => {
    const t = setup(); const asset = t.service.upload(t.human, { filename: 'pieza.mp4', mimeType: 'video/mp4', dataBase64: mp4Fixture() });
    const draft = t.service.create(t.human, { ...t.input('tiktok', [asset.id]), deliveryMode: 'manual', options: {} });
    expect(() => t.service.exportPackage(t.agent, draft.id)).toThrow(); expect(() => t.service.exportPackage(t.human, draft.id)).toThrow(); t.approve(draft);
    const exported = t.service.exportPackage(t.human, draft.id); expect(exported.files[0]).toMatchObject({ filename: 'pieza.mp4', sha256: asset.sha256, dataBase64: mp4Fixture() }); expect(exported.draft.text).toBe(draft.text); expect(exported.draft.state).toBe('exported');
    expect(t.service.exportPackage(t.human, draft.id).draft.state).toBe('exported');
    await expect(t.service.publish(t.human, draft.id)).rejects.toThrow('manual');
    expect(() => t.service.recordEvidence(t.human, draft.id, { url: 'https://attacker.example/video/123', comment: 'Publicado manualmente.' })).toThrow();
    const evidence = t.service.recordEvidence(t.human, draft.id, { url: 'https://www.tiktok.com/@marca/video/123', comment: 'Publicado manualmente por el responsable.' });
    expect(evidence.state).toBe('manual_recorded'); expect(evidence.manualEvidence?.recordedBy).toBe('responsable'); expect(evidence.providerId).toBeNull(); expect(evidence.attemptId).toBeNull();
    expect(t.service.exportPackage(t.human, draft.id).draft.state).toBe('manual_recorded'); expect((t.providers.get('demo-tiktok') as DemoSocialProvider).calls).toBe(0);
    expect(() => t.service.create(t.human, { ...t.input('tiktok', [asset.id], new Date(t.clock() + 60000).toISOString()), deliveryMode: 'manual' })).toThrow('manual');
  });
});
