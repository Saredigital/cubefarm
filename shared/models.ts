import type { AgentCli } from './types.ts';

// Which model an agent's session asks for. The office's default model belongs to its default coding agent, and each
// worker can name their own; a model only goes to an agent that understands it (no Claude model for Codex).

/** Claude Code's model names and aliases. */
export const isClaudeModel = (model: string) => /^(claude|opus|sonnet|haiku|fable|default|best|opusplan)\b/i.test(model.trim());

/**
 * The model for a worker on `cli`: their own if it suits that agent, else the office default when `cli` is the
 * default agent, else `claudeDefault` for Claude Code, or '' to let any other agent use its own default.
 */
export function effectiveModel(own: string, cli: AgentCli, office: { defaultCli: AgentCli; defaultModel: string }, claudeDefault: string): string {
  const suits = (m: string) => m.trim() !== '' && (cli === 'claude') === isClaudeModel(m);
  if (suits(own)) return own.trim();
  if (cli === office.defaultCli && suits(office.defaultModel)) return office.defaultModel.trim();
  return cli === 'claude' ? claudeDefault : '';
}

/** The coding agents the CEO can run: its office tools reach Claude Code and Codex. */
export type CeoCli = 'claude' | 'codex';
export const CEO_CLIS: CeoCli[] = ['codex', 'claude'];
export const CEO_MODELS: Record<CeoCli, string> = { codex: 'gpt-6.1-sol', claude: 'claude-opus-5-5' };
/** The CEO's coding agent: its own pick, Codex by default. */
export const ceoCli = (cli: AgentCli | ''): CeoCli => (cli === 'claude' ? 'claude' : 'codex');
/** The CEO's model on `cli`: its own if it suits that agent, else that agent's CEO default. */
export function ceoModel(own: string, cli: CeoCli): string {
  const m = own.trim();
  return m && (cli === 'claude') === isClaudeModel(m) ? m : CEO_MODELS[cli];
}

/** Claude Code models offered as suggestions in the office's model fields. */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Model suggestions for a coding agent; any other name can still be typed. OpenCode names are `provider/model`. */
export function modelSuggestions(cli: AgentCli): string[] {
  if (cli === 'claude') return CLAUDE_MODELS;
  if (cli === 'codex') return ['gpt-6.1-sol', 'gpt-5.5-codex', 'gpt-5.5'];
  return CLAUDE_MODELS.map((m) => `anthropic/${m}`);
}
