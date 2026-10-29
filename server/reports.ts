// Analysis reports: what an agent found on an issue labelled swarm:analysis (shared/issues.ts). The office keeps the
// latest ones so the manager reads them in the panel and can hand one to the CEO; the issue gets it as a comment.

import type { ReportView } from '../shared/types.ts';

export interface Report {
  id: string;
  repoId: string;
  issue: number;
  title: string;
  agentName: string;
  at: number;
  text: string;
}

/** Reports kept, across every floor. */
export const MAX_REPORTS = 40;
/** A report's length as kept (and as posted on GitHub, which takes comments up to 65,536 characters). */
export const MAX_REPORT_CHARS = 30_000;
const EXCERPT_CHARS = 280;

export const reportId = (repoId: string, issue: number) => `${repoId}#${issue}`;

/** The report as kept: trimmed and clipped. '' when the agent said nothing. */
export function cleanReport(text: string): string {
  const t = text.trim();
  return t.length > MAX_REPORT_CHARS ? `${t.slice(0, MAX_REPORT_CHARS)}\n\n… (informe recortado)` : t;
}

/** The list with `r` in front: a new analysis of the same issue replaces its last report. */
export function addReport(list: readonly Report[], r: Report): Report[] {
  return [r, ...list.filter((x) => x.id !== r.id)].slice(0, MAX_REPORTS);
}

export function reportView(r: Report): ReportView {
  const flat = r.text.replace(/\s+/g, ' ').trim();
  return {
    id: r.id,
    repoId: r.repoId,
    issue: r.issue,
    title: r.title,
    agentName: r.agentName,
    at: r.at,
    excerpt: flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat,
  };
}

/** Reports from a saved state, the malformed ones dropped. */
export function loadReports(raw: unknown): Report[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Report => !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.repoId === 'string' && Number.isInteger(r.issue) && typeof r.text === 'string')
    .map((r) => ({ ...r, title: String(r.title ?? ''), agentName: String(r.agentName ?? ''), at: Number(r.at) || 0 }))
    .slice(0, MAX_REPORTS);
}

/** The comment that closes the issue on GitHub. */
export const reportComment = (r: Pick<Report, 'agentName' | 'text'>) => `## Informe de análisis\n\nPor ${r.agentName} (sareoffice).\n\n${r.text}`;
