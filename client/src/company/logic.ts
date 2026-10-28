import type { CompanySnapshot, CompanyTaskStatus } from '../../../shared/company';
import type { MailDraft } from '../../../shared/mail';

export const TASK_LABELS: Record<CompanyTaskStatus, string> = { pending: 'Pendiente', assigned: 'Asignada', in_progress: 'En curso', in_review: 'En revisión', completed: 'Finalizada', blocked: 'Bloqueada', cancelled: 'Cancelada' };
export const CHANNEL_LABELS = { x: 'X', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
export function readyToRun(taskId: string, state: Pick<CompanySnapshot, 'tasks'>): boolean {
  const task = state.tasks.find((t) => t.id === taskId);
  return !!task && !!task.assigneeId && !['completed', 'cancelled', 'in_progress'].includes(task.status) && task.dependencyIds.every((id) => state.tasks.some((t) => t.id === id && t.status === 'completed'));
}
export const splitLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export function localDate(value: string | null): string { return value ? new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin fecha'; }
export function hasCurrentMailApproval(draft: Pick<MailDraft, 'version' | 'contentHash' | 'status' | 'approval'>, now = Date.now()): boolean {
  return draft.status === 'approved' && draft.approval?.version === draft.version && draft.approval.contentHash === draft.contentHash && Date.parse(draft.approval.expiresAt) > now;
}
