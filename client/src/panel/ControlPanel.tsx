// The control panel: the office as a plain 2D console for a computer, on the same store, snapshot and REST as pocket
// mode. A side bar (pages, projects, company, Claude's usage) and a page: the overview, a project, the agents,
// approvals, the CEO's chat, the company or the settings. A fresh office starts with the setup wizard. Agents' terminals and a project's app open over it as the
// office's own panels. The route lives in the location hash, so a refresh or a link keeps the page.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { CEO_ID } from '../../../shared/types';
import { agentsOnRepo, unreadMessages, useStore } from '../store';
import { officeUpdateChip } from '../officeUpdate';
import { approvalsBadge, waitingOnYou } from '../pocket/pocketData';
import { setMode } from '../pocket/mode';
import { Approvals } from '../pocket/PocketApprovals';
import { Chat } from '../ui/Phone';
import { Panel } from '../ui/Panel';
import { ProjectPicker } from '../ui/ProjectPicker';
import { SetupWizard } from '../ui/SetupWizard';
import { AgentsPage } from './Agents';
import { LaunchTask } from './LaunchTask';
import { Overview } from './Overview';
import { ProjectPage } from './Project';
import { SettingsPage } from './Settings';
import { parseRoute, routeHash, shortName, type PanelRoute } from './panelData';
import './panel.css';

// Loaded when first opened (the terminal brings xterm.js, the company its own workspace).
const TerminalView = lazy(() => import('../ui/TerminalView').then((m) => ({ default: m.TerminalView })));
const AppViewer = lazy(() => import('../ui/AppViewer').then((m) => ({ default: m.AppViewer })));
const CompanyWorkspace = lazy(() => import('../company/CompanyWorkspace').then((m) => ({ default: m.CompanyWorkspace })));

export type Go = (route: PanelRoute) => void;

const go: Go = (route) => {
  location.hash = routeHash(route);
};

function useRoute(): PanelRoute {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---------- side bar ----------

const ICONS: Record<string, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  agents: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  approvals: <path d="M20 6L9 17l-5-5" />,
  ceo: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  company: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg className="cp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

function Usage() {
  const usage = useStore((s) => s.usage);
  const pct = usage.warning?.pct ?? null;
  const until = usage.until ? new Date(usage.until).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : null;
  const label = usage.state === 'paused' ? `En pausa${until ? ` hasta las ${until}` : ''}` : usage.state === 'pacing' ? `Ritmo reducido${until ? ` hasta las ${until}` : ''}` : 'Ritmo normal';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Uso de Claude</span>
        {pct != null && <span style={{ color: '#fff' }}>{Math.round(pct)} %</span>}
      </div>
      {pct != null && (
        <div className="cp-meter" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso de Claude">
          <div style={{ width: `${Math.min(100, pct)}%`, background: usage.state === 'normal' ? undefined : '#f5a524' }} />
        </div>
      )}
      <div style={{ color: usage.state === 'normal' ? '#9aa0ac' : '#f5a524' }}>{label}</div>
    </>
  );
}

function Side({ route, connect }: { route: PanelRoute; connect: () => void }) {
  const company = useStore((s) => s.settings.companyName);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const connected = useStore((s) => s.connected);
  const waiting = useStore((s) => {
    const w = waitingOnYou(s.repos, s.qa, s.requests);
    return approvalsBadge(w) + w.ready.length;
  });
  const unread = useStore((s) => unreadMessages(s.messages, s.phoneReadAt));
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const item = (page: PanelRoute['page'], label: string, extra?: ReactNode) => (
    <button aria-current={route.page === page ? 'page' : undefined} onClick={() => go({ page })}>
      <Icon name={page} />
      {label}
      {extra}
    </button>
  );
  return (
    <aside className="cp-side" aria-label="Navegación">
      <div className="cp-brand">
        <div className="cp-logo" aria-hidden>
          {(company || 'S')[0]!.toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <b className="cp-ellipsis">{company || 'saredigital'}</b>
          <small>
            <span className={`cp-dot ${connected ? 'cp-dot-on' : 'cp-dot-bad'}`} style={{ display: 'inline-block', marginRight: 6 }} />
            {connected ? 'Panel de control' : 'Sin conexión'}
          </small>
        </div>
      </div>
      <nav className="cp-nav">
        {item('overview', 'Resumen')}
        {item('agents', 'Agentes')}
        {item('approvals', 'Aprobaciones', waiting > 0 ? <span className="cp-nav-badge">{waiting}</span> : null)}
        {item('ceo', ceoName === 'CEO' ? 'CEO' : `CEO · ${ceoName}`, unread > 0 && route.page !== 'ceo' ? <span className="cp-nav-badge">{unread}</span> : null)}
      </nav>
      <div>
        <div className="cp-nav-title">Proyectos</div>
        <nav className="cp-nav">
          {repos.map((r) => {
            const team = agentsOnRepo(agents, r.id).filter((a) => a.role !== 'ceo');
            const busy = team.some((a) => a.status === 'working' || a.status === 'preparing');
            const bad = !!r.syncError || r.cloneStatus === 'error' || team.some((a) => a.status === 'error');
            return (
              <button key={r.id} aria-current={route.page === 'project' && route.repoId === r.id ? 'page' : undefined} onClick={() => go({ page: 'project', repoId: r.id })}>
                <span className={`cp-dot ${bad ? 'cp-dot-warn' : busy ? 'cp-dot-on' : ''}`} aria-hidden />
                <span className="cp-ellipsis">{shortName(r.fullName)}</span>
                <span className="cp-nav-count">{team.length}</span>
              </button>
            );
          })}
          <button onClick={connect} style={{ color: '#9aa0ac' }}>
            + Conectar proyecto
          </button>
        </nav>
      </div>
      <div>
        <div className="cp-nav-title">Empresa</div>
        <nav className="cp-nav">
          {item('company', 'Gestión de empresa')}
          {item('settings', 'Ajustes')}
        </nav>
      </div>
      <div className="cp-side-foot">
        <Usage />
        <div style={{ marginTop: 4 }}>
          <button onClick={() => setMode('pocket')}>Modo bolsillo</button>
        </div>
      </div>
    </aside>
  );
}

// ---------- the shell ----------

function Banners() {
  const connected = useStore((s) => s.connected);
  const loaded = useStore((s) => s.loaded);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const demo = useStore((s) => s.demo);
  const update = useStore((s) => (s.restarting ? 'La oficina se está reiniciando…' : officeUpdateChip(s.officeUpdate)));
  return (
    <>
      {!connected && <div className="cp-banner cp-banner-bad">{loaded ? 'Reconectando con la oficina…' : 'Conectando con la oficina…'}</div>}
      {loaded && !ghReady && <div className="cp-banner cp-banner-bad">GitHub no está listo: {ghError ?? 'inicia sesión con gh auth login'}.</div>}
      {update && <div className="cp-banner">{update}</div>}
      {demo && <div className="cp-banner" style={{ background: 'var(--cp-accent-soft)', color: 'var(--cp-accent-ink)', borderColor: '#c7d5fb' }}>Modo demo: repositorios, agentes y GitHub simulados.</div>}
    </>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="cp-toasts" role="status">
      {toasts.slice(-3).map((t) => (
        <button key={t.id} className={`cp-toast cp-toast-${t.level}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** The office's panels opened over the page: an agent's terminal and a project's app. */
function Overlay() {
  const overlay = useStore((s) => s.overlay);
  if (overlay?.kind === 'terminal' && overlay.agentId !== CEO_ID) return <TerminalView agentId={overlay.agentId} />;
  if (overlay?.kind === 'app') return <AppViewer repoId={overlay.repoId} pr={overlay.pr} />;
  return null;
}

export default function ControlPanel() {
  const route = useRoute();
  const [launch, setLaunch] = useState<{ repoId?: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const company = useStore((s) => s.settings.companyName);
  const loaded = useStore((s) => s.loaded);
  const setupDone = useStore((s) => s.settings.setupDone);

  // Every agent's latest line comes to this tab, for the agent cards (shared/watch.ts).
  useEffect(() => {
    useStore.getState().setWorkersOpen(true);
    return () => useStore.getState().setWorkersOpen(false);
  }, []);
  // While the CEO's chat is on screen, new CEO messages don't toast (the store reads this as the phone's chat open).
  useEffect(() => {
    const s = useStore.getState();
    if (route.page === 'ceo') s.openOverlay({ kind: 'phone', tab: 'chat' });
    else if (s.overlay?.kind === 'phone') s.openOverlay(null);
  }, [route.page]);
  useEffect(() => {
    document.title = `${company || 'sareoffice'} · panel`;
    return () => void (document.title = 'sareoffice');
  }, [company]);
  // Ctrl K launches a task from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setLaunch((l) => l ?? { repoId: route.page === 'project' ? route.repoId : undefined });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  if (loaded && !setupDone) return <SetupWizard />;

  const openLaunch = (repoId?: string) => setLaunch({ repoId: repoId ?? (route.page === 'project' ? route.repoId : undefined) });
  const connect = () => setConnecting(true);

  return (
    <div className="cp">
      <Side route={route} connect={connect} />
      <main className="cp-main" key={route.page === 'project' ? `p-${route.repoId}` : route.page}>
        <Banners />
        {route.page === 'overview' && <Overview go={go} launch={() => openLaunch()} connect={connect} />}
        {route.page === 'project' && route.repoId && <ProjectPage repoId={route.repoId} tab={route.tab ?? 'board'} go={go} launch={openLaunch} />}
        {route.page === 'agents' && <AgentsPage go={go} />}
        {route.page === 'approvals' && (
          <>
            <header className="cp-header">
              <div className="cp-header-text">
                <h1>Aprobaciones</h1>
                <div className="cp-sub">Cambios de equipo que propone el CEO, PRs atascadas que te necesitan y PRs listas para fusionar.</div>
              </div>
            </header>
            <div className="cp-embed" style={{ maxWidth: 820 }}>
              <Approvals />
            </div>
          </>
        )}
        {route.page === 'ceo' && (
          <>
            <header className="cp-header">
              <div className="cp-header-text">
                <h1>CEO</h1>
                <div className="cp-sub">Coordina todos los proyectos: crea issues, planifica, revisa y ajusta los equipos. Pídele lo que necesites.</div>
              </div>
            </header>
            <div className="cp-card cp-chat" style={{ maxWidth: 900, overflow: 'hidden' }}>
              <Chat />
            </div>
          </>
        )}
        {route.page === 'settings' && <SettingsPage />}
        {route.page === 'company' && (
          <Suspense fallback={<p className="cp-empty">Cargando la gestión de empresa…</p>}>
            <CompanyWorkspace embedded />
          </Suspense>
        )}
      </main>
      {launch && <LaunchTask repoId={launch.repoId} onClose={() => setLaunch(null)} onCeo={() => go({ page: 'ceo' })} />}
      {connecting && (
        <Panel title="Conectar proyecto" onClose={() => setConnecting(false)} wide>
          <ProjectPicker
            onConnected={(repo) => {
              setConnecting(false);
              go({ page: 'project', repoId: repo.id });
            }}
          />
        </Panel>
      )}
      <Suspense fallback={null}>
        <Overlay />
      </Suspense>
      <Toasts />
    </div>
  );
}
