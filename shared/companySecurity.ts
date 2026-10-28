/** Company data never travels through the public office snapshot. */
export interface Provenance {
  mailboxIds: string[];
  sourceIds: string[];
}

export interface CompanyPrincipal {
  id: string;
  kind: 'manager' | 'agent';
  agentId?: string;
}

export interface CompanyAuthority {
  readonly principal: CompanyPrincipal;
  readonly provenance: Provenance;
}

export type MailCapability = 'read' | 'organize' | 'draft';
export interface MailGrant {
  agentId: string;
  mailboxId: string;
  capabilities: MailCapability[];
}

export interface CompanySecurityStatus {
  mode: 'demo' | 'blocked' | 'isolated' | 'local';
  liveAvailable: boolean;
  reason: string;
  authenticated: boolean;
  csrfToken?: string;
  demoPassword?: string;
}

export function combineProvenance(...sources: Provenance[]): Provenance {
  return {
    mailboxIds: [...new Set(sources.flatMap(source => source.mailboxIds))].sort(),
    sourceIds: [...new Set(sources.flatMap(source => source.sourceIds))].sort(),
  };
}
