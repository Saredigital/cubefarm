// Careers (#226) in the panels: an agent's career card (initials, rank, badges, stats, last merged PRs and what they're
// known for) and the Team tab's table.
import { useState } from 'react';
import { avgFixRounds, knownFor, mergesThisWeek, passRate, rank, tenureDays, type CareerView } from '../../../shared/careers';
import { useStore, type Agent } from '../store';

const LAST = 5;

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
export const fixed1 = (x: number | null) => (x === null ? '—' : x.toFixed(1));

/** "3 days", "5 hours", "12 minutes" on the team. */
export function tenureText(c: CareerView, now: number) {
  const d = tenureDays(c, now);
  if (d >= 1) return `${Math.floor(d)} día${Math.floor(d) === 1 ? '' : 's'}`;
  const h = d * 24;
  if (h >= 1) return `${Math.floor(h)} hora${Math.floor(h) === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.round(h * 60));
  return `${m} minuto${m === 1 ? '' : 's'}`;
}

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return m <= 1 ? 'ahora mismo' : `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Their initials on their shirt color. */
function Portrait({ agent, size }: { agent: Agent; size: number }) {
  const letters = agent.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span
      className="career-portrait"
      role="img"
      aria-label={agent.name}
      style={{ width: size, height: size, borderRadius: '50%', background: agent.color, color: '#fff', display: 'inline-grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.38 }}
    >
      {letters}
    </span>
  );
}

function Stat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div className="career-stat" title={title}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function CareerCard({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === agent.repoId));
  const now = Date.now();
  const c = agent.career;
  if (!c) return <div className="career-card muted small">{agent.name} dirige la empresa; su historial es toda la oficina.</div>;
  return (
    <div className={`career-card ${compact ? 'career-compact' : ''}`} style={{ ['--accent' as string]: agent.color }}>
      <div className="career-head">
        <Portrait agent={agent} size={compact ? 44 : 88} />
        <div className="career-who">
          <div className="career-name">{agent.name}</div>
          <div className="career-title">
            {rank(c)}
            {repo ? ` · planta ${repo.floor}` : ''}
          </div>
          {c.firstPass >= 10 && (
            <div className="career-badges">
              <span className="career-badge career-star">⭐ 10 aprobados a la primera</span>
            </div>
          )}
          <div className="career-known">“{knownFor(c)}”</div>
        </div>
      </div>
      <div className="career-stats">
        <Stat label="PRs fusionadas" value={c.merged} />
        <Stat label="PRs abiertas" value={c.opened} />
        <Stat label="QA a la primera" value={c.firstPass} title="PRs que pasaron QA en su primera ronda" />
        <Stat label="tasa de QA superado" value={pct(passRate(c))} title={`${c.qaPass} de ${c.qaPass + c.qaFail} rondas de QA de sus PRs superadas`} />
        <Stat label="rondas de corrección / PR" value={fixed1(avgFixRounds(c))} />
        <Stat label="revisiones de QA" value={c.reviews} />
        <Stat label="mejor racha" value={c.best} title="PRs seguidas que pasaron QA a la primera" />
        <Stat label="en el equipo" value={tenureText(c, now)} />
        {!compact && <Stat label="coste est." value={`$${c.costUsd.toFixed(2)}`} title="Lo que informan los agentes de código, equivalente en API; el uso con suscripción se factura según el plan" />}
        {!compact && <Stat label="turnos" value={c.turns} />}
      </div>
      {c.recent.length > 0 && (
        <div className="career-recent">
          {!compact && <div className="muted small">Últimas fusionadas</div>}
          {c.recent.slice(0, compact ? 1 : LAST).map((r) => (
            <div key={r.n} className="career-pr">
              {compact && <span className="muted">Última fusionada </span>}
              {repo ? (
                <a href={`https://github.com/${repo.fullName}/pull/${r.n}`} target="_blank" rel="noreferrer">
                  #{r.n}
                </a>
              ) : (
                <b>#{r.n}</b>
              )}{' '}
              <span className="career-pr-title">{r.title || 'sin título'}</span> <span className="muted">{ago(r.at, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- the Team tab ----------

type Col = { key: string; label: string; title?: string; value: (a: Agent, c: CareerView, now: number) => number | string; show?: (a: Agent, c: CareerView, now: number) => string };

const COLS: Col[] = [
  { key: 'merged', label: 'Fusionadas', value: (_a, c) => c.merged },
  { key: 'opened', label: 'Abiertas', value: (_a, c) => c.opened },
  { key: 'firstPass', label: 'QA a la 1.ª', title: 'PRs que pasaron QA en su primera ronda', value: (_a, c) => c.firstPass },
  { key: 'rate', label: 'Tasa de éxito', value: (_a, c) => passRate(c) ?? -1, show: (_a, c) => pct(passRate(c)) },
  { key: 'fixes', label: 'Correcciones / PR', title: 'Rondas de corrección por PR fusionada', value: (_a, c) => avgFixRounds(c) ?? -1, show: (_a, c) => fixed1(avgFixRounds(c)) },
  { key: 'reviews', label: 'Revisiones', title: 'Revisiones de QA hechas', value: (_a, c) => c.reviews },
  { key: 'best', label: 'Racha', title: 'Mayor racha de PRs que pasaron QA a la primera', value: (_a, c) => c.best },
  { key: 'week', label: 'Esta semana', value: (_a, c, now) => mergesThisWeek(c, now) },
  { key: 'since', label: 'En el equipo', value: (_a, c) => -c.since, show: (_a, c, now) => tenureText(c, now) },
  { key: 'cost', label: 'Coste', title: 'Estimado, según lo informan los agentes de código', value: (_a, c) => c.costUsd, show: (_a, c) => `$${c.costUsd.toFixed(2)}` },
  { key: 'turns', label: 'Turnos', value: (_a, c) => c.turns },
];

/** Everyone's stats in one sortable table (click a heading; again to flip it). */
export function TeamStats() {
  const agents = useStore((s) => s.agents);
  const repos = useStore((s) => s.repos);
  const openOverlay = useStore((s) => s.openOverlay);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'merged', dir: -1 });
  const now = Date.now();
  const col = COLS.find((c) => c.key === sort.key);
  const floor = (a: Agent) => repos.find((r) => r.id === a.repoId)?.floor ?? 0;
  const rows = Object.values(agents)
    .filter((a): a is Agent & { career: CareerView } => a.role !== 'ceo' && !!a.career)
    .sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
      if (sort.key === 'floor') return (floor(a) - floor(b)) * sort.dir;
      const va = col!.value(a, a.career, now);
      const vb = col!.value(b, b.career, now);
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return d * sort.dir || a.name.localeCompare(b.name);
    });
  if (!rows.length) return null;
  const head = (key: string, label: string, title?: string) => (
    <th key={key} title={title} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-btn" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'name' || key === 'floor' ? 1 : -1 })}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  return (
    <div className="card team-stats">
      <div className="row">
        <b className="grow">🏅 Trayectorias</b>
        <span className="muted small">Contado a partir de lo que ve la oficina: PRs, rondas de QA, correcciones y merges.</span>
      </div>
      <div className="team-stats-scroll">
        <table className="team stats-table">
          <thead>
            <tr>
              {head('name', 'Nombre')}
              {head('floor', 'Planta')}
              {COLS.map((c) => head(c.key, c.label, c.title))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">
                  <span className="dot" style={{ background: a.color }} />{' '}
                  <button className="link-btn" title="Abrir su puesto" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                    {a.name}
                  </button>
                </td>
                <td>{repos.find((r) => r.id === a.repoId)?.floor ?? '—'}</td>
                {COLS.map((c) => (
                  <td key={c.key} className="num">
                    {c.show ? c.show(a, a.career, now) : c.value(a, a.career, now)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
