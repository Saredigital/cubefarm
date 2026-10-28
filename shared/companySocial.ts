import type { SocialChannel } from './company';
import type { Provenance } from './companySecurity';

export type SocialStatus = 'draft' | 'approved' | 'scheduled' | 'sending' | 'accepted' | 'published' | 'failed' | 'uncertain' | 'cancelled' | 'invalidated' | 'exported' | 'manual_recorded';
export interface SocialCreatorInfo { username: string; privacyOptions: string[]; commentDisabled: boolean; duetDisabled: boolean; stitchDisabled: boolean; maxDurationSeconds: number; checkedAt: string }
export interface SocialAccount { id: string; label: string; channel: SocialChannel; providerAccountId: string; enabled: boolean; permissionVersion: string; status: 'demo' | 'blocked' | 'ready'; reason: string | null; verifiedAt: string | null; creatorInfo: SocialCreatorInfo | null }
export interface SocialAsset { id: string; filename: string; mimeType: 'image/jpeg' | 'video/mp4'; size: number; sha256: string; durationSeconds: number | null; provenance: Provenance; createdAt: string }
export interface SocialPostOptions { privacy: string | null; disableComment: boolean; disableDuet: boolean; disableStitch: boolean; brandContent: boolean; brandOrganic: boolean; aiGenerated: boolean }
export interface SocialApproval { fingerprint: string; approverId: string; approvedAt: string; expiresAt: string; permissionEpoch: number; externalDisclosure: boolean }
export interface SocialDraft { id: string; accountId: string; channel: SocialChannel; deliveryMode: 'api' | 'manual'; deliverableId: string; version: number; deliverableHash: string; text: string; assetIds: string[]; options: SocialPostOptions; scheduledAt: string | null; provenance: Provenance; fingerprint: string; state: SocialStatus; approval: SocialApproval | null; attemptId: string | null; finalAttempted: boolean; providerId: string | null; providerPhase: 'container' | 'post' | null; manualEvidence: { url: string; comment: string; recordedBy: string; recordedAt: string } | null; reason: string | null; createdAt: string; updatedAt: string }
export interface SocialSnapshot { mode: 'demo' | 'isolated' | 'blocked'; accounts: SocialAccount[]; assets: SocialAsset[]; drafts: SocialDraft[] }
export interface SocialDraftInput { accountId: string; deliveryMode?: 'api' | 'manual'; deliverableId: string; version: number; text: string; assetIds: string[]; scheduledAt?: string | null; options?: Partial<SocialPostOptions> }
