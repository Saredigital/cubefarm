// Company work contracts; restricted content travels only through authenticated company routes.
export interface CompanyProvenance { mailboxIds: string[]; sourceIds: string[] }
export interface CompanyPrincipal { id: string; kind: 'manager' | 'agent'; agentId?: string }
export type CompanyTaskStatus = 'pending' | 'assigned' | 'in_progress' | 'in_review' | 'completed' | 'blocked' | 'cancelled';
export type CompanyWorkflow = 'marketing' | 'business' | 'operations';
export type SocialChannel = 'x' | 'instagram' | 'facebook' | 'tiktok';
export interface CompanyDepartment { id: string; name: string; mission: string; managerId: string | null; floor: number; order: number; archived: boolean }
export interface CompanyProject { id: string; name: string; objective: string; departmentIds: string[]; repositoryIds: string[]; status: 'active' | 'completed' | 'archived'; provenance: CompanyProvenance }
export interface SpecialistProfile { id: string; name: string; specialty: string; instructions: string; capabilities: string[]; qualityCriteria: string[]; maxConcurrentTasks: number; budgetEuros: number }
export interface CompanyAgent { id: string; name: string; departmentId: string; profileId: string; model: string; enabled: boolean; spentEuros: number }
export interface CompanyTask { id: string; title: string; objective: string; projectId: string | null; departmentId: string; assigneeId: string | null; collaboratorIds: string[]; priority: 'low' | 'normal' | 'high' | 'urgent'; dueAt: string | null; dependencyIds: string[]; completionCriteria: string; status: CompanyTaskStatus; provenance: CompanyProvenance; createdAt: string; updatedAt: string; runId: string | null; externalReference: string | null }
export interface CompanyComment { id: string; taskId: string; authorId: string; text: string; createdAt: string; provenance: CompanyProvenance }
export interface DeliverableVersion { version: number; title: string; content: string; authorId: string; createdAt: string; provenance: CompanyProvenance }
export interface CompanyDeliverable { id: string; taskId: string; kind: 'document' | 'proposal' | 'social_content' | 'report' | 'code' | 'email_draft'; versions: DeliverableVersion[] }
export interface CompanyReview { id: string; deliverableId: string; version: number; reviewerId: string; decision: 'accepted' | 'changes_requested' | 'rejected'; comment: string; createdAt: string; provenance: CompanyProvenance }
export interface CompanyKnowledge { id: string; title: string; category: 'services' | 'procedures' | 'brand' | 'general'; versions: DeliverableVersion[] }
export interface CompanyContact { id: string; name: string; organisation: string; email: string; provenance: CompanyProvenance }
export interface CompanyOpportunity { id: string; contactId: string; name: string; stage: 'new' | 'qualified' | 'proposal' | 'won' | 'lost'; valueEuros: number; nextAction: string; nextActionAt: string | null; projectId: string | null; provenance: CompanyProvenance }
export interface CompanyCalendarEntry { id: string; projectId: string; taskId: string; channel: SocialChannel; scheduledAt: string | null; state: 'draft' | 'in_review' | 'approved' | 'published'; provenance: CompanyProvenance }
export interface CompanyRun { id: string; taskId: string; agentId: string; state: 'running' | 'completed' | 'cancelled' | 'failed'; mode: 'demo' | 'restricted'; startedAt: string; finishedAt: string | null; costEuros: number; reservedCostEuros: number; error: string | null; provenance: CompanyProvenance }
export interface CompanyState { schemaVersion: 1; revision: number; company: { name: string; objective: string }; departments: CompanyDepartment[]; projects: CompanyProject[]; profiles: SpecialistProfile[]; agents: CompanyAgent[]; tasks: CompanyTask[]; comments: CompanyComment[]; deliverables: CompanyDeliverable[]; reviews: CompanyReview[]; knowledge: CompanyKnowledge[]; contacts: CompanyContact[]; opportunities: CompanyOpportunity[]; calendar: CompanyCalendarEntry[]; runs: CompanyRun[]; migration: { importedAt: string; legacyRepos: number; legacyAgents: number; legacyTasks: number; legacyHistory: number; source: string } | null }
export interface CompanyMetrics { pending: number; blocked: number; overdue: number; inReview: number; approvedDeliverables: number; spentEuros: number; opportunities: number }
/** General metadata only. Task titles and derived counts are excluded from public office screens. */
export interface CompanyPublicView { name: string; departments: CompanyDepartment[]; agents: Pick<CompanyAgent, 'id' | 'name' | 'departmentId' | 'profileId'>[]; deploymentMode?: 'local' }
export interface CompanySnapshot extends CompanyState { metrics: CompanyMetrics; runtime: { mode: 'demo' | 'restricted' | 'blocked'; reason: string | null } }
