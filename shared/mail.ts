import type { MailGrant, Provenance } from './companySecurity';

export interface Mailbox {
  id: string;
  name: string;
  address: string;
  provider: 'graph' | 'imap';
  enabled: boolean;
  permissionVersion: number;
  folders: string[];
}

export interface MailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  quarantined: boolean;
}

export interface MailMessage {
  id: string;
  mailboxId: string;
  providerId: string;
  conversationId: string;
  internetMessageId?: string;
  replyTo?: string[];
  folder: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  receivedAt: string;
  read: boolean;
  attachments: MailAttachment[];
  provenance: Provenance;
}

export interface MailContent {
  mailboxId: string;
  messageId?: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachmentIds: string[];
}

export type MailDraftStatus = 'draft' | 'approved' | 'sending' | 'accepted' | 'uncertain' | 'failed' | 'cancelled';
export interface MailDraft extends MailContent {
  /** Immutable source Message-ID, resolved by the broker when this reply is created. */
  replyMessageId?: string;
  id: string;
  version: number;
  contentHash: string;
  status: MailDraftStatus;
  provenance: Provenance;
  createdBy: string;
  permissionVersion: number;
  approval?: { managerId: string; version: number; contentHash: string; expiresAt: string };
  attemptId?: string;
  providerReceipt?: string;
  acceptedRecipients?: string[];
  rejectedRecipients?: string[];
  outcome?: string;
  attachments?: MailAttachment[];
}

export interface MailIntegration {
  provider: 'graph' | 'imap';
  mode: 'simulated' | 'blocked' | 'configured' | 'connected';
  label: string;
}

export interface MailState {
  mailboxes: Mailbox[];
  messages: MailMessage[];
  drafts: MailDraft[];
  grants: MailGrant[];
  integrations: MailIntegration[];
}
