import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Backend } from './backend.ts';
import type { LogEntry, SessionHandle, SessionResult } from './agentRunner.ts';
import { BoxMachines } from './boxMachines.ts';
import type { BoxCliRecord, BoxTarget } from './boxCli.ts';
import type { BoxSignIn, ReconnectedCli } from './cliRunner.ts';
import { boxLinkedDir } from './boxScripts.ts';
import { CloudError } from './box.ts';
import { Cloud, officeId, redact } from './cloud.ts';
import type { PrDetails } from './github.ts';
import { defaultProjectsDir, DESK_SWEEP_INTERVAL_MS, HOME_DIR, LOG_BUFFER, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, VERSION } from './config.ts';
import { askedFor, ceoJobPrompt, ceoSystemPrompt, checkCloseIssue, createOfficeTools, floorCapacity, IssueCap, jobLabel, NOT_ASKED, planDependencies, plannedSize, scalePlan, type CeoJob, type OfficeTools, type TeamNow } from './ceo.ts';
import { afterClose, ASK_AGAIN_MS, closedWhy, closuresHeld, forgettable, issueOpen, nameList, pullNow, stillOpen, stoppedMessage, toAsk, toHold, type Closure, type FloorState, type KnownPull, type LearnedPull } from './closeCleanup.ts';
import { depsPromptLine, type DepsOutcome } from './deps.ts';
import { setUpDesk } from './deskSetup.ts';
import { fixOutcome, MAX_FIX_FAILURES } from './fixOutcome.ts';
import { fixGoesTo, pickTester, PREP_HOLD_MS, prepFailure, prepHeld, type PrepStrikes } from './handOut.ts';
import { HttpError } from './httpError.ts';
import { IssueAges } from './issueAges.ts';
import { issuesResolvedBy, issueTaken } from './issueClaims.ts';
import { CHECKS_ALERT_MS, failedRunIds, MAX_MERGE_FIXES, MERGE_RETRY_MS, mergeStep } from './mergeGate.ts';
import { orphanedQa } from './qaOrphans.ts';
import { catchUp, failedRunId, logTail, noChangeReason, PR_LIMITS_VERSION, QA_STOPPED, unpushedFix } from './prOwnership.ts';
import { conflictFixInstructions, MAX_QA_ROUNDS, qaGate, qaOutcome, type PreQa, type QaNext } from './qaOutcome.ts';
import { qaInstructions } from './qaPrompt.ts';
import { followKeptCli, resumeNote, resumesAfterRestart } from './restartRecovery.ts';
import { reconcileStep, restartMessage, sessionStart, workState, type ReconcileStep, type RestartCounts, type WorkState } from './reconcile.ts';
import { diagnose, finding, forget, NUDGE_WAIT_MS, nudgeText, QUIET_MS, triage, unclosedIssues, type Problem, type Remedy, type WatchAgent, type WatchMemory } from './watchdog.ts';
import { sendBackPatch } from './sendBack.ts';
import { checkTriageTarget, triageStep, type TriagePr } from './triage.ts';
import { DEFAULT_PREVIEW, Previews, parsePreviewPatch } from './previews.ts';
import { PREVIEW_SLUG } from './previewRunner.ts';
import { pruneQaShots, qaShotsDir, readQaShot, removeQaShots, saveQaShots } from './qaShots.ts';
import { agentPromptPreview, ceoPromptPreview, devBranch, devSystemPrompt, failedLogLines, noPushNudge, ownPrLine, qaBranch, qaSystemPrompt } from './prompts.ts';
import { QA_RESUME_PROMPT, qaRetry } from './qaRetry.ts';
import { drainDecision, lastUpdateMessage, POSTPONE_MS, type DrainInput, type LastUpdate } from './officeUpdate.ts';
import { clampPacingSessions, DEFAULT_PACING_SESSIONS, mayStart, PACING_MS, pacingMessage, resumeRefusal, usageLabel, usageView, waived, warningView, type UsageWarning, type Waiver, type WorkKind } from './pacing.ts';
import { emptyHistory, loadHistory, opsView, recordChecks, recordCost, recordMerges, recordQa, type OpsFloorState, type OpsHistory } from './metrics.ts';
import { clampTrimIdleMin, DEFAULT_TRIM_IDLE_MIN, desksToTrim, formatBytes, freedMessage, idleSince, TRIM_SWEEP_MS } from './deskTrim.ts';
import { boxVersions, cliLabel, isCli } from './clis.ts';
import { machineName, type MachineProvider } from './machines.ts';
import { MACHINES_DIR, type DeskTrim } from './workspace.ts';
import { envSecrets, legacyAgent, legacyRequest } from './legacyState.ts';
import { apply as applyLedger, emptyLedger, loadLedger, progressView, type Effects, type LedgerEvent, type LedgerState } from './ledger.ts';
import { AgentTerminal } from './terminal.ts';
import { Ticker } from './ticker.ts';
import { Outbox } from './outbox.ts';
import { DEFAULT_LISTEN, DEFAULT_VOICE, listenSettings, speaks, Voice, voiceSettings } from './voice.ts';
import { Notifier } from './notifier.ts';
import { clip, plainText, stuckAgents } from './notify.ts';
import { DEFAULT_NOTIFY, notifySettings, officeUrl } from '../shared/notify.ts';
import { cloudSettings, DEFAULT_CLOUD } from '../shared/cloud.ts';
import { agentActivity, lineActivity, sameActivity, type SeenActivity } from '../shared/activity.ts';
import { blockers, holdUps, waitsMessage } from '../shared/issues.ts';
import { cleanStyle, HAIR_COLORS, SKIN_TONES, type AgentStyle } from '../shared/looks.ts';
import { achievementDef, type ProgressView } from '../shared/progress.ts';
import { ceoCli, ceoModel, effectiveModel, type CeoCli } from '../shared/models.ts';
import { CEO_ID, DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, FLOOR_SEATS, INSTALL_STEP } from '../shared/types.ts';
import type {
  AgentActivity,
  AgentCli,
  AgentLook,
  AgentPromptView,
  AgentRole,
  AgentStatus,
  AgentTask,
  AgentView,
  CeoInfo,
  CliView,
  ClientEvent,
  CloudSettings,
  DoctorFinding,
  DoctorFix,
  EffortLevel,
  HireRequestView,
  IssueInfo,
  LogLine,
  MachineHost,
  OfficeUpdateView,
  OpsView,
  PhoneMessage,
  PreviewConfig,
  PreviewView,
  PrPreviewView,
  ProjectFolderView,
  PullInfo,
  QaCheck,
  QaView,
  RepoView,
  ServerEvent,
  SwarmSettings,
  UsageView,
  UsageWarningView,
  WorldSnapshot,
} from '../shared/types.ts';

// ---------- persisted shape ----------

interface PersistedRepo {
  id: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number;
  color: string;
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  browserTesting: boolean;
  links: string[]; // other connected repos this floor's agents may read
  localPath: string | null; // the manager's own project folder (null: a clone under WORKSPACE_ROOT)
  mission: string;
  summary: string;
  qaBrief: string;
  preview: PreviewConfig; // how the floor's app runs for the preview monitor
  addedAt: number;
}

interface PersistedAgent {
  id: string;
  name: string;
  repoId: string; // '' for the CEO, who works in the lobby
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // one numbering per floor, 0 to FLOOR_SEATS - 1
  color: string;
  hair: string;
  skin: string;
  style: AgentStyle | null; // the look editor's picks (null: seeded from the id)
  model: string;
  effort: EffortLevel | '';
  cli: AgentCli | ''; // '' = the office's default CLI
  machine: string | null; // their machine (machines.ts); null for an agent from before machines, until their next task
  host?: MachineHost; // 'box': their machine is an Upstash Box (docs/cloud.md); absent: a folder on this computer
  boxCli?: BoxCliRecord | null; // a cloud agent's live CLI in their Box, to pick up again after a restart
  needsSignIn?: boolean; // a cloud agent whose CLI waits for the manager to sign it in, in their terminal (docs/cloud.md)
  status: AgentStatus;
  issueNumber: number | null;
  issueTitle: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  sessionCli: AgentCli | null; // the CLI whose session sessionId is: only it can resume it
  lastError: string | null;
  logTail: LogLine[];
}

/** A pull request's trip through QA. */
interface QaRecord extends Omit<QaView, 'ceoLooking'> {
  issueNumber: number | null;
  devSessionId: string | null; // the dev's Claude Code session, resumed to fix QA findings
  fixInstructions: string | null;
  sessionFailures: number;
  testedSha: string | null; // the head commit QA is testing
  passedSha: string | null; // the head commit QA signed off on: auto-merge merges exactly that
  fixReason: 'qa' | 'checks' | 'conflict' | null; // why it was last sent back to a developer
  mergeFixes: number; // times it went back for failing checks or conflicts
  retests: number; // QA rounds caused by merge fixes or new commits rather than by QA failing it
  preQa: PreQa | null; // a conflict found before QA tested the head is being fixed
  noChangeSha: string | null; // the head a developer last said needed no change (one free re-test per commit)
  pendingSince: number | null; // when auto-merge started waiting on its checks
  mergeRetryAt: number | null; // GitHub refused the merge: try again after this
  alerted: boolean; // the manager has been told it's stuck
  rerunSha: string | null; // the head commit whose failed checks the office re-ran (once per commit)
  rerunAt: number | null;
  qaChecks: PullInfo['checks'] | null; // GitHub's checks when QA last failed it: a later re-run can be the fix
  stuckWhy: string | null; // why it last became needs-human, for the CEO's triage and the manager's alert
  triages: number; // CEO triage jobs it has had (triage.ts caps them)
  escalated: boolean; // needs-human and the manager has been told; cleared when it leaves needs-human
}

/** The PR work a desk is being set up for. author: the PR's author before a fix was handed out (restored if it can't start). */
type PrepJob = { rec: QaRecord; task: 'qa' } | { rec: QaRecord; task: 'fix'; author: string | null };

/** A project's name as the panel shows it: the repo without its owner. */
const projectName = (r: { fullName: string }) => r.fullName.split('/')[1] ?? r.fullName;
const prepKey = (repoId: string, prNumber: number, task: PrepJob['task']) => `${repoId}#${prNumber}:${task}`;

/** Choices made when a project moves into the office. */
interface FloorOptions {
  mission?: string; // brief for the CEO to plan from
  autoAssign?: boolean; // free agents pick up backlog issues as soon as they're filed
}

interface CeoState {
  queue: CeoJob[];
  job: CeoJob | null; // the job the CEO is on right now
  lastReviewAt: number | null;
  lastFingerprint: string | null; // company state at the last review; unchanged means the next review is skipped
}

/** An open issue whose PR was closed: auto-assign leaves it for the manager (closeCleanup.ts toHold). */
interface HeldIssue {
  repoId: string;
  issue: number;
  pr: number;
}

interface Persisted {
  settings: SwarmSettings;
  repos: PersistedRepo[];
  agents: PersistedAgent[];
  qa: QaRecord[];
  requests: HireRequestView[];
  ceo: CeoState;
  messages: PhoneMessage[];
  phoneReadAt: number;
  prLimits: number; // the PR budgets (PR_LIMITS_VERSION) needs-human records were judged by
  ops: OpsHistory; // mission control's rolling week of merges, QA verdicts, check runs and costs
  held: HeldIssue[];
  progress: LedgerState; // coins, decorations, achievements and careers (ledger.ts)
  officeId: string; // this office on a shared Upstash account: its Boxes carry it (docs/cloud.md)
}

interface Shot {
  data: Buffer;
  mime: string;
  url: string | null;
  at: number;
}

interface AgentRuntime {
  log: LogLine[];
  session: SessionHandle | null;
  currentTool: string | null;
  browserUrl: string | null;
  screenshot: { data: Buffer; mime: string; at: number } | null;
  shots: Shot[]; // every screenshot of the current session (QA evidence)
  terminal: AgentTerminal | null; // their terminal, once they've run in the terminal runtime
  qaResume?: { cwd: string; systemAppend: string } | null; // the QA run's one resume for a missing report, until used
}

interface RepoRuntime {
  issues: IssueInfo[];
  pulls: PullInfo[];
  lastSync: number | null;
  syncError?: string;
  syncing: boolean;
  cloneStatus: RepoView['cloneStatus'];
  cloneError?: string;
  fetchedAt?: number; // when the latest issues/PRs fetch started
  lastMergedAt: string | null; // newest merge seen: a newer one means the folder needs a sync
  folderSync: string | null;
  merging: boolean;
  closedIssues: Map<number, number>; // issues the office learned are closed, and when (closeCleanup.ts)
  closedPulls: Map<number, LearnedPull>; // PRs it learned are closed or merged
  openAt: Map<string, number>; // `issue#<n>` / `pr#<n>` -> when GitHub said one the sync doesn't list is open
}

/** What startup reconciliation decided (reconcileRestart), for finishRestart once the floors have synced. */
interface Restart {
  carryOn: PersistedAgent[];
  interrupted: PersistedAgent[];
  preparing: Set<PersistedAgent>;
  requeue: Set<PersistedAgent>;
  counts: RestartCounts;
}

interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  checks: QaCheck[];
  commands: { command: string; result: string }[];
  screenshots: string[];
  fixInstructions?: string;
}

// ---------- flavour ----------

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
const HAIR = HAIR_COLORS;
const SKIN = SKIN_TONES;
// New agents are named after computing pioneers, then fictional detectives.
const NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Hedy', 'Tim', 'Katherine',
  'Bjarne', 'Frances', 'Edsger', 'Anita', 'Donald', 'Sophie', 'Yukihiro', 'Jean', 'Niklaus', 'Karen', 'Brendan',
  'Sherlock', 'Marple', 'Poirot', 'Nancy', 'Columbo', 'Fletcher', 'Watson', 'Morse', 'Holmes', 'Maigret',
];

// Names that get the feminine character look: everyone in the name pool above, plus common first names
// for agents the manager names themselves. The manager can always change an agent's look in the console.
const FEMININE_NAMES = new Set(
  (
    'ada grace margaret barbara radia hedy katherine frances anita sophie jean karen marple nancy fletcher ' +
    'alice amanda amelia amy ana anna anne aisha astrid ava bella beth carla caroline charlotte chloe claire clara ' +
    'diana elena elizabeth ella ellie emily emma eva fatima fiona freya georgia hannah harper helen holly ingrid iris ' +
    'isabella ivy jane jasmine jessica julia kate laura leah leila lena lily linda lisa lucy maria marie mary maya mei ' +
    'mia mila monica naomi natalie nina nora olivia paula priya rachel rose ruby sandra sara sarah scarlett sofia ' +
    'stella susan tess tessa tina vera victoria yuki zara zoe'
  ).split(' '),
);
const lookFor = (name: string): AgentLook => (FEMININE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase()) ? 'feminine' : 'masculine');
const LOOKS: AgentLook[] = ['feminine', 'masculine'];
// Every agent runs Claude Opus 5.5 at medium effort unless the manager overrides it.
const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// The CEO thinks harder than the staff: xhigh effort, on Codex unless the manager picks Claude Code (shared/models.ts).
const CEO_EFFORT: EffortLevel = 'xhigh';
const CEO_NAME = 'Morgan';
// The CEO's own folder: its notes about the company live here. Repos are read through their clones.
const CEO_DIR = path.join(HOME_DIR, 'ceo');
const DEFAULT_PROJECTS_DIR = defaultProjectsDir(path.resolve(import.meta.dirname, '..'));
const MAX_ISSUES_PER_JOB = 12;
const KEEP_MESSAGES = 200;
const KEEP_DECIDED_REQUESTS = 40;

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent';

const BUSY: AgentStatus[] = ['preparing', 'working'];
const FREE: AgentStatus[] = ['idle', 'done'];
// An agent whose session failed sits out this long before taking new work, so a broken setup can't burn through the queue.
const ERROR_COOLDOWN_MS = 2 * 60_000;
// Auto-assign stops retrying an issue after this many failed sessions; the manager can still assign it by hand.
const MAX_ISSUE_FAILURES = 2;
// Failed QA runs (sessions, or desks that couldn't be set up) before a PR goes to the manager.
const MAX_QA_FAILURES = 2;
// How long the office waits after Claude's usage limit is hit when Claude doesn't say when it resets.
const LIMIT_PAUSE_MS = 15 * 60_000;
// Everyone on a floor this size or bigger busy at once is a full house (an achievement).
const FULL_HOUSE = 4;
// Mission control's numbers are recomputed after these events (debounced), and every half minute for the clock's sake.
const OPS_EVENTS = new Set<ServerEvent['type']>(['repo', 'repoRemoved', 'agent', 'agentRemoved', 'qa', 'qaRemoved', 'ceo']);
const OPS_TICK_MS = 30_000;
// How often the watchdog looks for stuck work (watchdog.ts).
const WATCHDOG_MS = 60_000;
const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 200);
// While a cloud agent signs in, the office looks whether it's done this often (someone watching their terminal), else less.
const SIGN_IN_POLL_MS = 8_000;
const SIGN_IN_IDLE_POLL_MS = 60_000;
// What a session that lost its sign-in mid-task is told when it carries on.
const SIGNED_IN_AGAIN = 'Se cerró tu sesión en mitad de la tarea y ya la has vuelto a iniciar. Sigue donde lo dejaste.';

/** A cloud agent's CLI that runs in a Box and can sign in there (OpenCode can't run in one). */
type BoxCliId = 'claude' | 'codex';

/** A cloud agent's CLI isn't signed in in their Box: their task waits for the manager to sign it in (docs/cloud.md). */
class SignInNeeded extends Error {
  constructor(readonly cli: BoxCliId) {
    super(`${cliLabel(cli)} no tiene la sesión iniciada en su máquina en la nube.`);
  }
}

/** A cloud agent signing in: the task it holds (started once they're signed in) and the sign-in in their terminal. */
interface SignIn {
  cli: BoxCliId;
  held: (() => void) | null;
  run: BoxSignIn | null;
  starting: boolean;
  poll: NodeJS.Timeout | null;
}

// The latest browser screenshot per agent is kept on disk so monitors survive a server restart.
const SCREENS_DIR = path.join(HOME_DIR, 'screens');
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const screenFile = (agentId: string, mime: string) => path.join(SCREENS_DIR, `${agentId}.${MIME_EXT[mime] ?? 'img'}`);

async function loadScreen(agentId: string): Promise<{ data: Buffer; mime: string; at: number } | null> {
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const file = path.join(SCREENS_DIR, `${agentId}.${ext}`);
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      return { data, mime, at: stat.mtimeMs };
    } catch {
      // try the next extension
    }
  }
  return null;
}

// QA's screenshots of each PR's latest round, for the app viewer's QA panel (qaShots.ts).
const QA_SHOTS_DIR = path.join(HOME_DIR, 'qa-shots');

async function removeScreens(agentId: string) {
  await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(SCREENS_DIR, `${agentId}.${ext}`), { force: true })));
}

// Each agent's terminal (screen and scrollback) is saved too, so the office shows what they did after a restart.
const TERMINALS_DIR = path.join(HOME_DIR, 'terminals');
const terminalFile = (agentId: string) => path.join(TERMINALS_DIR, `${agentId}.ansi`);
const TERMINAL_SAVE_MS = 20_000;

// ---------- QA report ----------

const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'screenshots'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'], description: 'pass solo si el cambio funciona y cumple los requisitos del issue; si no, fail (valores literales en inglés)' },
    summary: { type: 'string', description: 'De dos a cuatro frases en español para el comentario de la pull request.' },
    checks: {
      type: 'array',
      description: 'Cada criterio de aceptación, ejecución de tests o escenario que has verificado.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string', description: 'En español.' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'Qué has hecho y qué has observado, en español.' },
        },
      },
    },
    commands: {
      type: 'array',
      description: 'Baterías de tests, linters, builds y otros comandos que has ejecutado.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'p. ej. "42 superados, 0 fallidos"' } },
      },
    },
    screenshots: {
      type: 'array',
      description: 'Un pie de foto breve, en español, por cada captura que hayas hecho con browser_take_screenshot, en el orden en que las hiciste.',
      items: { type: 'string' },
    },
    fixInstructions: { type: 'string', description: 'Cuando el veredicto es fail: instrucciones precisas y accionables para el desarrollador, en español.' },
  },
};

function parseReport(result: SessionResult): QaReport | null {
  let raw: unknown = result.structured;
  if (!raw && result.text) {
    // Terminal agents end their last message with the report, usually in a ```json block.
    const fenced = [...result.text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
    for (const json of [...fenced, result.text.match(/\{[\s\S]*\}/)?.[0]].filter((j): j is string => !!j)) {
      try {
        raw = JSON.parse(json);
        break;
      } catch {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QaReport>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  return {
    verdict: r.verdict,
    summary: String(r.summary ?? ''),
    checks: Array.isArray(r.checks) ? r.checks.map((c) => ({ name: String(c.name ?? ''), result: c.result === 'fail' ? 'fail' : c.result === 'skip' ? 'skip' : 'pass', details: String(c.details ?? '') })) : [],
    commands: Array.isArray(r.commands) ? r.commands.map((c) => ({ command: String(c.command ?? ''), result: String(c.result ?? '') })) : [],
    screenshots: Array.isArray(r.screenshots) ? r.screenshots.map(String) : [],
    fixInstructions: r.fixInstructions ? String(r.fixInstructions) : undefined,
  };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** A tab's message on /ws asking for the live office again (ClientEvent 'resync'). */
function isResync(raw: unknown): boolean {
  try {
    return (JSON.parse(String(raw)) as Partial<ClientEvent> | null)?.type === 'resync';
  } catch {
    return false;
  }
}

const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

const clampMaxAgents = (n: unknown) => Math.max(1, Math.min(FLOOR_SEATS, Math.round(Number(n)) || DEFAULT_MAX_AGENTS));

export { HttpError };

export class Swarm {
  private state: Persisted = {
    settings: {
      sessionLimit: 0,
      defaultModel: DEFAULT_MODEL,
      defaultEffort: 'medium',
      runtime: 'terminal',
      defaultCli: 'claude',
      scaling: 'approve',
      maxAgents: DEFAULT_MAX_AGENTS,
      ceoHeartbeatMin: 60,
      managerName: '',
      companyName: '',
      dogName: DEFAULT_DOG_NAME,
      projectsDir: DEFAULT_PROJECTS_DIR,
      setupDone: false,
      tutorialStep: 0,
      autoUpdate: true,
      pacingSessions: DEFAULT_PACING_SESSIONS,
      trimIdleDesksMin: DEFAULT_TRIM_IDLE_MIN,
      voice: { ...DEFAULT_VOICE },
      listen: { ...DEFAULT_LISTEN },
      notify: notifySettings(DEFAULT_NOTIFY, {}),
      cloud: { ...DEFAULT_CLOUD },
    },
    repos: [],
    agents: [],
    qa: [],
    requests: [],
    ceo: { queue: [], job: null, lastReviewAt: null, lastFingerprint: null },
    messages: [],
    phoneReadAt: 0,
    prLimits: PR_LIMITS_VERSION,
    ops: emptyHistory(),
    held: [],
    progress: emptyLedger(),
    officeId: officeId(),
  };
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  private officeTools(): OfficeTools {
    return createOfficeTools({
      companyStatus: () => this.companyStatus(),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: (a) => this.setFloorProfile(a),
      scaleTeam: (a) => this.scaleTeam(a),
      configureAgent: (a) => this.configureAgent(a),
      fileIssue: (a) => this.fileIssue(a),
      setDependencies: (a) => this.setDependencies(a),
      closeIssue: (a) => this.closeIssue(a),
      retryQa: (a) => this.triageRetryQa(a),
      sendBack: (a) => this.triageSendBack(a),
      rerunChecks: (a) => this.triageRerunChecks(a),
      closePull: (a) => this.triageClosePull(a),
      escalate: (a) => this.triageEscalate(a),
    });
  }
  private ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB); // issues filed during the current CEO job
  private ceoAsked = false; // the manager asked for work in the current CEO job (a plan, or a message): only then are issues filed
  private messageSeq = 1;
  private agentRt = new Map<string, AgentRuntime>();
  private seenActivity = new Map<string, SeenActivity>(); // agent id -> their latest action in the log
  private shownActivity = new Map<string, AgentActivity | null>(); // agent id -> the activity clients last heard
  private ticker = new Ticker({
    name: (id) => this.state.agents.find((a) => a.id === id)?.name ?? null,
    author: (repoId, pr) => this.state.agents.find((a) => a.repoId === repoId && a.role !== 'ceo' && a.task !== 'qa' && a.prNumber === pr)?.name ?? null,
  });
  private repoRt = new Map<string, RepoRuntime>();
  private issueAges = new IssueAges(); // when the issues behind recent merges were filed, for the whiteboard
  private deskAlerts = new Map<string, string>(); // agent id -> the desk setup error the manager was last told about
  private prepStrikes = new Map<string, PrepStrikes>(); // `${repoId}#${pr}:${task}` -> its desks that couldn't be set up
  private dropping = new Map<string, string>(); // agent id -> why their task's issue or PR closed: the desk clears once the session ends
  // Everything sent to the tabs on /ws: agent and floor changes batched as patches, terminal lines only where shown.
  private outbox = new Outbox({
    agents: () => this.state.agents.map((a) => ({ id: a.id, floor: this.floorOf(a) })),
    log: (id) => this.agentRt.get(id)?.log ?? [],
    beforeFlush: (ids) => this.updateSigns(ids),
  });
  private user: string | null = null;
  private ghError: string | undefined;
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve(); // state file writes, one at a time: they share its temp file
  private logSeq = 1;
  private previews: Previews;
  private officeHead: string | null = null; // the commit the office runs (null: not a git checkout, so no self-update)
  private officeUpdate = {
    behind: 0,
    requested: false,
    postponedUntil: null as number | null,
    postponedBehind: 0,
    failed: null as string | null,
    failedBehind: null as number | null,
    drainingSince: null as number | null,
    sent: false,
    handedOver: false, // sessions cut off by the hand-over are the restarted office's to recover
  };
  private lastOfficeView = '';
  private clis: CliView[] = []; // coding-agent CLIs found on this machine (detected at startup)
  /** Phone messages read aloud. The demo keeps its own key and clips, so it never touches the real ones. */
  readonly voice: Voice;
  private readonly envSecrets = envSecrets(process.env);
  /** Notifications to the manager's devices and chat apps (docs/pocket.md). The demo's only log what they'd send. */
  readonly notifier: Notifier;
  /** Settings → Cloud agents: the Upstash account and what cloud agents sign in with (docs/cloud.md). The demo's is fake. */
  readonly cloud: Cloud;
  /** Cloud agents' machines: an Upstash Box each. */
  private boxMachines: BoxMachines;
  /** Cloud agents waiting for a sign-in in their terminal (holdForSignIn), by agent id. */
  private signIns = new Map<string, SignIn>();
  private toldStuck = new Set<string>(); // `${agentId}:${endedAt}`: agents in an error the manager was notified about

  constructor(private backend: Backend) {
    this.voice = new Voice({
      api: backend.voice,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      cacheDir: path.join(HOME_DIR, backend.demo ? 'demo-voice' : 'voice'),
      settings: () => this.state.settings.voice,
      listen: () => this.state.settings.listen,
      messages: () => this.state.messages,
      officeNote: (text) => this.postMessage('office', text),
      keyChanged: (view) => this.broadcast({ type: 'voiceKey', ...view }),
      cacheChanged: (voiceCache) => this.broadcast({ type: 'voiceCache', voiceCache }),
      log: (line) => console.log(line),
    });
    this.notifier = new Notifier({
      transport: backend.notify,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      pushFile: path.join(HOME_DIR, backend.demo ? 'demo-push.json' : 'push.json'),
      settings: () => this.state.settings.notify,
      broadcast: (note) => this.broadcast({ type: 'notify', note }),
      channelsChanged: (notifyChannels) => this.broadcast({ type: 'notifyChannels', notifyChannels }),
      log: (line) => console.warn(line),
    });
    this.cloud = new Cloud({
      // The demo's fake cloud keeps a file of its own: its tests run beside the notifier's, which share demo-secrets.json.
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-cloud-secrets.json' : 'secrets.json'),
      env: backend.cloud.env(),
      boxes: (key) => backend.cloud.boxes(key),
      ghToken: () => backend.cloud.ghToken(),
      office: () => this.state.officeId,
      machines: () => new Set(this.state.agents.filter((a) => a.host === 'box' && a.machine).map((a) => a.machine!)),
      changed: (cloud) => this.broadcast({ type: 'cloud', cloud }),
      log: (line) => console.warn(line),
    });
    this.boxMachines = new BoxMachines({
      api: () => this.cloud.boxApi(),
      office: () => this.state.officeId,
      size: () => this.state.settings.cloud.boxSize,
      versions: boxVersions(),
      git: () => backend.cloud.gitIdentity(this.user),
      githubEnv: () => this.cloud.githubEnv(),
      state: (machine) => this.boxState(machine),
      secrets: () => this.secrets(),
      log: (line) => console.warn(line),
    });
    this.previews = new Previews(backend, {
      emit: (id) => {
        const r = this.state.repos.find((x) => x.id === id);
        if (r && this.repoRt.has(id)) this.emitRepo(r);
      },
      pulls: (id) => this.repoRt.get(id)?.pulls ?? [],
      emitPr: (preview) => this.broadcast({ type: 'prPreview', preview }),
      prRemoved: (repoId, pr) => this.broadcast({ type: 'prPreviewRemoved', repoId, pr }),
      note: (text) => this.toast('info', text),
    });
  }

  // ---------- lifecycle ----------

  async init() {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const loaded = JSON.parse(raw) as Partial<Persisted>;
      this.state = {
        settings: { ...this.state.settings, ...loaded.settings },
        repos: (loaded.repos ?? []).map((r) => ({
          ...r,
          autoMerge: r.autoMerge ?? true,
          links: r.links ?? [],
          mission: r.mission ?? '',
          summary: r.summary ?? '',
          qaBrief: r.qaBrief ?? '',
          localPath: r.localPath ?? null,
          preview: { command: r.preview?.command ?? null, env: { ...r.preview?.env } },
        })),
        // Developers and QA testers became agents (docs/agents.md): testers keep their seats, now the east-wall desks.
        agents: (loaded.agents ?? []).map((raw) => legacyAgent<PersistedAgent>(raw)).map((a) => ({
          ...a,
          machine: a.machine ?? null,
          boxCli: a.host === 'box' ? (a.boxCli ?? null) : null,
          effort: a.effort ?? '',
          look: a.look ?? lookFor(a.name),
          style: cleanStyle(a.style),
          task: a.task ?? (a.issueNumber ? 'issue' : null),
          cli: isCli(a.cli) ? a.cli : '',
          sessionCli: a.sessionCli ?? (a.sessionId ? 'claude' : null),
        })),
        qa: (loaded.qa ?? []).map((q) => ({
          ...q,
          testedSha: q.testedSha ?? null,
          passedSha: q.passedSha ?? null,
          fixReason: q.fixReason ?? null,
          mergeFixes: q.mergeFixes ?? 0,
          retests: q.retests ?? 0,
          pendingSince: q.pendingSince ?? null,
          mergeRetryAt: q.mergeRetryAt ?? null,
          alerted: q.alerted ?? false,
          preQa: q.preQa ?? null,
          noChangeSha: q.noChangeSha ?? null,
          rerunSha: q.rerunSha ?? null,
          rerunAt: q.rerunAt ?? null,
          qaChecks: q.qaChecks ?? null,
          stuckWhy: q.stuckWhy ?? null,
          triages: q.triages ?? 0,
          escalated: q.escalated ?? q.status === 'needs-human', // stuck before triage existed: the manager was told
          mergeNote: null,
        })),
        requests: (loaded.requests ?? []).map((raw) => legacyRequest<HireRequestView>(raw)),
        ceo: { ...this.state.ceo, ...loaded.ceo },
        messages: loaded.messages ?? [],
        phoneReadAt: loaded.phoneReadAt ?? 0,
        prLimits: loaded.prLimits ?? 1,
        ops: loadHistory(loaded.ops, Date.now()),
        held: loaded.held ?? [],
        progress: loadLedger(loaded.progress),
        officeId: typeof loaded.officeId === 'string' && /^[a-z0-9]{6}$/.test(loaded.officeId) ? loaded.officeId : this.state.officeId,
      };
      for (const m of this.state.messages) this.messageSeq = Math.max(this.messageSeq, m.id + 1);
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
      if (this.state.settings.runtime !== 'sdk') this.state.settings.runtime = 'terminal';
      if (!isCli(this.state.settings.defaultCli)) this.state.settings.defaultCli = 'claude';
      this.state.settings.trimIdleDesksMin = clampTrimIdleMin(this.state.settings.trimIdleDesksMin);
      if (!this.state.settings.defaultModel && this.state.settings.defaultCli === 'claude') this.state.settings.defaultModel = DEFAULT_MODEL;
      // "Max concurrent sessions" (default 4) became an optional session limit. The old default goes; a limit the manager chose stays.
      const old = this.state.settings as SwarmSettings & { maxConcurrent?: number; permissionMode?: string };
      if (old.maxConcurrent !== undefined) {
        if (loaded.settings?.sessionLimit === undefined) old.sessionLimit = old.maxConcurrent === 4 ? 0 : old.maxConcurrent;
        delete old.maxConcurrent;
      }
      delete old.permissionMode; // the office's rules are instructions now, not a permission mode
      // Hiring titled roles became team changes: the approval choice carries over, the team cap (an auto-approve limit) doesn't.
      const hiring = old as SwarmSettings & { hiring?: string; teamCap?: number };
      if (hiring.hiring !== undefined) {
        if (loaded.settings?.scaling === undefined) this.state.settings.scaling = hiring.hiring === 'auto' ? 'auto' : 'approve';
        // Teams hired before the limit existed stay whole: the CEO isn't asked to shrink them to fit a new default.
        const biggest = Math.max(0, ...this.state.repos.map((r) => this.state.agents.filter((a) => a.repoId === r.id).length));
        if (loaded.settings?.maxAgents === undefined) this.state.settings.maxAgents = Math.max(DEFAULT_MAX_AGENTS, biggest);
        delete hiring.hiring;
        delete hiring.teamCap;
      }
      if (this.state.settings.scaling !== 'auto') this.state.settings.scaling = 'approve';
      this.state.settings.maxAgents = clampMaxAgents(this.state.settings.maxAgents);
      this.state.settings.voice = voiceSettings(DEFAULT_VOICE, loaded.settings?.voice);
      this.state.settings.listen = listenSettings(DEFAULT_LISTEN, loaded.settings?.listen);
      this.state.settings.notify = notifySettings(DEFAULT_NOTIFY, loaded.settings?.notify);
      this.state.settings.cloud = cloudSettings(DEFAULT_CLOUD, loaded.settings?.cloud);
      // Offices that were set up before the setup wizard existed skip it.
      if (loaded.settings && loaded.settings.setupDone === undefined && this.state.repos.length > 0) {
        Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
      }
    } catch {
      // first run
    }
    await this.voice.init();
    await this.notifier.init();
    await this.cloud.init();
    if (this.state.settings.cloud.machineKind === 'box' && !this.cloud.boxApi()) this.state.settings.cloud.machineKind = 'local';
    for (const r of this.state.repos) if (r.localPath) this.backend.setLocalPath(r.fullName, r.localPath);
    const interrupted: PersistedAgent[] = [];
    for (const a of this.state.agents) {
      const tail = a.logTail ?? [];
      for (const l of tail) this.logSeq = Math.max(this.logSeq, l.id + 1);
      this.agentRt.set(a.id, { log: tail, session: null, currentTool: null, browserUrl: null, screenshot: await loadScreen(a.id), shots: [], terminal: await this.loadTerminal(a.id) });
    }
    // CLIs the terminal keeper kept running through the restart go back into their terminals, and busy ones carry on.
    // (The CEO's session is resumed instead: its office tools live in this process.)
    const terminalOf = (id: string) => {
      const a = this.state.agents.find((x) => x.id === id);
      return a && a.role !== 'ceo' ? this.terminalFor(a) : null;
    };
    const back: ReconnectedCli[] = await this.backend.reconnectClis(terminalOf).catch((err) => {
      console.warn('could not reconnect to the terminal keeper', err);
      return [];
    });
    // Cloud agents' CLIs kept working in their Boxes while the office was closed: picked up the same way (docs/cloud.md).
    const boxApi = this.cloud.boxApi();
    const boxKept = this.state.agents.filter((a) => a.host === 'box' && a.boxCli);
    if (!boxApi) for (const a of boxKept) a.boxCli = null;
    else {
      const kept = boxKept.map((a) => ({
        agentId: a.id,
        rec: a.boxCli!,
        api: boxApi,
        record: (rec: BoxCliRecord | null) => this.boxCliRecord(a.id, rec),
        connection: (up: boolean) => this.boxMachines.connection(a.machine ?? machineName(a.id), up),
      }));
      back.push(
        ...(await this.backend.cloud.reconnect(kept, terminalOf).catch((err) => {
          console.warn("could not pick up cloud agents' CLIs", err);
          return [];
        })),
      );
      // A CLI started just before a crash, that no record names, would work the same desk as the one the office starts.
      await Promise.all(this.state.agents.filter((a) => a.host === 'box' && a.machine).map((a) => this.boxMachines.sweepStrays(a.machine!, a.boxCli ? [a.boxCli.token] : []).catch(() => 0)));
    }
    for (const r of this.state.repos) this.repoRt.set(r.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    const restart = await this.reconcileRestart((a) => followKeptCli(a, back.find((c) => c.agentId === a.id)));
    interrupted.push(...restart.interrupted);
    for (const c of back) if (c.busy && !restart.carryOn.some((a) => a.id === c.agentId)) this.agentRt.get(c.agentId)?.terminal?.releaseIdle?.();
    for (const a of restart.carryOn) this.reattachSession(a);
    this.backend.hooksReady();
    // Cloud agents who waited for a sign-in: still signed out (a new sign-in starts in their terminal), or signed in now.
    for (const a of this.state.agents) if (a.host === 'box' && a.needsSignIn) void this.checkSignIn(a);

    try {
      this.user = await this.backend.user();
    } catch (err) {
      this.ghError = `La CLI de GitHub no está lista: ${(err as Error).message}. Ejecuta "gh auth login".`;
      console.warn(this.ghError);
    }

    if (this.backend.demo && this.state.repos.length === 0) {
      // The demo opens on a busy office; the tutorial still runs so it can be tried.
      Object.assign(this.state.settings, { setupDone: true, managerName: 'Demo Manager', companyName: 'Demo Co.' });
      for (const r of await this.backend.listMyRepos()) {
        const repo = await this.connectRepo(r.nameWithOwner);
        const size = Math.min(this.backend.demoTeam?.(repo.floor) ?? 4, FLOOR_SEATS);
        if (size > this.state.settings.maxAgents) this.state.settings.maxAgents = size; // the big-company demo fills its floors
        for (let i = 1; i < size; i++) this.hireAgent(repo.id, {}); // connecting hired the first
        this.updateRepo(repo.id, { autoAssign: true });
      }
      // Mission control opens on a week that already happened.
      this.state.ops = this.backend.seedOps?.(this.state.repos.map((r) => r.id), Date.now()) ?? this.state.ops;
    }
    for (const r of this.state.repos) this.ensureAgent(r);
    this.ensureCeo(interrupted);
    // Agents from before the ledger start their careers now.
    for (const a of this.state.agents) if (a.role !== 'ceo') applyLedger(this.state.progress, { kind: 'hired', agentId: a.id, at: Date.now() });

    for (const r of this.state.repos) void this.cloneRepo(r.id);
    await Promise.all(this.state.repos.map((r) => this.syncRepo(r.id)));
    // Anything still alive in a desk (or a preview) is left over from before the restart, except around the CLIs that
    // kept running through it: their dev servers and commands are theirs.
    await Promise.all([
      ...this.state.agents.map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo || back.some((c) => c.agentId === a.id)) return undefined;
        return this.releaseDesk(a, repo).catch(() => undefined);
      }),
      this.previews.clearOrphans(this.state.repos),
    ]);
    for (const r of this.state.repos) void this.previews.refreshDefault(r);
    void pruneQaShots(QA_SHOTS_DIR, new Set(this.state.qa.map((q) => `${q.repoId}#${q.prNumber}`)));
    this.finishRestart(restart);
    // A PR the restart left in "testing" with nobody on it: test it again (the result, if any, was lost).
    for (const rec of orphanedQa(this.state.qa, this.state.agents, BUSY)) this.setQa(rec, { status: 'queued', qaAgentId: null });
    if (this.state.prLimits < PR_LIMITS_VERSION) this.catchUpPrs();
    this.officeHead = await this.backend.office.head();
    const updated = await this.backend.office.takeLastUpdate().catch(() => null);
    if (updated) await this.reportUpdate(updated);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    setInterval(() => this.previews.sweepPrs(), 15_000);
    setInterval(() => void this.saveTerminals(), TERMINAL_SAVE_MS);
    // Every minute in the demo, so a short idle time shows its phone message soon.
    setInterval(() => {
      void this.trimIdleDesks();
      void this.voice.prune();
    }, this.backend.demo ? 60_000 : TRIM_SWEEP_MS);
    setInterval(() => {
      this.state.repos.forEach((r, i) => setTimeout(() => void this.sweepFloor(r.id), i * 1500));
      void this.sweepMachines();
    }, DESK_SWEEP_INTERVAL_MS);
    void this.sweepMachines();
    setInterval(() => this.emitOps(), OPS_TICK_MS); // the clock moves the numbers too: the last hour, today, errors turning into alarms
    setInterval(() => this.notifyStuck(), 60_000);
    setInterval(() => this.watchdogTick(), WATCHDOG_MS);
    void this.backend
      .detectClis()
      .then((clis) => {
        this.clis = clis;
        this.broadcast({ type: 'clis', clis });
      })
      .catch((err) => console.warn('could not look for agent CLIs', err));
    this.save();
    // Tabs connect after this, so each one's snapshot has at least these: later changes go out as patches on them.
    this.outbox.seed(
      this.state.agents.map((a) => {
        const { log: _log, ...view } = this.agentView(a, false);
        return view;
      }),
      this.state.repos.map((r) => this.repoView(r)),
    );
    setTimeout(() => this.schedule(), 1000);
  }

  /**
   * Startup reconciliation (reconcile.ts), before anything is reattached or scheduled: GitHub is asked about every task
   * and each desk is looked for. Finished work is cleared now (as its closure would); CLIs the keeper kept are followed
   * again only on open work at a desk that's still there; everyone else who was busy is stopped, to resume or start
   * over once the floors have synced (finishRestart). alive: the agent's CLI kept working on this task.
   */
  private async reconcileRestart(alive: (a: PersistedAgent) => boolean): Promise<Restart> {
    const plan = new Map<PersistedAgent, ReconcileStep>();
    await Promise.all(
      this.state.agents.map(async (a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        const rt = repo && this.repoRt.get(repo.id);
        if (!repo || !rt || a.role === 'ceo' || !a.task) return;
        const [issue, pr] = await Promise.all([
          a.task === 'issue' && a.issueNumber ? this.backend.issueState(repo.fullName, a.issueNumber).catch(() => null) : null,
          a.prNumber ? this.backend.prDetails(repo.fullName, a.prNumber).catch(() => null) : null,
        ]);
        // What GitHub said is learned like a sync's asks, so cleanUpClosed clears the desks, QA records and holds.
        if (issue === 'CLOSED' && a.issueNumber) rt.closedIssues.set(a.issueNumber, Date.now());
        if (pr && pr.state !== 'OPEN' && !rt.closedPulls.has(pr.number)) {
          rt.closedPulls.set(pr.number, { number: pr.number, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.holdIssues(repo, rt.closedPulls.get(pr.number)!);
        }
        plan.set(
          a,
          reconcileStep({
            role: a.role,
            status: a.status,
            task: a.task,
            work: workState(issue, pr?.state ?? null),
            // A cloud agent's desk is in their Box: taken to be there (Upstash may be unreachable, and looking wakes it).
            deskExists: a.host === 'box' || this.backend.deskExists(this.deskOf(a, repo)),
            cliAlive: alive(a),
            resumable: resumesAfterRestart(a, a.status === 'preparing', this.backend.demo),
          }),
        );
      }),
    );
    const out: Restart = { carryOn: [], interrupted: [], preparing: new Set(), requeue: new Set(), counts: { cleared: 0, reattached: 0, resumed: 0, requeued: 0 } };
    for (const a of this.state.agents) {
      const step = plan.get(a);
      if (step === 'requeue') out.requeue.add(a);
      if (!BUSY.includes(a.status)) continue;
      if (step === 'reattach' || (step === undefined && alive(a))) {
        out.carryOn.push(a);
        continue;
      }
      if (a.status === 'preparing') out.preparing.add(a);
      a.status = 'stopped';
      a.lastError = 'El servidor de la oficina se reinició mientras este agente trabajaba.';
      out.interrupted.push(a);
    }
    for (const r of this.state.repos) this.cleanUpClosed(r);
    for (const [a, step] of plan) if (step === 'clear' && !a.task) out.counts.cleared++;
    out.counts.reattached = out.carryOn.filter((a) => a.role !== 'ceo').length;
    return out;
  }

  /** After the startup sync: the restart's interrupted work resumes or goes back in line, and the phone hears what happened. */
  private finishRestart(r: Restart) {
    this.recover([...r.interrupted, ...[...r.requeue].filter((a) => !r.interrupted.includes(a))], r.preparing, r.requeue, r.counts);
    const text = restartMessage(r.counts);
    if (text) this.postMessage('office', text);
  }

  /**
   * Agents cut off by a server restart pick their session back up, told what they were doing. QA, demo agents, tasks
   * still being prepared and work whose desk is gone (requeue) start over from the queue, without a strike.
   */
  private recover(agents: PersistedAgent[], preparing: Set<PersistedAgent>, requeue = new Set<PersistedAgent>(), counts: RestartCounts = { cleared: 0, reattached: 0, resumed: 0, requeued: 0 }) {
    for (const a of agents) {
      if (!a.task) continue; // its issue or PR closed while the office was down: the startup sync cleared the desk
      const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
      if (requeue.has(a) || !resumesAfterRestart(a, preparing.has(a), this.backend.demo)) {
        this.appendLog(a, [{ kind: 'system', text: '↺ El servidor de la oficina se ha reiniciado. Se empieza de nuevo desde la cola.' }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        counts.requeued++;
        continue;
      }
      if (this.slotsFull()) continue; // stays 'stopped'; the manager can resume it later
      counts.resumed++;
      void this.message(a.id, resumeNote(a, fix)).catch((err) => console.warn(`could not resume ${a.name}`, err));
    }
  }

  /** One-off, on the first start with bigger PR budgets: PRs the manager got under the old ones go back to work. */
  private catchUpPrs() {
    const back: string[] = [];
    for (const rec of this.state.qa) {
      const status = catchUp(rec);
      if (!status) continue;
      const repo = this.state.repos.find((r) => r.id === rec.repoId);
      this.setQa(rec, { status, mergeNote: null, pendingSince: null, mergeRetryAt: null, alerted: false });
      back.push(`#${rec.prNumber}${repo ? ` on ${repo.fullName}` : ''}`);
    }
    this.state.prLimits = PR_LIMITS_VERSION;
    if (back.length) this.postMessage('office', `↩️ Ahora los desarrolladores tienen más intentos con sus PRs, así que ${back.join(', ')} han vuelto a ellos en lugar de esperarte.`);
  }

  // ---------- views ----------

  private repoView(r: PersistedRepo): RepoView {
    const rt = this.repoRt.get(r.id)!;
    return {
      id: r.id,
      fullName: r.fullName,
      description: r.description,
      url: r.url,
      defaultBranch: r.defaultBranch,
      floor: r.floor,
      color: r.color,
      autoAssign: r.autoAssign,
      autoMerge: r.autoMerge,
      folderSync: rt.folderSync,
      browserTesting: r.browserTesting,
      links: r.links,
      mission: r.mission,
      summary: r.summary,
      qaBrief: r.qaBrief,
      localPath: r.localPath,
      checkoutPath: this.backend.mainDir(r.fullName),
      cloneStatus: rt.cloneStatus,
      cloneError: rt.cloneError,
      issues: rt.issues,
      pulls: rt.pulls,
      held: this.state.held.filter((h) => h.repoId === r.id).map((h) => ({ issue: h.issue, pr: h.pr })),
      lastSync: rt.lastSync,
      syncError: rt.syncError,
      previewConfig: r.preview,
      preview: this.previews.view(r),
    };
  }

  private agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const rt = this.agentRt.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      look: a.look,
      task: a.task,
      desk: a.desk,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      style: a.style,
      model: a.model,
      effort: a.effort,
      cli: a.cli,
      host: a.host === 'box' ? 'box' : 'local',
      ...(a.host === 'box' ? { cloud: this.boxMachines.stateOf(a.machine ?? machineName(a.id)), needsSignIn: !!a.needsSignIn } : {}),
      terminal: !!rt.terminal,
      status: a.status,
      issueNumber: a.issueNumber,
      issueTitle: a.issueTitle,
      branch: a.branch,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      currentTool: rt.currentTool,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      costUsd: a.costUsd,
      turns: a.turns,
      browserUrl: rt.browserUrl,
      hasScreenshot: !!rt.screenshot,
      screenshotAt: rt.screenshot?.at ?? null,
      lastError: a.lastError,
      career: a.role === 'ceo' ? null : (this.state.progress.careers[a.id] ?? null),
      log: withLog ? rt.log : [],
      activity: this.activityOf(a),
    };
  }

  /** What the sign over their head says (shared/activity.ts): from their status and latest action, never raw input. */
  private activityOf(a: PersistedAgent): AgentActivity | null {
    const chat = a.role === 'ceo' && this.state.ceo.job?.kind === 'chat';
    const { status, task, issueNumber, prNumber, startedAt } = a;
    const currentTool = this.agentRt.get(a.id)?.currentTool ?? null;
    return agentActivity({ status, task, currentTool, issueNumber, prNumber, startedAt }, this.seenActivity.get(a.id) ?? null, chat);
  }

  private qaView(q: QaRecord): QaView {
    return {
      repoId: q.repoId,
      prNumber: q.prNumber,
      status: q.status,
      round: q.round,
      devAgentId: q.devAgentId,
      qaAgentId: q.qaAgentId,
      summary: q.summary,
      checks: q.checks,
      commentUrl: q.commentUrl,
      mergeNote: q.mergeNote,
      ceoLooking: q.status === 'needs-human' && !q.escalated && this.triageJob(q) != null,
      updatedAt: q.updatedAt,
      shots: q.shots ?? [],
    };
  }

  /** The office address the manager set for links in messages (Settings → Notificaciones), or ''; the origin guard trusts its host. */
  officeAddress(): string {
    return this.state.settings.notify.officeUrl;
  }

  snapshot(): WorldSnapshot {
    return {
      user: this.user,
      ghReady: !this.ghError,
      ghError: this.ghError,
      demo: this.backend.demo,
      machinesRoot: MACHINES_DIR,
      settings: this.state.settings,
      repos: this.state.repos.map((r) => this.repoView(r)),
      // no terminal lines: each tab asks for the ones it shows (shared/watch.ts)
      agents: this.state.agents.map((a) => this.agentView(a, false)),
      qa: this.state.qa.map((q) => this.qaView(q)),
      prPreviews: this.previews.prViews(),
      requests: this.state.requests,
      ceo: this.ceoInfo(),
      messages: this.state.messages.slice(-100),
      phoneReadAt: this.state.phoneReadAt,
      usage: this.usageNow(),
      ops: this.opsNow(),
      doctor: this.doctorView(),
      clis: this.clis,
      ...this.voice.keyView(),
      voiceCache: this.voice.cacheInfo(),
      ticker: this.ticker.recent(),
      notifyChannels: this.notifier.channelsView(),
      cloud: this.cloud.view(),
      version: VERSION,
      officeCommit: this.officeHead?.slice(0, 7) ?? null,
      officeUpdate: this.officeHead ? this.officeUpdateView() : undefined,
      progress: this.progressView(),
    };
  }

  /** The short commit the office runs, or null when it isn't a git checkout. */
  officeCommit(): string | null {
    return this.officeHead?.slice(0, 7) ?? null;
  }

  /** The agent's latest screenshot: null when it has none right now, undefined for an unknown agent. */
  screenshot(agentId: string) {
    const rt = this.agentRt.get(agentId);
    return rt ? rt.screenshot : undefined;
  }

  // ---------- clients ----------

  addClient(ws: WebSocket) {
    this.outbox.add(ws);
    ws.on('close', () => this.outbox.remove(ws));
    ws.on('message', (raw) => {
      // A tab back from the time-lapse asks for the live office again, and the terminal lines it shows with it;
      // otherwise it's saying what it shows (shared/watch.ts).
      if (isResync(raw)) {
        this.send(ws, { type: 'snapshot', data: this.snapshot() });
        this.outbox.resync(ws);
      } else this.outbox.receive(ws, String(raw));
    });
    this.send(ws, { type: 'snapshot', data: this.snapshot() });
  }

  /** The floor an agent's desk is on, for routing their terminal lines: 0 for the CEO in the lobby, null for none. */
  private floorOf(a: PersistedAgent): number | null {
    if (a.role === 'ceo') return 0;
    return this.state.repos.find((r) => r.id === a.repoId)?.floor ?? null;
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  }

  private broadcast(ev: ServerEvent) {
    this.outbox.broadcast(ev);
    this.observe(ev);
  }

  /** What follows from an event besides the tabs hearing it: ticker lines and mission control's numbers. */
  private observe(ev: ServerEvent) {
    for (const item of this.ticker.observe(ev)) this.broadcast({ type: 'ticker', item });
    if (OPS_EVENTS.has(ev.type)) this.opsSoon();
  }

  /** Values never to show or log: the ElevenLabs key, cloud keys and secret-looking environment variables. */
  private secrets(): string[] {
    const key = this.voice.secret();
    return [...this.envSecrets, ...(key ? [key] : []), ...this.cloud.secretValues()];
  }

  private toast(level: 'info' | 'success' | 'error', text: string) {
    this.broadcast({ type: 'toast', level, text });
  }

  private emitRepo(r: PersistedRepo) {
    const repo = this.repoView(r);
    this.observe({ type: 'repo', repo });
    // to the tabs with the next batch: a big company syncs and merges many times a minute
    this.outbox.repo(repo);
  }

  private emitAgent(a: PersistedAgent) {
    // A session can finish after its agent was let go (their floor disconnected mid-task); they're gone, so say nothing.
    if (!this.agentRt.has(a.id)) return;
    const { log: _log, ...rest } = this.agentView(a, false);
    this.shownActivity.set(a.id, rest.activity ?? null);
    this.observe({ type: 'agent', agent: rest });
    // to the tabs with the next batch: a busy agent changes tools many times a minute
    this.outbox.agent(rest);
  }

  private setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    const told = rec.status === 'needs-human' && rec.escalated;
    Object.assign(rec, patch, { updatedAt: Date.now() });
    if (!this.state.qa.includes(rec)) return; // it left QA (its PR closed) while a session on it was still wrapping up
    if (rec.status !== 'needs-human') rec.escalated = false;
    else this.ledger({ kind: 'needs-human', repoId: rec.repoId, pr: rec.prNumber });
    this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    this.save();
    // Every way a PR reaches the manager (escalated by the CEO, or straight to them) passes here.
    if (!told && rec.status === 'needs-human' && rec.escalated) this.notifyNeedsHuman(rec);
  }

  private appendLog(a: PersistedAgent, entries: LogEntry[]) {
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const t = Date.now();
    const lines: LogLine[] = [];
    for (const e of entries) {
      const line: LogLine = { id: this.logSeq++, t, kind: e.kind, text: e.text, tool: e.tool };
      rt.log.push(line);
      lines.push(line);
      const act = lineActivity(line);
      if (act) this.seenActivity.set(a.id, { ...act, at: t });
    }
    if (rt.log.length > LOG_BUFFER) rt.log.splice(0, rt.log.length - LOG_BUFFER);
    this.outbox.log(a.id, lines);
    this.save();
  }

  /** Before new lines go out: a new action changes the sign over their head (tool changes already sent most of them). */
  private updateSigns(agentIds: string[]) {
    for (const id of agentIds) {
      const a = this.state.agents.find((x) => x.id === id);
      if (a && !sameActivity(this.activityOf(a), this.shownActivity.get(id))) this.emitAgent(a);
    }
  }

  // ---------- persistence ----------

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.writeState().catch((err) => console.warn('could not save the state', err)), 1500);
  }

  /** Write the state file now, e.g. before the office stops or hands itself to the launcher. Waits for a write in progress. */
  private writeState(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const next = this.writing.then(() => this.writeStateFile());
    this.writing = next.catch(() => undefined);
    return next;
  }

  private async writeStateFile() {
    for (const a of this.state.agents) a.logTail = (this.agentRt.get(a.id)?.log ?? []).slice(-200);
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2));
    await fs.rename(tmp, STATE_FILE);
  }

  // ---------- lookups ----------

  private repo(id: string) {
    const r = this.state.repos.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `El repo ${id} no está conectado`);
    return r;
  }

  private agent(id: string) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No existe el agente ${id}`);
    return a;
  }

  private running() {
    return this.state.agents.filter((a) => BUSY.includes(a.status)).length;
  }

  /** Cloud agents working on a task in their Box, which an office restart doesn't stop. */
  private inBoxes() {
    return this.state.agents.filter((a) => a.host === 'box' && a.status === 'working' && !!a.boxCli);
  }

  /** True when the manager has set a session limit and every slot is taken. */
  private slotsFull() {
    const limit = this.state.settings.sessionLimit;
    return limit > 0 && this.running() >= limit;
  }

  private agentSlug(a: PersistedAgent) {
    return `${slugify(a.name)}-${a.id.slice(0, 4)}`;
  }

  /** The machines an agent's machine is one of: folders on this computer, or Upstash Boxes (docs/cloud.md). */
  private machinesFor(a: Pick<PersistedAgent, 'host'>): MachineProvider {
    return a.host === 'box' ? this.boxMachines : this.backend.machines;
  }

  /** Where an agent works: their machine's worktree, or (from before machines, until their next task) their floor desk. */
  private deskOf(a: PersistedAgent, repo: PersistedRepo) {
    return a.machine ? this.machinesFor(a).deskDir(a.machine, repo.fullName) : this.backend.deskDir(repo.fullName, this.agentSlug(a));
  }

  /** Stop what an agent left running at their desk: on their port, or started there. */
  private releaseDesk(a: PersistedAgent, repo: PersistedRepo) {
    return a.machine ? this.machinesFor(a).release(a.machine, repo.fullName, this.port(a)) : this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a));
  }

  /**
   * An agent's machine; one from before machines moves to theirs now, at the start of a task. Their sessions were kept
   * by the old desk folder (Claude Code stores them by folder), so none is resumed from the machine: fixes start fresh.
   */
  private machineOf(a: PersistedAgent) {
    if (a.machine) return a.machine;
    a.machine = machineName(a.id);
    a.sessionId = null;
    a.sessionCli = null;
    for (const q of this.state.qa) if (q.devAgentId === a.id) q.devSessionId = null;
    this.appendLog(a, [{ kind: 'system', text: '🖥️ Se muda a una máquina propia: su propio clon del repositorio, worktree y carpeta temporal.' }]);
    this.save(); // a restart from here on must know the machine is theirs, or its sweep takes it
    return a.machine;
  }

  /** The environment of an agent's sessions on their machine; nothing extra for one not on a machine yet. */
  private machineEnv(a: PersistedAgent): Record<string, string> | undefined {
    try {
      return a.machine ? this.machinesFor(a).env(a.machine) : undefined;
    } catch (err) {
      console.warn(`could not set up ${a.name}'s machine environment: ${oneLine(err)}`);
      return undefined;
    }
  }

  /** Remove a machine, saying where its unpushed work went; one still in use is tried again by sweepMachines. */
  private async removeMachine(machine: string, name: string | null, host: MachineHost = 'local') {
    const r = await this.machinesFor({ host }).remove(machine).catch(() => ({ removed: false, patches: [] as string[] }));
    if (r.patches.length) this.postMessage('office', `🧳 ${name ?? 'Un antiguo agente'} dejó trabajo que no estaba en ninguna rama de GitHub: guardado en ${path.dirname(r.patches[0])}.`);
    if (host === 'box' && r.removed) void this.cloud.count().catch(() => undefined);
  }

  /** Machines whose agents are gone (on this computer, or Boxes of this office): removed while still in use, or left by an office that stopped half-way. */
  private async sweepMachines() {
    for (const host of ['local', 'box'] as const) {
      const anyones = (m: string) => this.state.agents.some((a) => a.role !== 'ceo' && (a.host ?? 'local') === host && (a.machine ?? machineName(a.id)) === m);
      for (const m of await this.machinesFor({ host }).list().catch(() => [])) if (!anyones(m)) await this.removeMachine(m, null, host);
    }
  }

  private clearTask(a: PersistedAgent) {
    Object.assign(a, { status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, lastError: null });
    this.emitAgent(a);
  }

  // ---------- GitHub / repos ----------

  listGithubRepos(owner?: string) {
    return this.backend.listMyRepos(owner);
  }

  /**
   * Give a GitHub repo a floor. Its main checkout is one of your own folders: the one you picked, else the folder in
   * your projects folder that already has it as origin, else a fresh clone into your projects folder.
   */
  async connectRepo(fullName: string, opts: FloorOptions & { localPath?: string } = {}): Promise<RepoView> {
    const existing = this.state.repos.find((r) => r.id.toLowerCase() === fullName.toLowerCase());
    if (existing) throw new HttpError(409, `${fullName} ya es la planta ${existing.floor}`);
    const meta = await this.backend.repoMeta(fullName);
    const folder = opts.localPath ?? (await this.projectFolderFor(meta.nameWithOwner));
    const floor = this.state.repos.reduce((m, r) => Math.max(m, r.floor), 0) + 1;
    const repo: PersistedRepo = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor,
      color: FLOOR_COLORS[(floor - 1) % FLOOR_COLORS.length],
      autoAssign: !!opts.autoAssign,
      autoMerge: true,
      browserTesting: true,
      links: [],
      localPath: folder,
      mission: (opts.mission ?? '').trim().slice(0, 4000),
      summary: '',
      qaBrief: '',
      preview: { ...DEFAULT_PREVIEW, env: {} },
      addedAt: Date.now(),
    };
    this.backend.setLocalPath(repo.fullName, folder);
    this.state.repos.push(repo);
    this.repoRt.set(repo.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    this.save();
    this.emitRepo(repo);
    this.toast('success', `${repo.fullName} ya está conectado`);
    this.ensureAgent(repo);
    void this.cloneRepo(repo.id);
    void this.syncRepo(repo.id);
    // The CEO studies every new floor and sizes its team; a brief given here is the manager asking for a plan.
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
    if (repo.mission) this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
    return this.repoView(repo);
  }

  /** Where a GitHub repo's checkout goes when you connect it without picking a folder. */
  private async projectFolderFor(fullName: string): Promise<string> {
    const root = this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch(() => []);
    const match = folders.find((f) => f.github?.toLowerCase() === fullName.toLowerCase());
    if (match) return match.path;
    const name = fullName.split('/')[1];
    const taken = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new HttpError(409, `${taken.path} ya existe y no es un clon de ${fullName}. Conecta esa carpeta en su lugar, o cámbiale antes el nombre.`);
    return path.join(root, name); // cloned there when the floor opens
  }

  /** A brand-new project: a folder in your projects folder, pushed to a new GitHub repo. */
  async createRepo(name: string, opts: FloorOptions & { description?: string; visibility: 'private' | 'public'; owner?: string }) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Los nombres de proyecto solo pueden contener letras, números, ".", "-" y "_"');
    const created = await this.backend.createProject(this.state.settings.projectsDir, name, opts).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(created.fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: created.path });
  }

  /** The folders in your projects folder (or another folder you point at), and which are floors already. */
  async listProjectFolders(dir?: string): Promise<{ root: string; folders: ProjectFolderView[] }> {
    const root = dir?.trim() ? path.resolve(dir.trim()) : this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const floorOf = (f: { path: string; github: string | null }) =>
      this.state.repos.find((r) => (r.localPath && same(r.localPath, f.path)) || (f.github && r.id.toLowerCase() === f.github.toLowerCase()))?.floor ?? null;
    return { root, folders: folders.map((f) => ({ name: f.name, path: f.path, git: f.git, github: f.github, floor: floorOf(f) })) };
  }

  /** Give one of your folders a floor. It must already be on GitHub; otherwise publish it first. */
  async connectFolder(dir: string, opts: FloorOptions = {}) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    if (!f.github) throw new HttpError(400, `${f.name} ${f.git ? 'todavía no está en GitHub' : 'todavía no es un repositorio git'}. Publícalo antes en GitHub.`);
    return this.connectRepo(f.github, { ...opts, localPath: f.path });
  }

  /** Put one of your folders on GitHub (only what's committed goes up), then give it a floor. */
  async publishFolder(dir: string, opts: FloorOptions & { name?: string; visibility: 'private' | 'public'; description?: string }) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const name = (opts.name?.trim() || f.name).replace(/[^A-Za-z0-9._-]+/g, '-');
    const fullName = await this.backend.publishFolder(f.path, { name, visibility: opts.visibility, description: opts.description }).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: f.path });
  }

  disconnectRepo(id: string) {
    const repo = this.repo(id);
    this.state.ceo.queue = this.state.ceo.queue.filter((j) => j.repoId !== id);
    for (const r of this.state.requests.filter((x) => x.repoId === id && x.status === 'pending')) {
      this.decide(r, { status: 'rejected', note: 'Se desconectó la planta.', decidedBy: null });
    }
    for (const a of this.state.agents.filter((x) => x.repoId === id)) this.fireAgent(a.id, true);
    void this.previews.remove({ ...repo });
    this.state.repos = this.state.repos.filter((r) => r.id !== id);
    for (const q of this.state.qa.filter((x) => x.repoId === id)) {
      this.broadcast({ type: 'qaRemoved', repoId: id, prNumber: q.prNumber });
      void removeQaShots(qaShotsDir(QA_SHOTS_DIR, id, q.prNumber)).catch(() => undefined);
    }
    this.state.qa = this.state.qa.filter((q) => q.repoId !== id);
    this.state.held = this.state.held.filter((h) => h.repoId !== id);
    for (const r of this.state.repos) r.links = r.links.filter((l) => l !== id);
    this.repoRt.delete(id);
    // Keep floors contiguous.
    this.state.repos.sort((a, b) => a.floor - b.floor).forEach((r, i) => (r.floor = i + 1));
    this.backend.setLocalPath(repo.fullName, null);
    this.save();
    this.broadcast({ type: 'repoRemoved', repoId: id });
    for (const r of this.state.repos) this.emitRepo(r);
    this.toast('info', repo.localPath ? `${repo.fullName} ha dejado el edificio. Tu carpeta ${repo.localPath} sigue intacta.` : `${repo.fullName} desconectado (su clon se queda en el disco)`);
  }

  updateRepo(
    id: string,
    patch: Partial<Pick<PersistedRepo, 'autoAssign' | 'autoMerge' | 'browserTesting' | 'color' | 'links' | 'mission' | 'summary' | 'qaBrief'>> & { previewCommand?: unknown; previewEnv?: unknown },
  ) {
    const repo = this.repo(id);
    const preview = parsePreviewPatch(patch.previewCommand, patch.previewEnv);
    repo.preview = { ...repo.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(repo);
    if (patch.autoAssign !== undefined) repo.autoAssign = !!patch.autoAssign;
    if (patch.autoMerge !== undefined) {
      repo.autoMerge = !!patch.autoMerge;
      if (repo.autoMerge) void this.syncRepo(repo.id);
    }
    if (patch.browserTesting !== undefined) repo.browserTesting = !!patch.browserTesting;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) repo.color = patch.color;
    if (Array.isArray(patch.links)) repo.links = patch.links.filter((l) => l !== id && this.state.repos.some((r) => r.id === l));
    if (typeof patch.mission === 'string') repo.mission = patch.mission.trim().slice(0, 4000);
    if (typeof patch.summary === 'string') repo.summary = patch.summary.trim().slice(0, 140);
    if (typeof patch.qaBrief === 'string') repo.qaBrief = patch.qaBrief.trim().slice(0, 2500);
    this.save();
    this.emitRepo(repo);
    setTimeout(() => this.schedule(), 200);
    return this.repoView(repo);
  }

  // ---------- auto-merge ----------

  /**
   * Auto-merge (floors with it on): a swarm PR merges itself once QA has signed off on its latest commit and GitHub's
   * checks are green. Failing checks and merge conflicts go back to a developer; new commits after QA's sign-off send
   * it back to QA. Merging deletes the remote branch, and the floor's folder then fast-forwards (syncRepo sees the merge).
   */
  private async advanceMerges(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || !repo.autoMerge || rt.merging) return;
    rt.merging = true;
    let merged = false;
    try {
      for (const rec of this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'passed')) {
        const pr = rt.pulls.find((p) => p.number === rec.prNumber && p.state === 'OPEN');
        if (!pr || !pr.headRefName.startsWith('swarm/')) continue; // people's own PRs are theirs to merge
        // Only act on PR data fetched after the record last changed (a fix may have just pushed).
        if ((rt.fetchedAt ?? 0) < rec.updatedAt) continue;
        try {
          if (await this.advanceMerge(repo, rec, pr)) merged = true;
        } catch (err) {
          console.warn(`auto-merge of ${repo.fullName}#${pr.number} failed`, err);
          this.mergeNote(rec, `el auto-merge ha tenido un problema: ${oneLine(err)}`);
        }
      }
    } finally {
      rt.merging = false;
    }
    if (merged) {
      await this.syncRepo(repo.id);
      setTimeout(() => this.schedule(), 200);
    }
  }

  /** One step toward merging a QA-passed PR. Returns true when it merged. */
  private async advanceMerge(repo: PersistedRepo, rec: QaRecord, pr: PullInfo): Promise<boolean> {
    let step = mergeStep(pr, rec, Date.now(), { base: repo.defaultBranch });
    if (step.do === 'details') {
      // GitHub works mergeability out lazily and lists often say UNKNOWN; asking about the PR itself gets an answer.
      const d = await this.backend.prDetails(repo.fullName, pr.number);
      pr = { ...pr, headSha: d.headSha, mergeable: d.mergeable, mergeState: d.mergeState };
      step = mergeStep(pr, rec, Date.now(), { base: repo.defaultBranch, detailed: true });
    }
    Object.assign(rec, step.set);
    if (step.do === 'requeue') {
      // Commits arrived after QA's sign-off: they get tested too.
      this.setQa(rec, { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, mergeNote: null, pendingSince: null });
      setTimeout(() => this.schedule(), 200);
      return false;
    }
    if (step.do === 'rerun') {
      // A red check may be a flake or an outage: re-run it once for this commit before a developer is sent to fix it.
      try {
        await this.backend.rerunFailedJobs(repo.fullName, step.runIds);
      } catch (err) {
        console.warn(`could not re-run the failed checks of ${repo.fullName}#${pr.number}`, err);
        return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
      }
      this.setQa(rec, { rerunSha: pr.headSha, rerunAt: Date.now(), pendingSince: null, alerted: false, mergeNote: 'relanzando un check fallido' });
      return false;
    }
    if (step.do === 'send-back') return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
    if (step.do === 'wait') {
      if (step.alert) {
        this.postMessage('office', `⏳ La PR #${pr.number} de ${repo.fullName} ha pasado QA, pero sus checks (${pr.pendingChecks.join(', ')}) llevan más de ${CHECKS_ALERT_MS / 60_000} minutos en curso. Se fusionará en cuanto terminen.`);
      }
      return step.note === undefined ? false : this.mergeNote(rec, step.note);
    }
    if (step.do === 'update-branch') {
      // The repo only merges up-to-date branches. GitHub merges the base in cleanly (or refuses); CI checks the result.
      this.mergeNote(rec, `actualizando la rama con ${repo.defaultBranch}`);
      await this.backend.updateBranch(repo.fullName, pr.number);
      const details = await this.backend.prDetails(repo.fullName, pr.number);
      this.setQa(rec, { passedSha: details.headSha });
      return false;
    }
    if (step.do !== 'merge') return false;
    this.mergeNote(rec, 'fusionando…');
    let error = '';
    for (const method of ['squash', 'merge', 'rebase'] as const) {
      try {
        await this.backend.mergePull(repo.fullName, pr.number, method, rec.passedSha ?? pr.headSha);
        error = '';
        break;
      } catch (err) {
        error = oneLine(err).replace(/^gh .*? failed: /, '');
        if (!/not allowed/i.test(error)) break; // only a merge method the repo turned off is worth another try
      }
    }
    if (error && /head (branch|commit)/i.test(error)) return this.mergeNote(rec, 'han llegado commits nuevos; QA los revisa primero'); // the next sync re-queues it
    if (error) {
      rec.mergeRetryAt = Date.now() + MERGE_RETRY_MS;
      if (!rec.alerted) {
        rec.alerted = true;
        this.postMessage('office', `⚠️ La PR #${pr.number} de ${repo.fullName} ha pasado QA y sus checks, pero GitHub no la fusiona: ${error}. La oficina lo reintenta cada ${MERGE_RETRY_MS / 60_000} minutos; si sigue fallando, fusiónala tú o cambia las reglas de merge del repo.`);
      }
      return this.mergeNote(rec, `merge bloqueado: ${error}`);
    }
    this.toast('success', `🔀 PR #${pr.number} fusionada en ${repo.defaultBranch}: ${pr.title}`);
    this.notifyMerge(repo, pr.number, pr.title);
    await this.closeResolvedIssues(repo, pr.number, pr);
    return true;
  }

  /**
   * After the office merges a PR: close the issues it resolves now rather than waiting for GitHub's "Closes #N" (which
   * lags, and never comes when the link wasn't recognised), so the scheduler doesn't hand them out again. Never throws.
   */
  private async closeResolvedIssues(repo: PersistedRepo, prNumber: number, pr: Pick<PullInfo, 'headRefName' | 'closesIssues'>) {
    const numbers = issuesResolvedBy(pr);
    const rt = this.repoRt.get(repo.id);
    if (rt && rt.issues.some((i) => numbers.includes(i.number))) {
      rt.issues = rt.issues.filter((i) => !numbers.includes(i.number));
      this.emitRepo(repo);
    }
    // A merge is the normal end: whoever only remembers the PR or its issues is cleared, and nobody's session stops.
    if (rt) {
      for (const n of numbers) rt.closedIssues.set(n, Date.now());
      this.learnPull(repo, { number: prNumber, headRefName: pr.headRefName, closesIssues: pr.closesIssues }, 'MERGED');
    }
    for (const n of numbers) {
      try {
        if ((await this.backend.issueState(repo.fullName, n)) !== 'OPEN') continue;
        await this.backend.closeIssue(repo.fullName, n, `Shipped in #${prNumber}`);
      } catch (err) {
        console.warn(`could not close ${repo.fullName}#${n} after merging #${prNumber}`, err);
      }
    }
  }

  /** Show where auto-merge stands on a PR's card. Doesn't count as a change to the record. */
  private mergeNote(rec: QaRecord, text: string | null) {
    if (rec.mergeNote !== text) {
      rec.mergeNote = text;
      this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    }
    return false;
  }

  /** QA passed, but the PR can't merge as it is: a developer fixes it, and QA re-tests if the code changed. */
  private sendBack(repo: PersistedRepo, rec: QaRecord, reason: 'checks' | 'conflict', fixInstructions: string, needsHuman: boolean) {
    if (needsHuman) {
      this.stuck(rec, { mergeNote: null }, `sigue ${reason === 'conflict' ? `teniendo conflictos con ${repo.defaultBranch}` : 'fallando sus checks'} tras ${MAX_MERGE_FIXES} correcciones`);
      return false;
    }
    this.setQa(rec, { status: 'failed', fixReason: reason, fixInstructions, mergeFixes: rec.mergeFixes + 1, mergeNote: null, pendingSince: null });
    setTimeout(() => this.schedule(), 200);
    return false;
  }

  /** Fast-forward the floor's main checkout (usually your own project folder) and report how it stands. */
  private async syncFolder(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || rt.cloneStatus !== 'ready') return rt?.folderSync ?? null;
    const own = this.backend.office.isOwnFolder(this.backend.mainDir(repo.fullName)); // updating the running office restarts it mid-work
    const sync = await this.backend.syncMain(repo.fullName, repo.defaultBranch, { touch: !own }).catch((err) => ({ status: `sync failed: ${oneLine(err)}`, behind: 0, updatable: false }));
    const status = sync?.status ?? null;
    if (own && sync) this.setOfficeBehind(sync.updatable ? sync.behind : 0);
    if (!this.repoRt.has(repo.id)) return null;
    const before = rt.folderSync;
    rt.folderSync = status;
    this.emitRepo(repo);
    if (status && status !== before) {
      const name = repo.localPath ? path.basename(repo.localPath) : repo.fullName;
      if (status.startsWith('updated')) this.toast('success', `📁 ${name}: ${status}`);
      else if (/behind|diverged|failed/.test(status)) this.toast('info', `📁 ${name} no se ha actualizado: ${status}`);
    }
    return status;
  }

  /** The manager's "Sync now". */
  async syncFolderNow(repoId: string) {
    return { folderSync: await this.syncFolder(this.repo(repoId)) };
  }

  /** Remove the floor's desks, desk folders and swarm/qa branches nobody uses any more; say so when something went. */
  private async sweepFloor(repoId: string) {
    const repo = this.state.repos.find((r) => r.id === repoId);
    const rt = this.repoRt.get(repoId);
    if (!repo || !rt || rt.cloneStatus !== 'ready') return;
    try {
      const pulls = rt.lastSync ? rt.pulls : await this.backend.listPulls(repo.fullName);
      const agents = this.state.agents.filter((a) => a.repoId === repo.id);
      const keep = {
        // Floor desks: the previews', and those of agents not on a machine yet. Old desks go once their agents moved.
        desks: [...agents.filter((a) => !a.machine).map((a) => this.agentSlug(a)), PREVIEW_SLUG, ...this.previews.prSlugs(repo)],
        branches: [...agents.flatMap((a) => (a.branch ? [a.branch] : [])), ...pulls.filter((p) => p.state === 'OPEN').map((p) => p.headRefName)],
      };
      const r = await this.backend.sweepDesks(repo.fullName, keep);
      for (const a of agents) if (a.machine) r.branches += await this.machinesFor(a).sweep(a.machine, repo.fullName, keep.branches).catch(() => 0);
      const desks = r.desks + r.folders;
      const saved = r.patches.length ? ` (${r.patches.length} parche${r.patches.length === 1 ? '' : 's'} guardado${r.patches.length === 1 ? '' : 's'} en ${path.dirname(r.patches[0])})` : '';
      console.log(`desk sweep ${repo.fullName}: ${desks} desks, ${r.branches} branches removed${saved}${r.skipped.length ? `, ${r.skipped.length} still in use` : ''}`);
      if (!desks && !r.branches) return;
      const removed = [desks && `${desks} puesto${desks === 1 ? '' : 's'} antiguo${desks === 1 ? '' : 's'}`, r.branches && `${r.branches} rama${r.branches === 1 ? '' : 's'} terminada${r.branches === 1 ? '' : 's'}`].filter(Boolean).join(' y ');
      const text = `🧹 ${repo.fullName.split('/')[1]}: eliminados ${removed}${saved}`;
      this.toast('info', text);
      this.postMessage('office', text);
    } catch (err) {
      console.warn(`desk sweep ${repo.fullName} failed: ${oneLine(err)}`);
    }
  }

  // ---------- the floor's app (preview monitor) ----------

  /** Run the floor's app from its preview worktree: the default branch, or an open PR. Replaces what it is running now. */
  async startPreview(id: string, pr?: number | null): Promise<PreviewView> {
    const repo = this.repo(id);
    return this.previews.start(repo, `${repo.fullName.split('/')[1]} app`, pr);
  }

  stopPreview(id: string): Promise<PreviewView> {
    return this.previews.stop(this.repo(id));
  }

  /** The PR theatre: run an open PR beside the floor's main preview (kept when it's already up, unless restart). */
  startPrPreview(id: string, pr: number, restart = false): Promise<PrPreviewView> {
    const repo = this.repo(id);
    return this.previews.startPr(repo, pr, `${repo.fullName.split('/')[1]} app`, restart);
  }

  stopPrPreview(id: string, pr: number): Promise<void> {
    return this.previews.stopPr(this.repo(id), pr);
  }

  /** An open app viewer's heartbeat: the PR preview it has on screen (null: none). */
  watchPreview(viewer: string, repoId: string | null, pr: number | null) {
    if (repoId) this.repo(repoId);
    this.previews.watch(viewer, repoId, pr);
  }

  /** The address of a sync proxy in front of the floor's app (pr null) or a PR preview, for compare mode's synced scrolling. */
  async previewSyncUrl(id: string, pr: number | null): Promise<{ url: string }> {
    return { url: await this.previews.syncUrl(this.repo(id), pr) };
  }

  /** One of QA's screenshots from a PR's latest round. */
  async qaShot(repoId: string, pr: number, index: number): Promise<{ data: Buffer; mime: string } | null> {
    const shot = this.state.qa.find((q) => q.repoId === repoId && q.prNumber === pr)?.shots?.[index];
    if (!shot) return null;
    const data = await readQaShot(qaShotsDir(QA_SHOTS_DIR, repoId, pr), index, shot.mime);
    return data && { data, mime: shot.mime };
  }

  /**
   * Server shutdown: stop every floor's app so nothing is left holding a preview port. Agents' CLIs keep working
   * through a restart (the terminal keeper holds them for the next start) and stop when the office quits.
   */
  async shutdown(restart = false): Promise<void> {
    this.backend.cloud.detach(); // cloud agents' CLIs carry on in their Boxes: their records are final from here
    await this.writeState().catch((err) => console.warn('could not save the state', err));
    await this.backend.releaseClis(restart); // before the terminals are saved: whatever they print next waits in the keeper
    await this.saveTerminals(true);
    await this.previews.stopAll(this.state.repos);
  }

  private async cloneRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.cloneStatus === 'cloning') return;
    rt.cloneStatus = 'cloning';
    rt.cloneError = undefined;
    this.emitRepo(repo);
    try {
      await this.backend.ensureClone(repo.fullName);
      rt.cloneStatus = 'ready';
      void this.previews.refreshDefault(repo);
      void this.sweepFloor(id);
    } catch (err) {
      rt.cloneStatus = 'error';
      rt.cloneError = (err as Error).message;
      this.toast('error', `No se ha podido clonar ${repo.fullName}: ${rt.cloneError}`);
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  async syncRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.syncing) return;
    rt.syncing = true;
    try {
      const started = Date.now();
      const [issues, pulls] = await Promise.all([this.backend.listIssues(repo.fullName), this.backend.listPulls(repo.fullName)]);
      rt.issues = issues;
      rt.pulls = pulls;
      this.issueAges.learn(repo.id, issues);
      this.issueAges.stamp(repo.id, pulls);
      void this.lookUpIssueAges(repo);
      rt.lastSync = Date.now();
      rt.fetchedAt = started;
      rt.syncError = undefined;
      await this.askGitHub(repo, rt);
      if (!this.repoRt.has(id)) return; // disconnected meanwhile
      this.settleLearned(rt);
      this.ledgerPulls(repo, rt.pulls); // while the QA records still say who wrote what
      this.cleanUpClosed(repo);
      this.recordSync(repo, rt.pulls);
      this.reconcilePulls(repo, rt.pulls);
      // Something was merged since the last look (by the office or anyone else): bring the folder up to date.
      const newest = pulls.reduce<string | null>((m, p) => (p.mergedAt && (!m || p.mergedAt > m) ? p.mergedAt : m), null);
      if (newest !== rt.lastMergedAt) {
        rt.lastMergedAt = newest;
        void this.syncFolder(repo);
      }
      void this.advanceMerges(repo);
    } catch (err) {
      rt.syncError = (err as Error).message;
    } finally {
      rt.syncing = false;
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  /** When the issues behind the day's merges were filed, if the office never saw them open (e.g. after a restart). */
  private async lookUpIssueAges(repo: PersistedRepo) {
    const wanted = this.issueAges.wanted(repo.id, this.repoRt.get(repo.id)?.pulls ?? [], Date.now());
    if (!wanted.length) return;
    for (const n of wanted) this.issueAges.know(repo.id, n, (await this.backend.issueDetails(repo.fullName, n).catch(() => null))?.createdAt);
    const rt = this.repoRt.get(repo.id);
    if (!rt) return;
    this.issueAges.stamp(repo.id, rt.pulls);
    this.emitRepo(repo);
  }

  /** Tell the ledger what a sync saw: open PRs (and their checks), merges, and which PRs went away. */
  private ledgerPulls(repo: PersistedRepo, pulls: PullInfo[]) {
    const now = Date.now();
    for (const pr of pulls) {
      if (pr.state === 'OPEN') this.ledger({ kind: 'pr-open', repoId: repo.id, pr: pr.number, title: pr.title, author: this.prAuthor(repo, pr), checks: pr.checks, at: now });
      else if (pr.state === 'MERGED') {
        const at = pr.mergedAt ? Date.parse(pr.mergedAt) : now;
        this.ledger({ kind: 'merged', repoId: repo.id, repoName: repo.fullName, pr: pr.number, title: pr.title, author: this.prAuthor(repo, pr), at: Number.isFinite(at) ? Math.min(at, now) : now });
      }
    }
    this.ledger({ kind: 'listed', repoId: repo.id, numbers: pulls.map((p) => p.number), at: now });
  }

  /**
   * Every swarm PR goes through QA, including ones opened before QA existed or while the server was down. (Merged and
   * closed PRs leave QA, and agents who had them are cleared, in cleanUpClosed.)
   */
  private reconcilePulls(repo: PersistedRepo, pulls: PullInfo[]) {
    for (const pr of pulls) {
      if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith('swarm/')) continue;
      if (this.state.qa.some((q) => q.repoId === repo.id && q.prNumber === pr.number)) continue;
      const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role !== 'ceo' && a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
      this.queueQa(repo, pr.number, dev ?? null, pr.closesIssues[0] ?? null);
    }
    this.save();
  }

  async createIssue(repoId: string, title: string, body: string, assignTo?: string) {
    const repo = this.repo(repoId);
    if (!title.trim()) throw new HttpError(400, 'Un issue necesita un título');
    const number = await this.backend.createIssue(repo.fullName, title.trim(), body);
    await this.syncRepo(repo.id);
    this.toast('success', `Issue #${number} abierto en ${repo.fullName}`);
    if (assignTo) await this.assign(assignTo, number);
    else setTimeout(() => this.schedule(), 200);
    return number;
  }

  async mergePull(repoId: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number));
    await this.backend.mergePull(repo.fullName, number, method);
    this.toast('success', `PR #${number} fusionada en ${repo.defaultBranch}`);
    this.notifyMerge(repo, number, pr.title);
    await this.closeResolvedIssues(repo, number, pr);
    await this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 200);
  }

  /** The manager's Close on a PR: closed on GitHub, and its QA, fix and anyone working on it stop now. */
  async closePull(repoId: string, number: number) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number).catch(() => null));
    await this.backend.closePull(repo.fullName, number);
    this.learnPull(repo, { number, headRefName: pr?.headRefName ?? '', closesIssues: pr?.closesIssues ?? [] }, 'CLOSED');
    await this.syncRepo(repo.id);
  }

  /** The manager's Close on an issue: closed on GitHub as not planned, and whoever works on it stops now. */
  async closeIssueByManager(repoId: string, number: number, resolvedBy?: number) {
    const repo = this.repo(repoId);
    const rt = this.repoRt.get(repo.id);
    const state = rt?.issues.some((i) => i.number === number) ? 'OPEN' : await this.backend.issueState(repo.fullName, number).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number, state, pulls: rt?.pulls ?? [] });
    const by = this.state.settings.managerName || 'el responsable';
    // From the office doctor, for an issue a merged PR resolved: closed as completed, not as not planned.
    if (resolvedBy) await this.backend.closeIssue(repo.fullName, number, `Resuelto por #${resolvedBy}; cerrado por ${by} desde la oficina de sareoffice.`, 'completed');
    else await this.backend.closeIssue(repo.fullName, number, `Cerrado como no planificado por ${by} desde la oficina de sareoffice.`, 'not planned');
    this.toast('info', `#${number} cerrado en ${repo.fullName}`);
    this.learnIssueClosed(repo, number);
    await this.syncRepo(repo.id);
  }

  // ---------- closed issues and PRs ----------

  /** The floor's issues and PRs as the office knows them now (closeCleanup.ts). */
  private floorState(rt: RepoRuntime): FloorState {
    return { fetchedAt: rt.fetchedAt ?? 0, openIssues: rt.issues.map((i) => i.number), pulls: rt.pulls, closedIssues: rt.closedIssues, closedPulls: rt.closedPulls };
  }

  /** The floor's agents whose work a closure can end. One whose stopped session is still ending is left to finish. */
  private holders(repo: PersistedRepo) {
    return this.state.agents.filter((a) => a.repoId === repo.id && !this.dropping.has(a.id));
  }

  /** Ask GitHub about the issues and PRs agents, QA records or holds hold that the last sync doesn't list. */
  private async askGitHub(repo: PersistedRepo, rt: RepoRuntime) {
    const held = this.state.held.filter((h) => h.repoId === repo.id).map((h) => h.issue);
    const ask = toAsk(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), held, this.floorState(rt), rt.openAt, Date.now());
    await Promise.all([
      ...ask.issues.map(async (n) => {
        const state = await this.backend.issueState(repo.fullName, n).catch(() => null);
        if (state === 'CLOSED') rt.closedIssues.set(n, Date.now());
        else if (state === 'OPEN') rt.openAt.set(`issue#${n}`, Date.now());
      }),
      ...ask.pulls.map(async (n) => {
        const pr = await this.backend.prDetails(repo.fullName, n).catch(() => null);
        if (pr?.state === 'OPEN') rt.openAt.set(`pr#${n}`, Date.now());
        else if (pr) {
          rt.closedPulls.set(n, { number: n, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.holdIssues(repo, rt.closedPulls.get(n)!);
        }
      }),
    ]);
  }

  /** After a sync: forget closures it shows reopened, and keep what it lists in step with closures learned since it started. */
  private settleLearned(rt: RepoRuntime) {
    const gone = forgettable(this.floorState(rt), Date.now());
    for (const n of gone.issues) rt.closedIssues.delete(n);
    for (const n of gone.pulls) rt.closedPulls.delete(n);
    for (const [key, at] of rt.openAt) if (Date.now() - at > ASK_AGAIN_MS) rt.openAt.delete(key);
    const f = this.floorState(rt);
    rt.issues = rt.issues.filter((i) => issueOpen(i.number, f) !== false);
    rt.pulls = rt.pulls.map((p) => (p.state === 'OPEN' && pullNow(p.number, f)?.state === 'CLOSED' ? { ...p, state: 'CLOSED' as const } : p));
  }

  /** Stop and clear the work on the floor's closed issues and PRs (closeCleanup.ts). Returns the names of those it stopped. */
  private cleanUpClosed(repo: PersistedRepo): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const f = this.floorState(rt);
    const gone = this.state.held.filter((h) => h.repoId === repo.id && issueOpen(h.issue, f) === false);
    if (gone.length) {
      this.state.held = this.state.held.filter((h) => !gone.includes(h));
      this.emitRepo(repo);
    }
    const closures = closuresHeld(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), f);
    // PR previews of PRs that merged or closed stop too, held by anyone or not; what the office learned first counts.
    // Not before the first sync: an empty list would read as every PR gone.
    if (rt.lastSync) this.previews.pullsChanged(repo, [...rt.pulls.filter((p) => !rt.closedPulls.has(p.number)), ...rt.closedPulls.values()]);
    return closures.flatMap((c) => this.applyClosure(repo, c));
  }

  private applyClosure(repo: PersistedRepo, c: Closure): string[] {
    const plan = afterClose(c, this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), BUSY);
    const agent = (id: string) => this.state.agents.find((a) => a.id === id)!;
    const why = closedWhy(c);
    const stopped = plan.stop.map(agent);
    for (const a of stopped) this.stopForClosure(a, why);
    for (const a of plan.clear.map(agent)) {
      const merged = c.kind === 'pr' && c.merged;
      if (a.task === 'qa') this.dropTask(a, null); // they only tested it
      else this.dropTask(a, merged ? `🎉 La PR #${c.number} se ha fusionado. Listo para el siguiente issue.` : `↺ ${why[0].toUpperCase()}${why.slice(1)}. Puesto despejado.`, merged ? 'done' : 'system');
    }
    if (plan.dropQa) this.dropRecord(repo, c.number);
    if (stopped.length) this.postMessage('office', stoppedMessage(stopped.map((a) => a.name), c, repo.fullName));
    if (stopped.length || plan.clear.length || plan.dropQa) {
      this.save();
      setTimeout(() => this.schedule(), 200);
    }
    return stopped.map((a) => a.name);
  }

  /** End a session whose issue or PR closed, as ■ Stop does. Its desk is cleared once the session has ended. */
  private stopForClosure(a: PersistedAgent, why: string) {
    a.status = 'stopped';
    a.lastError = `Detenido: ${why}`;
    this.dropping.set(a.id, why);
    this.appendLog(a, [{ kind: 'system', text: `■ Detenido: ${why}.` }]);
    this.emitAgent(a);
    this.agentRt.get(a.id)?.session?.stop(); // no session yet (preparing): prepare() gives up and clears it
    const sign = this.signIns.get(a.id);
    if (sign?.held) {
      // Waiting for their sign-in: there's nothing to give up, so the desk is cleared now.
      sign.held = null;
      this.abandoned(a);
    }
  }

  /** Clear the desk of an agent whose work closed, as ↺ Clear desk does. */
  private dropTask(a: PersistedAgent, text: string | null, kind: LogLine['kind'] = 'system') {
    this.dropping.delete(a.id);
    this.agentRt.get(a.id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    if (text) this.appendLog(a, [{ kind, text }]);
  }

  /** A task given up before its session started: one stopped because its issue or PR closed clears the desk now. */
  private abandoned(a: PersistedAgent): null {
    if (this.dropping.has(a.id)) this.dropTask(a, '↺ Puesto despejado. Listo para trabajo nuevo.');
    return null;
  }

  /** A closed or merged PR leaves QA, so its QA or fix is never handed out again. */
  private dropRecord(repo: PersistedRepo, prNumber: number) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (!rec) return;
    this.state.qa = this.state.qa.filter((q) => q !== rec);
    this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber });
    void removeQaShots(qaShotsDir(QA_SHOTS_DIR, repo.id, prNumber)).catch(() => undefined);
    this.clearPrepStrikes(repo.id, prNumber);
    this.fixNudged.delete(`${repo.id}#${prNumber}`);
    this.save();
  }

  /** The office closed an issue, or found it closed: off the board, and its work cleaned up now. Returns who it stopped. */
  private learnIssueClosed(repo: PersistedRepo, n: number): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    rt.closedIssues.set(n, Date.now());
    if (rt.issues.some((i) => i.number === n)) {
      rt.issues = rt.issues.filter((i) => i.number !== n);
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /**
   * The office closed or merged a PR, or found it so: its work is cleaned up now, not at the next sync. A closed PR's
   * issues wait for the manager, unless it was closed to be built again (rebuild). Returns who it stopped.
   */
  private learnPull(repo: PersistedRepo, pr: Omit<KnownPull, 'state'>, state: 'CLOSED' | 'MERGED', rebuild = false): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const known: LearnedPull = { number: pr.number, headRefName: pr.headRefName, closesIssues: pr.closesIssues, state, at: Date.now() };
    rt.closedPulls.set(pr.number, known);
    if (!rebuild) this.holdIssues(repo, known);
    if (state === 'CLOSED' && rt.pulls.some((p) => p.number === pr.number && p.state === 'OPEN')) {
      rt.pulls = rt.pulls.map((p) => (p.number === pr.number ? { ...p, state } : p));
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /** A closed PR's open issues wait for the manager instead of going back to auto-assign (toHold). */
  private holdIssues(repo: PersistedRepo, pr: KnownPull) {
    const rt = this.repoRt.get(repo.id);
    const add = rt ? toHold(pr, this.floorState(rt)).filter((n) => !this.isHeld(repo.id, n)) : [];
    if (!add.length) return;
    this.state.held.push(...add.map((issue) => ({ repoId: repo.id, issue, pr: pr.number })));
    this.emitRepo(repo);
    this.save();
  }

  private isHeld(repoId: string, n: number) {
    return this.state.held.some((h) => h.repoId === repoId && h.issue === n);
  }

  // ---------- agents ----------

  hireAgent(
    repoId: string,
    opts: {
      name?: string;
      model?: string;
      effort?: string;
      look?: string;
      cli?: string;
      /** Where they work: 'local', 'box', or '' / absent for the office default (Settings → Cloud agents). */
      host?: string;
      /** Refuse rather than fall back to this computer when they can't be a cloud agent (the manager chose). */
      strict?: boolean;
      appearance?: { color: string; hair: string; skin: string };
      /** Their id, when it's known before they're hired (a team change's): their look is seeded from it. */
      id?: string;
    },
  ) {
    const repo = this.repo(repoId);
    const team = this.state.agents.filter((a) => a.repoId === repo.id);
    const max = this.state.settings.maxAgents;
    if (team.length >= max) throw new HttpError(409, `${projectName(repo)} ya tiene ${team.length} agentes, su máximo (${max}). Sube "Máximo de agentes por proyecto" en Ajustes para añadir más.`);
    const used = new Set(team.map((a) => a.desk));
    let desk = 0;
    while (used.has(desk)) desk++;
    if (desk >= FLOOR_SEATS) throw new HttpError(409, `${projectName(repo)} ya tiene el máximo de ${FLOOR_SEATS} agentes`);
    const name = opts.name?.trim().slice(0, 24) || this.freeName();
    const cli = isCli(opts.cli) ? opts.cli : '';
    const host = this.hostFor(opts.host, cli || this.state.settings.defaultCli, !!opts.strict);
    // A cloud agent's CLI is the one the office installs in their Box, not this computer's.
    if (cli && host === 'local' && !this.cliReady(cli)) throw new HttpError(400, `${cliLabel(cli)} no está instalado en este ordenador.`);
    const id = opts.id && !this.state.agents.some((a) => a.id === opts.id) ? opts.id : crypto.randomUUID();
    const agent: PersistedAgent = {
      id,
      name,
      repoId: repo.id,
      role: 'agent',
      look: LOOKS.includes(opts.look as AgentLook) ? (opts.look as AgentLook) : lookFor(name),
      task: null,
      desk,
      color: opts.appearance?.color ?? pick(SHIRTS),
      hair: opts.appearance?.hair ?? pick(HAIR),
      skin: opts.appearance?.skin ?? pick(SKIN),
      style: null,
      model: opts.model ?? '',
      effort: EFFORTS.includes(opts.effort as EffortLevel) ? (opts.effort as EffortLevel) : '',
      cli,
      machine: machineName(id),
      ...(host === 'box' ? { host } : {}),
      status: 'idle',
      issueNumber: null,
      issueTitle: null,
      branch: null,
      prNumber: null,
      prUrl: null,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      sessionId: null,
      sessionCli: null,
      lastError: null,
      logTail: [],
    };
    this.state.agents.push(agent);
    applyLedger(this.state.progress, { kind: 'hired', agentId: agent.id, at: Date.now() });
    this.agentRt.set(agent.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    this.appendLog(agent, [{ kind: 'system', text: `👋 ${name} se ha incorporado a ${projectName(repo)} (${repo.fullName})${host === 'box' ? ', trabajando en la nube' : ''}.` }]);
    this.save();
    this.broadcast({ type: 'agent', agent: this.agentView(agent, false) });
    if (host === 'box') this.bringUpBox(agent);
    setTimeout(() => this.schedule(), 200);
    return this.agentView(agent, true);
  }

  // ---------- cloud agents (docs/cloud.md) ----------

  /**
   * Where a new (or moving) agent works: what was asked, else the office default. A cloud agent needs the Upstash key,
   * room under the plan's Box limit and a CLI a Box can run (Claude Code or Codex). `strict`: the manager asked for the
   * cloud, so say why not; otherwise (a floor's first agent, the demo) they work on this computer instead.
   */
  private hostFor(asked: string | undefined, cli: AgentCli, strict: boolean, moving?: PersistedAgent): MachineHost {
    const want: MachineHost = asked === 'box' || asked === 'local' ? asked : this.state.settings.cloud.machineKind;
    if (want === 'local') return 'local';
    const why = !this.cloud.boxApi()
      ? 'Los agentes en la nube necesitan antes tu clave de API de Upstash Box: Ajustes → Agentes en la nube.'
      : cli === 'opencode'
        ? 'OpenCode todavía no puede ejecutarse en una máquina en la nube: dale a este agente Claude Code o Codex.'
        : !this.boxRoom(moving)
          ? `Has alcanzado el límite de Boxes de tu plan de Upstash (${this.state.settings.cloud.boxLimit}). Súbelo en Ajustes → Agentes en la nube si tu plan permite más, o borra Boxes que no necesites.`
          : null;
    if (!why) return 'box';
    if (strict || asked === 'box') throw new HttpError(409, why);
    return 'local';
  }

  /** There's room for one more Box under the plan's limit (Boxes on the account, or cloud agents, whichever is more). */
  private boxRoom(moving?: PersistedAgent) {
    const agents = this.state.agents.filter((a) => a.host === 'box' && a !== moving).length;
    return Math.max(this.cloud.view().boxes?.total ?? 0, agents) < this.state.settings.cloud.boxLimit;
  }

  /** Create and set up a new cloud agent's Box in the background, so their first task doesn't wait for it. */
  private bringUpBox(a: PersistedAgent) {
    const machine = this.machineOf(a);
    const note = (text: string) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]);
    void this.boxMachines
      .ensure(machine, note)
      .then(() => {
        note('Su máquina en la nube está lista.');
        void this.cloud.count().catch(() => undefined);
        void this.checkSignIn(a);
      })
      .catch((err) => {
        const why = redact(oneLine(err), this.secrets());
        this.appendLog(a, [{ kind: 'error', text: `✗ No se ha podido preparar su máquina en la nube: ${why}` }]);
        this.postMessage('office', `⚠️ No se ha podido preparar la máquina en la nube de ${a.name}: ${why.slice(0, 240)}`);
      });
  }

  /**
   * Move an agent between this computer and the cloud, while they have no task. Their old machine goes (unpushed work
   * saved to leftovers); sessions can't move between machines, so their next one starts fresh.
   */
  private moveAgent(a: PersistedAgent, to: MachineHost) {
    if ((a.host ?? 'local') === to) return;
    if (a.task || BUSY.includes(a.status)) throw new HttpError(409, `${a.name} está con una tarea: muévelo cuando termine.`);
    const host = this.hostFor(to, a.cli || this.state.settings.defaultCli, true, a);
    const from = a.host ?? 'local';
    this.agentRt.get(a.id)?.terminal?.releaseIdle?.(); // a CLI still waiting at its prompt stays where it was
    if (a.machine) void this.removeMachine(a.machine, a.name, from);
    if (host === 'box') a.host = 'box';
    else delete a.host;
    a.boxCli = null;
    this.dropSignIn(a.id);
    delete a.needsSignIn;
    a.sessionId = null;
    a.sessionCli = null;
    for (const q of this.state.qa) if (q.devAgentId === a.id) q.devSessionId = null;
    this.appendLog(a, [{ kind: 'system', text: host === 'box' ? '☁ Se muda a la nube: un Upstash Box propio.' : '🖥️ Vuelve a este ordenador.' }]);
    if (host === 'box') this.bringUpBox(a);
  }

  /**
   * What a cloud agent's session runs with: their Box, set up and awake, and the credentials their CLI signs in with.
   * Without a key from the office, their CLI uses its own login in the Box: it's checked first (a signed-out one throws
   * SignInNeeded), except for a prompt the manager already typed into the CLI.
   */
  private async boxTarget(a: PersistedAgent, cli: AgentCli, browserTesting: boolean, check = true): Promise<BoxTarget> {
    const api = this.cloud.boxApi();
    if (!api) throw new Error('Los agentes en la nube necesitan tu clave de API de Upstash Box: Ajustes → Agentes en la nube.');
    const machine = this.machineOf(a);
    const boxId = await this.boxMachines.ensure(machine, (text) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]));
    const creds = await this.cloud.credentials(cli);
    if (creds.missing.length) throw new Error(`Los agentes en la nube todavía no pueden iniciar sesión. Falta: ${creds.missing.join('; ')}.`);
    if (check && creds.ownLogin && cli !== 'opencode' && (await this.boxMachines.signedIn(machine, cli).catch(() => null)) === false) throw new SignInNeeded(cli);
    // The Box's own Chromium starts with a first tab; Playwright attaches to it.
    const browser = browserTesting ? await api.browser(boxId).catch(() => false) : false;
    return { api, boxId, env: creds.env, apiKeyHelper: creds.apiKeyHelper, browser, record: (rec) => this.boxCliRecord(a.id, rec), connection: (up) => this.boxMachines.connection(machine, up) };
  }

  /** A cloud agent's live CLI record changed: kept with them, so a restart picks the CLI up. Gone with no task: the Box can pause. */
  private boxCliRecord(agentId: string, rec: BoxCliRecord | null) {
    const a = this.state.agents.find((x) => x.id === agentId);
    if (!a) return;
    const was = a.boxCli;
    a.boxCli = rec;
    if (rec && was && was.token === rec.token && was.offset === rec.offset && was.busy === rec.busy && was.resumeId === rec.resumeId) return;
    this.save();
    if (!rec && was && !a.task && a.machine && a.host === 'box') void this.boxMachines.pause(a.machine).catch(() => undefined);
  }

  /** A machine's Box changed state: its agent's card shows it. */
  private boxState(machine: string) {
    const a = this.state.agents.find((x) => x.host === 'box' && x.machine === machine);
    if (a) this.emitAgent(a);
  }

  // Settings → Cloud agents (REST)

  setCloudKey(key: string) {
    return this.cloud.setKey(key).then((view) => {
      if (!view.keySet && this.state.settings.cloud.machineKind === 'box') {
        // No key, no cloud: new agents work on this computer until it's back.
        this.state.settings.cloud = { ...this.state.settings.cloud, machineKind: 'local' };
        this.broadcast({ type: 'settings', settings: this.state.settings });
        this.save();
      }
      return view;
    });
  }

  setCloudToken(kind: string, value: string) {
    if (kind !== 'github' && kind !== 'anthropic' && kind !== 'openai') throw new HttpError(400, 'kind debe ser github, anthropic u openai');
    return this.cloud.setToken(kind, value).then((view) => {
      // A key for their CLI now: agents waiting to sign in don't need to any more.
      for (const a of this.state.agents) if (a.host === 'box' && a.needsSignIn) void this.checkSignIn(a);
      return view;
    });
  }

  // ---------- signing cloud agents in (docs/cloud.md) ----------

  /**
   * A cloud agent's CLI has no login in their Box (a new Box, or one that expired): they're marked as needing a sign-in
   * and take no work, the task they were starting (if any) waits, and the CLI's own sign-in starts in their terminal.
   */
  private holdForSignIn(a: PersistedAgent, cli: BoxCliId, task: (() => void) | null, expired = false) {
    if (!this.state.agents.includes(a) || a.host !== 'box') return;
    const s = this.signInOf(a, cli);
    const label = cliLabel(cli);
    if (task) {
      a.status = 'preparing';
      s.held = () => {
        if (a.status === 'preparing') task();
        else this.abandoned(a); // stopped meanwhile
      };
      this.appendLog(a, [{ kind: 'system', text: `⏸ Su tarea espera hasta que ${label} tenga la sesión iniciada.` }]);
    }
    if (!a.needsSignIn) {
      a.needsSignIn = true;
      this.appendLog(a, [
        {
          kind: 'error',
          text: `🔑 ${expired ? `La sesión de ${label} en su máquina en la nube ha caducado.` : `${label} todavía no tiene la sesión iniciada en su máquina en la nube.`} Inicia la sesión en su terminal (en su puesto, o con 🔑 Iniciar sesión): abre allí el enlace y termina de iniciar sesión.`,
        },
      ]);
      this.postMessage('office', `🔑 ${a.name} necesita que inicies sesión en ${label}${expired ? ' otra vez' : ''}: ve a su puesto o pulsa 🔑 Iniciar sesión en su ficha y sigue el enlace de su terminal. Su máquina en la nube conserva la sesión.`);
    }
    this.emitAgent(a);
    this.save();
    void this.startSignIn(a);
  }

  /** Their sign-in's state, made (or switched to another CLI, keeping the held task) when needed. */
  private signInOf(a: PersistedAgent, cli: BoxCliId): SignIn {
    let s = this.signIns.get(a.id);
    if (!s) {
      s = { cli, held: null, run: null, starting: false, poll: null };
      this.signIns.set(a.id, s);
    } else if (s.cli !== cli) {
      s.run?.stop();
      s.run = null;
      s.cli = cli;
    }
    return s;
  }

  /** Their sign-in goes (they left, moved to this computer): its CLI closes and a held task is dropped with it. */
  private dropSignIn(agentId: string) {
    const s = this.signIns.get(agentId);
    if (!s) return;
    this.signIns.delete(agentId);
    if (s.poll) clearTimeout(s.poll);
    s.run?.stop();
  }

  /** Start the CLI's own sign-in in their terminal, unless it's running already. */
  private async startSignIn(a: PersistedAgent) {
    const cli = a.cli || this.state.settings.defaultCli;
    const api = this.cloud.boxApi();
    if (!a.needsSignIn || a.host !== 'box' || cli === 'opencode' || !api) return;
    const s = this.signInOf(a, cli);
    if (s.run || s.starting) return;
    s.starting = true;
    try {
      const boxId = await this.boxMachines.ensure(this.machineOf(a), (text) => this.appendLog(a, [{ kind: 'system', text: `☁ ${text}` }]));
      if (!a.needsSignIn || this.signIns.get(a.id) !== s || s.cli !== cli || !this.state.agents.includes(a)) return;
      s.run = this.backend.cloud.signIn({ api, boxId, cli, term: this.terminalFor(a), agentId: a.id }, (code) => void this.signInEnded(a, s, code));
      this.emitAgent(a); // their terminal is there to open now
      this.pollSignIn(a, s);
    } catch (err) {
      this.appendLog(a, [{ kind: 'error', text: `✗ No se ha podido empezar a iniciar sesión: ${redact(oneLine(err), this.secrets())}` }]);
    } finally {
      s.starting = false;
    }
  }

  /** While the sign-in runs, look now and then whether it's done (often while someone watches their terminal). */
  private pollSignIn(a: PersistedAgent, s: SignIn) {
    if (s.poll) clearTimeout(s.poll);
    const wait = this.agentRt.get(a.id)?.terminal?.watched ? SIGN_IN_POLL_MS : SIGN_IN_IDLE_POLL_MS;
    s.poll = setTimeout(() => {
      s.poll = null;
      if (this.signIns.get(a.id) !== s || !s.run) return;
      void this.boxMachines
        .signedIn(this.machineOf(a), s.cli)
        .catch(() => null)
        .then((ok) => {
          if (this.signIns.get(a.id) !== s) return;
          if (ok) this.signedIn(a);
          else if (s.run) this.pollSignIn(a, s);
        });
    }, wait);
  }

  /** The sign-in's CLI exited: signed in, or the manager can start it again from their terminal. */
  private async signInEnded(a: PersistedAgent, s: SignIn, code: number) {
    if (this.signIns.get(a.id) !== s) return;
    s.run = null;
    if (s.poll) clearTimeout(s.poll);
    const ok = await this.boxMachines.signedIn(this.machineOf(a), s.cli).catch(() => null);
    if (this.signIns.get(a.id) !== s || s.run) return;
    if (ok) return this.signedIn(a);
    this.agentRt.get(a.id)?.terminal?.note(`Todavía sin sesión iniciada. 🔑 Iniciar sesión vuelve a empezar.`);
    this.appendLog(a, [{ kind: 'error', text: `🔑 ${cliLabel(s.cli)} no ha terminado de iniciar sesión${code > 0 ? ` (ha salido con el código ${code})` : ''}. 🔑 Iniciar sesión en su terminal vuelve a empezar.` }]);
  }

  /** Their CLI is signed in: the flag goes and the task it held starts (a sign-in still on screen gets a moment to finish). */
  private signedIn(a: PersistedAgent) {
    const s = this.signIns.get(a.id);
    this.signIns.delete(a.id);
    if (s?.poll) clearTimeout(s.poll);
    const run = s?.run;
    if (run) setTimeout(() => run.stop(), 3000);
    if (!a.needsSignIn) return;
    a.needsSignIn = false;
    this.appendLog(a, [{ kind: 'done', text: `✔ ${cliLabel(s?.cli ?? 'claude')} tiene la sesión iniciada en su máquina en la nube.${s?.held ? ' De vuelta a la tarea.' : ''}` }]);
    this.emitAgent(a);
    this.save();
    const held = s?.held;
    if (held) setTimeout(held, run ? 3000 : 0);
    else setTimeout(() => this.schedule(), 200);
  }

  /**
   * Is a cloud agent's CLI signed in? Looked at when their Box is set up, after a restart and when keys or their CLI
   * change. `fresh`: their CLI changed, so a sign-in for the old one stops.
   */
  private async checkSignIn(a: PersistedAgent, fresh = false) {
    const cli = a.cli || this.state.settings.defaultCli;
    if (a.host !== 'box' || a.role === 'ceo' || !this.cloud.boxApi()) return;
    if (fresh) {
      const s = this.signIns.get(a.id);
      s?.run?.stop();
      if (s) s.run = null;
    }
    if (cli === 'opencode') return this.signedIn(a);
    const creds = await this.cloud.credentials(cli).catch(() => null);
    const ok = !creds ? null : creds.ownLogin ? await this.boxMachines.signedIn(this.machineOf(a), cli).catch(() => null) : true;
    if (!this.state.agents.includes(a) || a.host !== 'box') return;
    if (ok === true) this.signedIn(a);
    else if (ok === false) this.holdForSignIn(a, cli, null);
  }

  /** POST /api/agents/:id/sign-in: start a cloud agent's sign-in (over) in their terminal: it ended, went stale or never started. */
  signIn(id: string) {
    const a = this.agent(id);
    if (a.host !== 'box') throw new HttpError(409, `${a.name} trabaja en este ordenador: su agente de código inicia sesión aquí.`);
    if (!a.needsSignIn) throw new HttpError(409, `El agente de código de ${a.name} ya tiene la sesión iniciada.`);
    const s = this.signIns.get(a.id);
    if (s?.run) {
      // Start over: a link that went stale (Codex's code lasts 15 minutes) or a sign-in that went wrong.
      if (s.poll) clearTimeout(s.poll);
      s.run.stop();
      s.run = null;
    }
    this.terminalFor(a);
    void this.startSignIn(a);
    return this.agentView(a, false);
  }

  /** The demo's stand-in for a login that expired (POST /api/cloud/demo-expire): every cloud agent's Box is signed out. */
  expireSignIns() {
    const expire = this.backend.cloud.expireSignIns;
    if (!expire) throw new HttpError(404, 'Las sesiones solo se pueden caducar en la oficina demo.');
    expire();
    // Idle ones notice at once, as their next task's check would; working ones when their session fails.
    for (const a of this.state.agents) if (a.host === 'box' && !a.task) void this.checkSignIn(a);
  }

  testCloud() {
    return this.cloud.test();
  }

  deleteCloudOrphans() {
    return this.cloud.deleteOrphans();
  }

  /** Every floor has at least one agent. */
  private ensureAgent(repo: PersistedRepo) {
    if (this.state.agents.some((a) => a.repoId === repo.id)) return;
    this.hireAgent(repo.id, {});
  }

  /** A name from the pool that no agent or waiting candidate has. */
  private freeName() {
    const taken = new Set([...this.state.agents.map((a) => a.name), ...this.state.requests.filter((r) => r.status === 'pending').map((r) => r.name)]);
    return NAMES.find((n) => !taken.has(n)) || `Agent ${this.state.agents.length + 1}`;
  }

  /** The coding agent is installed here (or the office hasn't looked yet: then the session says so if it isn't). */
  private cliReady(cli: AgentCli) {
    return !this.clis.length || this.clis.some((c) => c.id === cli && c.installed);
  }

  updateAgent(id: string, patch: { name?: string; model?: string; effort?: string; cli?: string; host?: string; look?: string; color?: string; hair?: string; style?: unknown }) {
    const a = this.agent(id);
    if (patch.host !== undefined && a.role !== 'ceo' && (patch.host === 'box' || patch.host === 'local')) this.moveAgent(a, patch.host);
    if (patch.cli !== undefined && a.role === 'ceo') this.setCeoCli(a, patch.cli);
    if (patch.cli !== undefined && a.role !== 'ceo') {
      const cli = isCli(patch.cli) ? patch.cli : '';
      if (a.host === 'box' && (cli || this.state.settings.defaultCli) === 'opencode') throw new HttpError(400, `${a.name} trabaja en la nube, donde OpenCode todavía no puede ejecutarse: muévelo antes a este ordenador.`);
      if (cli && a.host !== 'box' && !this.cliReady(cli)) throw new HttpError(400, `${cliLabel(cli)} no está instalado en este ordenador.`);
      const changed = cli !== a.cli;
      a.cli = cli;
      // Another coding agent in their Box has a login of its own (or needs one).
      if (changed && a.host === 'box') void this.checkSignIn(a, true);
    }
    if (patch.name?.trim() && patch.name.trim() !== a.name) {
      a.name = patch.name.trim().slice(0, 24);
      a.look = lookFor(a.name);
    }
    if (LOOKS.includes(patch.look as AgentLook)) a.look = patch.look as AgentLook;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color;
    if (patch.hair && /^#[0-9a-f]{6}$/i.test(patch.hair)) a.hair = patch.hair;
    if (patch.style !== undefined) a.style = cleanStyle(patch.style); // null: back to the seeded look
    if (patch.model !== undefined) a.model = String(patch.model).trim();
    if (patch.effort !== undefined) a.effort = EFFORTS.includes(patch.effort as EffortLevel) ? (patch.effort as EffortLevel) : '';
    this.save();
    this.emitAgent(a);
  }

  /** The CEO's coding agent. Its model follows the new agent's default; its next chat starts a new conversation. */
  private setCeoCli(a: PersistedAgent, value: string) {
    if (value !== 'claude' && value !== 'codex') throw new HttpError(400, 'El CEO solo puede usar Claude Code o Codex.');
    if (!this.cliReady(value)) throw new HttpError(400, `${cliLabel(value)} no está instalado en este ordenador.`);
    if (value === 'codex' && !this.backend.terminals) throw new HttpError(400, 'Codex necesita los terminales reales (node-pty), que no están disponibles en este ordenador.');
    if (value === ceoCli(a.cli)) return;
    a.cli = value;
    a.model = '';
  }

  /** The CEO's coding agent for its next session: Codex only runs in a real terminal, so without one it's Claude Code. */
  private ceoCliNow(a: PersistedAgent): CeoCli {
    const cli = ceoCli(a.cli);
    return cli === 'codex' && !this.backend.terminals ? 'claude' : cli;
  }

  fireAgent(id: string, force = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') throw new HttpError(409, `${a.name} dirige la empresa y no se le puede despedir.`);
    if (!force && this.state.agents.filter((x) => x.repoId === a.repoId).length <= 1) {
      throw new HttpError(409, `${a.name} es el único agente de esta planta, y cada planta conserva al menos uno.`);
    }
    for (const r of this.state.requests.filter((x) => x.kind === 'let-go' && x.agentId === id && x.status === 'pending')) {
      this.decide(r, { status: 'approved', note: 'Se le despidió directamente.', decidedBy: 'manager' });
    }

    // A desk being set up for them notices and gives up (prepare() checks the status), rather than start a session.
    if (BUSY.includes(a.status)) a.status = 'stopped';
    this.dropSignIn(id);
    this.agentRt.get(id)?.session?.stop();
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.agentRt.get(id)?.terminal?.dispose();
    void removeScreens(id);
    void fs.rm(terminalFile(id), { force: true }).catch(() => undefined);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id) q.devAgentId = null;
      if (q.devAgentId === null && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (repo) {
      const slug = this.agentSlug(a);
      const main = this.backend.mainDir(repo.fullName); // now: a disconnect points the floor elsewhere before this runs
      void this.releaseDesk(a, repo)
        .then(() => (a.machine ? this.removeMachine(a.machine, a.name, a.host ?? 'local') : this.backend.removeDesk(repo.fullName, slug, main)))
        .catch(() => undefined)
        .then(() => this.sweepFloor(repo.id));
    }
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    applyLedger(this.state.progress, { kind: 'let-go', agentId: id });
    this.agentRt.delete(id);
    this.seenActivity.delete(id);
    this.shownActivity.delete(id);
    this.save();
    this.broadcast({ type: 'agentRemoved', agentId: id });
  }

  stopAgent(id: string) {
    const a = this.agent(id);
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Stopped by manager';
    this.appendLog(a, [{ kind: 'manager', text: '■ El responsable ha detenido esta sesión.' }]);
    const sign = this.signIns.get(id);
    if (sign) sign.held = null; // the task waiting for their sign-in stays stopped
    this.agentRt.get(id)?.session?.stop();
    this.emitAgent(a);
    this.save();
  }

  /** An agent whose CLI kept working through the office's restart: the office follows its session again. */
  private reattachSession(a: PersistedAgent) {
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (!repo) return;
    this.appendLog(a, [{ kind: 'system', text: '↻ La oficina se ha reiniciado; su CLI siguió trabajando y la oficina vuelve a seguirlo.' }]);
    this.startAgentSession(a, repo, this.deskOf(a, repo), '', '', a.sessionId ?? undefined, undefined, 'reattach');
  }

  /** The manager pressed Esc in the agent's terminal and the CLI stopped its turn: a Stop that leaves the CLI to them. */
  private interrupted(a: PersistedAgent) {
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Interrupted in the terminal';
    this.appendLog(a, [{ kind: 'manager', text: '■ Interrumpido en el terminal. Escribe ahí para continuar.' }]);
  }

  resetAgent(id: string) {
    const a = this.agent(id);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} está ocupado; detenlo primero`);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    this.appendLog(a, [{ kind: 'system', text: '↺ Puesto despejado. Listo para trabajo nuevo.' }]);
    this.save();
  }

  private issueTaken(repo: PersistedRepo, n: number) {
    return issueTaken(
      n,
      this.state.agents.filter((a) => a.repoId === repo.id),
      this.repoRt.get(repo.id)?.pulls ?? [],
      Date.now(),
    );
  }

  private ensureSlot() {
    if (this.slotsFull()) {
      throw new HttpError(429, `Las ${this.state.settings.sessionLimit} plazas de sesión están ocupadas. Sube o quita el límite de sesiones en la consola del responsable, o espera.`);
    }
  }

  /** `waitForDeps`: refuse an issue that still waits for open ones (a sticky carried to a desk; the console may override). */
  async assign(agentId: string, issueNumber: number, note?: string, waitForDeps = false) {
    const a = this.agent(agentId);
    const repo = this.repo(a.repoId);
    if (a.role === 'ceo') throw new HttpError(400, `${a.name} dirige la empresa; da los issues a los agentes de las plantas.`);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} está ocupado: ${this.agentDoing(a)}`);
    this.ensureSlot();
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `El issue #${issueNumber} no está abierto en ${repo.fullName}`);
    const waits = waitForDeps ? blockers(issue.body, new Set(issues.map((i) => i.number))) : [];
    if (waits.length) throw new HttpError(409, waitsMessage(issueNumber, waits));
    const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.issueNumber === issueNumber && BUSY.includes(x.status));
    if (holder) throw new HttpError(409, `${holder.name} ya está trabajando en #${issueNumber}`);
    if (this.isHeld(repo.id, issueNumber)) {
      // Assigned by hand: its wait after its PR closed is over.
      this.state.held = this.state.held.filter((h) => !(h.repoId === repo.id && h.issue === issueNumber));
      this.emitRepo(repo);
    }
    void this.runTask(a, repo, issue, note);
    return this.agentView(a, false);
  }

  private port(a: PersistedAgent) {
    return 5200 + (parseInt(a.id.slice(0, 4), 16) % 700);
  }

  private linkedRepos(repo: PersistedRepo) {
    return repo.links.map((id) => this.state.repos.find((r) => r.id === id)).filter((r): r is PersistedRepo => !!r);
  }

  /**
   * How an agent's next session runs: the CLI in their terminal (the terminal runtime), or Claude Code through the
   * SDK. A session can only be resumed by the CLI that made it, so a follow-up stays with that CLI.
   */
  private sessionRuntime(a: PersistedAgent, resume?: string): { terminal?: AgentTerminal; cli?: AgentCli; label?: string; resumeSessionId?: string } {
    // A cloud agent's CLI always runs in a terminal: their Box's, which needs nothing from this computer.
    let cli: AgentCli = a.role === 'ceo' ? this.ceoCliNow(a) : a.cli || this.state.settings.defaultCli;
    const inTerminal = (a.role === 'ceo' && cli === 'codex') || a.host === 'box' || (this.state.settings.runtime === 'terminal' && this.backend.terminals);
    if (resume && a.sessionCli && a.sessionCli !== cli) {
      if (a.role === 'ceo') resume = undefined;
      else if (inTerminal) cli = a.sessionCli;
      else if (a.sessionCli !== 'claude') resume = undefined;
    }
    if (!inTerminal) return { resumeSessionId: resume };
    const what = a.role === 'ceo' ? a.issueTitle : a.task === 'qa' ? `QA · PR #${a.prNumber}` : a.task === 'fix' ? `corrigiendo la PR #${a.prNumber}` : a.issueNumber ? `#${a.issueNumber} ${a.issueTitle ?? ''}` : null;
    return { terminal: this.terminalFor(a), cli, label: `${a.name}${what ? ` · ${what}` : ''}`.slice(0, 80).trim(), resumeSessionId: resume };
  }

  /** The model to ask for (the Agent SDK runs Claude Code). '' lets another coding agent use its own default. */
  private modelFor(a: PersistedAgent, cli: AgentCli | undefined) {
    return effectiveModel(a.model, cli ?? 'claude', this.state.settings, DEFAULT_MODEL);
  }

  // ---------- terminals ----------

  private async loadTerminal(agentId: string): Promise<AgentTerminal | null> {
    if (!(await fs.stat(terminalFile(agentId)).catch(() => null))) return null;
    const t = this.newTerminal(agentId);
    await t.load(terminalFile(agentId));
    return t;
  }

  /** The agent's terminal, made the first time they run in the terminal runtime. */
  private terminalFor(a: PersistedAgent): AgentTerminal {
    const rt = this.agentRt.get(a.id)!;
    rt.terminal ??= this.newTerminal(a.id);
    return rt.terminal;
  }

  private newTerminal(agentId: string) {
    const t = new AgentTerminal();
    // Typed at a CLI waiting at its prompt after its task: a follow-up, which starts synchronously when it can.
    t.onIdlePrompt = (text) => {
      void this.message(agentId, text, true).catch(() => undefined);
      return !!this.agentRt.get(agentId)?.session;
    };
    return t;
  }

  private async saveTerminals(all = false) {
    for (const [id, rt] of this.agentRt) {
      if (rt.terminal && (all || rt.terminal.dirty)) await rt.terminal.save(terminalFile(id)).catch((err) => console.warn('could not save a terminal', err));
    }
  }

  /** A browser opened an agent's terminal (/ws/term?agent=<id>). */
  attachTerminal(agentId: string, ws: WebSocket) {
    const a = this.state.agents.find((x) => x.id === agentId);
    // Opening the terminal of a cloud agent who waits for a sign-in (at their desk, or 🔑 Sign in) starts one if none runs.
    if (a?.needsSignIn && a.host === 'box') {
      this.terminalFor(a);
      void this.startSignIn(a);
    }
    const t = this.agentRt.get(agentId)?.terminal;
    if (!t) return ws.close(4404, 'That agent has no terminal');
    t.attach(ws);
  }

  private buildSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, fixing?: { pr: number; headRef: string }, deps?: DepsOutcome) {
    return devSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, linked: this.linkedDirs(repo, a), fixing, depsLine: depsPromptLine(deps) });
  }

  /** The floor's linked repos where the agent reads them: the floor checkouts here, or their copies in a cloud agent's Box. */
  private linkedDirs(repo: PersistedRepo, a?: PersistedAgent) {
    return this.linkedRepos(repo).map((r) => ({ fullName: r.fullName, dir: a?.host === 'box' ? boxLinkedDir(r.fullName) : this.backend.mainDir(r.fullName) }));
  }

  /** What an agent is told on a task, previewed with placeholders for the task's details. */
  agentPrompt(id: string): AgentPromptView {
    const a = this.agent(id);
    if (a.role === 'ceo') return ceoPromptPreview(ceoSystemPrompt(this.ceoPromptInput(a)));
    const repo = this.repo(a.repoId);
    return agentPromptPreview({ agent: a, repo, port: this.port(a), slug: slugify(a.name), linked: this.linkedDirs(repo, a) });
  }

  private beginTask(a: PersistedAgent, patch: Partial<PersistedAgent>, banner: string, preparing: string) {
    const rt = this.agentRt.get(a.id)!;
    this.dropping.delete(a.id);
    Object.assign(a, {
      status: 'preparing' as AgentStatus,
      startedAt: Date.now(),
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      ...patch,
    });
    rt.screenshot = null;
    rt.browserUrl = null;
    rt.shots = [];
    void removeScreens(a.id);
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${banner} ━━━` },
      { kind: 'system', text: preparing },
    ]);
    this.emitAgent(a);
    this.save();
  }

  /** job: the PR fix or QA run this desk is for; if the desk can't be set up, the PR pays for it, not the agent. */
  private async prepare(a: PersistedAgent, repo: PersistedRepo, base: { pr?: number }, branch: string, job?: PrepJob): Promise<{ cwd: string; deps: DepsOutcome } | null> {
    try {
      if (this.repoRt.get(repo.id)?.cloneStatus !== 'ready') await this.cloneRepo(repo.id);
      const note = (text: string) => this.appendLog(a, [{ kind: 'system', text }]);
      const cwd = await setUpDesk(this.agentRt.get(a.id)?.terminal, {
        release: () => this.releaseDesk(a, repo),
        prepare: () => this.machinesFor(a).prepareDesk(this.machineOf(a), repo.fullName, { defaultBranch: repo.defaultBranch, pr: base.pr }, branch, note),
      });
      this.deskAlerts.delete(a.id);
      if (job) this.prepStrikes.delete(prepKey(repo.id, job.rec.prNumber, job.task));
      if (a.status !== 'preparing') return this.abandoned(a); // stopped or fired while preparing, or its issue or PR closed
      // Outside the repo's git lock, so other desks keep checking out meanwhile. A failed install never fails the task.
      const deps = await this.installDeps(a, cwd, repo);
      return a.status === 'preparing' ? { cwd, deps } : this.abandoned(a);
    } catch (err) {
      if (a.status !== 'preparing') return this.abandoned(a);
      // Upstash refusing or unreachable is the cloud's trouble, not the PR's: it goes back in line without a strike.
      const cloud = err instanceof CloudError;
      if (job && !cloud) {
        this.jobDeskFailed(a, repo, job, (err as Error).message);
        return null;
      }
      if (job) {
        if (this.state.qa.includes(job.rec)) this.setQa(job.rec, job.task === 'fix' ? { status: 'failed', devAgentId: job.author } : { status: 'queued', qaAgentId: null });
        this.clearTask(a);
      }
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      if (this.deskAlerts.get(a.id) !== a.lastError) {
        // Once per agent and error: retries that fail the same way don't ring the phone again.
        this.deskAlerts.set(a.id, a.lastError);
        this.postMessage('office', `⚠️ No se ha podido preparar el puesto de ${a.name}: ${a.lastError.slice(0, 240)}`);
      }
      this.emitAgent(a);
      this.save();
      return null;
    }
  }

  /**
   * A desk couldn't be set up for a PR's fix or QA run (#199). Nothing ran, so the agent is free again at once. The PR
   * is handed out again; after repeated failures it sits out a while (one phone message), and in time needs the manager.
   */
  private jobDeskFailed(a: PersistedAgent, repo: PersistedRepo, job: PrepJob, error: string) {
    const { rec, task } = job;
    this.appendLog(a, [
      { kind: 'error', text: `✗ ${error}` },
      { kind: 'system', text: `No se ha ejecutado nada, así que ${a.name} queda libre para otro trabajo.` },
    ]);
    this.clearTask(a);
    this.save();
    if (!this.state.qa.includes(rec)) return;
    const key = prepKey(repo.id, rec.prNumber, task);
    const step = prepFailure(this.prepStrikes.get(key), rec.sessionFailures, task === 'fix' ? MAX_FIX_FAILURES : MAX_QA_FAILURES, Date.now());
    this.prepStrikes.set(key, step.strikes);
    const needsHuman = step.next === 'needs-human';
    this.setQa(rec, {
      ...(task === 'fix' ? { status: needsHuman ? 'needs-human' : 'failed', devAgentId: job.author } : { status: needsHuman ? 'needs-human' : 'queued', qaAgentId: null }),
      sessionFailures: step.sessionFailures,
      ...(needsHuman ? { mergeNote: 'no se ha podido preparar su puesto', stuckWhy: 'no se ha podido preparar su puesto', escalated: true } : {}), // no CEO tool fixes a desk: straight to the manager
    });
    if (step.next === 'retry') return;
    const what = task === 'fix' ? 'corrección' : 'ronda de QA';
    const why = `no se han podido preparar puestos para su ${what} dos veces seguidas: ${error.slice(0, 240)}`;
    this.postMessage(
      'office',
      needsHuman
        ? `⚠️ La PR #${rec.prNumber} de ${repo.fullName} te necesita: ${why}`
        : `⚠️ La PR #${rec.prNumber} de ${repo.fullName} espera ${Math.round(PREP_HOLD_MS / 60_000)} minutos antes de que nadie vuelva a intentar su ${what}: ${why}`,
    );
  }

  private clearPrepStrikes(repoId: string, prNumber: number) {
    for (const task of ['fix', 'qa'] as const) this.prepStrikes.delete(prepKey(repoId, prNumber, task));
  }

  /** The desk's dependencies, shown on the agent's card ("Installing dependencies") while npm runs. */
  private async installDeps(a: PersistedAgent, cwd: string, repo: PersistedRepo): Promise<DepsOutcome> {
    const rt = this.agentRt.get(a.id);
    const cb = {
      log: (lines: string[]) => this.appendLog(a, lines.map((text) => ({ kind: text.startsWith('⚠') ? 'error' : 'system', text }) as LogEntry)),
      installing: () => {
        if (!rt) return;
        rt.currentTool = INSTALL_STEP;
        this.emitAgent(a);
      },
    };
    try {
      // A cloud agent's dependencies are installed in their Box, outside this computer's install limit.
      return await (a.host === 'box' ? this.boxMachines.installDeps(this.machineOf(a), repo.fullName, cb) : this.backend.installDeps(cwd, cb));
    } finally {
      if (rt?.currentTool === INSTALL_STEP) {
        rt.currentTool = null;
        this.emitAgent(a);
      }
    }
  }

  private async runTask(a: PersistedAgent, repo: PersistedRepo, issue: IssueInfo, note?: string) {
    const branch = devBranch(issue.number, slugify(a.name));
    this.beginTask(
      a,
      { task: 'issue', issueNumber: issue.number, issueTitle: issue.title, branch, prNumber: null, prUrl: null, sessionId: null },
      `Issue #${issue.number}: ${issue.title}`,
      `Preparando el worktree en ${branch}…`,
    );
    // GitHub's word, not the last sync's: an issue closed since then isn't started.
    const live = await this.backend.issueState(repo.fullName, issue.number).catch(() => null);
    if (a.status !== 'preparing') return void this.abandoned(a);
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'issue', number: issue.number }, this.floorState(rt), live)) {
      this.appendLog(a, [{ kind: 'system', text: `El issue #${issue.number} está cerrado; no hay nada que hacer.` }]);
      this.clearTask(a);
      this.learnIssueClosed(repo, issue.number);
      return;
    }
    const desk = await this.prepare(a, repo, {}, branch);
    if (!desk) return;
    const { cwd } = desk;

    const prompt = [
      `Resuelve el issue de GitHub #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.labels.length ? `Etiquetas: ${issue.labels.join(', ')}` : '',
      '',
      issue.body?.trim() || '(El issue no tiene descripción.)',
      note ? `\nNota del responsable: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildSystemAppend(a, repo, cwd, branch, undefined, desk.deps));
  }

  private startAgentSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId?: string,
    outputSchema?: Record<string, unknown>,
    /** typed: the manager typed the prompt at the CLI; reattach: follow the CLI that kept working through a restart. */
    mode: 'typed' | 'reattach' | null = null,
  ) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // let go meanwhile
    // A cloud agent's session runs in their Box: it's awake and set up, their linked repos fetched there, and their
    // credentials resolved first. (Following a CLI that kept working there needs none of that.)
    if (a.host === 'box' && mode !== 'reattach') {
      const cli = this.sessionRuntime(a, resumeSessionId).cli ?? 'claude';
      const note = (text: string) => this.appendLog(a, [{ kind: 'system', text }]);
      void this.boxTarget(a, cli, repo.browserTesting, mode !== 'typed')
        .then(async (box) => {
          const linked = await this.boxMachines.linkRepos(this.machineOf(a), this.linkedRepos(repo).map((r) => r.fullName), note).catch(() => []);
          this.launchSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode, box, linked);
        })
        .catch((err) => {
          if (err instanceof SignInNeeded) return this.holdForSignIn(a, err.cli, () => this.startAgentSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode));
          const why = redact(oneLine(err), this.secrets());
          this.appendLog(a, [{ kind: 'error', text: `✗ ${why}` }]);
          void this.onFinished(a, repo, { ok: false, text: '', costUsd: 0, turns: 0, errors: [why] });
        });
      return;
    }
    this.launchSession(a, repo, cwd, prompt, systemAppend, resumeSessionId, outputSchema, mode);
  }

  private launchSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId: string | undefined,
    outputSchema: Record<string, unknown> | undefined,
    mode: 'typed' | 'reattach' | null,
    box?: BoxTarget,
    linked?: string[],
  ) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // let go meanwhile
    // A session started in a folder that's gone dies at once (Windows exit 267): set the desk up again first. (A Box's
    // desk is taken to be there: looking would wake it.)
    if (a.host !== 'box' && sessionStart(this.backend.deskExists(cwd), mode) === 'prepare') {
      const machine = a.machine;
      // An agent who moved to their machine meanwhile can't resume a session from their old desk (machineOf).
      void this.restoreDesk(a, repo).then((dir) => dir && this.startAgentSession(a, repo, dir, prompt, systemAppend, a.machine === machine ? resumeSessionId : undefined, outputSchema, mode));
      return;
    }
    a.status = 'working';
    this.activity.set(a.id, Date.now());
    const how = this.sessionRuntime(a, resumeSessionId);
    this.emitAgent(a);
    const active = (entries: LogEntry[]) => {
      if (entries.some((e) => e.kind !== 'manager')) this.activity.set(a.id, Date.now());
    };
    rt.session = this.backend.startSession(
      {
        cwd,
        prompt,
        systemAppend,
        model: this.modelFor(a, how.cli),
        effort: a.effort || this.state.settings.defaultEffort,
        browserTesting: repo.browserTesting,
        additionalDirectories: linked ?? (a.host === 'box' ? [] : this.linkedRepos(repo).map((r) => this.backend.mainDir(r.fullName))),
        role: a.role,
        task: a.task,
        env: this.machineEnv(a),
        outputSchema,
        ...(box ? { box } : {}),
        // An agent's CLI stays at its prompt after building or fixing, for the manager and for follow-ups; after QA it
        // closes, so the next QA run of that PR is a fresh session.
        keepAlive: a.task !== 'qa',
        typed: mode === 'typed',
        reattach: mode === 'reattach',
        agentId: a.id,
        ...how,
      },
      {
        log: (entries) => {
          active(entries);
          this.appendLog(a, entries);
        },
        tool: (name) => {
          this.activity.set(a.id, Date.now());
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? (how.cli ?? 'claude') : null;
        },
        browserUrl: (url) => {
          rt.browserUrl = url;
          this.emitAgent(a);
        },
        screenshot: (data, mime) => {
          const at = Date.now();
          rt.screenshot = { data, mime, at };
          rt.shots.push({ data, mime, url: rt.browserUrl, at });
          if (rt.shots.length > 12) rt.shots.shift();
          this.broadcast({ type: 'screen', agentId: a.id, url: rt.browserUrl, at });
          void removeScreens(a.id)
            .then(() => fs.mkdir(SCREENS_DIR, { recursive: true }))
            .then(() => fs.writeFile(screenFile(a.id, mime), data))
            .catch((err) => console.warn('could not save screenshot', err));
        },
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        finished: (result) => {
          // A cloud agent's CLI whose login expired: the task carries on (the same conversation) once it's signed in again.
          const again = () => this.startAgentSession(a, repo, cwd, a.sessionId ? SIGNED_IN_AGAIN : prompt, systemAppend, a.sessionId ?? undefined, outputSchema, null);
          if (a.host === 'box' && result.signedOut) void this.signedOutMidTask(a, repo, result, how.cli ?? 'claude', again);
          else void this.onFinished(a, repo, result);
        },
      },
    );
  }

  /** A cloud agent's session that ended because their CLI's login is gone (cliRunner's signedOut). */
  private async signedOutMidTask(a: PersistedAgent, repo: PersistedRepo, result: SessionResult, cli: AgentCli, again: () => void) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return;
    const creds = cli === 'opencode' ? null : await this.cloud.credentials(cli).catch(() => null);
    if (cli === 'opencode' || !creds?.ownLogin || a.status === 'stopped' || this.dropping.has(a.id) || a.host !== 'box') {
      // A key from Settings that was turned away has nothing to sign in here: the session failed like any other.
      const errors = creds && !creds.ownLogin ? [`${cliLabel(cli)} ha rechazado la clave que se le dio: revísala en Ajustes → Agentes en la nube.`] : result.errors;
      return this.onFinished(a, repo, { ...result, errors });
    }
    if (this.silenced.delete(a.id)) return; // the demo's pretend restart cut it off: reconciled like after a real one
    rt.session = null;
    rt.currentTool = null;
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, repo.id, result.costUsd, Date.now());
    // The login its servers turned away is forgotten, so the Box reads as signed out until the manager signs it in again.
    await this.boxMachines.signOut(this.machineOf(a), cli).catch(() => undefined);
    this.holdForSignIn(a, cli, again, true);
  }

  private async onFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // fired
    if (this.officeUpdate.handedOver && a.host !== 'box') return; // stopped for the office's update: recovered like after a restart
    if (this.silenced.delete(a.id)) return; // the demo's pretend restart cut it off: reconciled like after a real one
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, repo.id, result.costUsd, a.endedAt);
    this.ledger({ kind: 'session', agentId: a.id, key: `${a.id}:${a.startedAt}:${a.endedAt}`, costUsd: result.costUsd, turns: result.turns }, false); // emitted below
    // Dev servers the agent forgot to stop would otherwise keep its port and lock its desk folder.
    void this.releaseDesk(a, repo).catch(() => undefined);
    if (result.interrupted) this.interrupted(a);

    if (this.dropping.has(a.id)) this.dropTask(a, '↺ Puesto despejado. Listo para trabajo nuevo.'); // stopped: its issue or PR closed
    else if (a.task === 'qa') await this.onQaFinished(a, repo, result);
    else if (a.task === 'fix') await this.onFixFinished(a, repo, result);
    else await this.onIssueFinished(a, repo, result);

    this.emitAgent(a);
    this.save();
    this.applyTeamChanges();
    void this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 500);
  }

  private minutes(a: PersistedAgent) {
    return a.startedAt && a.endedAt ? Math.max(1, Math.round((a.endedAt - a.startedAt) / 60000)) : 0;
  }

  private fail(a: PersistedAgent, result: SessionResult, what: string) {
    a.status = 'error';
    a.lastError = result.errors.join('; ') || 'Session failed';
    this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
    this.toast('error', `${a.name} ha tenido un problema con ${what}: ${a.lastError.slice(0, 120)}`);
  }

  private async onIssueFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const escaped = repo.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = result.text.match(new RegExp(`https://github\\.com/${escaped}/pull/(\\d+)`, 'i'));
    if (m) {
      a.prNumber = Number(m[1]);
      a.prUrl = m[0];
    } else if (a.branch) {
      const pr = await this.backend.prForBranch(repo.fullName, a.branch).catch(() => null);
      if (pr) {
        a.prNumber = pr.number;
        a.prUrl = pr.url;
      }
    }

    if (a.status === 'stopped') return; // the manager already logged the stop
    if (!result.ok) {
      this.issueFailed(repo, a.issueNumber);
      return this.fail(a, result, `#${a.issueNumber}`);
    }
    this.issueFailures.delete(`${repo.id}#${a.issueNumber}`);
    a.status = 'done';
    if (a.prNumber) this.ledger({ kind: 'opened', repoId: repo.id, pr: a.prNumber, title: a.issueTitle ?? '', author: a.id, at: Date.now() }, false);
    this.appendLog(a, [{ kind: 'done', text: `✔ Terminado en ${this.minutes(a)} min · ${a.turns} turnos${a.prNumber ? ` · PR #${a.prNumber}` : ' · sin PR'}` }]);
    const failedEarly = a.prNumber ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber && q.status === 'failed') : undefined;
    if (failedEarly) {
      // QA failed the PR while this session was still going (#199): the fix was kept for them, and resumes this session.
      this.setQa(failedEarly, { devAgentId: a.id, devSessionId: a.sessionId ?? failedEarly.devSessionId });
      this.appendLog(a, [{ kind: 'system', text: `📨 QA ya suspendió la PR #${a.prNumber}; lo siguiente es corregirla.` }]);
    } else if (a.prNumber) {
      this.queueQa(repo, a.prNumber, a, a.issueNumber);
      this.appendLog(a, [{ kind: 'system', text: `📨 PR #${a.prNumber} entregada a QA.` }]);
      this.toast('success', `${a.name} ha abierto la PR #${a.prNumber} para #${a.issueNumber}; pasa a QA`);
    } else {
      this.noPullRequest(a, repo);
    }
  }

  /**
   * An issue session ended without a PR, which would leave the issue "taken" with nobody on it. The same developer,
   * who has the context and the worktree, is asked once to finish; after that the issue goes back on the board.
   */
  private noPullRequest(a: PersistedAgent, repo: PersistedRepo) {
    const key = `${repo.id}#${a.issueNumber}`;
    if (this.nudged.has(key)) return this.releaseIssue(a, repo);
    this.nudged.add(key);
    // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
    void this.message(
      a.id,
      `Has terminado sin abrir una pull request para #${a.issueNumber}. Completa ahora los pasos que faltan: haz commit, sube tu rama y abre la PR con "Closes #${a.issueNumber}" (tal cual, en inglés) en el cuerpo. Si el issue no se puede hacer, abre una PR en borrador que explique por qué.`,
    ).catch(() => this.releaseIssue(a, repo));
  }

  private releaseIssue(a: PersistedAgent, repo: PersistedRepo) {
    const n = a.issueNumber;
    this.clearTask(a);
    this.postMessage('office', `⚠️ ${a.name} ha terminado #${n} de ${repo.fullName} sin abrir una pull request, así que vuelve al tablero para quien sea.`);
  }

  // ---------- QA ----------

  private queueQa(repo: PersistedRepo, prNumber: number, dev: PersistedAgent | null, issueNumber: number | null) {
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'pr', number: prNumber }, this.floorState(rt))) return; // it closed: QA has nothing to test
    let rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec) {
      if (rec.status === 'testing') return;
      this.setQa(rec, { status: 'queued', devAgentId: dev?.id ?? rec.devAgentId, devSessionId: dev?.sessionId ?? rec.devSessionId });
    } else {
      rec = {
        repoId: repo.id,
        prNumber,
        status: 'queued',
        round: 1,
        devAgentId: dev?.id ?? null,
        qaAgentId: null,
        summary: null,
        checks: [],
        commentUrl: null,
        updatedAt: Date.now(),
        issueNumber,
        devSessionId: dev && dev.prNumber === prNumber ? dev.sessionId : null,
        fixInstructions: null,
        sessionFailures: 0,
        mergeNote: null,
        testedSha: null,
        passedSha: null,
        fixReason: null,
        mergeFixes: 0,
        retests: 0,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        preQa: null,
        noChangeSha: null,
        rerunSha: null,
        rerunAt: null,
        qaChecks: null,
        stuckWhy: null,
        triages: 0,
        escalated: false,
      };
      this.state.qa.push(rec);
      this.setQa(rec, {});
    }
    setTimeout(() => this.schedule(), 200);
  }

  /** Manager's "send to QA" for any open PR (including ones opened by people); with `agentId`, that free agent tests it now. */
  async sendToQa(repoId: string, prNumber: number, agentId?: string) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber && p.state === 'OPEN');
    if (!pr) throw new HttpError(404, `La PR #${prNumber} no está abierta en ${repo.fullName}`);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `La PR #${prNumber} ya está en estado ${rec.status}`);
    if (rec && (rec.status === 'needs-human' || rec.status === 'passed' || rec.status === 'failed')) {
      // a fresh start: the manager decided it deserves another round
      rec.round += 1;
      rec.sessionFailures = 0;
      rec.mergeNote = null;
      if (rec.preQa) Object.assign(rec, { fixReason: rec.preQa.fixReason, preQa: null }); // QA gets the test it was queued for
    }
    const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role !== 'ceo' && a.task !== 'qa' && (a.prNumber === prNumber || a.branch === pr.headRefName));
    const tester = agentId ? this.agent(agentId) : null;
    if (tester && (tester.repoId !== repo.id || tester.role === 'ceo')) throw new HttpError(400, `${tester.name} no trabaja en ${repo.fullName}`);
    if (tester && BUSY.includes(tester.status)) throw new HttpError(409, `${tester.name} está ocupado: ${this.agentDoing(tester)}`);
    if (tester) this.ensureSlot();
    this.clearPrepStrikes(repo.id, prNumber);
    this.queueQa(repo, prNumber, dev ?? null, pr.closesIssues[0] ?? null);
    const queued = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber && q.status === 'queued');
    if (tester && queued) {
      void this.runQa(tester, repo, queued); // marks it testing at once, before the scheduler's next pass
      this.toast('info', `${tester.name} está probando la PR #${prNumber}`);
    } else this.toast('info', `La PR #${prNumber} está en cola para QA`);
  }

  /** Manager's "send back to dev" for a PR that needs a human or failed QA: a developer fixes it, with the note. */
  async sendBackToDev(repoId: string, prNumber: number, note?: string, from?: string) {
    const repo = this.repo(repoId);
    const find = () => this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber);
    sendBackPatch(prNumber, listed, find(), repo.defaultBranch, note, from); // refuse before asking GitHub
    // The last sync's mergeability may be stale or UNKNOWN: ask about the PR itself whether it conflicts now.
    const details = await this.backend.prDetails(repo.fullName, prNumber).catch(() => null);
    const pr = details && listed ? { ...listed, state: details.state, mergeable: details.mergeable, mergeState: details.mergeState } : listed;
    const rec = find();
    const patch = sendBackPatch(prNumber, pr, rec, repo.defaultBranch, note, from);
    this.clearPrepStrikes(repo.id, prNumber);
    this.setQa(rec!, { ...patch, preQa: null });
    setTimeout(() => this.schedule(), 200);
    this.toast('info', `La PR #${prNumber} vuelve a un desarrollador${patch.fixReason === 'conflict' ? ' para resolver sus conflictos' : ''}`);
  }

  private buildQaSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, pr: PrDetails, testStep: string, deps?: DepsOutcome) {
    return qaSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, pr, testStep, depsLine: depsPromptLine(deps) });
  }

  private async runQa(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const branch = qaBranch(rec.prNumber, slugify(a.name));
    this.qaWaits.set(`${repo.id}#${rec.prNumber}`, Date.now() - rec.updatedAt); // queued since its last change
    this.setQa(rec, { status: 'testing', qaAgentId: a.id });
    this.beginTask(
      a,
      { task: 'qa', issueNumber: rec.issueNumber, issueTitle: `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: null, sessionId: null },
      `QA · PR #${rec.prNumber} · round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );

    let pr: PrDetails;
    let issue: { title: string; body: string } | null = null;
    const lastTestedSha = rec.testedSha;
    // Stopped meanwhile, by the manager or because the PR closed (then its record has left QA already).
    const stopped = () => {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return void this.abandoned(a);
    };
    try {
      pr = await this.backend.prDetails(repo.fullName, rec.prNumber);
      const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
      if (issueNumber) issue = await this.backend.issueDetails(repo.fullName, issueNumber).catch(() => null);
      Object.assign(a, { issueTitle: pr.title, prUrl: pr.url });
      this.emitAgent(a);
    } catch (err) {
      if (a.status !== 'preparing') return stopped();
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      this.emitAgent(a);
      return;
    }
    if (a.status !== 'preparing') return stopped();
    if (pr.state !== 'OPEN') {
      this.appendLog(a, [{ kind: 'system', text: `La PR #${pr.number} está ${pr.state === 'MERGED' ? 'fusionada' : 'cerrada'}; no hay nada que probar.` }]);
      this.clearTask(a);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, pr, pr.state);
      return;
    }
    // QA never spends a session on a stale branch: a conflict goes to the developer first, a branch behind is updated.
    const gate = qaGate(pr, rec, repo.autoMerge);
    if (gate.do === 'send-back') {
      this.appendLog(a, [{ kind: 'system', text: `La PR #${pr.number} tiene conflictos con ${repo.defaultBranch}; vuelve a su desarrollador antes de QA.` }]);
      this.clearTask(a);
      if (gate.needsHuman) {
        this.sendBack(repo, rec, 'conflict', rec.fixInstructions ?? '', true);
        return;
      }
      // QA's last findings stay on the record for the test QA was queued for, which follows the merge.
      this.setQa(rec, { status: 'failed', qaAgentId: null, fixReason: 'conflict', preQa: { sha: pr.headSha, fixReason: rec.fixReason }, mergeFixes: rec.mergeFixes + 1, mergeNote: null });
      setTimeout(() => this.schedule(), 200);
      return;
    }
    if (gate.do === 'update-branch') {
      this.appendLog(a, [{ kind: 'system', text: `Actualizando primero la rama de la PR #${pr.number} con ${repo.defaultBranch}…` }]);
      try {
        await this.backend.updateBranch(repo.fullName, pr.number);
        pr = await this.backend.prDetails(repo.fullName, pr.number);
      } catch (err) {
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ GitHub no ha podido actualizarla (${oneLine(err)}); se prueba tal como está.` }]);
      }
    }
    rec.testedSha = pr.headSha;

    const desk = await this.prepare(a, repo, { pr: rec.prNumber }, branch, { rec, task: 'qa' });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return;
    }
    const { cwd } = desk;

    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    // A last-round fail sent back for a merge fix (QA never passed it): QA's findings first, then a full re-check.
    const failedConflict = rec.fixReason === 'conflict' && !rec.passedSha;
    const qa = qaInstructions({
      ...pr,
      round: rec.round,
      fixReason: failedConflict ? 'qa' : rec.fixReason,
      lastTestedSha: failedConflict ? null : lastTestedSha,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      defaultBranch: repo.defaultBranch,
    });
    const prompt = [
      `Haz QA de la pull request #${pr.number}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Autor: ${dev ? (dev.id === a.id ? `tú, en una sesión anterior` : dev.name) : 'un compañero'} · ronda de QA ${rec.round}`,
      qa.checks,
      qa.retest,
      '',
      'Descripción de la PR:',
      pr.body.trim() || '(vacía)',
      issue ? `\nIssue enlazado: ${issue.title}\n${issue.body.trim() || '(sin descripción)'}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    const systemAppend = this.buildQaSystemAppend(a, repo, cwd, branch, pr, qa.testStep, desk.deps);
    const rt = this.agentRt.get(a.id);
    if (!rt) return; // let go meanwhile
    rt.qaResume = { cwd, systemAppend };
    this.startAgentSession(a, repo, cwd, prompt, systemAppend, undefined, QA_SCHEMA);
  }

  private async onQaFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    const rt = this.agentRt.get(a.id)!;
    const report = result.ok ? parseReport(result) : null;
    const resume = rt.qaResume;
    const next = qaRetry({ stopped: a.status === 'stopped', limited: this.limited(), ok: result.ok, report: !!report, canResume: !!resume && !!a.sessionId });
    if (next === 'resume' && resume && a.sessionId) {
      // Same session, context and screenshots: they likely ended a turn to wait on something that never woke them.
      rt.qaResume = null;
      a.endedAt = null;
      this.appendLog(a, [{ kind: 'system', text: '↻ La sesión ha terminado sin informe de QA. Se reanuda una vez para terminar.' }]);
      this.startAgentSession(a, repo, resume.cwd, QA_RESUME_PROMPT, resume.systemAppend, a.sessionId, QA_SCHEMA);
      return;
    }

    if (next === 'give-up' || !report) {
      if (a.status !== 'stopped') this.fail(a, { ...result, errors: result.errors.length ? result.errors : ['QA ha terminado sin un informe utilizable'] }, `el QA de la PR #${a.prNumber}`);
      if (rec) {
        const failures = rec.sessionFailures + (this.limited() ? 0 : 1); // the usage limit isn't the PR's fault
        const patch = { qaAgentId: null, sessionFailures: failures, summary: a.status === 'stopped' ? QA_STOPPED : rec.summary };
        if (a.status === 'stopped') this.setQa(rec, { ...patch, status: 'needs-human', escalated: true }); // the manager stopped it: theirs to decide
        else if (failures >= MAX_QA_FAILURES) this.stuck(rec, patch, `QA ha terminado sin un informe utilizable ${failures} veces seguidas`);
        else this.setQa(rec, { ...patch, status: 'queued' });
      }
      return;
    }

    a.status = 'done';
    const pass = report.verdict === 'pass';
    if (rec) this.ledger({ kind: 'qa', repoId: repo.id, pr: rec.prNumber, round: rec.round, pass, tester: a.id, author: rec.devAgentId, at: Date.now() });
    this.appendLog(a, [{ kind: pass ? 'done' : 'error', text: `${pass ? '✅ QA ha aprobado' : '❌ QA ha suspendido'} la PR #${a.prNumber} · ${report.checks.length} comprobaciones · ${rt.shots.length} capturas` }]);

    // Evidence + comment on the PR
    let commentUrl: string | null = null;
    if (rec) {
      const shots = await saveQaShots(
        qaShotsDir(QA_SHOTS_DIR, repo.id, rec.prNumber),
        rt.shots.map((s, i) => ({ data: s.data, mime: s.mime, page: s.url, caption: report.screenshots[i] ?? `Screenshot ${i + 1}` })),
      ).catch((err) => {
        console.warn(`could not keep QA's screenshots of PR #${rec.prNumber}: ${oneLine(err)}`);
        return [];
      });
      const key = `${repo.id}#${rec.prNumber}`;
      recordQa(this.state.ops, repo.id, pass, this.qaWaits.get(key) ?? null, Date.now());
      this.qaWaits.delete(key);
      // On a fail: a conflict with the default branch is the merge gate's job, not the manager's (on QA's last round),
      // and the checks are recorded so a re-run of a red one can count as the fix.
      const pull = !pass ? await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null) : null;
      const next = qaOutcome(pass, rec, pull);
      try {
        this.appendLog(a, [{ kind: 'system', text: '📎 Subiendo las capturas y publicando el informe de QA en la PR…' }]);
        const body = await this.renderQaComment(a, repo, rec, report, rt.shots, next);
        commentUrl = (await this.backend.commentPull(repo.fullName, rec.prNumber, body)) || null;
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ ${commentUrl ?? 'comentario publicado'}` }]);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ No se ha podido publicar el informe de QA: ${(err as Error).message}` }]);
      }
      const qaRounds = rec.round - rec.retests; // rounds QA itself asked for
      const nextStatus = next === 'conflict' ? 'failed' : next;
      const fixInstructions = report.fixInstructions ?? report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n');
      this.setQa(rec, {
        status: nextStatus,
        summary: report.summary,
        checks: report.checks,
        commentUrl: commentUrl ?? rec.commentUrl,
        fixInstructions,
        sessionFailures: 0,
        fixReason: pass ? null : 'qa',
        preQa: null,
        passedSha: pass ? rec.testedSha : null,
        mergeNote: null,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        qaChecks: pull?.checks ?? null,
        shots,
      });
      // QA's findings travel with the merge fix; the developer's push then gets one more QA round.
      if (next === 'conflict') this.sendBack(repo, rec, 'conflict', conflictFixInstructions(fixInstructions, repo.defaultBranch), false);
      const stillConflicts = pull && (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') ? `, y sigue teniendo conflictos con ${repo.defaultBranch} tras agotar sus ${MAX_MERGE_FIXES} correcciones de merge` : '';
      const triaged = nextStatus === 'needs-human' && this.stuck(rec, {}, `ha suspendido QA ${qaRounds} veces, el máximo de rondas de QA de una PR (${MAX_QA_ROUNDS})${stillConflicts}`);
      this.toast(
        pass ? 'success' : 'error',
        pass
          ? `✅ ${a.name} ha aprobado la PR #${rec.prNumber}${repo.autoMerge ? '; se fusiona cuando los checks de GitHub estén en verde' : ': lista para fusionar'}`
          : nextStatus === 'needs-human'
            ? `❌ La PR #${rec.prNumber} ha suspendido QA ${qaRounds} veces${triaged ? `; ${this.ceo().name} la revisa antes de que te llegue` : ' y necesita a una persona'}`
            : next === 'conflict'
              ? `❌ ${a.name} ha suspendido la PR #${rec.prNumber}, y tiene conflictos con ${repo.defaultBranch}; vuelve para hacer merge y corregir`
              : `❌ ${a.name} ha suspendido la PR #${rec.prNumber}; vuelve al desarrollador`,
      );
    }
  }

  private async renderQaComment(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, report: QaReport, shots: Shot[], next: QaNext) {
    const pass = report.verdict === 'pass';
    const images: string[] = [];
    const evidence = shots.slice(-8);
    const offset = shots.length - evidence.length;
    const folder = `pr-${rec.prNumber}/round-${rec.round}-${Date.now().toString(36)}`;
    for (const [i, shot] of evidence.entries()) {
      const n = offset + i + 1;
      const ext = MIME_EXT[shot.mime] ?? 'png';
      const file = `${folder}/${String(n).padStart(2, '0')}.${ext}`;
      try {
        const url = await this.backend.uploadEvidence(repo.fullName, file, shot.data);
        const caption = report.screenshots[n - 1] ?? `Screenshot ${n}`;
        images.push(`**${n}. ${caption}**${shot.url ? ` · \`${shot.url}\`` : ''}\n\n<img src="${url}" alt="${caption.replace(/"/g, "'")}" width="760">`);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ no se ha podido subir la captura ${n}: ${(err as Error).message.slice(0, 120)}` }]);
      }
    }
    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const lines = [
      `## 🔍 Informe de QA: ${pass ? '✅ Aprobada' : '❌ Suspendida'}`,
      `**QA:** ${a.name} (agente de sareoffice, en una sesión nueva) · **Ronda:** ${rec.round}${dev ? ` · **Autor:** ${dev.name}` : ''}`,
      '',
      report.summary,
      '',
      '| | Comprobación | Detalles |',
      '|---|---|---|',
      ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`),
    ];
    if (report.commands.length) {
      lines.push('', '<details><summary>🧪 Comandos ejecutados</summary>', '', '| Comando | Resultado |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
    }
    if (!pass && report.fixInstructions) lines.push('', '### 🔧 Qué hay que corregir', '', report.fixInstructions);
    if (images.length) lines.push('', '### 📸 Capturas', '', ...images.flatMap((img) => [img, '']));
    else lines.push('', '_En esta ronda no se hicieron capturas del navegador._');
    const merge = repo.autoMerge ? 'se fusiona automáticamente cuando pasen los checks de GitHub' : 'lista para que el responsable la fusione';
    lines.push('', `<sub>Publicado por sareoffice · ${pass ? merge : next === 'needs-human' ? 'necesita que decida una persona' : next === 'conflict' ? `devuelta al desarrollador para hacer merge de ${repo.defaultBranch} y corregir` : 'devuelta al desarrollador para corregir'}</sub>`);
    return lines.join('\n');
  }

  /** Send a failed PR back to the agent who wrote it (or any free agent on the floor). */
  private async runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const original = rec.devAgentId === dev.id;
    const pull = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const headRef = pull?.headRefName ?? dev.branch ?? `pr-${rec.prNumber}`;
    const qaAgent = rec.qaAgentId ? this.state.agents.find((x) => x.id === rec.qaAgentId) : null;
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const author = rec.devAgentId;
    this.ledger({ kind: 'fix', repoId: repo.id, pr: rec.prNumber, key: `${rec.round}:${rec.mergeFixes}`, at: Date.now() });
    this.setQa(rec, { status: 'fixing', devAgentId: dev.id });
    this.beginTask(
      dev,
      // The session they held was another task's (QA, say); the author's own is resumed below, from rec.devSessionId.
      { task: 'fix', issueNumber: rec.issueNumber, issueTitle: pull?.title ?? `PR #${rec.prNumber}`, branch: headRef, prNumber: rec.prNumber, prUrl: pull?.url ?? null, sessionId: null },
      rec.fixReason === 'conflict' ? `Resolviendo conflictos en la PR #${rec.prNumber}` : rec.fixReason === 'checks' ? `Arreglando checks en la PR #${rec.prNumber}` : `Corrigiendo la PR #${rec.prNumber} tras la ronda de QA ${rec.round}`,
      `Descargando la PR #${rec.prNumber}…`,
    );
    // GitHub's word, not the last sync's: a PR closed or merged since then gets no fix.
    const live = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if (dev.status !== 'preparing') {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return void this.abandoned(dev);
    }
    if (live && live.state !== 'OPEN') {
      this.appendLog(dev, [{ kind: 'system', text: `La PR #${rec.prNumber} está ${live.state === 'MERGED' ? 'fusionada' : 'cerrada'}; no hay nada que corregir.` }]);
      this.clearTask(dev);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, live, live.state);
      return;
    }
    const desk = await this.prepare(dev, repo, { pr: rec.prNumber }, headRef, { rec, task: 'fix', author });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    const { cwd } = desk;
    const failed = rec.checks.filter((c) => c.result === 'fail');
    const takeover = original ? '' : ' La escribió un compañero, así que lee primero la PR y el issue enlazado.';
    const push = `sube los cambios a la misma rama: git push origin HEAD:${headRef}`;
    const runId = rec.fixReason === 'checks' ? failedRunId(rec.fixInstructions) : null;
    const runLog = runId ? logTail(await this.backend.failedRunLog(repo.fullName, runId).catch(() => '')) : '';
    // A conflict QA never passed (it failed the last round) goes out as a QA fix: its instructions add the merge.
    const mergeFix =
      rec.fixReason === 'conflict' && (rec.preQa || rec.passedSha)
        ? [
            rec.preQa
              ? `La pull request #${rec.prNumber} (${pull?.url ?? ''}) tiene conflictos con ${repo.defaultBranch} porque antes se fusionó otro trabajo, así que vuelve a ti antes de que QA la pruebe.${takeover}`
              : `QA aprobó la pull request #${rec.prNumber} (${pull?.url ?? ''}), pero ahora tiene conflictos con ${repo.defaultBranch} porque antes se fusionó otro trabajo.${takeover}`,
            // A conflict found before QA keeps QA's last findings for the re-test, not for this fix.
            !rec.preQa && rec.fixInstructions ? `\nQué hay que corregir:\n${rec.fixInstructions}` : '',
            '',
            `Actualízala: git fetch origin && git merge origin/${repo.defaultBranch}. Resuelve los conflictos de forma que tanto este cambio como el trabajo recién fusionado sigan funcionando, ejecuta las comprobaciones del proyecto y ${push}`,
          ]
        : rec.fixReason === 'checks'
          ? [
              `QA aprobó la pull request #${rec.prNumber} (${pull?.url ?? ''}), pero han fallado sus checks de GitHub.${takeover}`,
              '',
              `Checks fallidos:\n${rec.fixInstructions ?? ''}`,
              ...(runId ? failedLogLines(runId, runLog) : []),
              '',
              `Lee los logs con gh pr checks ${rec.prNumber} -R ${repo.fullName} (para GitHub Actions: gh run view <run id> -R ${repo.fullName} --log-failed). Corrige la causa, ejecuta en local los mismos checks donde puedas y ${push}`,
              `Si un fallo claramente no tiene nada que ver con este cambio (un test inestable o una caída de un servicio), relánzalo con gh run rerun <run id> -R ${repo.fullName} --failed y dilo.`,
            ]
          : null;
    const qaFix = [
      original
        ? `${qaAgent && qaAgent.id !== dev.id ? qaAgent.name : 'QA'} ha probado tu pull request #${rec.prNumber} y la ha SUSPENDIDO (ronda ${rec.round}).`
        : `Te haces cargo de la pull request #${rec.prNumber} (${pull?.url ?? ''}), escrita por un compañero, porque QA la ha suspendido (ronda ${rec.round}). Lee primero la PR y el issue enlazado.`,
      '',
      `Resumen de QA: ${rec.summary ?? ''}`,
      failed.length ? `Comprobaciones fallidas:\n${failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')}` : '',
      rec.fixInstructions ? `\nQué hay que corregir:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `\nInforme completo con capturas: ${rec.commentUrl}` : '',
      '',
      `Corrige estos problemas, vuelve a ejecutar las comprobaciones relevantes y sube los cambios a la misma rama: git push origin HEAD:${headRef}`,
      ownPrLine(repo.defaultBranch),
      'Después responde con un breve resumen de lo que has cambiado. No abras una pull request nueva; QA volverá a probarla automáticamente.',
    ];
    const mergeEnd = 'Después responde con un breve resumen de lo que has hecho. No abras una pull request nueva; la oficina la fusiona cuando pasan los checks, tras otra ronda de QA si el código ha cambiado.';
    const prompt = (mergeFix ? [...mergeFix, ownPrLine(repo.defaultBranch), mergeEnd] : qaFix).filter((l) => l !== '').join('\n');
    const resume = original && rec.devSessionId ? rec.devSessionId : undefined;
    this.startAgentSession(dev, repo, cwd, prompt, this.buildSystemAppend(dev, repo, cwd, headRef, { pr: rec.prNumber, headRef }, desk.deps), resume);
  }

  private async onFixFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    // Did it push anything? A checks fix may only re-run a flaky check, so only QA and conflict fixes are asked.
    const current = rec && result.ok && a.status !== 'stopped' && rec.fixReason !== 'checks' ? await this.prHead(a, repo, rec.prNumber) : null;
    if (a.status === 'stopped') {
      if (rec?.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    if (!result.ok) {
      this.fail(a, result, `la corrección de la PR #${a.prNumber}`);
      // Someone else gets a go before it lands on the manager.
      const failures = rec ? rec.sessionFailures + (this.limited() ? 0 : 1) : 0;
      if (rec && failures >= MAX_FIX_FAILURES) this.stuck(rec, { sessionFailures: failures }, `han fallado ${failures} sesiones de corrección seguidas`);
      else if (rec) this.setQa(rec, { status: 'failed', sessionFailures: failures });
      return;
    }
    if (!rec || !this.state.qa.includes(rec)) {
      a.status = 'done';
      this.appendLog(a, [{ kind: 'done', text: `✔ Corrección subida para la PR #${a.prNumber} en ${this.minutes(a)} min. Vuelve a QA.` }]);
      return;
    }
    const head = current?.headSha ?? null;
    const step = fixOutcome(rec, head, this.minutes(a), !this.limited(), current?.checks ?? null);
    if (!step.pushed && head) {
      // Asked once to push or say why nothing needs to change, before it counts as a strike.
      const key = `${repo.id}#${rec.prNumber}`;
      const noChange = noChangeReason(result.text);
      const next = unpushedFix(rec, head, { nudged: this.fixNudged.has(key), noChange, counts: !this.limited() });
      if (next.do === 'retest') {
        this.fixNudged.delete(key);
        a.status = 'done';
        this.appendLog(a, [{ kind: 'done', text: `✔ La PR #${rec.prNumber} no necesita cambios: ${noChange?.replace(/[.!\s]+$/, '')}. Vuelve a QA para otra prueba.` }]);
        this.setQa(rec, { ...next.set, devSessionId: a.sessionId ?? rec.devSessionId });
        this.toast('info', `${a.name} dice que la PR #${rec.prNumber} no necesita cambios; QA vuelve a probarla`);
        return;
      }
      if (next.do === 'nudge') {
        this.fixNudged.add(key);
        a.status = 'done';
        this.appendLog(a, [{ kind: 'system', text: `No se han subido commits nuevos a la PR #${rec.prNumber}; se le pregunta a ${a.name} una vez más.` }]);
        // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
        void this.message(a.id, noPushNudge(rec.prNumber, repo.defaultBranch)).catch(() => {
          if (rec.status !== 'fixing') return;
          this.unpushed(a, repo, rec, step);
          this.emitAgent(a);
          setTimeout(() => this.schedule(), 500);
        });
        return;
      }
    }
    if (!step.pushed) return this.unpushed(a, repo, rec, step);
    a.status = 'done';
    this.appendLog(a, [step.log]);
    this.setQa(rec, { ...step.set, devSessionId: a.sessionId ?? rec.devSessionId });
    this.toast(
      'info',
      step.set.status === 'passed'
        ? `${a.name} ha corregido la PR #${rec.prNumber}; se fusiona cuando vuelva a pasar`
        : 'preQa' in step.set
          ? `${a.name} ha actualizado la PR #${rec.prNumber}; QA la prueba`
          : step.set.retests
            ? `${a.name} ha relanzado los checks fallidos de la PR #${rec.prNumber}; QA vuelve a probarla`
            : `${a.name} ha subido correcciones a la PR #${rec.prNumber}; la ronda de QA ${rec.round} está en cola`,
    );
  }

  /** A fix that pushed nothing counts as a failed session (fixOutcome's step). */
  private unpushed(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, step: ReturnType<typeof fixOutcome>) {
    // Like a failed session: someone gets another go, with the same instructions, before it lands on the CEO.
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const needsHuman = step.set.status === 'needs-human';
    a.status = 'error';
    a.lastError = `No se han subido commits nuevos a la PR #${rec.prNumber}`;
    this.appendLog(a, [step.log]);
    const triaged = needsHuman ? this.stuck(rec, step.set, `volvió para corregirse, pero ${step.set.sessionFailures} sesiones de corrección seguidas terminaron sin subir ningún commit`) : (this.setQa(rec, step.set), false);
    const next = !needsHuman ? '; vuelve para otro intento' : triaged ? `; ${this.ceo().name} la revisa` : '; te necesita';
    this.toast('error', `${a.name} ha terminado la corrección de la PR #${rec.prNumber} sin subir ningún commit${next}`);
  }

  /** The PR's head commit and checks now; null (with a warning in the agent's log) when GitHub can't be asked. */
  private async prHead(a: PersistedAgent, repo: PersistedRepo, prNumber: number): Promise<Pick<PrDetails, 'headSha' | 'checks'> | null> {
    try {
      return await this.backend.prDetails(repo.fullName, prNumber);
    } catch (err) {
      console.warn(`could not read the head of ${repo.fullName}#${prNumber}`, err);
      this.appendLog(a, [{ kind: 'system', text: `⚠ No se ha podido comprobar si la PR #${prNumber} tiene commits nuevos (${oneLine(err)}); se da la corrección por buena.` }]);
      return null;
    }
  }

  /** A message for an agent: sent into their running session, or a follow-up that resumes it. typed: the manager typed it at their CLI's prompt, where it's already running. */
  async message(id: string, text: string, typed = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') return this.messageCeo(text);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Mensaje vacío');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      if (!typed) {
        try {
          rt.session.send(text);
        } catch {
          throw new HttpError(409, `La sesión de ${a.name} todavía está arrancando; vuelve a enviar el mensaje en un momento.`);
        }
      }
      this.appendLog(a, [{ kind: 'manager', text: `▶ Responsable: ${text}` }]);
      return;
    }
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} todavía se está preparando; vuelve a intentarlo en un momento`);
    if (!a.sessionId || !a.branch || a.task === 'qa') throw new HttpError(409, `${a.name} no tiene ninguna sesión que continuar. Dale un issue o una PR que probar.`);
    this.ensureSlot();
    this.appendLog(a, [{ kind: 'manager', text: `▶ Responsable: ${text}` }]);
    const cwd = this.deskOf(a, repo);
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId, undefined, typed ? 'typed' : null);
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    const s = this.state.settings;
    if (patch.sessionLimit !== undefined) s.sessionLimit = Math.max(0, Math.round(Number(patch.sessionLimit)) || 0);
    // The default model belongs to the default coding agent: a new agent starts on its own default.
    if (isCli(patch.defaultCli) && patch.defaultCli !== s.defaultCli) {
      s.defaultCli = patch.defaultCli;
      if (patch.defaultModel === undefined) s.defaultModel = s.defaultCli === 'claude' ? DEFAULT_MODEL : '';
    }
    if (patch.defaultModel !== undefined) s.defaultModel = String(patch.defaultModel).trim() || (s.defaultCli === 'claude' ? DEFAULT_MODEL : '');
    if (patch.defaultEffort !== undefined && EFFORTS.includes(patch.defaultEffort)) s.defaultEffort = patch.defaultEffort;
    if (patch.runtime === 'terminal' || patch.runtime === 'sdk') s.runtime = patch.runtime;
    if (patch.scaling === 'approve' || patch.scaling === 'auto') s.scaling = patch.scaling;
    if (patch.maxAgents !== undefined) s.maxAgents = clampMaxAgents(patch.maxAgents);
    if (patch.ceoHeartbeatMin !== undefined) s.ceoHeartbeatMin = Math.max(0, Math.min(1440, Math.round(Number(patch.ceoHeartbeatMin)) || 0));
    if (typeof patch.managerName === 'string') s.managerName = patch.managerName.trim().slice(0, 40);
    if (typeof patch.companyName === 'string') s.companyName = patch.companyName.trim().slice(0, 60);
    if (typeof patch.dogName === 'string') s.dogName = patch.dogName.trim().slice(0, 24) || DEFAULT_DOG_NAME;
    if (typeof patch.projectsDir === 'string' && patch.projectsDir.trim()) s.projectsDir = path.resolve(patch.projectsDir.trim());
    if (typeof patch.setupDone === 'boolean') s.setupDone = patch.setupDone;
    if (patch.tutorialStep !== undefined) s.tutorialStep = Math.max(-1, Math.round(Number(patch.tutorialStep)) || 0);
    if (typeof patch.autoUpdate === 'boolean') s.autoUpdate = patch.autoUpdate;
    if (patch.pacingSessions !== undefined) s.pacingSessions = clampPacingSessions(patch.pacingSessions);
    if (patch.trimIdleDesksMin !== undefined) {
      s.trimIdleDesksMin = clampTrimIdleMin(patch.trimIdleDesksMin);
      setTimeout(() => void this.trimIdleDesks(), 1000);
    }
    if (patch.voice !== undefined) {
      const keepDays = s.voice.keepDays;
      s.voice = voiceSettings(s.voice, patch.voice);
      if (s.voice.keepDays !== keepDays) setTimeout(() => void this.voice.prune(), 500);
    }
    if (patch.listen !== undefined) s.listen = listenSettings(s.listen, patch.listen);
    if (patch.notify !== undefined) {
      const url = (patch.notify as { officeUrl?: unknown } | null)?.officeUrl;
      if (url !== undefined && officeUrl(url) === null) throw new HttpError(400, 'La URL de la oficina debe ser una dirección http(s), p. ej. https://office.your-tailnet.ts.net');
      s.notify = notifySettings(s.notify, patch.notify);
    }
    if (patch.cloud !== undefined) {
      const next: CloudSettings = cloudSettings(s.cloud, patch.cloud);
      if (next.machineKind === 'box' && !this.cloud.boxApi()) throw new HttpError(400, 'Guarda antes tu clave de API de Upstash Box: los agentes en la nube se ejecutan en tu cuenta de Upstash.');
      s.cloud = next;
    }
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    this.emitCeo();
    setTimeout(() => this.schedule(), 200);
    return s;
  }

  /** The setup wizard: who you are, the company, and your CEO. */
  setup(x: { managerName?: string; companyName?: string; scaling?: string; ceoName?: string; ceoLook?: string; ceoColor?: string }) {
    this.updateSettings({
      managerName: x.managerName,
      companyName: x.companyName,
      ...(x.scaling === 'auto' || x.scaling === 'approve' ? { scaling: x.scaling } : {}),
    });
    const ceo = this.ceo();
    this.updateAgent(ceo.id, { name: x.ceoName, color: x.ceoColor });
    if (LOOKS.includes(x.ceoLook as AgentLook)) this.updateAgent(ceo.id, { look: x.ceoLook });
    return this.state.settings;
  }

  // ---------- scheduling ----------

  /**
   * Can this agent take work now? One whose last session failed sits out a short cooldown, then gets work like everyone
   * else instead of waiting for the manager to reset them.
   */
  private isFree(a: PersistedAgent) {
    if (a.needsSignIn) return false; // a cloud agent waiting to be signed in takes no work (docs/cloud.md)
    return FREE.includes(a.status) || (a.status === 'error' && Date.now() - (a.endedAt ?? 0) >= ERROR_COOLDOWN_MS);
  }

  /** A floor's agents who can take work now, by desk. */
  private available(repo: PersistedRepo) {
    return this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo' && this.isFree(a)).sort((x, y) => x.desk - y.desk);
  }

  private scheduleOffset = 0;
  private issueFailures = new Map<string, number>(); // `${repoId}#${issue}` → failed sessions on it
  private nudged = new Set<string>(); // `${repoId}#${issue}`: its agent was asked once to finish the missing PR
  private fixNudged = new Set<string>(); // `${repoId}#${pr}`: its fix session was asked once to push or say why not
  private pausedUntil = 0; // Claude's usage limit was hit: nothing new starts before this
  private pacingUntil = 0; // Claude warned about usage: new issues are paced until this
  private pacingLimit: string | null = null; // which of Claude's limits the pacing is for
  private lastWarning: UsageWarningView | null = null; // the latest usage warning, for the usage meter
  private waiver: Waiver | null = null; // pacing the manager cleared with "Resume full speed"
  private lastUsage = '';

  /** Backlog issues that can start now, most urgent first: the ones holding up the longest chain of other issues, then the oldest. */
  private readyIssues(repo: PersistedRepo) {
    const issues = this.repoRt.get(repo.id)!.issues;
    const open = new Set(issues.map((i) => i.number));
    const weight = holdUps(issues);
    return issues
      .filter(
        (i) =>
          !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) &&
          !this.issueTaken(repo, i.number) &&
          !this.isHeld(repo.id, i.number) &&
          blockers(i.body, open).length === 0 &&
          (this.issueFailures.get(`${repo.id}#${i.number}`) ?? 0) < MAX_ISSUE_FAILURES,
      )
      .map((issue) => ({ issue, ...weight.get(issue.number)! }))
      .sort((x, y) => y.chain - x.chain || y.waiting - x.waiting || x.issue.number - y.issue.number);
  }

  /**
   * Finish work in flight: test queued PRs (oldest first) and get failed ones fixed. Returns true if work started.
   * Any free agent but the PR's author tests it (handOut.ts pickTester); its author goes on with other work meanwhile. A failed PR goes back to its author when they're free; while the
   * author is still in a session on it, it waits for them; otherwise any free agent takes it. A PR whose desks keep
   * failing to set up sits out.
   */
  private startPipelineWork(repo: PersistedRepo): boolean {
    const free = this.available(repo);
    if (!free.length) return false;
    const now = Date.now();
    const floor = this.floorState(this.repoRt.get(repo.id)!);
    const waiting = (status: QaRecord['status'], task: PrepJob['task']) =>
      this.state.qa
        .filter(
          (q) =>
            q.repoId === repo.id &&
            q.status === status &&
            stillOpen({ kind: 'pr', number: q.prNumber }, floor) &&
            !prepHeld(this.prepStrikes.get(prepKey(repo.id, q.prNumber, task)), now),
        )
        .sort((x, y) => x.updatedAt - y.updatedAt);
    const fixes = waiting('failed', 'fix');
    const owed = new Set(fixes.map((q) => q.devAgentId).filter((id): id is string => !!id));
    for (const rec of waiting('queued', 'qa')) {
      const othersCan = this.state.agents.some((a) => a.repoId === repo.id && a.role !== 'ceo' && a.id !== rec.devAgentId && a.status !== 'stopped');
      const tester = pickTester(free, rec.devAgentId, owed, othersCan, now - rec.updatedAt);
      if (!tester) continue;
      void this.runQa(tester, repo, rec);
      return true;
    }
    for (const rec of fixes) {
      const author = this.state.agents.find((a) => a.id === rec.devAgentId && a.repoId === repo.id && a.role !== 'ceo') ?? null;
      const headRef = this.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)?.headRefName ?? null;
      const to = fixGoesTo(author, !!author && free.includes(author), rec.prNumber, headRef);
      if (to === 'wait') continue; // the author gets it when their session ends
      void this.runFix(to === 'author' ? author! : (free.find((a) => !owed.has(a.id)) ?? free[0]), repo, rec);
      return true;
    }
    return false;
  }

  /**
   * Give a free agent the next backlog issue (auto-assign floors only). Returns true if work started. Issues that say
   * "Depends on #N" wait until #N is closed; the rest go in readyIssues() order.
   */
  private startIssueWork(repo: PersistedRepo): boolean {
    if (!repo.autoAssign || !this.mayStart('issue')) return false;
    const agent = this.available(repo)[0];
    const next = agent ? this.readyIssues(repo)[0] : undefined;
    if (!agent || !next) return false;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    void this.assign(agent.id, next.issue.number).catch((err) => console.warn('auto-assign failed', err));
    return agent.status === 'preparing';
  }

  private limited() {
    return Date.now() < this.pausedUntil;
  }

  /** Claude turned a session away for the usage limit: start nothing new until it resets, rather than failing agent after agent. */
  private pauseForLimit(resetsAt: number | null) {
    const until = (resetsAt ?? Date.now() + LIMIT_PAUSE_MS) + 30_000;
    if (until <= this.pausedUntil) return;
    const fresh = Date.now() >= this.pausedUntil;
    this.pausedUntil = until;
    if (fresh) this.postMessage('office', `⏸ Se ha alcanzado el límite de uso de Claude. La oficina no empieza trabajo nuevo hasta las ${new Date(until).toLocaleTimeString('es-ES')}; las sesiones en curso continúan.`);
    this.emitUsage();
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets, rather than run into the limit. */
  private paceForWarning(info: UsageWarning) {
    const now = Date.now();
    this.lastWarning = warningView(info, now);
    const until = info.resetsAt && info.resetsAt > now ? info.resetsAt : now + PACING_MS;
    // The manager already resumed full speed for this window: they topped up, or their usage was reset.
    if (until <= this.pacingUntil || waived(info, this.waiver, now)) return this.emitUsage();
    const fresh = now >= this.pacingUntil;
    this.pacingUntil = until;
    this.pacingLimit = info.rateLimitType;
    if (fresh) this.postMessage('office', pacingMessage(info, until, this.state.settings.pacingSessions, now));
    this.emitUsage();
  }

  /** The manager's "Resume full speed" (they topped up, or their usage was reset): pacing ends now. A hard pause never does. */
  resumeFullSpeed(): UsageView {
    const now = Date.now();
    const refused = resumeRefusal({ now, pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil });
    if (refused) throw new HttpError(409, refused);
    this.waiver = { until: this.pacingUntil, limit: this.pacingLimit };
    this.pacingUntil = 0;
    this.postMessage('office', '⏩ Has vuelto a la velocidad máxima: los issues nuevos vuelven a empezar con normalidad. Si Claude rechaza una sesión por el límite, la oficina seguirá parándose hasta que se restablezca.');
    this.emitUsage();
    setTimeout(() => this.schedule(), 200);
    return this.usageNow();
  }

  /** The demo's stand-in for Claude's usage warning or limit (POST /api/usage/simulate), so pacing and the pause can be tried. */
  simulateUsage(kind: unknown): UsageView {
    const fake = this.backend.simulateUsage;
    if (!fake) throw new HttpError(404, 'El uso solo se puede simular en la oficina demo.');
    if (kind !== 'warning' && kind !== 'limit') throw new HttpError(400, 'kind debe ser "warning" o "limit"');
    const usage = fake(kind, Date.now());
    if ('limitResetsAt' in usage) this.pauseForLimit(usage.limitResetsAt);
    else {
      this.waiver = null; // a simulated warning always paces, even after Resume full speed
      this.paceForWarning(usage);
    }
    return this.usageNow();
  }

  /** May work of this kind start now, as far as Claude's usage goes? */
  private mayStart(kind: WorkKind) {
    return mayStart(kind, { now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running: this.running(), pacingSessions: this.state.settings.pacingSessions });
  }

  private usageNow() {
    return usageView({ now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil }, this.lastWarning);
  }

  private emitUsage() {
    const usage = this.usageNow();
    const key = JSON.stringify(usage);
    if (key === this.lastUsage) return;
    const was = this.lastUsage ? (JSON.parse(this.lastUsage) as typeof usage).state : 'normal';
    this.lastUsage = key;
    this.broadcast({ type: 'usage', usage });
    if (usage.state !== was && usage.state !== 'normal') {
      const until = usage.until ? new Date(usage.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'it resets';
      if (usage.state === 'paused') this.notifier.notify('usage', 'Se ha alcanzado el límite de uso de Claude', `La oficina no empieza trabajo nuevo hasta las ${until}; las sesiones en curso continúan.`);
      else this.notifier.notify('usage', 'Dosificando el trabajo nuevo', `Claude ha avisado de que el uso es alto, así que los issues nuevos empiezan despacio hasta las ${until}.`);
    }
  }

  /** Pacing and pauses run out on their own: say so when pacing ends. */
  private tickUsage() {
    if (this.pacingUntil && Date.now() >= this.pacingUntil) {
      this.pacingUntil = 0;
      this.postMessage('office', '✅ El uso de Claude ha vuelto a la normalidad. La oficina vuelve a empezar trabajo nuevo a toda velocidad.');
    }
    this.emitUsage();
  }

  // ---------- mission control ----------

  private opsTimer: NodeJS.Timeout | null = null;
  private lastOps = '';
  private qaWaits = new Map<string, number>(); // `${repoId}#${pr}` -> how long its QA run in progress waited for a tester

  /** A sync's merges (stamped with their issues' ages) and finished check runs go into mission control's history. */
  private recordSync(repo: PersistedRepo, pulls: PullInfo[]) {
    const now = Date.now();
    if (recordMerges(this.state.ops, repo.id, pulls, now) + recordChecks(this.state.ops, repo.id, pulls, now) > 0) this.save();
  }

  /** Every floor as mission control sees it now. */
  private opsNow(): OpsView {
    const floors: OpsFloorState[] = this.state.repos.map((r) => {
      const rt = this.repoRt.get(r.id);
      return {
        repoId: r.id,
        floor: r.floor,
        ready: rt?.lastSync ? this.readyIssues(r).length : 0,
        agents: this.state.agents.filter((a) => a.repoId === r.id),
        prs: (rt?.pulls ?? [])
          .filter((p) => p.state === 'OPEN')
          .map((p) => {
            const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
            return { number: p.number, qa: q ? this.qaView(q) : null, why: q?.stuckWhy ?? q?.mergeNote ?? null };
          }),
      };
    });
    return opsView(floors, this.state.ops, Date.now());
  }

  /** Recompute mission control shortly: changes usually come several at a time. */
  private opsSoon() {
    this.opsTimer ??= setTimeout(() => this.emitOps(), 400);
  }

  /** Broadcast mission control's numbers, but only when they changed: the wall repaints only then. */
  private emitOps() {
    if (this.opsTimer) clearTimeout(this.opsTimer);
    this.opsTimer = null;
    const ops = this.opsNow();
    const key = JSON.stringify(ops);
    if (key === this.lastOps) return;
    this.lastOps = key;
    this.broadcast({ type: 'ops', ops });
  }

  /** A failed session releases its issue for someone else; an issue that keeps failing waits for the manager. */
  private issueFailed(repo: PersistedRepo, n: number | null) {
    if (n == null || this.limited()) return; // the usage limit isn't the issue's fault
    const key = `${repo.id}#${n}`;
    const failures = (this.issueFailures.get(key) ?? 0) + 1;
    this.issueFailures.set(key, failures);
    if (failures === MAX_ISSUE_FAILURES) {
      this.postMessage('office', `⚠️ El issue #${n} de ${repo.fullName} ha fallado ${failures} sesiones seguidas, así que la asignación automática lo salta. Asígnaselo a alguien a mano cuando esté resuelto.`);
    }
  }

  /**
   * Hand out work for free session slots. Finishing beats starting: QA and QA fixes on every floor go before any new issue.
   * Within each phase floors take turns (one job per floor per pass), and the starting floor rotates between calls,
   * so no repo can hog the slots.
   */
  private schedule() {
    this.tickUsage();
    this.progressTick();
    if (this.officeUpdateTick()) return; // draining for the office's own update
    this.applyTeamChanges(); // before handing out work, so agents on their way out get none
    if (this.limited()) return;
    // Management first: the CEO's jobs are short and shape everyone else's work.
    this.maybeHeartbeat();
    this.startCeoWork();
    const repos = this.state.repos.filter((r) => {
      const rt = this.repoRt.get(r.id);
      return rt && rt.lastSync != null && rt.cloneStatus !== 'error';
    });
    if (repos.length === 0) return;
    this.scheduleOffset = (this.scheduleOffset + 1) % repos.length;
    const order = [...repos.slice(this.scheduleOffset), ...repos.slice(0, this.scheduleOffset)];
    for (const start of [(r: PersistedRepo) => this.startPipelineWork(r), (r: PersistedRepo) => this.startIssueWork(r)]) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const repo of order) {
          if (this.slotsFull()) return;
          if (start(repo)) progress = true;
        }
      }
    }
  }

  // ---------- the office's own update ----------

  private drainInput(): DrainInput {
    const u = this.officeUpdate;
    return {
      now: Date.now(),
      behind: this.officeHead ? u.behind : 0,
      launcher: this.backend.office.launcher,
      autoUpdate: this.state.settings.autoUpdate !== false,
      requested: u.requested,
      postponedUntil: u.postponedUntil,
      postponedBehind: u.postponedBehind,
      failed: u.failed,
      failedBehind: u.failedBehind,
      drainingSince: u.drainingSince,
      sent: u.sent,
      running: this.running() - this.inBoxes().length, // cloud agents carry on in their Boxes through the restart
    };
  }

  private officeUpdateView(): OfficeUpdateView {
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    const until = u.postponedUntil ? new Date(u.postponedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const detail = d.state === 'failed' ? u.failed : d.state === 'waiting' ? `Aplazado hasta las ${until}, o hasta que llegue un commit más nuevo.` : null;
    return { state: d.state, behind: input.behind, launcher: input.launcher, drainingSince: u.drainingSince ?? d.drainingSince, running: input.running, detail };
  }

  private emitOfficeUpdate() {
    if (!this.officeHead) return;
    const view = this.officeUpdateView();
    const key = JSON.stringify(view);
    if (key === this.lastOfficeView) return;
    this.lastOfficeView = key;
    this.broadcast({ type: 'officeUpdate', officeUpdate: view });
  }

  /** The own-folder check found the office this many commits behind GitHub. */
  private setOfficeBehind(behind: number) {
    const u = this.officeUpdate;
    if (u.failed && u.failedBehind === null) u.failedBehind = behind; // only a newer commit retries a failed update by itself
    u.behind = behind;
    if (behind === 0) Object.assign(u, { requested: false, failed: null, failedBehind: null });
    this.officeUpdateTick();
  }

  /**
   * Take the office's own update one step (see drainDecision): drain, and once nothing is running, or the drain timed
   * out, hand it to the launcher. True while nothing new may start.
   */
  private officeUpdateTick(): boolean {
    if (!this.officeHead) return false;
    const u = this.officeUpdate;
    const d = drainDecision(this.drainInput());
    if (d.state === 'draining' && u.drainingSince === null) {
      const running = this.running();
      this.postMessage(
        'office',
        `⬆️ Actualizando la oficina (${u.behind} commit${u.behind === 1 ? '' : 's'} nuevo${u.behind === 1 ? '' : 's'}). No empieza nada nuevo${running ? ` mientras termina${running === 1 ? '' : 'n'} ${running} sesi${running === 1 ? 'ón' : 'ones'} en curso` : ''}; después se instala y se reinicia.`,
      );
    }
    u.drainingSince = d.drainingSince;
    if (d.send) void this.handOver(d.timedOut);
    this.emitOfficeUpdate();
    return d.state === 'draining' || d.state === 'updating';
  }

  /** Drained: hand the update to the launcher. Sessions still running after the timeout stop the way a restart stops them. */
  private async handOver(timedOut: boolean) {
    const u = this.officeUpdate;
    const from = this.officeHead!;
    u.sent = true;
    // Cloud agents working in their Boxes carry on through the restart: the restarted office picks them up.
    const busy = this.state.agents.filter((a) => BUSY.includes(a.status) && !this.inBoxes().includes(a));
    if (timedOut) this.postMessage('office', `⏱ ${busy.length === 1 ? 'Una sesión seguía' : `${busy.length} sesiones seguían`} en curso tras 20 minutos. Detenida${busy.length === 1 ? '' : 's'}; el trabajo vuelve a la cola tras la actualización.`);
    this.emitOfficeUpdate();
    u.handedOver = true;
    await this.writeState().catch((err) => console.warn('could not save the state', err)); // still "working": the restarted office recovers them
    for (const a of busy) this.agentRt.get(a.id)?.session?.stop();
    try {
      const result = await this.backend.office.update(from);
      if (result) await this.afterUpdate(result); // the demo: nothing restarts
    } catch (err) {
      await this.afterUpdate({ from, to: from, ok: false, error: `el lanzador no ha aceptado la actualización: ${oneLine(err)}`, installed: false, built: false, at: Date.now() });
    }
  }

  /** An update that didn't restart the office (the demo, or a failed hand-over): recover like a restart would, then report it. */
  private async afterUpdate(result: LastUpdate) {
    const u = this.officeUpdate;
    Object.assign(u, { sent: false, handedOver: false, requested: false, drainingSince: null });
    const interrupted = this.state.agents.filter((a) => BUSY.includes(a.status) && !this.inBoxes().includes(a));
    const preparing = new Set(interrupted.filter((a) => a.status === 'preparing'));
    for (const a of interrupted) {
      Object.assign(a, { status: 'stopped', lastError: 'La oficina se actualizó mientras este agente trabajaba.' });
      const rt = this.agentRt.get(a.id);
      if (rt) Object.assign(rt, { session: null, currentTool: null });
    }
    this.ensureCeo(interrupted);
    this.recover(interrupted, preparing);
    interrupted.forEach((a) => this.emitAgent(a));
    await this.reportUpdate(result);
    if (!result.ok) u.failedBehind = u.behind;
    const own = this.state.repos.find((r) => this.backend.office.isOwnFolder(this.backend.mainDir(r.fullName)));
    if (own) await this.syncFolder(own);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** One phone message about the last update (the launcher's last-update.json, or the demo's fake). */
  private async reportUpdate(result: LastUpdate) {
    const commits = result.ok && result.to ? await this.backend.office.commitsBetween(result.from, result.to) : null;
    this.postMessage('office', lastUpdateMessage(result, commits));
    Object.assign(this.officeUpdate, { failed: result.ok ? null : result.error || 'unknown error', failedBehind: null });
  }

  /** The manager's Update now (drain now, even with automatic updates off) or Later (not for 2 hours, or until a newer commit). */
  updateOffice(action: unknown): OfficeUpdateView {
    if (action !== 'now' && action !== 'later') throw new HttpError(400, 'action debe ser "now" o "later"');
    const u = this.officeUpdate;
    if (!this.officeHead || !this.backend.office.launcher) throw new HttpError(409, 'La oficina solo puede actualizarse cuando la ha arrancado su lanzador (npm run dev o npm start).');
    if (u.sent) throw new HttpError(409, 'La actualización ya está en marcha.');
    if (u.behind <= 0) throw new HttpError(409, 'La oficina está al día: no hay nada que actualizar.');
    if (action === 'now') Object.assign(u, { requested: true, postponedUntil: null });
    else Object.assign(u, { requested: false, postponedUntil: Date.now() + POSTPONE_MS, postponedBehind: u.behind });
    this.officeUpdateTick();
    setTimeout(() => this.schedule(), 200);
    return this.officeUpdateView();
  }

  // ---------- the CEO ----------

  private ceo() {
    return this.state.agents.find((a) => a.id === CEO_ID)!;
  }

  /** The company always has a CEO. One cut off by a server restart picks its job back up. */
  private ensureCeo(interrupted: PersistedAgent[]) {
    let a = this.state.agents.find((x) => x.id === CEO_ID);
    if (!a) {
      a = {
        id: CEO_ID,
        name: CEO_NAME,
        repoId: '',
        role: 'ceo',
        look: lookFor(CEO_NAME),
        task: null,
        desk: 0,
        color: '#e63946',
        hair: '#2b2118',
        skin: pick(SKIN),
        style: null,
        model: '',
        effort: CEO_EFFORT,
        cli: 'codex',
        machine: null,
        status: 'idle',
        issueNumber: null,
        issueTitle: null,
        branch: null,
        prNumber: null,
        prUrl: null,
        startedAt: null,
        endedAt: null,
        costUsd: 0,
        turns: 0,
        sessionId: null,
        sessionCli: null,
        lastError: null,
        logTail: [],
      };
      this.state.agents.push(a);
      this.agentRt.set(a.id, { log: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
      this.appendLog(a, [{ kind: 'system', text: `🏛️ ${a.name} se ha instalado en el despacho de la esquina. El CEO estudia cada planta, dimensiona su equipo y planifica su trabajo.` }]);
    }
    const i = interrupted.indexOf(a);
    if (i >= 0) {
      interrupted.splice(i, 1);
      a.status = 'idle';
      a.lastError = null;
      this.appendLog(a, [{ kind: 'system', text: '↺ El servidor de la oficina se ha reiniciado. Se retoma el trabajo.' }]);
    }
    if (this.state.ceo.job) {
      this.state.ceo.queue.unshift(this.state.ceo.job);
      this.state.ceo.job = null;
    }
    this.state.ceo.lastReviewAt ??= Date.now(); // the first review comes one heartbeat after the office opens
  }

  private ceoFloor(repoId?: string) {
    const repo = repoId ? this.state.repos.find((r) => r.id === repoId) : undefined;
    if (!repo) return null;
    return { floor: repo.floor, fullName: repo.fullName, clone: this.backend.mainDir(repo.fullName), mission: repo.mission, backlog: this.repoRt.get(repo.id)?.issues.length ?? 0 };
  }

  private ceoInfo(): CeoInfo {
    const c = this.state.ceo;
    const view = (j: CeoJob) => ({ kind: j.kind, label: jobLabel(j, this.ceoFloor(j.repoId)) });
    const min = this.state.settings.ceoHeartbeatMin;
    return {
      queue: c.queue.map(view),
      job: c.job ? view(c.job) : null,
      lastReviewAt: c.lastReviewAt,
      nextReviewAt: min > 0 && c.lastReviewAt ? c.lastReviewAt + min * 60_000 : null,
    };
  }

  private emitCeo() {
    this.broadcast({ type: 'ceo', ceo: this.ceoInfo() });
  }

  /** Queue a job for the CEO: one onboarding and one plan per floor, one review, and chat messages merge into one reply. */
  private enqueueCeo(job: CeoJob) {
    const q = this.state.ceo.queue;
    const same = q.findIndex((j) => j.kind === job.kind && (job.kind === 'review' || job.kind === 'chat' || (j.repoId === job.repoId && j.prNumber === job.prNumber)));
    if (same >= 0) q[same] = job.kind === 'chat' ? { ...q[same], text: `${q[same].text}\n${job.text}` } : job;
    else q.push(job);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
  }

  /** Start the CEO's next job when they're free and a session slot is open. Replies to the manager go first. */
  private startCeoWork(): void {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    // A triage whose PR is no longer stuck (the manager stepped in, or it closed) has nothing left to do.
    const stale = c.queue.filter((j) => j.kind === 'triage' && !this.stuckRecord(j));
    if (stale.length) {
      c.queue = c.queue.filter((j) => !stale.includes(j));
      this.emitCeo();
      this.save();
    }
    if (!a || BUSY.includes(a.status) || c.job || c.queue.length === 0) return;
    if (this.slotsFull()) return;
    const rank: Record<CeoJob['kind'], number> = { chat: 0, triage: 0, onboard: 1, plan: 1, review: 2 };
    // A floor's jobs wait for its clone and first sync, so the CEO has something to read.
    const ready = (j: CeoJob) => {
      const rt = j.repoId ? this.repoRt.get(j.repoId) : undefined;
      return !rt || rt.cloneStatus === 'error' || (rt.cloneStatus === 'ready' && rt.lastSync != null);
    };
    const job = [...c.queue].sort((x, y) => rank[x.kind] - rank[y.kind]).find(ready);
    if (!job) return;
    c.queue.splice(c.queue.indexOf(job), 1);
    const rt = job.repoId ? this.repoRt.get(job.repoId) : undefined;
    if (job.repoId && (!rt || rt.cloneStatus === 'error')) {
      const repo = this.state.repos.find((r) => r.id === job.repoId);
      if (repo) this.postMessage('office', `⚠️ ${a.name} no ha podido estudiar ${projectName(repo)}: ha fallado el clon del repositorio (${rt?.cloneError ?? 'error desconocido'}).`);
      this.emitCeo();
      this.save();
      return this.startCeoWork();
    }
    void this.runCeoJob(a, job);
  }

  private ceoPromptInput(a: PersistedAgent): Parameters<typeof ceoSystemPrompt>[0] {
    const s = this.state.settings;
    return { name: a.name, company: s.companyName, manager: s.managerName, notesFile: path.join(CEO_DIR, 'NOTES.md'), sessionLimit: s.sessionLimit, maxAgents: s.maxAgents, scaling: s.scaling };
  }

  private async runCeoJob(a: PersistedAgent, job: CeoJob) {
    const rt = this.agentRt.get(a.id)!;
    const floor = this.ceoFloor(job.repoId);
    const label = jobLabel(job, floor);
    this.state.ceo.job = job;
    Object.assign(a, { status: 'working' as AgentStatus, task: null, issueNumber: null, issueTitle: label, startedAt: Date.now(), endedAt: null, costUsd: 0, turns: 0, lastError: null });
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${label} ━━━` },
    ]);
    if (job.kind === 'chat') this.appendLog(a, [{ kind: 'manager', text: `▶ Responsable: ${job.text}` }]);
    if (job.kind === 'review') {
      this.state.ceo.lastReviewAt = Date.now();
      this.state.ceo.lastFingerprint = this.fingerprint();
    }
    this.ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB);
    this.ceoAsked = askedFor(job);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    await fs.mkdir(CEO_DIR, { recursive: true }).catch(() => undefined);
    const triage = job.kind === 'triage' ? await this.triagePr(job) : null;
    if (a.status !== 'working') {
      // stopped before the session started
      this.state.ceo.job = null;
      if (job.kind === 'triage') this.endTriage(job);
      this.emitCeo();
      return;
    }
    // A chat carries on from the CEO's last session, so "why did you propose that?" has an answer.
    const how = this.sessionRuntime(a, job.kind === 'chat' ? (a.sessionId ?? undefined) : undefined);
    const cli = this.ceoCliNow(a);
    if (cli !== ceoCli(a.cli)) this.appendLog(a, [{ kind: 'system', text: '⚠ Codex necesita los terminales reales (node-pty), que no están disponibles: el CEO trabaja esta vez con Claude Code.' }]);
    rt.session = this.backend.startSession(
      {
        cwd: CEO_DIR,
        prompt: ceoJobPrompt(job, floor, triage),
        systemAppend: ceoSystemPrompt(this.ceoPromptInput(a)),
        model: ceoModel(a.model, cli),
        effort: a.effort || CEO_EFFORT,
        browserTesting: false,
        additionalDirectories: this.state.repos.filter((r) => this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)),
        role: 'ceo',
        office: this.officeTools(),
        ...how,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => {
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? (how.cli ?? 'claude') : null;
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        turn: (text) => this.postMessage('ceo', text),
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        finished: (result) => this.onCeoFinished(a, result),
      },
    );
  }

  private onCeoFinished(a: PersistedAgent, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || this.officeUpdate.handedOver) return;
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    recordCost(this.state.ops, '', result.costUsd, a.endedAt);
    const job = this.state.ceo.job;
    this.state.ceo.job = null;
    if (job?.kind === 'triage') this.endTriage(job);
    if (result.interrupted) this.interrupted(a);
    if (a.status === 'stopped') {
      // the manager already logged the stop
    } else if (!result.ok) {
      a.status = 'error';
      a.lastError = result.errors.join('; ') || 'Session failed';
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      const what = job ? jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase() : 'trabajando';
      this.postMessage('office', `⚠️ ${a.name} ha tenido un problema (${what}): ${a.lastError.slice(0, 240)}`);
    } else {
      a.status = 'done';
      const filed = this.ceoIssues.total ? ` · ${this.ceoIssues.total} issue${this.ceoIssues.total === 1 ? '' : 's'} abierto${this.ceoIssues.total === 1 ? '' : 's'}` : '';
      this.appendLog(a, [{ kind: 'done', text: `✔ Hecho en ${this.minutes(a)} min · ${a.turns} turnos${filed}` }]);
    }
    for (const id of this.ceoIssues.repos) void this.syncRepo(id);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** The manager's phone → the CEO. Injected into a running session, otherwise the CEO picks it up next. */
  async messageCeo(text: string) {
    const t = text.trim().slice(0, 4000);
    if (!t) throw new HttpError(400, 'Mensaje vacío');
    const a = this.ceo();
    this.postMessage('manager', t);
    const rt = this.agentRt.get(a.id)!;
    if (rt.session) {
      try {
        rt.session.send(`Mensaje del responsable (lee tu respuesta en el móvil, así que sé breve):\n${t}`);
      } catch {
        // Its CLI is still starting (or just ended): the message waits for the CEO's next chat.
        this.enqueueCeo({ kind: 'chat', text: t, at: Date.now() });
        return;
      }
      this.appendLog(a, [{ kind: 'manager', text: `▶ Responsable: ${t}` }]);
      this.ceoIssues.managerMessage(); // a new request: the issue cap counts from here
      this.ceoAsked = true;
      return;
    }
    this.enqueueCeo({ kind: 'chat', text: t, at: Date.now() });
  }

  requestReview() {
    if (this.state.repos.length === 0) throw new HttpError(400, 'Conecta antes un repo: el CEO necesita una planta que revisar.');
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  onboardFloor(repoId: string) {
    const repo = this.repo(repoId);
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
  }

  /** The manager hands the CEO a brief for a floor; the CEO turns it into issues and a team. */
  planFloor(repoId: string, mission?: string) {
    const repo = this.repo(repoId);
    if (typeof mission === 'string') {
      repo.mission = mission.trim().slice(0, 4000);
      this.emitRepo(repo);
    }
    if (!repo.mission) throw new HttpError(400, 'Escribe antes un encargo: ¿qué debe construir esta planta?');
    this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
  }

  /** Everything the heartbeat cares about. When it hasn't changed since the last review, the review is skipped. */
  private fingerprint() {
    const data = {
      repos: this.state.repos.map((r) => {
        const rt = this.repoRt.get(r.id);
        return [r.id, r.mission, r.summary, rt?.issues.map((i) => i.number), rt?.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number)];
      }),
      agents: this.state.agents.filter((a) => a.role !== 'ceo').map((a) => [a.id, FREE.includes(a.status) ? 'free' : a.status]),
      qa: this.state.qa.map((q) => [q.repoId, q.prNumber, q.status]),
      requests: this.state.requests.filter((r) => r.status === 'pending').map((r) => r.id),
    };
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  }

  private maybeHeartbeat() {
    const min = this.state.settings.ceoHeartbeatMin;
    const c = this.state.ceo;
    if (!min || this.state.repos.length === 0 || c.job?.kind === 'review' || c.queue.some((j) => j.kind === 'review')) return;
    if (Date.now() < (c.lastReviewAt ?? 0) + min * 60_000) return;
    if (this.fingerprint() === c.lastFingerprint) {
      c.lastReviewAt = Date.now(); // nothing changed since the last review
      this.emitCeo();
      this.save();
      return;
    }
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  // ---------- triage ----------

  /**
   * A PR the office can't move on its own (needs-human): the CEO triages it first, at most MAX_TRIAGES times, and the
   * manager hears when the CEO escalates or takes no action, or when it keeps getting stuck. True: it went to the CEO.
   */
  private stuck(rec: QaRecord, patch: Partial<QaRecord>, why: string): boolean {
    if (!this.state.qa.includes(rec)) return false; // its PR closed: nothing is stuck
    this.setQa(rec, { ...patch, status: 'needs-human', stuckWhy: why });
    const step = triageStep({ kind: 'stuck', triages: rec.triages });
    if (step.do !== 'triage') {
      this.escalate(rec, step.do === 'escalate' ? step.note : null);
      return false;
    }
    rec.triages += 1;
    this.enqueueCeo({ kind: 'triage', repoId: rec.repoId, prNumber: rec.prNumber, at: Date.now() });
    this.setQa(rec, {}); // the card shows the CEO looking
    return true;
  }

  /** Tell the manager a stuck PR needs them, once each time it gets stuck. note: what the CEO adds. */
  private escalate(rec: QaRecord, note: string | null) {
    if (rec.status !== 'needs-human' || rec.escalated) return;
    this.setQa(rec, { escalated: true });
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    if (repo) this.postMessage('office', `⚠️ La PR #${rec.prNumber} de ${repo.fullName} te necesita: ${rec.stuckWhy ?? 'está atascada'}.${note ? ` ${note}` : ''}`);
  }

  /** The CEO's triage job for this PR, queued or running. */
  private triageJob(q: Pick<QaRecord, 'repoId' | 'prNumber'>) {
    const c = this.state.ceo;
    return [c.job, ...c.queue].find((j) => j?.kind === 'triage' && j.repoId === q.repoId && j.prNumber === q.prNumber) ?? null;
  }

  /** The record a triage job is for, while it is still waiting on a decision. */
  private stuckRecord(job: CeoJob) {
    return this.state.qa.find((q) => q.repoId === job.repoId && q.prNumber === job.prNumber && q.status === 'needs-human' && !q.escalated);
  }

  /** What a triage job's prompt says about its PR: the QA record and GitHub's view of it now. null: no longer stuck. */
  private async triagePr(job: CeoJob): Promise<TriagePr | null> {
    const rec = this.stuckRecord(job);
    const repo = this.state.repos.find((r) => r.id === job.repoId);
    if (!rec || !repo) return null;
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const pr = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if ((pr ?? listed)?.state !== 'OPEN') return null;
    return {
      number: rec.prNumber,
      title: pr?.title ?? listed?.title ?? '',
      url: pr?.url ?? listed?.url ?? '',
      round: rec.round,
      why: rec.stuckWhy,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      mergeNote: rec.mergeNote,
      checks: pr?.checks ?? listed?.checks ?? 'none',
      failedChecks: pr?.failedChecks ?? listed?.failedChecks.map((c) => c.name) ?? [],
      pendingChecks: pr?.pendingChecks ?? listed?.pendingChecks ?? [],
      mergeable: pr?.mergeable ?? listed?.mergeable ?? 'UNKNOWN',
      mergeState: pr?.mergeState ?? listed?.mergeState ?? 'UNKNOWN',
      triage: rec.triages,
    };
  }

  /** A triage job ended (done, failed or stopped): a PR still waiting on a decision goes to the manager. */
  private endTriage(job: CeoJob) {
    const rec = this.stuckRecord(job);
    const pull = rec && this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber);
    const step = triageStep({ kind: 'ended', acted: !rec || (pull != null && pull.state !== 'OPEN') }); // a closed PR leaves QA on the next sync
    if (rec && step.do === 'escalate') this.escalate(rec, step.note);
  }

  /** The stuck PR a triage tool names; refused unless it is on the current triage job's floor (see checkTriageTarget). */
  private async triageTarget(x: { floor: number; pr: number }) {
    const job = this.state.ceo.job;
    const jobFloor = job?.kind === 'triage' ? (this.state.repos.find((r) => r.id === job.repoId)?.floor ?? null) : null;
    const repo = this.state.repos.find((r) => r.floor === x.floor);
    const pr = Number(x.pr);
    const listed = repo ? this.repoRt.get(repo.id)?.pulls.find((p) => p.number === pr) : undefined;
    // The last sync may be a minute old and doesn't list closed PRs: ask GitHub about this one.
    const pull = repo && x.floor === jobFloor ? await this.backend.prDetails(repo.fullName, pr).catch(() => listed) : listed;
    const rec = repo ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr) : undefined;
    checkTriageTarget({ jobFloor, floor: x.floor, pr, pull, status: rec?.status });
    return { repo: repo!, rec: rec!, listed };
  }

  private async triageRetryQa(x: { floor: number; pr: number }) {
    const { repo, rec } = await this.triageTarget(x);
    await this.sendToQa(repo.id, rec.prNumber);
    return `La PR #${rec.prNumber} está en cola para la ronda de QA ${rec.round}.`;
  }

  private async triageSendBack(x: { floor: number; pr: number; note: string }) {
    const { repo, rec } = await this.triageTarget(x);
    const note = String(x.note ?? '').trim();
    if (!note) throw new HttpError(400, 'Di qué debe hacer el desarrollador: la nota acompaña a la corrección.');
    await this.sendBackToDev(repo.id, rec.prNumber, note, `${this.ceo().name}, el CEO`);
    return `La PR #${rec.prNumber} vuelve a un desarrollador con los hallazgos de QA y tu nota.`;
  }

  private async triageRerunChecks(x: { floor: number; pr: number }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const runIds = failedRunIds(listed?.failedChecks ?? []);
    if (!listed || !runIds.length) {
      const failed = listed?.failedChecks.map((c) => c.name) ?? [];
      throw new HttpError(409, `La PR #${rec.prNumber} no tiene ejecuciones fallidas de GitHub Actions que relanzar${failed.length ? ` (${failed.join(', ')} no se pueden relanzar desde aquí)` : ''}.`);
    }
    await this.backend.rerunFailedJobs(repo.fullName, runIds);
    const runs = `${runIds.length} failed run${runIds.length === 1 ? '' : 's'}`;
    if (rec.passedSha && rec.passedSha === listed.headSha) {
      // QA signed off on this commit: the merge gate waits for the re-run and merges if it goes green.
      this.setQa(rec, { status: 'passed', rerunSha: listed.headSha, rerunAt: Date.now(), pendingSince: null, mergeNote: 'relanzando un check fallido' });
      return `Relanzando ${runs} en la PR #${rec.prNumber}. QA aprobó este commit, así que se fusiona si se ponen en verde.`;
    }
    await this.sendToQa(repo.id, rec.prNumber);
    return `Relanzando ${runs} en la PR #${rec.prNumber}, y está en cola para la ronda de QA ${rec.round}.`;
  }

  private async triageClosePull(x: { floor: number; pr: number; comment: string }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const comment = String(x.comment ?? '').trim();
    if (!comment) throw new HttpError(400, 'Di por qué se cierra la pull request: el comentario se publica en ella.');
    const issues = listed ? issuesResolvedBy(listed) : [];
    const ceo = this.ceo().name;
    await this.backend.commentPull(repo.fullName, rec.prNumber, `${comment}\n\n<sub>Cerrada por ${ceo}, CEO de sareoffice, tras el triaje.${issues.length ? ' Su issue sigue abierto, así que se construirá de nuevo.' : ''}</sub>`);
    // Closing deletes no branch and leaves the issue open, so the scheduler hands it out again.
    await this.backend.closePull(repo.fullName, rec.prNumber);
    this.postMessage('office', `🗂️ ${ceo} ha cerrado la PR #${rec.prNumber} de ${projectName(repo)}: ${comment.split('\n')[0].slice(0, 200)}`);
    this.dropRecord(repo, rec.prNumber);
    this.learnPull(repo, { number: rec.prNumber, headRefName: listed?.headRefName ?? '', closesIssues: listed?.closesIssues ?? [] }, 'CLOSED', true); // built again
    void this.syncRepo(repo.id);
    return `PR #${rec.prNumber} cerrada.${issues.length ? ` ${issues.map((n) => `#${n}`).join(', ')} sigue${issues.length === 1 ? '' : 'n'} abierto${issues.length === 1 ? '' : 's'}, así que un desarrollador lo construirá de nuevo.` : ''}`;
  }

  private async triageEscalate(x: { floor: number; pr: number; reason: string }) {
    const { rec } = await this.triageTarget(x);
    const step = triageStep({ kind: 'escalate', reason: String(x.reason ?? '').split('\n')[0].slice(0, 300) });
    if (step.do === 'escalate') this.escalate(rec, step.note && `${this.ceo().name}: ${step.note}`);
    return `El responsable tiene ahora la PR #${rec.prNumber}, con tu diagnóstico.`;
  }

  // ---------- idle desks ----------

  private bootAt = Date.now();
  private deskWatch = new Map<string, { busyAt: number | null; trimmedAt: number | null }>(); // desk → what the sweeps saw
  private trimming = false;

  /** An agent's desk is in use: a task (preparing, working, testing or fixing) or a live CLI in their terminal. Hands off a fired agent's. */
  private deskBusy(a: PersistedAgent) {
    const rt = this.agentRt.get(a.id);
    return !rt || !this.state.agents.includes(a) || BUSY.includes(a.status) || !!rt.session || !!rt.terminal?.live;
  }

  /**
   * Free disk space on desks idle longer than settings.trimIdleDesksMin: every agent's desk, and each floor's preview
   * worktree while no preview runs. One desk at a time, once per idle stretch; one phone message per sweep that freed anything.
   */
  private async trimIdleDesks() {
    const min = this.state.settings.trimIdleDesksMin;
    if (!min || this.trimming) return;
    this.trimming = true;
    try {
      const now = Date.now();
      type Desk = { key: string; name: string; endedAt: number | null; busy: () => boolean; trim: (stillIdle: () => boolean) => Promise<DeskTrim | null> };
      const desks: Desk[] = [];
      for (const a of this.state.agents) {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo) continue;
        const name = `el puesto de ${a.name} en ${repo.fullName}`;
        const trim = a.machine ? (idle: () => boolean) => this.machinesFor(a).trimDesk(a.machine!, repo.fullName, idle) : (idle: () => boolean) => this.backend.trimDesk(repo.fullName, this.agentSlug(a), idle);
        desks.push({ key: a.id, name, endedAt: a.endedAt, busy: () => this.deskBusy(a), trim });
      }
      for (const repo of this.state.repos) {
        const busy = () => !this.state.repos.includes(repo) || this.previews.active(repo);
        desks.push({ key: `preview:${repo.id}`, name: `el puesto de vista previa de ${repo.fullName}`, endedAt: null, busy, trim: (idle) => this.backend.trimDesk(repo.fullName, PREVIEW_SLUG, idle) });
      }
      for (const key of this.deskWatch.keys()) if (!desks.some((d) => d.key === key)) this.deskWatch.delete(key);
      const seen = desks.map((d) => {
        const w = this.deskWatch.get(d.key) ?? { busyAt: null, trimmedAt: null };
        this.deskWatch.set(d.key, w);
        const busy = d.busy();
        if (busy) w.busyAt = now;
        return { key: d.key, busy, idleSince: idleSince(d.endedAt, w.busyAt, this.bootAt), trimmedAt: w.trimmedAt };
      });
      const due = new Set(desksToTrim(seen, min, now));
      let freed = 0;
      let count = 0;
      for (const d of desks.filter((x) => due.has(x.key))) {
        // Asked again inside the repo lock: a task that started since is never pulled out from under its agent.
        const result = await d.trim(() => !d.busy()).catch((err) => {
          console.warn(`could not trim ${d.name}:`, oneLine(err));
          return undefined;
        });
        if (result === undefined) continue;
        // Folders Windows still had locked are tried again at the next sweep.
        if (!result?.skipped.length) this.deskWatch.get(d.key)!.trimmedAt = Date.now();
        if (!result?.freed) continue;
        freed += result.freed;
        count++;
        const locked = result.skipped.length ? `; still locked: ${result.skipped.join(', ')}` : '';
        console.log(`trimmed ${d.name}: freed ${formatBytes(result.freed)} (${result.removed.join(', ')})${locked}`);
      }
      if (count) this.postMessage('office', freedMessage(freed, count));
    } finally {
      this.trimming = false;
    }
  }

  // ---------- the watchdog and the office doctor (#262) ----------

  private activity = new Map<string, number>(); // agent id -> their session's latest output or tool activity
  private watch: WatchMemory = { remedied: new Map(), nudged: new Map() };
  private doctor: DoctorFinding[] = [];
  private ignored = new Set<string>(); // findings the manager ignored, until they go away
  private lastDoctor = '';
  private silenced = new Set<string>(); // sessions the demo's pretend restart cut off: their end is ignored
  private stalled = new Set<string>(); // the demo's stuck sessions

  /**
   * A session about to start in a desk folder that's gone: the desk is set up again first, on the same branch (at the
   * PR's head when there is one). Null when it couldn't be (prepare() said why) or the agent was stopped meanwhile.
   */
  private async restoreDesk(a: PersistedAgent, repo: PersistedRepo): Promise<string | null> {
    a.status = 'preparing';
    this.appendLog(a, [{ kind: 'system', text: 'La carpeta de su puesto ha desaparecido, así que primero se vuelve a preparar.' }]);
    this.emitAgent(a);
    const desk = await this.prepare(a, repo, { pr: a.prNumber ?? undefined }, a.branch ?? `swarm/desk-${this.agentSlug(a)}`);
    return desk?.cwd ?? null;
  }

  /** When an agent's session last showed signs of life. Claude Code reports every step; other CLIs may only report a turn's end, so their terminal output counts too. */
  private activeAt(a: PersistedAgent) {
    const term = this.agentRt.get(a.id)?.terminal;
    const cli = a.sessionCli ?? (a.cli || this.state.settings.defaultCli);
    return Math.max(this.activity.get(a.id) ?? a.startedAt ?? Date.now(), cli !== 'claude' && term ? term.outputAt : 0);
  }

  /** The agent's task as the office knows it now (closeCleanup.ts). */
  private workOf(a: PersistedAgent): WorkState {
    const rt = this.repoRt.get(a.repoId);
    if (!rt || !a.task) return 'unknown';
    const f = this.floorState(rt);
    const issue = a.task === 'issue' && a.issueNumber != null ? issueOpen(a.issueNumber, f) : null;
    return workState(issue === null ? null : issue ? 'OPEN' : 'CLOSED', a.prNumber != null ? (pullNow(a.prNumber, f)?.state ?? null) : null);
  }

  /** Every minute: find what's stuck (watchdog.ts), heal what can safely be healed, and list the rest for the doctor. heal false: only list. */
  private watchdogTick(heal = true) {
    const now = Date.now();
    forget(this.watch, now);
    // A cloud agent whose Box is being set up, that the office can't reach right now or that waits to be signed in isn't stuck: left be.
    const away = (a: PersistedAgent) => a.host === 'box' && (!!a.needsSignIn || ['creating', 'setting-up', 'disconnected'].includes(this.boxMachines.stateOf(a.machine ?? machineName(a.id))));
    const agents: WatchAgent[] = this.state.agents.filter((a) => !away(a)).map((a) => ({
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      status: a.status,
      task: a.task,
      issueNumber: a.issueNumber,
      prNumber: a.prNumber,
      startedAt: a.startedAt,
      activeAt: this.activeAt(a),
      work: this.workOf(a),
    }));
    const unclosed = this.state.repos.flatMap((r) => {
      const rt = this.repoRt.get(r.id);
      return rt?.lastSync ? unclosedIssues(r.id, rt.issues.map((i) => i.number), rt.pulls) : [];
    });
    const { auto, doctor } = triage(diagnose(agents, this.state.qa, unclosed, now), this.watch, now);
    if (heal) {
      const done = auto.map(({ problem, remedy }) => this.remedy(problem, remedy, now)).filter((t): t is string => !!t);
      if (done.length) {
        this.postMessage('office', `🩺 El vigilante ${nameList(done)}.`);
        setTimeout(() => this.schedule(), 200);
      }
    }
    const agent = (id: string | null) => this.state.agents.find((x) => x.id === id);
    this.doctor = doctor.map((p) => finding(p, (id) => agent(id)?.name ?? null, agent(p.agentId) ? this.workOf(agent(p.agentId)!) : null, now));
    for (const id of this.ignored) if (!this.doctor.some((f) => f.id === id)) this.ignored.delete(id);
    this.emitDoctor();
  }

  /** Apply an automatic remedy. Returns what to tell the manager, or null. */
  private remedy(p: Problem, remedy: Remedy, now: number): string | null {
    const a = p.agentId ? this.state.agents.find((x) => x.id === p.agentId) : undefined;
    const rec = p.prNumber != null ? this.state.qa.find((q) => q.repoId === p.repoId && q.prNumber === p.prNumber) : undefined;
    const what = p.prNumber != null ? `PR #${p.prNumber}` : `#${p.issueNumber}`;
    const mins = Math.round((now - p.since) / 60_000);
    if (remedy === 'nudge') {
      const session = a && this.agentRt.get(a.id)?.session;
      if (!a || !session) return null;
      this.watch.nudged.set(p.key, now);
      this.appendLog(a, [{ kind: 'system', text: `🩺 Sin señales de vida durante ${mins} minutos: la oficina le ha dado un toque.` }]);
      session.send(nudgeText(now - p.since));
      return null;
    }
    this.watch.remedied.set(p.key, now);
    if (remedy === 'requeue' && a) {
      this.requeue(a, `el vigilante ha devuelto ${what} a la cola tras ${mins} ${p.kind === 'quiet' ? 'minutos en silencio y un toque' : 'minutos preparando un puesto'}`);
      return `ha devuelto ${what} de ${a.name} a la cola (${p.kind === 'quiet' ? `en silencio durante ${mins} minutos, incluso tras un toque` : `atascado preparando un puesto durante ${mins} minutos`})`;
    }
    if (remedy === 'clear' && a) {
      this.requeue(a, `${what} ya está ${this.workOf(a) === 'merged' ? 'fusionado' : 'cerrado'}`);
      return `ha despejado el puesto de ${a.name} (${what} estaba terminado)`;
    }
    if (remedy === 'retry-qa' && rec) {
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      return `ha devuelto la PR #${rec.prNumber} a QA (nadie la estaba probando)`;
    }
    if (remedy === 'refix' && rec) {
      this.setQa(rec, { status: 'failed' });
      return `ha devuelto la corrección de la PR #${rec.prNumber} a la cola (nadie estaba con ella)`;
    }
    return null;
  }

  /** Stop the agent if they're busy and put their work back in line, without a strike: an issue back on the board, a QA run or fix back in its PR's queue. */
  private requeue(a: PersistedAgent, why: string) {
    for (const q of this.state.qa) {
      if (q.qaAgentId === a.id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === a.id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    if (BUSY.includes(a.status)) {
      // A desk stuck setting up: whatever hangs in it (an install, a checkout) is stopped, so prepare() gives up.
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      if (repo && a.status === 'preparing') void this.releaseDesk(a, repo).catch(() => undefined);
      this.stopForClosure(a, why);
    } else this.dropTask(a, `↺ ${why[0].toUpperCase()}${why.slice(1)}. Puesto despejado.`);
    this.save();
  }

  private doctorView(): DoctorFinding[] {
    return this.doctor.filter((f) => !this.ignored.has(f.id));
  }

  private emitDoctor() {
    const doctor = this.doctorView();
    const key = JSON.stringify(doctor);
    if (key === this.lastDoctor) return;
    this.lastDoctor = key;
    this.broadcast({ type: 'doctor', doctor });
  }

  /** The doctor's one-click fix (POST /api/doctor/fix): the console's own actions, for the finding they were offered on. */
  async doctorFix(id: unknown, fix: unknown) {
    const f = this.doctor.find((x) => x.id === id);
    if (!f) throw new HttpError(404, 'Ese hallazgo ya no está: puede que la oficina ya lo haya resuelto.');
    if (!f.fixes.includes(fix as DoctorFix)) throw new HttpError(400, `"${String(fix)}" no arregla este. Prueba ${f.fixes.join(' o ')}.`);
    const a = f.agentId ? this.state.agents.find((x) => x.id === f.agentId) : undefined;
    const rec = f.prNumber != null ? this.state.qa.find((q) => q.repoId === f.repoId && q.prNumber === f.prNumber) : undefined;
    const need = <T>(x: T | undefined, what: string): T => {
      if (!x) throw new HttpError(404, `${what} ya no está: puede que la oficina ya lo haya resuelto.`);
      return x;
    };
    if (fix === 'stop') this.stopAgent(need(a, 'That agent').id);
    else if (fix === 'clear') this.resetAgent(need(a, 'That agent').id);
    else if (fix === 'requeue') this.requeue(need(a, 'Ese agente'), 'el responsable ha devuelto el trabajo a la cola desde el médico de la oficina');
    else if (fix === 'retry-qa') {
      this.clearPrepStrikes(f.repoId, f.prNumber!);
      this.setQa(need(rec, `PR #${f.prNumber}'s QA record`), { status: 'queued', qaAgentId: null });
    } else if (fix === 'send-back') {
      const r = need(rec, `PR #${f.prNumber}'s QA record`);
      // A PR left "testing" or "fixing" with nobody on it goes back to a developer as it is; otherwise it's the console's Send back.
      if (r.status === 'testing' || r.status === 'fixing') this.setQa(r, { status: 'failed', qaAgentId: null });
      else await this.sendBackToDev(f.repoId, f.prNumber!);
    } else if (fix === 'close-issue') await this.closeIssueByManager(f.repoId, f.issueNumber!, f.prNumber ?? undefined);
    this.watchdogTick(false);
    setTimeout(() => this.schedule(), 200);
    return this.doctorView();
  }

  /** "Ignore" on a finding: hidden until it goes away (and shows again if it comes back). */
  doctorIgnore(id: unknown) {
    if (!this.doctor.some((f) => f.id === id)) throw new HttpError(404, 'Ese hallazgo ya no está.');
    this.ignored.add(String(id));
    this.emitDoctor();
    return this.doctorView();
  }

  /**
   * The demo's scenarios (POST /api/doctor/demo). restart: an office restart that finds finished work and desks gone ·
   * stuck: a session goes quiet for 20 minutes · later: 10 more minutes pass for the stuck ones · unclosed: an issue
   * a merged PR resolved stays open · check: the watchdog looks now.
   */
  async demoDoctor(action: unknown): Promise<{ text: string; doctor: DoctorFinding[] }> {
    const dd = this.backend.demoDoctor;
    if (!dd) throw new HttpError(404, 'El médico de la oficina solo se puede probar en la oficina demo.');
    let text = 'El vigilante ha echado un vistazo.';
    if (action === 'restart') text = await this.demoRestart(dd);
    else if (action === 'stuck') {
      const a = this.state.agents.find((x) => x.role !== 'ceo' && x.status === 'working' && !this.stalled.has(x.id) && this.agentRt.get(x.id)?.session && dd.stall(x.id));
      if (!a) throw new HttpError(409, 'Ahora mismo no trabaja nadie. Espera a que alguien empiece un issue y vuelve a intentarlo.');
      this.stalled.add(a.id);
      this.activity.set(a.id, Date.now() - QUIET_MS - 60_000);
      this.watchdogTick();
      text = `${a.name} se quedó en silencio hace 21 minutos (simulado), y el vigilante le ha dado un toque.`;
    } else if (action === 'later') {
      const skip = NUDGE_WAIT_MS + 60_000;
      for (const id of this.stalled) {
        if (!this.state.agents.some((a) => a.id === id && a.status === 'working')) this.stalled.delete(id);
        else this.activity.set(id, (this.activity.get(id) ?? Date.now()) - skip);
      }
      for (const [key, at] of this.watch.nudged) if ([...this.stalled].some((id) => key.includes(`:${id}:`))) this.watch.nudged.set(key, at - skip);
      this.watchdogTick();
      text = 'Han pasado once minutos más para las sesiones atascadas.';
    } else if (action === 'unclosed') {
      const repo = this.state.repos[0];
      const made = repo && dd.unclosedMerge(repo.fullName, 15 * 60_000);
      if (!made) throw new HttpError(409, 'La primera planta no tiene ningún issue abierto que dejar abierto.');
      await this.syncRepo(repo.id);
      this.watchdogTick();
      text = `La PR #${made.pr} se fusionó hace 15 minutos (simulado), pero el issue #${made.issue} sigue abierto.`;
    } else if (action === 'check') this.watchdogTick();
    else throw new HttpError(400, 'action debe ser "restart", "stuck", "later", "unclosed" o "check"');
    return { text, doctor: this.doctorView() };
  }

  /**
   * The demo's restart, in place: of the people working, one's CLI keeps going (followed again), the others' sessions
   * end as if the office stopped and their desks are gone, and half of those finished their work on GitHub meanwhile.
   * Then the office reconciles as it does after a real restart.
   */
  private async demoRestart(dd: NonNullable<Backend['demoDoctor']>): Promise<string> {
    if (this.state.agents.some((a) => a.status === 'preparing')) throw new HttpError(409, 'Alguien todavía está preparando un puesto. Vuelve a intentarlo en un momento.');
    const busy = this.state.agents.filter((a) => a.role !== 'ceo' && a.status === 'working' && a.task && this.agentRt.get(a.id)?.session);
    if (busy.length < 2) throw new HttpError(409, 'Espera a que al menos dos personas estén trabajando y vuelve a intentarlo.');
    const [keep, ...rest] = busy;
    rest.forEach((a, i) => {
      const repo = this.repo(a.repoId);
      dd.dropDesk(this.deskOf(a, repo));
      if (i % 2 === 0) {
        if (a.task === 'issue' && !a.prNumber && a.issueNumber) dd.finishQuietly(repo.fullName, 'issue', a.issueNumber);
        else if (a.prNumber) dd.finishQuietly(repo.fullName, 'pr', a.prNumber);
      }
      const rt = this.agentRt.get(a.id)!;
      const session = rt.session;
      rt.session = null;
      rt.currentTool = null;
      this.silenced.add(a.id);
      session?.stop();
      this.silenced.delete(a.id);
    });
    const restart = await this.reconcileRestart((a) => a === keep); // keep's session never stopped: nothing to reattach
    this.finishRestart(restart);
    setTimeout(() => this.schedule(), 500);
    return restartMessage(restart.counts) ?? 'Reiniciado: no hay nada que hacer.';
  }

  // ---------- progress: coins, decorations, achievements and careers (#210, #226) ----------

  /** Tell the ledger something happened; send on whatever it changed. emitAgents false: the caller emits them. */
  private ledger(ev: LedgerEvent, emitAgents = true) {
    this.fanout(applyLedger(this.state.progress, ev), emitAgents);
  }

  private fanout(fx: Effects, emitAgents = true) {
    if (!fx.changed) return;
    if (emitAgents) {
      for (const id of fx.careers) {
        const a = this.state.agents.find((x) => x.id === id);
        if (a) this.emitAgent(a);
      }
    }
    for (const u of fx.unlocked) {
      const def = achievementDef(u.id);
      if (!def) continue;
      this.postMessage('office', `🏆 Logro desbloqueado: ${def.icon} ${def.name}. ${def.blurb} (${u.detail}).`);
      this.toast('success', `🏆 Logro desbloqueado: ${def.icon} ${def.name}`);
    }
    if (fx.progress) this.broadcast({ type: 'progress', progress: this.progressView() });
    this.save();
  }

  private progressView(): ProgressView {
    return progressView(this.state.progress, this.state.repos.map((r) => r.id));
  }

  /** Who wrote a PR, as far as the office knows: its QA record's author, the one holding it, or the one its branch is named after. */
  private prAuthor(repo: PersistedRepo, pr: PullInfo): string | null {
    const devs = this.state.agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo');
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr.number);
    if (rec?.devAgentId && devs.some((a) => a.id === rec.devAgentId)) return rec.devAgentId;
    const holder = devs.find((a) => a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
    if (holder) return holder.id;
    const m = /^swarm\/issue-\d+-(.+)$/i.exec(pr.headRefName);
    return m ? (devs.find((a) => slugify(a.name) === m[1].toLowerCase())?.id ?? null) : null;
  }

  /** The scheduler's beat: a new day for the ledger, and a full house when everyone on a floor is busy at once. */
  private progressTick() {
    const now = Date.now();
    this.ledger({ kind: 'tick', at: now });
    for (const r of this.state.repos) {
      const team = this.state.agents.filter((a) => a.repoId === r.id);
      if (team.length >= FULL_HOUSE && team.every((a) => BUSY.includes(a.status))) this.ledger({ kind: 'full-house', repoName: r.fullName, people: team.length, at: now });
    }
  }

  // ---------- the phone ----------

  private postMessage(from: PhoneMessage['from'], text: string, requestId?: string) {
    const m: PhoneMessage = { id: this.messageSeq++, from, text: text.trim().slice(0, 6000), at: Date.now(), ...(requestId ? { requestId } : {}) };
    const v = this.state.settings.voice;
    if (v.provider !== 'off' && speaks(m, v)) m.voice = v.provider; // what the phone's ▶ replays it with
    this.state.messages.push(m);
    if (this.state.messages.length > KEEP_MESSAGES) this.state.messages.splice(0, this.state.messages.length - KEEP_MESSAGES);
    this.broadcast({ type: 'message', message: m });
    this.save();
    // Proposals are notified as such (proposeHire, proposeLetGo).
    if (from === 'ceo' && !requestId) this.notifier.notify('ceoMessage', this.ceo().name, plainText(m.text), `${this.ceo().name}: ${plainText(m.text, 100)}`);
    return m;
  }

  // ---------- notifications ----------

  private notifyNeedsHuman(rec: QaRecord) {
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    const title = this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber)?.title;
    const name = repo?.fullName.split('/')[1] ?? rec.repoId;
    this.notifier.notify('needsHuman', `La PR #${rec.prNumber} te necesita`, `${name}${title ? `: ${title}` : ''}. ${rec.stuckWhy ? `Atascada porque ${rec.stuckWhy}.` : rec.summary ?? ''}`, `${name} #${rec.prNumber}${title ? ` ${title}` : ''}`);
  }

  private notifyMerge(repo: PersistedRepo, n: number, title: string) {
    const name = repo.fullName.split('/')[1];
    this.notifier.notify('merge', `PR #${n} fusionada`, `${name}${title ? `: ${title}` : ''}`, `${name} #${n}${title ? ` ${title}` : ''}`);
  }

  /** Agents stuck in an error for STUCK_ERROR_MS: the manager hears once per error (checked every minute). */
  private notifyStuck() {
    const now = Date.now();
    for (const { agent: a, key } of stuckAgents(this.state.agents, now, this.toldStuck)) {
      this.toldStuck.add(key);
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      const mins = Math.round((now - (a.endedAt ?? now)) / 60_000);
      this.notifier.notify('agentError', `${a.name} necesita ayuda`, `Con un error desde hace ${mins} minutos${repo ? ` en ${projectName(repo)}` : ''}: ${clip(a.lastError ?? 'su sesión ha fallado', 200)}`, `${a.name}${repo ? ` (${projectName(repo)})` : ''}`);
    }
    for (const key of this.toldStuck) if (!this.state.agents.some((a) => key === `${a.id}:${a.endedAt ?? 0}` && a.status === 'error')) this.toldStuck.delete(key);
  }

  markPhoneRead(at: number) {
    const t = Math.min(Number(at) || Date.now(), Date.now());
    if (t <= this.state.phoneReadAt) return;
    this.state.phoneReadAt = t;
    this.broadcast({ type: 'phoneRead', at: t });
    this.save();
  }

  // ---------- team changes ----------

  private addRequest(req: HireRequestView) {
    this.state.requests.push(req);
    const decided = this.state.requests.filter((r) => r.status !== 'pending');
    if (decided.length > KEEP_DECIDED_REQUESTS) {
      const drop = new Set(decided.slice(0, decided.length - KEEP_DECIDED_REQUESTS));
      this.state.requests = this.state.requests.filter((r) => !drop.has(r));
    }
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  private decide(req: HireRequestView, patch: Pick<HireRequestView, 'status' | 'note' | 'decidedBy'>) {
    Object.assign(req, patch, { decidedAt: Date.now() });
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  /** "Codex · gpt-6 · high": what an agent runs, where it isn't the office default ('' when it all is). */
  private setupLabel(x: { cli: AgentCli | ''; model: string; effort: EffortLevel | ''; host?: MachineHost | '' }) {
    return [x.cli ? cliLabel(x.cli) : '', x.model, x.effort ? `esfuerzo ${x.effort}` : '', x.host === 'box' ? 'en la nube' : ''].filter(Boolean).join(' · ');
  }

  /** A team change goes through: the new agent joins as set up here (the manager's changes win), or an agent leaves. */
  approveRequest(id: string, overrides: { name?: string; cli?: string; model?: string; effort?: string; host?: string; note?: string } = {}, by: 'manager' | 'auto' = 'manager') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'Ese cambio de equipo ya no existe');
    if (req.status !== 'pending') throw new HttpError(409, `Ese cambio de equipo ya estaba ${req.status === 'approved' ? 'aprobado' : req.status === 'rejected' ? 'rechazado' : req.status}`);
    const repo = this.repo(req.repoId);
    // The manager's note (from the lobby card) reaches the CEO as managerNote, as a decline's does.
    const note = (overrides.note ?? '').trim().slice(0, 400);
    const quoted = note ? ` Tu nota: "${note}"` : '';
    if (req.kind === 'hire') {
      const name = overrides.name?.trim() || req.name;
      const agent = this.hireAgent(repo.id, {
        name,
        cli: overrides.cli ?? req.cli,
        host: overrides.host ?? req.host ?? '',
        strict: true,
        model: overrides.model ?? req.model,
        effort: overrides.effort ?? req.effort,
        look: name === req.name ? req.look : undefined,
        appearance: { color: req.color, hair: req.hair, skin: req.skin },
        // the request's id: the candidate waiting in the lobby was drawn from it, so they look the same at their desk
        id: req.id,
      });
      Object.assign(req, { agentId: agent.id, name: agent.name, cli: agent.cli, host: agent.host ?? 'local', model: agent.model, effort: agent.effort });
      this.decide(req, { status: 'approved', note, decidedBy: by });
      const setup = this.setupLabel(req);
      this.postMessage('office', by === 'auto' ? `🤖 ${agent.name} se ha incorporado a ${projectName(repo)}${setup ? ` (${setup})` : ''}.` : `✅ Has incorporado a ${agent.name} a ${projectName(repo)}${setup ? ` (${setup})` : ''}.${quoted}`, req.id);
      this.toast('success', `${agent.name} se ha incorporado a ${projectName(repo)}`);
      return;
    }
    const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
    this.decide(req, { status: 'approved', note: a ? note : 'Ya se había ido.', decidedBy: by });
    if (a) {
      try {
        this.fireAgent(a.id);
      } catch (err) {
        this.decide(req, { status: 'pending', note: '', decidedBy: null });
        throw err;
      }
    }
    this.postMessage('office', `👋 ${req.name} ha dejado ${projectName(repo)}${by === 'auto' ? '' : ' (con tu visto bueno)'}.${a ? quoted : ''}`, req.id);
  }

  rejectRequest(id: string, note = '') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'Ese cambio de equipo ya no existe');
    if (req.status !== 'pending') throw new HttpError(409, `Ese cambio de equipo ya estaba ${req.status === 'approved' ? 'aprobado' : req.status === 'rejected' ? 'rechazado' : req.status}`);
    this.decide(req, { status: 'rejected', note: note.trim().slice(0, 400), decidedBy: 'manager' });
    const floor = this.state.repos.find((r) => r.id === req.repoId)?.floor;
    const what = req.kind === 'hire' ? `añadir a ${req.name} a la planta ${floor ?? '?'}` : `despedir a ${req.name}`;
    this.postMessage('office', `✋ Has rechazado ${what}${req.note ? `: "${req.note}"` : '.'}`, req.id);
  }

  /**
   * With team changes applied straight away: new agents waiting in the lobby join (a floor that's full keeps them
   * waiting), and agents let go leave as soon as they aren't preparing or working. A floor's last agent never leaves.
   */
  private applyTeamChanges() {
    if (this.state.settings.scaling !== 'auto') return;
    for (const req of this.state.requests.filter((r) => r.status === 'pending')) {
      const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
      if (req.kind === 'let-go' && a && BUSY.includes(a.status)) continue;
      if (req.kind === 'let-go' && a && this.state.agents.filter((x) => x.repoId === a.repoId).length <= 1) {
        this.decide(req, { status: 'rejected', note: `${a.name} es el último agente de la planta.`, decidedBy: 'auto' });
        continue;
      }
      try {
        this.approveRequest(req.id, {}, 'auto');
      } catch (err) {
        console.warn(`team change for ${req.name} waits: ${oneLine(err)}`);
      }
    }
  }

  /** A floor's team as scale_team sees it: who's there, and the team changes waiting for the manager. */
  private teamNow(repo: PersistedRepo): TeamNow {
    const pending = this.state.requests.filter((q) => q.repoId === repo.id && q.status === 'pending');
    return {
      agents: this.state.agents.filter((a) => a.repoId === repo.id).map((a) => ({ id: a.id, desk: a.desk, free: this.isFree(a) })),
      pendingHires: pending.filter((q) => q.kind === 'hire').sort((x, y) => x.createdAt - y.createdAt).map((q) => q.id),
      pendingLetGos: pending.filter((q) => q.kind === 'let-go' && q.agentId).map((q) => ({ id: q.id, agentId: q.agentId! })),
    };
  }

  private newHire(repo: PersistedRepo, reason: string, setup: Pick<HireRequestView, 'cli' | 'model' | 'effort'>): HireRequestView {
    const name = this.freeName();
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'hire',
      repoId: repo.id,
      agentId: null,
      name,
      reason,
      ...setup,
      look: lookFor(name),
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  private newLetGo(a: PersistedAgent, reason: string): HireRequestView {
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'let-go',
      repoId: a.repoId,
      agentId: a.id,
      name: a.name,
      reason,
      cli: a.cli,
      model: a.model,
      effort: a.effort,
      look: a.look,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    return req;
  }

  /**
   * The CEO's scale_team (scalePlan does the arithmetic). With scaling on approve, new agents wait in the lobby and
   * let-gos are envelopes on desks until the manager decides; on auto, they go through at once, bar busy agents, who
   * leave when their task is over (leaveIfDue).
   */
  private scaleTeam(x: { floor: number; size: number; reason: string; cli?: string; model?: string; effort?: string }) {
    const repo = this.floorRepo(x.floor);
    const reason = String(x.reason ?? '').trim().slice(0, 600);
    if (!reason) throw new Error('Di por qué: el responsable lee el motivo.');
    const cli: AgentCli | '' = isCli(x.cli) ? x.cli : '';
    if (cli && !this.cliReady(cli)) throw new Error(`${cliLabel(cli)} no está instalado aquí. Instalados: ${this.clis.filter((c) => c.installed).map((c) => c.id).join(', ') || 'ninguno'}.`);
    const max = this.state.settings.maxAgents;
    const team = this.teamNow(repo);
    const before = plannedSize(team);
    const plan = scalePlan(team, Number(x.size), max);
    const counting = team.pendingHires.length + team.pendingLetGos.length ? ', contando los cambios de equipo pendientes del responsable' : '';
    if (plan.size === before) return `La planta ${repo.floor} ya tiene ${before} ${before === 1 ? 'agente' : 'agentes'}${counting}${Number(x.size) > max ? ` (su máximo: ${max})` : ''}. No ha cambiado nada.`;
    for (const id of [...plan.cancelHires, ...plan.cancelLetGos]) {
      const req = this.state.requests.find((r) => r.id === id);
      if (req) this.decide(req, { status: 'rejected', note: `${this.ceo().name} ha cambiado el plan.`, decidedBy: 'auto' });
    }
    const setup = { cli, model: String(x.model ?? '').trim(), effort: EFFORTS.includes(x.effort as EffortLevel) ? (x.effort as EffortLevel) : ('' as const) };
    const made = [...Array.from({ length: plan.hire }, () => this.newHire(repo, reason, setup)), ...plan.letGo.map((id) => this.newLetGo(this.agent(id), reason))];
    const capped = Number(x.size) > max ? ` (has pedido ${x.size}; su máximo es ${max})` : '';
    const names = (reqs: HireRequestView[]) => nameList(reqs.map((r) => r.name));
    if (this.state.settings.scaling === 'auto') {
      const now = made.filter((r) => r.kind === 'hire' || !BUSY.includes(this.agent(r.agentId!).status));
      this.applyTeamChanges();
      const joined = now.filter((r) => r.kind === 'hire');
      const left = now.filter((r) => r.kind === 'let-go');
      const later = made.filter((r) => !now.includes(r));
      const parts = [joined.length ? `${joined.length === 1 ? 'se incorpora' : 'se incorporan'} ${names(joined)}` : '', left.length ? `${left.length === 1 ? 'se va' : 'se van'} ${names(left)}` : '', later.length ? `${names(later)} se ${later.length === 1 ? 'irá' : 'irán'} tras su tarea actual` : ''].filter(Boolean);
      return `La planta ${repo.floor} pasa de ${before} a ${plan.size} agentes${capped}: ${parts.join('; ') || 'se han retirado los cambios pendientes'}.`;
    }
    const hires = made.filter((r) => r.kind === 'hire');
    const leaves = made.filter((r) => r.kind === 'let-go');
    const asks = [hires.length ? `añadir a ${names(hires)}` : '', leaves.length ? `despedir a ${names(leaves)}` : ''].filter(Boolean).join(' y ');
    if (made.length) {
      const project = repo.fullName.split('/')[1] ?? repo.fullName;
      const text = `📈 ${project}: ¿de ${before} a ${plan.size} agentes? Propongo ${asks}. ${reason}`;
      this.postMessage('ceo', hires.length ? `${text} ${hires.length === 1 ? `${hires[0].name} espera` : 'Esperan'} en Aprobaciones, donde puedes configurar${hires.length === 1 ? 'lo' : 'los'} antes de aceptar${hires.length === 1 ? 'lo' : 'los'}.` : text, made.length === 1 ? made[0].id : undefined);
      this.notifier.notify('hire', `${project}: ¿${before} → ${plan.size} agentes?`, `${this.ceo().name} propone ${asks}. ${plainText(reason)}`, `cambio de equipo en ${project}`);
    }
    return `La planta ${repo.floor} pasará de ${before} a ${plan.size} agentes${capped} cuando el responsable lo acepte: ${asks || 'se han retirado los cambios pendientes'}.`;
  }

  /**
   * Demo only: the CEO grows or shrinks a floor by one right now (the demo office's Team tab on the phone and
   * __swarmHiring). It goes through scale_team: same checks, phone message and auto mode.
   */
  demoPropose(kind: unknown, floor?: unknown) {
    if (!this.backend.demo) throw new HttpError(404, 'Solo la oficina demo se inventa cambios de equipo');
    if (kind !== 'hire' && kind !== 'let-go') throw new HttpError(400, 'kind debe ser "hire" o "let-go"');
    const floors = [...this.state.repos].sort((x, y) => x.floor - y.floor).filter((r) => floor === undefined || floor === null || r.floor === Number(floor));
    if (!floors.length) throw new HttpError(404, floor === undefined || floor === null ? 'Todavía no hay plantas' : `No existe la planta ${floor}`);
    for (const r of floors) {
      const size = plannedSize(this.teamNow(r));
      const ready = this.repoRt.get(r.id)?.lastSync ? this.readyIssues(r).length : 0;
      if (kind === 'hire' ? size >= this.state.settings.maxAgents : size <= 1 || !this.available(r).length) continue;
      const reason =
        kind === 'hire'
          ? `${ready} issue${ready === 1 ? '' : 's'} podría${ready === 1 ? '' : 'n'} empezar, y ${this.available(r).length} de ${size} agentes están libres.`
          : `${this.available(r).length} de ${size} agentes no tienen nada que hacer, y ${ready} issue${ready === 1 ? '' : 's'} podría${ready === 1 ? '' : 'n'} empezar.`;
      try {
        return { text: this.scaleTeam({ floor: r.floor, size: kind === 'hire' ? size + 1 : size - 1, reason }) };
      } catch (err) {
        throw new HttpError(409, (err as Error).message);
      }
    }
    throw new HttpError(409, kind === 'hire' ? 'Todas las plantas tienen ya su máximo de agentes' : 'Ninguna planta tiene un agente libre al que despedir');
  }

  // ---------- the CEO's office tools ----------

  private floorRepo(floor: number) {
    const r = this.state.repos.find((x) => x.floor === Number(floor));
    if (!r) throw new Error(`No existe la planta ${floor}. Plantas: ${this.state.repos.map((x) => `${x.floor} (${x.fullName})`).join(', ') || 'ninguna'}.`);
    return r;
  }

  private agentByRef(ref: string) {
    const r = String(ref ?? '').trim().toLowerCase();
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!a) throw new Error(`No existe el agente "${ref}". Usa los ids de company_status.`);
    return a;
  }

  private agentDoing(a: PersistedAgent) {
    return !BUSY.includes(a.status) ? null : a.task === 'qa' ? `probando la PR #${a.prNumber}` : a.task === 'fix' ? `corrigiendo la PR #${a.prNumber}` : `issue #${a.issueNumber}`;
  }

  /** What an agent runs, defaults resolved, for the CEO. */
  private agentSetup(a: PersistedAgent) {
    const ceo = a.role === 'ceo';
    const cli = ceo ? this.ceoCliNow(a) : a.cli || this.state.settings.defaultCli;
    return {
      codingAgent: cli,
      model: ceo ? ceoModel(a.model, this.ceoCliNow(a)) : this.modelFor(a, cli) || 'el predeterminado del agente de código',
      effort: a.effort || (ceo ? CEO_EFFORT : this.state.settings.defaultEffort),
    };
  }

  private companyStatus() {
    const s = this.state.settings;
    const ops = this.opsNow();
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    const floors = [...this.state.repos]
      .sort((x, y) => x.floor - y.floor)
      .map((r) => {
        const rt = this.repoRt.get(r.id)!;
        const open = new Set(rt.issues.map((i) => i.number));
        const team = this.teamNow(r);
        const nums = ops.floors.find((f) => f.repoId === r.id);
        return {
          floor: r.floor,
          repo: r.fullName,
          description: r.description,
          clone: rt.cloneStatus === 'ready' ? this.backend.mainDir(r.fullName) : `(no disponible: clon ${rt.cloneStatus})`,
          brief: r.mission || null,
          profile: r.summary || null,
          qaBrief: r.qaBrief || null,
          preview: { command: r.preview.command, env: r.preview.env, status: this.previews.view(r).status },
          autoAssign: r.autoAssign,
          autoMerge: r.autoMerge,
          folderSync: rt.folderSync,
          team: { size: team.agents.length, max: s.maxAgents, free: this.available(r).length, pendingHires: team.pendingHires.length, pendingLetGos: team.pendingLetGos.length },
          throughput: {
            mergedLastHour: nums?.mergedHour ?? 0,
            mergedToday: nums?.mergedToday ?? 0,
            medianLeadMinutes: nums?.leadMs != null ? Math.round(nums.leadMs / 60_000) : null,
            qaPassRate: nums?.qaPass ?? null,
          },
          capacity: {
            issuesReadyToStart: this.readyIssues(r).length,
            ...floorCapacity({
              issues: rt.issues,
              inProgress: (n) => this.issueTaken(r, n),
              openPrs: rt.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number),
              qa: this.state.qa.filter((q) => q.repoId === r.id),
            }),
          },
          agents: this.state.agents
            .filter((a) => a.repoId === r.id)
            .map((a) => ({ id: a.id, name: a.name, status: a.status, doing: this.agentDoing(a), ...this.agentSetup(a) })),
          backlog: rt.issues.map((i) => ({
            number: i.number,
            title: i.title,
            waitsFor: blockers(i.body, open),
            inProgress: this.issueTaken(r, i.number),
            ...(this.isHeld(r.id, i.number) ? { waitsForManager: 'se cerró su PR; solo el responsable vuelve a asignarlo' } : {}),
          })),
          pullRequests: rt.pulls
            .filter((p) => p.state === 'OPEN')
            .map((p) => {
              const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
              return { number: p.number, title: p.title, qa: q ? `${q.status}${q.round > 1 ? ` (ronda ${q.round})` : ''}` : 'sin probar', merge: q?.mergeNote ?? null, checks: p.checks };
            }),
          mergedRecently: rt.pulls.filter((p) => p.state === 'MERGED').map((p) => `#${p.number} ${p.title}`),
        };
      });
    const req = (r: HireRequestView) => ({
      id: r.id,
      kind: r.kind,
      floor: this.state.repos.find((x) => x.id === r.repoId)?.floor ?? null,
      name: r.name,
      reason: r.reason,
      status: r.status,
      managerNote: r.note || null,
    });
    return JSON.stringify(
      {
        company: {
          ceo: this.ceo().name,
          scaling: s.scaling === 'auto' ? 'los cambios de equipo se aplican directamente' : 'el responsable aprueba cada cambio de equipo',
          maxAgentsPerFloor: s.maxAgents,
          sessionLimit: s.sessionLimit || 'none',
          sessionsRunning: this.running(),
          usage: usageLabel(this.usageNow(), Date.now()),
        },
        floors,
        pendingChanges: pending.map(req),
        recentDecisions: this.state.requests.filter((r) => r.status !== 'pending').slice(-10).map(req),
      },
      null,
      1,
    );
  }

  private agentDetail(x: { agent_id: string }) {
    const a = this.agentByRef(x.agent_id);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    return JSON.stringify(
      {
        id: a.id,
        name: a.name,
        floor: repo?.floor ?? null,
        ...(a.role === 'ceo' ? { role: 'CEO' } : {}),
        status: a.status,
        doing: this.agentDoing(a),
        issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
        pullRequest: a.prNumber ? { number: a.prNumber, url: a.prUrl } : null,
        ...this.agentSetup(a),
      },
      null,
      1,
    );
  }

  private setFloorProfile(x: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }) {
    const r = this.floorRepo(x.floor);
    const preview = parsePreviewPatch(x.preview_command, x.preview_env);
    if (x.summary !== undefined) r.summary = String(x.summary).trim().slice(0, 140);
    if (x.qa_brief !== undefined) r.qaBrief = String(x.qa_brief).trim().slice(0, 2500);
    r.preview = { ...r.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(r);
    this.emitRepo(r);
    this.save();
    return `Saved floor ${r.floor}'s profile.`;
  }

  /** configure_agent: an agent's coding agent, model or effort, from their next task. */
  private configureAgent(x: { agent_id: string; cli?: string; model?: string; effort?: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error('Ese eres tú: al CEO lo configura el responsable.');
    if (x.cli === undefined && x.model === undefined && x.effort === undefined) throw new Error('Nada que cambiar: pasa cli, model, effort o una combinación.');
    this.updateAgent(a.id, { cli: x.cli, model: x.model, effort: x.effort });
    const setup = this.setupLabel(a) || 'los valores por defecto de la oficina';
    this.appendLog(a, [{ kind: 'system', text: `⚙️ ${this.ceo().name} ha configurado a ${a.name} con ${setup}.` }]);
    return `${a.name} usará ${setup} desde su próxima tarea.`;
  }

  private async fileIssue(x: { floor: number; title: string; body: string }) {
    const repo = this.floorRepo(x.floor);
    if (!this.ceoAsked) throw new Error(NOT_ASKED);
    this.ceoIssues.check();
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new Error('Un issue necesita un título.');
    const body = `${String(x.body ?? '').trim()}\n\n---\n_Abierto por ${this.ceo().name}, CEO de sareoffice._`;
    const n = await this.backend.createIssue(repo.fullName, title, body);
    this.ceoIssues.record(repo.id);
    return `Filed #${n} on floor ${repo.floor}: ${title}.`;
  }

  /** Rewrite an open issue's "Depends on #N" line (see planDependencies for what is refused). */
  private async setDependencies(x: { floor: number; number: number; depends_on: number[] }) {
    const repo = this.floorRepo(x.floor);
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const deps = (x.depends_on ?? []).map(Number);
    const asked = [Number(x.number), ...deps].filter((n) => !issues.some((i) => i.number === n));
    const states = new Map(await Promise.all([...new Set(asked)].map(async (n) => [n, await this.backend.issueState(repo.fullName, n).catch(() => null)] as const)));
    const plan = planDependencies({
      floor: repo.floor,
      number: Number(x.number),
      dependsOn: deps,
      issues,
      closed: (n) => states.get(n) === 'CLOSED',
      inProgress: this.issueTaken(repo, Number(x.number)),
    });
    if (plan.body !== null) {
      await this.backend.editIssue(repo.fullName, Number(x.number), { body: plan.body });
      await this.syncRepo(repo.id); // the scheduler sees the new order right away
    }
    return plan.summary;
  }

  /** Close an open issue as not planned, with the CEO's reason as its comment (see checkCloseIssue for what is refused). */
  private async closeIssue(x: { floor: number; number: number; reason: string }) {
    const repo = this.floorRepo(x.floor);
    const n = Number(x.number);
    const rt = this.repoRt.get(repo.id);
    const reason = String(x.reason ?? '').trim().slice(0, 1000);
    if (!reason) throw new HttpError(400, 'Di por qué se cierra el issue: el motivo se publica en él como comentario.');
    const state = rt?.issues.some((i) => i.number === n) ? 'OPEN' : await this.backend.issueState(repo.fullName, n).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number: n, state, pulls: rt?.pulls ?? [] });
    await this.backend.closeIssue(repo.fullName, n, reason, 'not planned');
    this.postMessage('office', `🗂️ ${this.ceo().name} ha cerrado #${n} de ${projectName(repo)}: ${reason.split('\n')[0].slice(0, 200)}`);
    const stopped = this.learnIssueClosed(repo, n); // off the Kanban, out of the scheduler's queue, and whoever was on it stops
    await this.syncRepo(repo.id);
    return `#${n} de la planta ${repo.floor} cerrado como no planificado.${stopped.length ? ` ${nameList(stopped)} ha${stopped.length === 1 ? '' : 'n'} dejado de trabajar en él.` : ''}`;
  }
}
