import { describe, expect, it } from 'vitest';
import { analysisSystemPrompt } from './prompts.ts';
import { addReport, cleanReport, loadReports, MAX_REPORT_CHARS, MAX_REPORTS, reportId, reportView, type Report } from './reports.ts';

const report = (issue: number, text = `Informe ${issue}`): Report => ({ id: reportId('r1', issue), repoId: 'r1', issue, title: `Tema ${issue}`, agentName: 'Margaret', at: issue, text });

describe('analysis reports', () => {
  it('keeps the newest first, one per issue, up to the limit', () => {
    let list: Report[] = [];
    for (let i = 1; i <= MAX_REPORTS + 3; i++) list = addReport(list, report(i));
    expect(list).toHaveLength(MAX_REPORTS);
    expect(list[0].issue).toBe(MAX_REPORTS + 3);
    list = addReport(list, report(10, 'Otra vuelta'));
    expect(list[0]).toMatchObject({ issue: 10, text: 'Otra vuelta' });
    expect(list.filter((r) => r.issue === 10)).toHaveLength(1);
  });

  it('clips a long report and shows a one-line excerpt', () => {
    expect(cleanReport('  \n ')).toBe('');
    expect(cleanReport('x'.repeat(MAX_REPORT_CHARS + 10))).toMatch(/informe recortado\)$/);
    const view = reportView(report(1, `# Título\n\n${'palabra '.repeat(100)}`));
    expect(view.excerpt).not.toContain('\n');
    expect(view.excerpt.length).toBeLessThanOrEqual(280);
    expect(view).not.toHaveProperty('text');
  });

  it('tells the analyst to report without touching the repository', () => {
    const text = analysisSystemPrompt({ agent: { name: 'Margaret' }, repo: { fullName: 'acme/shop', defaultBranch: 'main', autoMerge: true, browserTesting: false, summary: '', mission: '', qaBrief: '' }, cwd: '/desk', linked: [] });
    expect(text).toMatch(/no modifiques ficheros/);
    expect(text).toMatch(/no abras pull requests/);
    expect(text).toMatch(/mensaje final es el informe/);
  });

  it('loads only well-formed saved reports', () => {
    expect(loadReports(undefined)).toEqual([]);
    expect(loadReports([report(1), { id: 'x' }, null, { ...report(2), issue: 'dos' }])).toEqual([report(1)]);
  });
});
