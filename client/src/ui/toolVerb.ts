// What an agent is doing, in a word, from the tool they're running (the terminal panel and pocket mode's team cards).

export function toolVerb(tool: string | null): string {
  if (!tool) return '';
  if (tool.startsWith('mcp__playwright__')) return 'Navegando';
  if (tool === 'Bash' || tool === 'PowerShell') return 'Ejecutando';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return 'Editando';
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'Leyendo';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Investigando';
  return tool;
}
