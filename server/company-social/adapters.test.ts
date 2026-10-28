import { describe, expect, it, vi } from 'vitest';
import type { SocialDraft, SocialAsset } from '../../shared/companySocial.ts';
import { ApiSocialProvider } from './adapters.ts';
import { accountView, socialAccountConfigSchema, type SocialAccountConfig } from './config.ts';
import type { SocialPublishInput } from './provider.ts';
import { inspectMedia } from './media.ts';

const config = (channel: SocialAccountConfig['channel']) => socialAccountConfigSchema.parse({ id: 'account', label: 'Cuenta corporativa', channel, providerAccountId: '123', accessToken: 'SECRET_TOKEN_FOR_MOCK_ONLY', expiresAt: '2099-01-01T00:00:00.000Z', scopes: [], appReviewed: true, enabled: true, publicMediaOrigin: 'https://broker.example.com', mediaDomainVerified: true });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function input(channel: SocialAccountConfig['channel'], media = true): SocialPublishInput {
  const asset: SocialAsset & { dataBase64: string } = { id: 'asset', filename: channel === 'tiktok' ? 'video.mp4' : 'foto.jpg', mimeType: channel === 'tiktok' ? 'video/mp4' : 'image/jpeg', size: 3, sha256: 'a'.repeat(64), durationSeconds: channel === 'tiktok' ? 5 : null, provenance: { mailboxIds: [], sourceIds: [] }, createdAt: '2026-10-20T10:00:00.000Z', dataBase64: 'AQID' };
  const draft: SocialDraft = { id: 'draft', accountId: 'account', channel, deliveryMode: 'api', deliverableId: 'document', version: 1, deliverableHash: 'b'.repeat(64), text: 'Texto aprobado', assetIds: media ? ['asset'] : [], options: { privacy: channel === 'tiktok' ? 'SELF_ONLY' : null, disableComment: true, disableDuet: true, disableStitch: true, brandContent: false, brandOrganic: false, aiGenerated: true }, scheduledAt: null, provenance: { mailboxIds: [], sourceIds: [] }, fingerprint: 'c'.repeat(64), state: 'sending', approval: null, attemptId: 'attempt', finalAttempted: false, providerId: null, providerPhase: null, manualEvidence: null, reason: null, createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:00:00.000Z' };
  return { draft, assets: media ? [asset] : [], mediaUrl: () => 'https://broker.example.com/api/company/social/media/TOKEN', checkpoint: vi.fn(), beforePublish: vi.fn(), assertAllowed: vi.fn() };
}

describe('adaptadores sociales sin red real', () => {
  it('X verifica identidad, sube JPEG y publica referencias de medios con OAuth2', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ data: { id: '123' } })).mockResolvedValueOnce(response({ data: { id: 'media1' } })).mockResolvedValueOnce(response({ data: { id: 'post1' } })).mockResolvedValueOnce(response({ data: { id: 'post1' } }));
    const provider = new ApiSocialProvider(config('x'), request); expect((await provider.verify()).accountId).toBe('123');
    const post = input('x'); expect((await provider.publish(post)).state).toBe('accepted');
    expect(request.mock.calls[1][0]).toBe('https://api.x.com/2/media/upload'); expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ media: 'AQID', media_category: 'tweet_image' });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({ text: 'Texto aprobado', media: { media_ids: ['media1'] }, made_with_ai: true }); expect(post.beforePublish).toHaveBeenCalledTimes(1);
    expect((await provider.reconcile({ ...post.draft, providerId: 'post1', providerPhase: 'post' })).state).toBe('published');
    expect(request.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true);
  });
  it('Facebook usa feed para texto y multipart para bytes JPEG sin URLs externas', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: '123' })).mockResolvedValueOnce(response({ id: 'post_text' })).mockResolvedValueOnce(response({ id: 'photo1', post_id: '123_post1' }));
    const provider = new ApiSocialProvider(config('facebook'), request); await provider.verify(); await provider.publish(input('facebook', false)); await provider.publish(input('facebook'));
    expect(request.mock.calls[1][0]).toBe('https://graph.facebook.com/v26.0/123/feed'); expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ message: 'Texto aprobado' });
    const form = request.mock.calls[2][1]?.body as FormData; expect(form).toBeInstanceOf(FormData); expect(form.get('source')).toBeInstanceOf(Blob); expect(form.get('caption')).toBe('Texto aprobado'); expect(form.has('url')).toBe(false);
  });
  it('Instagram persiste contenedor y la intención final antes de media_publish', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ user_id: '123', username: 'marca' })).mockResolvedValueOnce(response({ id: 'container1' })).mockResolvedValueOnce(response({ status_code: 'FINISHED' })).mockResolvedValueOnce(response({ id: 'media1' }));
    const provider = new ApiSocialProvider(config('instagram'), request, async () => {}); await provider.verify(); const post = input('instagram');
    const events: string[] = []; post.checkpoint = (id, phase) => events.push(`${phase}:${id}`); post.beforePublish = () => events.push('intent');
    const output = await provider.publish(post); expect(output).toEqual({ state: 'accepted', providerId: 'media1', phase: 'post' }); expect(events).toEqual(['container:container1', 'intent', 'post:media1']);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({ image_url: 'https://broker.example.com/api/company/social/media/TOKEN', caption: 'Texto aprobado', is_ai_generated: true });
    expect(request.mock.calls[3][0]).toBe('https://graph.instagram.com/v26.0/123/media_publish'); expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({ creation_id: 'container1' });
  });
  it('Instagram lento devuelve accepted container; reanuda sin recrear el contenedor', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: 'container1' }));
    for (let n = 0; n < 5; n++) request.mockResolvedValueOnce(response({ status_code: 'IN_PROGRESS' }));
    request.mockResolvedValueOnce(response({ status_code: 'FINISHED' })).mockResolvedValueOnce(response({ id: 'media1' }));
    const provider = new ApiSocialProvider(config('instagram'), request, async () => {}); const post = input('instagram');
    expect(await provider.publish(post)).toMatchObject({ state: 'accepted', phase: 'container' }); expect(post.beforePublish).not.toHaveBeenCalled();
    expect(await provider.resume({ ...post, draft: { ...post.draft, providerId: 'container1', providerPhase: 'container' } })).toMatchObject({ state: 'accepted', phase: 'post' });
    expect(request.mock.calls.filter(call => String(call[0]).endsWith('/123/media'))).toHaveLength(1);
    await expect(provider.resume({ ...post, draft: { ...post.draft, providerId: 'container1', providerPhase: 'container', finalAttempted: true } })).rejects.toThrow();
  });
  it('el cierre durante una consulta pendiente evita nuevos sondeos y la publicación final', async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; }));
    const provider = new ApiSocialProvider(config('instagram'), request, async () => {});
    const post = input('instagram');
    let stopped = false;
    post.assertAllowed = () => { if (stopped) throw new Error('Servicio en cierre'); };
    const pending = provider.resume({ ...post, draft: { ...post.draft, providerId: 'container1', providerPhase: 'container' } });
    stopped = true;
    finish(response({ status_code: 'IN_PROGRESS' }));
    await expect(pending).rejects.toThrow('cierre');
    expect(request).toHaveBeenCalledTimes(1);
    expect(post.beforePublish).not.toHaveBeenCalled();
  });
  it('TikTok consulta creador y usa URL de dominio propio verificado; adaptador permanece bloqueado en la oficina real', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ data: { user: { open_id: '123' } }, error: { code: 'ok' } })).mockResolvedValueOnce(response({ data: { creator_username: 'marca', privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 60 }, error: { code: 'ok' } })).mockResolvedValueOnce(response({ data: { publish_id: 'v_post~123' }, error: { code: 'ok' } })).mockResolvedValueOnce(response({ data: { status: 'PROCESSING_DOWNLOAD' }, error: { code: 'ok' } })).mockResolvedValueOnce(response({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }));
    const provider = new ApiSocialProvider(config('tiktok'), request); expect((await provider.verify()).creatorInfo?.privacyOptions).toEqual(['SELF_ONLY']); const post = input('tiktok');
    expect((await provider.publish(post)).state).toBe('accepted');
    const init = JSON.parse(String(request.mock.calls[2][1]?.body)); expect(init.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: 'https://broker.example.com/api/company/social/media/TOKEN' }); expect(init.post_info).toMatchObject({ privacy_level: 'SELF_ONLY', brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true });
    expect(request.mock.calls.every(call => new URL(String(call[0])).hostname === 'open.tiktokapis.com')).toBe(true);
    const attempted = { ...post.draft, providerId: 'v_post~123', providerPhase: 'post' as const }; expect((await provider.reconcile(attempted)).state).toBe('accepted'); expect((await provider.reconcile(attempted)).state).toBe('published');
  });
  it.each(['http://127.0.0.1/video/', 'https://attacker.example/video/', 'https://broker.example.com.attacker.example/video/', 'https://broker.example.com:8443/video/', 'https://user:pass@broker.example.com/api/company/social/media/TOKEN'])('rechaza URL de medios TikTok ajena %s sin enviar bytes o token', async url => {
    const request = vi.fn<typeof fetch>();
    await expect(new ApiSocialProvider(config('tiktok'), request).publish({ ...input('tiktok'), mediaUrl: () => url })).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it('TikTok no sigue redirects ni utiliza una URL de subida devuelta por un proveedor', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } }));
    await expect(new ApiSocialProvider(config('tiktok'), request).publish(input('tiktok'))).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1]?.redirect).toBe('error');
  });
  it.each([429, 500, 503])('un error HTTP %s no repite la petición', async status => { const request = vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'SECRET_TOKEN_FOR_MOCK_ONLY' }, status)); await expect(new ApiSocialProvider(config('x'), request).publish(input('x', false))).rejects.toThrow('El proveedor no confirmó'); expect(request).toHaveBeenCalledTimes(1); });
  it('rechaza cuerpo enorme, JSON incompleto y estado proveedor desconocido', async () => {
    const enormous = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(262145))); await expect(new ApiSocialProvider(config('x'), enormous).verify()).rejects.toThrow();
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(response({ data: {} })); await expect(new ApiSocialProvider(config('x'), malformed).publish(input('x', false))).rejects.toThrow();
    const unknown = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { status: 'inventado' }, error: { code: 'ok' } })); await expect(new ApiSocialProvider(config('tiktok'), unknown).reconcile({ ...input('tiktok').draft, providerId: 'post' })).rejects.toThrow();
  });
  it('rechaza contenedores y tipos de medios manipulados y configuración SSRF', () => {
    expect(() => inspectMedia('video/mp4', 'AQID')).toThrow(); expect(() => inspectMedia('image/jpeg', Buffer.from('<html>no image</html>').toString('base64'))).toThrow(); expect(() => inspectMedia('image/jpeg', 'AAAA===')).toThrow();
    for (const publicMediaOrigin of ['http://127.0.0.1', 'https://127.0.0.1', 'https://localhost', 'https://foo.local', 'https://broker.example.com/path', 'https://user:pass@broker.example.com']) expect(() => socialAccountConfigSchema.parse({ ...config('instagram'), publicMediaOrigin })).toThrow();
  });
  it('appReviewed y dominio verificado no habilitan TikTok automático para la herramienta interna', () => { const account = { ...config('tiktok'), scopes: ['video.publish', 'user.info.basic'] }; expect(accountView(account)).toMatchObject({ status: 'blocked', reason: expect.stringContaining('herramienta interna') }); });
});
