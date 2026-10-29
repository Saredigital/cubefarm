import { create } from 'zustand';
import { CEO_ID, DEFAULT_DOG_NAME, DEFAULT_MAX_AGENTS, type AgentView, type CeoInfo, type CliView, type CloudView, type DoctorFinding, type HireRequestView, type LogLine, type NotifyChannelsView, type OfficeUpdateView, type OpsView, type PhoneMessage, type PrPreviewView, type QaView, type ReportView, type RepoView, type ServerEvent, type SwarmSettings, type TickerItem, type UsageView, type VoiceCacheView, type WorldSnapshot } from '../../shared/types';
import { blockers } from '../../shared/issues';
import { latestListed } from '../../shared/watch';
import { DEFAULT_NOTIFY } from '../../shared/notify';
import { DEFAULT_CLOUD, EMPTY_CLOUD } from '../../shared/cloud';
import { speechText } from '../../shared/speech';
import { showDesktopNote } from './notifications';
import { EMPTY_OPS, newAlarms } from './ops';
import type { ProgressView } from '../../shared/progress';
import { needsManager, qaCardNote, type CardTone } from './qaCard';
import { announce } from './ui/announce';
import { alarm, audioUnlocked, chirp, cue } from './ui/sfx';
import { claimVoice } from './ui/voiceClaim';
import { speakable } from './ui/voiceQueue';
import { companyDepartmentOnFloor } from './company/public';
import { routeHash } from './panel/panelData';

export type Agent = Omit<AgentView, 'log'>;

export type PhoneTab = 'chat' | 'hires' | 'company';

export type Overlay =
  | { kind: 'company'; tab?: import('./company/CompanyWorkspace').CompanyTab; departmentId?: string }
  | { kind: 'terminal'; agentId: string }
  | { kind: 'kanban'; repoId: string }
  | { kind: 'app'; repoId: string; pr?: number | null } // pr: open the viewer on that channel (null: main)
  | { kind: 'manager'; tab?: ManagerTab; repoId?: string; card?: string } // card: an OpsAlarm id, or 'usage', to open at
  | { kind: 'phone'; tab?: PhoneTab; requestId?: string }
  | { kind: 'help' };

export type ManagerTab = 'floors' | 'ops' | 'ceo' | 'team' | 'issues' | 'settings' | 'access';

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  connected: boolean;
  loaded: boolean;
  user: string | null;
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  machinesRoot: string;
  settings: SwarmSettings;
  clis: CliView[]; // the coding-agent CLIs installed where the office runs
  repos: RepoView[];
  agents: Record<string, Agent>;
  logs: Record<string, LogLine[]>; // only for the agents this tab watches (shared/watch.ts): its floor and open panels
  latest: Record<string, LogLine>; // everyone's latest line worth listing, for the workers list
  workersOpen: boolean; // the workers list is showing (WorkersPanel.tsx), so the office sends everyone's latest line
  screens: Record<string, number>; // agentId -> screenshot timestamp (cache buster)
  qa: Record<string, QaView>; // `${repoId}#${prNumber}`
  reports: ReportView[]; // finished analyses, newest first
  prPreviews: Record<string, PrPreviewView>; // the PR theatre's previews, `${repoId}#${pr}`
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  phoneReadAt: number;
  version?: string; // the sareoffice version the server runs
  officeCommit?: string | null; // undefined: the server can't update itself
  officeUpdate?: OfficeUpdateView;
  usage: UsageView; // Claude's subscription usage: normal, pacing after a warning, or paused at the limit
  ops: OpsView; // mission control: every floor's numbers and what needs the manager
  doctor: DoctorFinding[]; // the office doctor's findings (server/watchdog.ts)
  voiceKeySet: boolean; // an ElevenLabs key is saved on the server
  voiceKeyHint: string; // its last 4 characters
  voiceCache: VoiceCacheView; // the voice's saved clips: Settings → Voice, and which messages the phone's ▶ replays
  progress: ProgressView; // coins, decorations and achievements (#210)
  voiceSpeaking: number | null; // the phone message being read aloud in this tab (ui/voiceMessages.ts)
  ticker: TickerItem[]; // the floors' recent activity lines, oldest first (the panel's activity feed)
  notifyChannels: NotifyChannelsView; // which chat apps have a webhook saved (hints only) and how many devices get push
  cloud: CloudView; // Settings → Cloud agents: the Upstash account and what cloud agents sign in with (never a key)
  restarting: boolean; // the connection dropped because the office is restarting to update

  floor: number; // the floor (project) this tab watches, for its agents' terminal lines (shared/watch.ts); 0: none
  overlay: Overlay | null;
  toasts: Toast[];

  /** Folds an event into the state. */
  apply(ev: ServerEvent): void;
  setConnected(v: boolean): void;
  setRestarting(v: boolean): void;
  setOfficeUpdate(u: OfficeUpdateView): void;
  openOverlay(o: Overlay | null): void;
  setWorkersOpen(v: boolean): void;
  /** Opens a floor's project in the control panel. */
  goToFloor(n: number): void;
  pushToast(level: Toast['level'], text: string): void;
  dismissToast(id: number): void;
}

let toastSeq = 1;

const LOG_KEEP = 600;
const TICKER_KEEP = 120; // ticker lines kept across every floor

export const useStore = create<State>((set, get) => ({
  connected: false,
  loaded: false,
  user: null,
  ghReady: true,
  demo: false,
  machinesRoot: '',
  // Until the server's snapshot arrives; setupDone stays true so the wizard doesn't flash while loading.
  settings: {
    sessionLimit: 0,
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'medium',
    runtime: 'terminal',
    defaultCli: 'claude',
    scaling: 'approve',
    maxAgents: DEFAULT_MAX_AGENTS,
    ceoHeartbeatMin: 60,
    managerName: '',
    companyName: '',
    dogName: DEFAULT_DOG_NAME,
    projectsDir: '',
    setupDone: true,
    tutorialStep: -1,
    pacingSessions: 3,
    trimIdleDesksMin: 120,
    voice: { provider: 'off', voiceId: '', voiceName: '', model: '', speakOffice: false, keepDays: 7 },
    listen: { provider: 'off', autoSend: false, handsFree: false },
    notify: DEFAULT_NOTIFY,
    cloud: DEFAULT_CLOUD,
  },
  clis: [],
  repos: [],
  agents: {},
  logs: {},
  latest: {},
  workersOpen: false,
  screens: {},
  qa: {},
  reports: [],
  prPreviews: {},
  requests: [],
  ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
  messages: [],
  phoneReadAt: 0,
  usage: { state: 'normal', until: null, warning: null },
  ops: EMPTY_OPS,
  doctor: [],
  voiceKeySet: false,
  voiceKeyHint: '',
  voiceCache: { clips: 0, bytes: 0, saved: [] },
  progress: { floors: {}, achievements: [], coffees: 0, merges: 0 },
  voiceSpeaking: null,
  ticker: [],
  notifyChannels: { webhooks: { ntfy: { set: false, hint: '' } }, pushDevices: 0 },
  cloud: EMPTY_CLOUD,
  restarting: false,

  floor: 0,
  overlay: null,
  toasts: [],

  apply(ev) {
    // Cues compare the old state with the new, so each change sounds once; snapshots (page load,
    // reconnect) never do, and nothing sounds before the first snapshot.
    const live = get().loaded;
    const cues = live;
    switch (ev.type) {
      case 'snapshot': {
        const d: WorldSnapshot = ev.data;
        const agents: Record<string, Agent> = {};
        const logs: Record<string, LogLine[]> = {};
        const screens: Record<string, number> = {};
        for (const { log, ...a } of d.agents) {
          agents[a.id] = a;
          logs[a.id] = log;
          if (a.screenshotAt) screens[a.id] = a.screenshotAt;
        }
        const qa: Record<string, QaView> = {};
        for (const q of d.qa) qa[qaKey(q.repoId, q.prNumber)] = q;
        const prPreviews: Record<string, PrPreviewView> = {};
        for (const p of d.prPreviews ?? []) prPreviews[qaKey(p.repoId, p.pr)] = p;
        // Stay on the current (or remembered) floor if it still exists; otherwise go to the lobby.
        const floorExists = !!companyDepartmentOnFloor(get().floor) || d.repos.some((r) => r.floor === get().floor);
        set({
          loaded: true,
          user: d.user,
          ghReady: d.ghReady,
          ghError: d.ghError,
          demo: d.demo,
          machinesRoot: d.machinesRoot,
          settings: d.settings,
          repos: d.repos.sort((a, b) => a.floor - b.floor),
          agents,
          logs,
          latest: {},
          screens,
          qa,
          reports: d.reports ?? [],
          prPreviews,
          requests: d.requests,
          ceo: d.ceo,
          messages: d.messages,
          phoneReadAt: d.phoneReadAt,
          version: d.version,
          officeCommit: d.officeCommit,
          officeUpdate: d.officeUpdate,
          usage: d.usage,
          ops: d.ops ?? EMPTY_OPS,
          doctor: d.doctor ?? [],
          clis: d.clis ?? [],
          voiceKeySet: d.voiceKeySet ?? false,
          voiceKeyHint: d.voiceKeyHint ?? '',
          voiceCache: d.voiceCache ?? { clips: 0, bytes: 0, saved: [] },
          ticker: d.ticker ?? [],
          notifyChannels: d.notifyChannels ?? get().notifyChannels,
          cloud: d.cloud ?? EMPTY_CLOUD,
          progress: d.progress ?? { floors: {}, achievements: [], coffees: 0, merges: 0 },
          restarting: false,
          floor: floorExists ? get().floor : 0,
        });
        break;
      }
      case 'repo':
      case 'repos': {
        // one floor in full, or a batch of floors' changes (server/outbox.ts)
        let repos = get().repos;
        let merged = false;
        for (const patch of ev.type === 'repo' ? [ev.repo] : ev.repos) {
          const before = repos.find((r) => r.id === patch.id);
          if (!before && patch.fullName === undefined) continue; // a change to a floor this tab no longer has
          const next = { ...before, ...patch } as RepoView;
          if (before && newlyMerged(before, next).length) merged = true;
          repos = [...repos.filter((r) => r.id !== next.id), next];
        }
        set({ repos: repos.sort((a, b) => a.floor - b.floor) });
        if (merged && cues) cue('merged');
        break;
      }
      case 'repoRemoved': {
        const repos = get().repos.filter((r) => r.id !== ev.repoId);
        const floor = get().floor > repos.length ? 0 : get().floor;
        set({ repos, floor });
        break;
      }
      case 'agent': {
        const prev = get().agents[ev.agent.id];
        if (cues && !prev && ev.agent.role !== 'ceo') cue('welcome');
        if (cues && prev && prev.status !== 'error' && ev.agent.status === 'error') cue('error');
        set({ agents: { ...get().agents, [ev.agent.id]: ev.agent } });
        break;
      }
      case 'agents': {
        // a batch of changes (server/outbox.ts): one update for all of them
        const agents = { ...get().agents };
        for (const patch of ev.agents) {
          const prev = agents[patch.id];
          if (!prev && patch.name === undefined) continue; // a change to someone this tab no longer has
          const next = { ...prev, ...patch } as Agent;
          if (cues && !prev && next.role !== 'ceo') cue('welcome');
          if (cues && prev && prev.status !== 'error' && next.status === 'error') cue('error');
          agents[patch.id] = next;
        }
        set({ agents });
        break;
      }
      case 'agentRemoved': {
        const { [ev.agentId]: _gone, ...agents } = get().agents;
        set({ agents });
        break;
      }
      case 'logs': {
        const logs = { ...get().logs };
        const latest = { ...get().latest };
        for (const [id, lines] of Object.entries(ev.tails)) {
          // a catch-up replaces the buffer; live lines it already had (sent again after one) are skipped
          const prev = ev.catchUp ? [] : (logs[id] ?? []);
          const last = prev.length ? prev[prev.length - 1].id : -1;
          const fresh = ev.catchUp ? lines : lines.filter((l) => l.id > last);
          if (!fresh.length && !ev.catchUp) continue;
          const next = prev.concat(fresh);
          logs[id] = next.length > LOG_KEEP ? next.slice(-LOG_KEEP) : next;
          const listed = latestListed(fresh, 80);
          if (listed) latest[id] = listed;
        }
        set({ logs, latest });
        break;
      }
      case 'latest':
        set({ latest: { ...get().latest, ...ev.lines } });
        break;
      case 'screen': {
        const a = get().agents[ev.agentId];
        set({
          screens: { ...get().screens, [ev.agentId]: ev.at },
          agents: a ? { ...get().agents, [ev.agentId]: { ...a, hasScreenshot: true, screenshotAt: ev.at, browserUrl: ev.url ?? a.browserUrl } } : get().agents,
        });
        break;
      }
      case 'qa': {
        const prev = get().qa[qaKey(ev.qa.repoId, ev.qa.prNumber)]?.status;
        const failed = (st?: QaView['status']) => st === 'failed' || st === 'needs-human';
        if (cues && ev.qa.status === 'passed' && prev !== 'passed') cue('ready');
        if (cues && failed(ev.qa.status) && !failed(prev)) cue('qaFailed');
        set({ qa: { ...get().qa, [qaKey(ev.qa.repoId, ev.qa.prNumber)]: ev.qa } });
        break;
      }
      case 'report':
        set({ reports: [ev.report, ...get().reports.filter((r) => r.id !== ev.report.id)] });
        break;
      case 'qaRemoved': {
        const { [qaKey(ev.repoId, ev.prNumber)]: _gone, ...qa } = get().qa;
        set({ qa });
        break;
      }
      case 'prPreview':
        set({ prPreviews: { ...get().prPreviews, [qaKey(ev.preview.repoId, ev.preview.pr)]: ev.preview } });
        break;
      case 'prPreviewRemoved': {
        const { [qaKey(ev.repoId, ev.pr)]: _gone, ...prPreviews } = get().prPreviews;
        set({ prPreviews });
        break;
      }
      case 'settings':
        set({ settings: ev.settings });
        break;
      case 'clis':
        set({ clis: ev.clis });
        break;
      case 'request': {
        const prev = get().requests.find((r) => r.id === ev.request.id);
        if (cues && ev.request.kind === 'hire' && ev.request.status === 'approved' && prev?.status === 'pending') cue('welcome');
        const requests = get().requests.filter((r) => r.id !== ev.request.id);
        requests.push(ev.request);
        set({ requests: requests.sort((a, b) => a.createdAt - b.createdAt) });
        break;
      }
      case 'ceo':
        set({ ceo: ev.ceo });
        break;
      case 'message': {
        set({ messages: [...get().messages.slice(-199), ev.message] });
        const o = get().overlay;
        const reading = o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat';
        // Read aloud, in this tab or another; the voice plays the chirp itself if it can't. Locked audio can't speak.
        const speak = live && audioUnlocked() && speakable(ev.message, get().settings.voice, Date.now());
        if (speak) {
          const arrived = Date.now();
          const wait = claimVoice(ev.message.id);
          void import('./ui/voiceMessages').then((v) => v.speakMessage(ev.message, arrived, wait));
        }
        // Screen readers hear every message from the CEO, in words (no markdown or emoji), wherever focus is.
        if (live && ev.message.from === 'ceo') announce(`Mensaje de ${get().agents[CEO_ID]?.name ?? 'el CEO'}: ${speechText(ev.message.text, 600)}`);
        if (ev.message.from === 'ceo' && !reading) {
          if (!speak) chirp();
          const ceo = get().agents[CEO_ID]?.name ?? 'CEO';
          const text = ev.message.text.replace(/\s+/g, ' ');
          get().pushToast('info', `📱 ${ceo}: ${text.length > 110 ? `${text.slice(0, 109)}…` : text}`);
        }
        break;
      }
      case 'phoneRead':
        set({ phoneReadAt: Math.max(get().phoneReadAt, ev.at) });
        break;
      case 'toast':
        get().pushToast(ev.level, ev.text);
        break;
      case 'officeUpdate':
        set({ officeUpdate: ev.officeUpdate });
        break;
      case 'usage':
        set({ usage: ev.usage });
        break;
      case 'ops':
        // A new alarm sounds once (rate-limited); the beacons spin until it's handled.
        if (cues && newAlarms(get().ops.alarms, ev.ops.alarms).length) alarm();
        set({ ops: ev.ops });
        break;
      case 'doctor':
        set({ doctor: ev.doctor });
        break;
      case 'voiceKey':
        set({ voiceKeySet: ev.voiceKeySet, voiceKeyHint: ev.voiceKeyHint });
        break;
      case 'voiceCache':
        set({ voiceCache: ev.voiceCache });
        break;
      case 'ticker':
        set({ ticker: [...get().ticker.slice(-(TICKER_KEEP - 1)), ev.item] });
        break;
      case 'notifyChannels':
        set({ notifyChannels: ev.notifyChannels });
        break;
      case 'cloud':
        set({ cloud: ev.cloud });
        break;
      case 'notify':
        // This tab shows it only while it's hidden (notifications.ts); a visible office already chimes and toasts.
        showDesktopNote(ev.note, get().settings.notify?.channels.desktop !== false);
        break;
      case 'progress':
        set({ progress: ev.progress });
        break;
    }
  },

  setConnected: (connected) => set({ connected }),
  setRestarting: (restarting) => set({ restarting }),
  setOfficeUpdate: (officeUpdate) => set({ officeUpdate }),
  openOverlay(overlay) {
    set({ overlay });
  },
  setWorkersOpen: (workersOpen) => set({ workersOpen }),
  goToFloor(n) {
    const repo = get().repos.find((r) => r.floor === n);
    set({ overlay: null, floor: n });
    if (repo) location.hash = routeHash({ page: 'project', repoId: repo.id });
  },
  pushToast(level, text) {
    if (level === 'error') announce(text, 'assertive');
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-4), { id, level, text }] });
    setTimeout(() => get().dismissToast(id), level === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// ---------- derived helpers ----------

export const qaKey = (repoId: string, prNumber: number) => `${repoId}#${prNumber}`;

/** PRs that were open in `before` and are merged in `after`: the merges a floor patch brings. */
export function newlyMerged(before: Pick<RepoView, 'pulls'>, after: Pick<RepoView, 'pulls'>): number[] {
  const was = new Map((before.pulls ?? []).map((p) => [p.number, p.state]));
  return (after.pulls ?? []).filter((p) => p.state === 'MERGED' && was.has(p.number) && was.get(p.number) !== 'MERGED').map((p) => p.number);
}

export const repoOnFloor = (repos: RepoView[], floor: number) => repos.find((r) => r.floor === floor) ?? null;

export const agentsOnRepo = (agents: Record<string, Agent>, repoId: string) =>
  Object.values(agents)
    .filter((a) => a.repoId === repoId)
    .sort((a, b) => a.desk - b.desk);

/**
 * Panels that hide the whole office (the wide ones: Kanban, terminals and the manager's console), so the
 * 3D view can stop drawing behind them. The phone, help, elevator panel and confirm dialogs are see-through.
 */
export const coversView = (o: Overlay | null) => o?.kind === 'kanban' || o?.kind === 'terminal' || o?.kind === 'manager';

export const isBusy = (a: Agent) => a.status === 'preparing' || a.status === 'working';

/** CEO messages the manager hasn't seen yet (proposals are counted by pendingRequests instead). */
export const unreadMessages = (messages: PhoneMessage[], readAt: number) => messages.filter((m) => m.from === 'ceo' && !m.requestId && m.at > readAt).length;

export const pendingRequests = (requests: HireRequestView[]) => requests.filter((r) => r.status === 'pending');

/** The red dot on the phone: decisions waiting on the manager plus unread messages. */
export function usePhoneBadge() {
  const requests = useStore((s) => s.requests);
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  return pendingRequests(requests).length + unreadMessages(messages, readAt);
}

export interface KanbanCard {
  key: string;
  number: number;
  title: string;
  url?: string;
  agent?: Agent;
  note?: string;
  tone?: CardTone;
  prNumber?: number;
  qa?: QaView;
  /** The 3D board draws it as an outline: its sticky is off the board, with the agent testing it (StickyNotes.tsx). */
  ghost?: boolean;
}

export interface KanbanColumns {
  backlog: KanbanCard[];
  progress: KanbanCard[];
  qa: KanbanCard[];
  ready: KanbanCard[];
  merged: KanbanCard[];
}

/**
 * Sort a floor's GitHub state and QA pipeline into the five office Kanban columns. With `usage`, backlog issues
 * auto-assign would start but Claude's usage holds back say so ("⏸ paced").
 */
export function kanbanFor(repo: RepoView, agents: Agent[], qaRecords: Record<string, QaView>, usage?: Pick<UsageView, 'state'>): KanbanColumns {
  const openPulls = repo.pulls.filter((p) => p.state === 'OPEN');
  const byId = new Map(agents.map((a) => [a.id, a]));
  const workers = agents.filter((a) => a.role !== 'ceo');
  // While testing, an agent's prNumber is the PR under test, not one of theirs.
  const authors = workers.filter((a) => a.task !== 'qa');
  const authorOf = (n: number, head: string) => authors.find((a) => a.prNumber === n) ?? authors.find((a) => a.branch && a.branch === head);

  const progress: KanbanCard[] = [];
  for (const a of workers) {
    if (a.issueNumber == null || a.task !== 'issue' || a.status === 'idle') continue;
    // Their PR's card is the work now; once it's closed or merged there is no card ("finished · no PR" was wrong).
    if (a.prNumber != null) continue;
    const note =
      a.status === 'preparing' ? 'preparando' : a.status === 'working' ? 'trabajando' : a.status === 'error' ? 'necesita ayuda' : a.status === 'stopped' ? 'detenido' : 'terminado · sin PR';
    progress.push({
      key: `a-${a.id}`,
      number: a.issueNumber,
      title: a.issueTitle ?? '',
      agent: a,
      note,
      tone: a.status === 'error' ? 'bad' : a.status === 'stopped' || a.status === 'done' ? 'warn' : undefined,
    });
  }

  const qa: KanbanCard[] = [];
  const ready: KanbanCard[] = [];
  for (const p of openPulls) {
    const rec = qaRecords[qaKey(repo.id, p.number)];
    const dev = (rec?.devAgentId ? byId.get(rec.devAgentId) : undefined) ?? authorOf(p.number, p.headRefName);
    const tester = rec?.qaAgentId ? byId.get(rec.qaAgentId) : undefined;
    const base = { key: `pr-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, qa: rec };
    const card = { ...base, ...qaCardNote(rec, p, repo.autoMerge) };
    if (rec?.status === 'passed') ready.push({ ...card, agent: dev });
    else qa.push({ ...card, agent: rec?.status === 'testing' ? tester : dev });
  }

  const claimed = new Set<number>([...progress.map((c) => c.number), ...openPulls.flatMap((p) => p.closesIssues)]);
  const open = new Set(repo.issues.map((i) => i.number));
  const held = new Map((repo.held ?? []).map((h) => [h.issue, h.pr]));
  const paced = repo.autoAssign && usage && usage.state !== 'normal' ? (usage.state === 'paused' ? '⏸ en pausa' : '⏸ ritmo reducido') : '';
  const backlog: KanbanCard[] = repo.issues
    .filter((i) => !claimed.has(i.number))
    .map((i) => {
      const waits = blockers(i.body, open);
      const labels = i.labels.slice(0, 2).join(', ');
      const card = { key: `i-${i.number}`, number: i.number, title: i.title, url: i.url };
      // Its PR was closed: it waits for the manager rather than going back to auto-assign.
      if (held.has(i.number)) return { ...card, note: `⏸ PR #${held.get(i.number)} cerrada · asígnalo a mano`, tone: 'warn' as const };
      return { ...card, note: (waits.length ? `⏳ tras #${waits.join(', #')}` : [paced, labels].filter(Boolean).join(' · ')) || undefined };
    });

  const merged: KanbanCard[] = repo.pulls
    .filter((p) => p.state === 'MERGED')
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
    .map((p) => ({ key: `m-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, agent: authorOf(p.number, p.headRefName) }));

  return { backlog, progress, qa, ready, merged };
}

export interface FloorPrCounts {
  /** Open PRs in the Kanban's In QA column: queued, testing, failed, fixing, needs-human and untested ones. */
  inQa: number;
  /** Open PRs that passed QA (the Ready to merge column). */
  ready: number;
  /** Open PRs waiting on the manager (needs-human, and the CEO isn't triaging them); also counted in inQa. */
  needsYou: number;
}

/**
 * A floor's PR counts, matching kanbanFor's columns. Only open PRs count: QA records outlive their PR's merge or
 * close, so counting records instead drifts further from the board with every merge.
 */
export function floorPrCounts(repo: RepoView, qaRecords: Record<string, QaView>): FloorPrCounts {
  const counts: FloorPrCounts = { inQa: 0, ready: 0, needsYou: 0 };
  for (const p of repo.pulls) {
    if (p.state !== 'OPEN') continue;
    const rec = qaRecords[qaKey(repo.id, p.number)];
    if (rec?.status === 'passed') counts.ready++;
    else counts.inQa++;
    if (needsManager(rec)) counts.needsYou++;
  }
  return counts;
}
