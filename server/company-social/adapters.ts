import type { SocialCreatorInfo, SocialDraft } from '../../shared/companySocial.ts';
import type { SocialAccountConfig } from './config.ts';
import { ProviderFailure, type SocialFetch, type SocialProvider, type SocialPublishInput, type SocialResult } from './provider.ts';

const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ProviderFailure(true); return v as Record<string, unknown>; };
const identifier = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-zA-Z0-9_~.:-]{1,200}$/.test(v)) throw new ProviderFailure(true); return v; };
const string = (v: unknown): string => { if (typeof v !== 'string' || v.length > 500) throw new ProviderFailure(true); return v; };
async function boundedJson(response: Response) {
  if (Number(response.headers.get('content-length')) > 262144) throw new ProviderFailure(true);
  const reader = response.body?.getReader(); if (!reader) throw new ProviderFailure(true);
  let bytes = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 262144) { await reader.cancel(); throw new ProviderFailure(true); } chunks.push(item.value); } return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new ProviderFailure(true); } finally { reader.releaseLock(); }
}

/** Fixed provider hosts; redirects are never followed and provider errors never reach the browser. */
export class ApiSocialProvider implements SocialProvider {
  constructor(private config: SocialAccountConfig, private request: SocialFetch = fetch, private wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1000))) {}
  private async call(host: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await this.request(`https://${host}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${this.config.accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new ProviderFailure(true); }
    if (!response.ok) throw new ProviderFailure(response.status >= 500 || response.status >= 300 && response.status < 400);
    const json = await boundedJson(response); if (json.error && object(json.error).code !== 'ok') throw new ProviderFailure(false); return json;
  }
  private graph(path: string, body?: unknown) { return this.call(this.config.channel === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com', `/${this.config.apiVersion}${path}`, body); }
  private tik(path: string, body: unknown) { return this.call('open.tiktokapis.com', `/v2${path}`, body); }
  async verify() {
    if (this.config.channel === 'x') { const data = object((await this.call('api.x.com', '/2/users/me')).data); return { accountId: identifier(data.id), creatorInfo: null }; }
    if (this.config.channel === 'instagram') { const data = await this.graph('/me?fields=user_id,username'); return { accountId: identifier(data.user_id), creatorInfo: null }; }
    if (this.config.channel === 'facebook') { const data = await this.graph('/me?fields=id,name'); return { accountId: identifier(data.id), creatorInfo: null }; }
    const user = object(object((await this.call('open.tiktokapis.com', '/v2/user/info/?fields=open_id,display_name')).data).user);
    const data = object((await this.tik('/post/publish/creator_info/query/', {})).data);
    if (!Array.isArray(data.privacy_level_options) || data.privacy_level_options.some(v => typeof v !== 'string') || typeof data.max_video_post_duration_sec !== 'number' || !Number.isFinite(data.max_video_post_duration_sec) || ['comment_disabled', 'duet_disabled', 'stitch_disabled'].some(key => typeof data[key] !== 'boolean')) throw new ProviderFailure(true);
    const creatorInfo: SocialCreatorInfo = { username: string(data.creator_username), privacyOptions: data.privacy_level_options as string[], commentDisabled: data.comment_disabled as boolean, duetDisabled: data.duet_disabled as boolean, stitchDisabled: data.stitch_disabled as boolean, maxDurationSeconds: data.max_video_post_duration_sec, checkedAt: new Date().toISOString() };
    return { accountId: identifier(user.open_id), creatorInfo };
  }
  async publish(input: SocialPublishInput): Promise<SocialResult> {
    const { draft, assets, checkpoint, assertAllowed } = input;
    const account = encodeURIComponent(this.config.providerAccountId);
    assertAllowed();
    if (draft.channel === 'x') {
      const media: string[] = [];
      for (const asset of assets) { assertAllowed(); const data = object((await this.call('api.x.com', '/2/media/upload', { media: asset.dataBase64, media_category: 'tweet_image' })).data); media.push(identifier(data.id)); }
      assertAllowed(); input.beforePublish();
      const data = object((await this.call('api.x.com', '/2/tweets', { text: draft.text, ...(media.length ? { media: { media_ids: media } } : {}), made_with_ai: draft.options.aiGenerated })).data);
      const id = identifier(data.id); checkpoint(id, 'post'); return { state: 'accepted', providerId: id, phase: 'post' };
    }
    if (draft.channel === 'facebook') {
      input.beforePublish();
      let data: Record<string, unknown>;
      if (assets.length) {
        const form = new FormData(); form.set('source', new Blob([Uint8Array.from(Buffer.from(assets[0].dataBase64, 'base64'))], { type: 'image/jpeg' }), assets[0].filename); form.set('caption', draft.text); form.set('published', 'true');
        let response: Response;
        try { response = await this.request(`https://graph.facebook.com/${this.config.apiVersion}/${account}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${this.config.accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(30_000), body: form }); } catch { throw new ProviderFailure(true); }
        if (!response.ok) throw new ProviderFailure(response.status >= 500);
        data = await boundedJson(response);
      } else data = await this.graph(`/${account}/feed`, { message: draft.text });
      const id = identifier(data.post_id ?? data.id); checkpoint(id, 'post'); return { state: 'accepted', providerId: id, phase: 'post' };
    }
    if (draft.channel === 'instagram') {
      const container = identifier((await this.graph(`/${account}/media`, { image_url: input.mediaUrl(assets[0].id), caption: draft.text, is_ai_generated: draft.options.aiGenerated })).id);
      checkpoint(container, 'container');
      return this.resume({ ...input, draft: { ...draft, providerId: container, providerPhase: 'container' } });
    }
    // The approval includes an explicit privacy choice and every interaction/commercial disclosure.
    const options = draft.options;
    const asset = assets[0];
    const mediaUrl = new URL(input.mediaUrl(asset.id));
    if (!this.config.mediaDomainVerified || !this.config.publicMediaOrigin || mediaUrl.origin !== new URL(this.config.publicMediaOrigin).origin || !/^\/api\/company\/social\/media\/[A-Za-z0-9_-]{1,100}$/.test(mediaUrl.pathname) || mediaUrl.username || mediaUrl.password || mediaUrl.search || mediaUrl.hash) throw new ProviderFailure(false);
    input.beforePublish();
    const data = object((await this.tik('/post/publish/video/init/', { post_info: { title: draft.text, privacy_level: options.privacy, disable_comment: options.disableComment, disable_duet: options.disableDuet, disable_stitch: options.disableStitch, brand_content_toggle: options.brandContent, brand_organic_toggle: options.brandOrganic, is_aigc: options.aiGenerated }, source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl.href } })).data);
    const id = identifier(data.publish_id); checkpoint(id, 'post');
    return { state: 'accepted', providerId: id, phase: 'post' };
  }
  async resume(input: SocialPublishInput): Promise<SocialResult> {
    if (input.draft.channel !== 'instagram' || input.draft.finalAttempted || input.draft.providerPhase !== 'container') throw new ProviderFailure(true);
    const container = identifier(input.draft.providerId);
    for (let attempt = 0; attempt < 5; attempt++) {
      input.assertAllowed();
      const status = await this.graph(`/${encodeURIComponent(container)}?fields=status_code`);
      if (status.status_code === 'FINISHED') {
        input.assertAllowed(); input.beforePublish();
        const id = identifier((await this.graph(`/${encodeURIComponent(this.config.providerAccountId)}/media_publish`, { creation_id: container })).id);
        input.checkpoint(id, 'post'); return { state: 'accepted', providerId: id, phase: 'post' };
      }
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') return { state: 'failed', providerId: container, phase: 'container', reason: 'El proveedor rechazó el medio.' };
      await this.wait();
    }
    return { state: 'accepted', providerId: container, phase: 'container', reason: 'Medio en preparación. Se continuará con la aprobación vigente cuando el contenedor esté listo.' };
  }
  async reconcile(draft: SocialDraft): Promise<SocialResult> {
    const id = identifier(draft.providerId);
    if (draft.channel === 'tiktok') {
      const data = object((await this.tik('/post/publish/status/fetch/', { publish_id: id })).data);
      if (!['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED'].includes(String(data.status))) throw new ProviderFailure(true);
      const state = data.status === 'PUBLISH_COMPLETE' ? 'published' : data.status === 'FAILED' ? 'failed' : 'accepted';
      return { state, providerId: id, phase: 'post' };
    }
    if (draft.channel === 'instagram' && draft.providerPhase === 'container') {
      const data = await this.graph(`/${encodeURIComponent(id)}?fields=status_code`);
      return { state: data.status_code === 'PUBLISHED' ? 'published' : ['ERROR', 'EXPIRED'].includes(String(data.status_code)) ? 'failed' : 'uncertain', providerId: id, phase: 'container' };
    }
    const data = draft.channel === 'x' ? object((await this.call('api.x.com', `/2/tweets/${encodeURIComponent(id)}`)).data) : await this.graph(`/${encodeURIComponent(id)}?fields=id`);
    if (identifier(data.id) !== id) throw new ProviderFailure(true);
    return { state: 'published', providerId: id, phase: 'post' };
  }
}

export class DemoSocialProvider implements SocialProvider {
  calls = 0;
  constructor(private accountId: string) {}
  async verify() { return { accountId: this.accountId, creatorInfo: { username: 'cuenta_demo', privacyOptions: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'], commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSeconds: 60, checkedAt: new Date().toISOString() } }; }
  async publish(input: SocialPublishInput): Promise<SocialResult> { input.assertAllowed(); input.beforePublish(); this.calls++; const id = `demo_${input.draft.id}`; input.checkpoint(id, 'post'); return { state: 'accepted', providerId: id, phase: 'post', reason: 'SIMULACIÓN DEMO: aceptado por el proveedor simulado.' }; }
  async reconcile(draft: SocialDraft): Promise<SocialResult> { return { state: 'published', providerId: draft.providerId!, phase: 'post', reason: 'SIMULACIÓN DEMO: publicación simulada confirmada.' }; }
}
