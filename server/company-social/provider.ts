import type { SocialAsset, SocialCreatorInfo, SocialDraft } from '../../shared/companySocial.ts';

export interface SocialResult { state: 'accepted' | 'published' | 'failed' | 'uncertain'; providerId: string; phase: 'container' | 'post'; reason?: string }
export interface SocialPublishInput { draft: SocialDraft; assets: (SocialAsset & { dataBase64: string })[]; mediaUrl(assetId: string): string; checkpoint(id: string, phase: 'container' | 'post'): void; beforePublish(): void; assertAllowed(): void }
export interface SocialProvider {
  verify(): Promise<{ accountId: string; creatorInfo: SocialCreatorInfo | null }>;
  publish(input: SocialPublishInput): Promise<SocialResult>;
  reconcile(draft: SocialDraft): Promise<SocialResult>;
  resume?(input: SocialPublishInput): Promise<SocialResult>;
}
export class ProviderFailure extends Error { constructor(readonly uncertain: boolean) { super('El proveedor no confirmó la operación.'); } }
export type SocialFetch = typeof fetch;
