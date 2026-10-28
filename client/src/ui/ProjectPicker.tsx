import { useEffect, useMemo, useState } from 'react';
import { api, type FloorOptions } from '../api';
import { useStore } from '../store';
import type { GhRepoSummary, ProjectFolderView, RepoView } from '../../../shared/types';
import { confirmDialog } from './Confirm';

// Add a project to the office: one of your own folders, a GitHub repo, or something brand new.
// Used by the setup wizard and by the Floors tab of the manager's console.

type Mode = 'folder' | 'github' | 'new';

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

const VISIBILITY_LABELS: Record<string, string> = { private: 'privado', public: 'público', internal: 'interno' };

const sep = (p: string) => (p.includes('\\') ? '\\' : '/');

function FolderMode({ floor, onDone }: { floor: FloorOptions; onDone: (r: RepoView) => void }) {
  const projectsDir = useStore((s) => s.settings.projectsDir);
  const [dir, setDir] = useState(projectsDir);
  const [root, setRoot] = useState('');
  const [folders, setFolders] = useState<ProjectFolderView[] | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = (d?: string) => {
    setFolders(null);
    void attempt(() => api.folders(d)).then((res) => {
      setFolders(res?.folders ?? []);
      if (res) {
        setRoot(res.root);
        setDir(res.root);
      }
    });
  };
  useEffect(() => load(), []);

  const shown = useMemo(() => (folders ?? []).filter((f) => f.name.toLowerCase().includes(q.toLowerCase())), [folders, q]);
  const run = async (f: ProjectFolderView, fn: () => Promise<RepoView>) => {
    setBusy(f.path);
    const repo = await attempt(fn);
    setBusy(null);
    if (repo) onDone(repo);
    else load(root);
  };
  const publish = async (f: ProjectFolderView) => {
    const ok = await confirmDialog({
      icon: '🐙',
      title: `¿Subir ${f.name} a GitHub?`,
      body: (
        <>
          Esto crea un repositorio <b>privado</b> de GitHub llamado <code>{f.name}</code> y sube lo que ya tiene commit. Nada sin commit sale de tu ordenador.
          {!f.git && ' A una carpeta vacía se le añade antes un README inicial.'}
        </>
      ),
      confirm: 'Crear repositorio privado',
    });
    if (ok) void run(f, () => api.publishFolder({ path: f.path, visibility: 'private', ...floor }));
  };

  return (
    <div className="picker-mode">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          load(dir.trim() || undefined);
        }}
      >
        <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\Proyectos" title="Tu carpeta de proyectos" aria-label="Tu carpeta de proyectos" />
        <button className="btn btn-small">Buscar aquí</button>
      </form>
      {root && root !== projectsDir && (
        <div className="row small">
          <span className="muted grow">Los proyectos nuevos se crean en {projectsDir}.</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.updateSettings({ projectsDir: root }))}>
            Usar {root} en su lugar
          </button>
        </div>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar carpetas…" />
      <div className="repo-list folder-list">
        {folders === null && <div className="muted small">Buscando en {dir || 'tu carpeta de proyectos'}…</div>}
        {folders && shown.length === 0 && <div className="muted small">{q ? 'Ninguna carpeta coincide aquí' : 'No hay carpetas aquí'}.</div>}
        {shown.map((f) => (
          <div key={f.path} className="repo-row">
            <div style={{ minWidth: 0 }}>
              <b>📁 {f.name}</b>{' '}
              {f.floor != null ? (
                <span className="chip chip-good">planta {f.floor}</span>
              ) : f.github ? (
                <span className="chip">🐙 {f.github}</span>
              ) : (
                <span className="chip chip-warn">{f.git ? 'no está en GitHub' : 'aún sin git'}</span>
              )}
            </div>
            {f.floor != null ? (
              <span className="muted small">en la oficina</span>
            ) : f.github ? (
              <button className="btn btn-small btn-good" disabled={!!busy} onClick={() => run(f, () => api.connectFolder(f.path, floor))}>
                {busy === f.path ? 'Instalándose…' : 'Añadir planta'}
              </button>
            ) : (
              <button className="btn btn-small" disabled={!!busy} onClick={() => void publish(f)}>
                {busy === f.path ? 'Publicando…' : 'Publicar en GitHub'}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="muted small">
        La oficina nunca toca tu trabajo en curso: después de un merge solo hace fast-forward de tu carpeta cuando está en la rama por defecto sin cambios locales (y ejecuta npm install si cambiaron las dependencias). Cada agente trabaja en su propio worktree de git, fuera de tu proyecto (así tu servidor de desarrollo y tus linters nunca los ven).
      </p>
    </div>
  );
}

function GithubMode({ floor, onDone }: { floor: FloorOptions; onDone: (r: RepoView) => void }) {
  const repos = useStore((s) => s.repos);
  const projectsDir = useStore((s) => s.settings.projectsDir);
  const [list, setList] = useState<GhRepoSummary[] | null>(null);
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = (o?: string) => {
    setList(null);
    void attempt(() => api.githubRepos(o)).then((r) => setList(r ?? []));
  };
  useEffect(() => load(), []);
  const connected = new Set(repos.map((r) => r.id.toLowerCase()));
  const shown = (list ?? []).filter((r) => !connected.has(r.nameWithOwner.toLowerCase()) && r.nameWithOwner.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const connect = async (name: string) => {
    setBusy(name);
    const repo = await attempt(() => api.connectRepo(name, floor));
    setBusy(null);
    if (repo) onDone(repo);
  };
  return (
    <div className="picker-mode">
      <div className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar tus repositorios…" />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Organización (opcional)" style={{ maxWidth: 160 }} />
        <button className="btn btn-small" onClick={() => load(owner.trim() || undefined)}>
          Listar
        </button>
      </div>
      <div className="repo-list folder-list">
        {list === null && <div className="muted small">Pidiendo tus repositorios a GitHub…</div>}
        {list && shown.length === 0 && <div className="muted small">Ningún repositorio coincide.</div>}
        {shown.map((r) => (
          <div key={r.nameWithOwner} className="repo-row">
            <div style={{ minWidth: 0 }}>
              <b>{r.nameWithOwner}</b> <span className="chip">{VISIBILITY_LABELS[r.visibility.toLowerCase()] ?? r.visibility.toLowerCase()}</span>
              {r.description && <div className="muted small">{r.description}</div>}
            </div>
            <button className="btn btn-small btn-good" disabled={!!busy} onClick={() => connect(r.nameWithOwner)}>
              {busy === r.nameWithOwner ? 'Instalándose…' : 'Añadir planta'}
            </button>
          </div>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) void connect(manual.trim());
        }}
      >
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="…o escribe propietario/nombre" />
        <button className="btn btn-small" disabled={!manual.trim() || !!busy}>
          Añadir planta
        </button>
      </form>
      <p className="muted small">
        Si ya está en {projectsDir || 'tu carpeta de proyectos'}, se usa esa carpeta. Si no, se clona en {projectsDir}
        {sep(projectsDir)}&lt;nombre&gt;.
      </p>
    </div>
  );
}

function NewMode({ floor, onDone }: { floor: FloorOptions; onDone: (r: RepoView) => void }) {
  const projectsDir = useStore((s) => s.settings.projectsDir);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const slug = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  return (
    <form
      className="picker-mode"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!slug) return;
        setBusy(true);
        const repo = await attempt(() => api.createRepo({ name: slug, description, visibility, ...floor }));
        setBusy(false);
        if (repo) onDone(repo);
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del proyecto, p. ej. panaderia-isla" autoFocus />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción de una línea (opcional)" />
      <div className="row">
        <label className="toggle">
          <input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Privado
        </label>
        <label className="toggle">
          <input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Público
        </label>
        <span className="spacer" />
        <button className="btn btn-good" disabled={busy || !slug}>
          {busy ? 'Creando…' : 'Crear proyecto'}
        </button>
      </div>
      <p className="muted small">
        Crea <code>{slug ? `${projectsDir}${sep(projectsDir)}${slug}` : `${projectsDir}${sep(projectsDir)}…`}</code> con un README y lo sube a un repositorio {visibility === 'private' ? 'privado' : 'público'} nuevo de GitHub. Dale un brief al CEO abajo y
        planificará el primer hito.
      </p>
    </form>
  );
}

export function ProjectPicker({ onConnected, initial = 'folder' }: { onConnected?: (repo: RepoView) => void; initial?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [mission, setMission] = useState('');
  const [autoAssign, setAutoAssign] = useState(true);
  const floor: FloorOptions = { mission, autoAssign };
  const done = (repo: RepoView) => {
    setMission('');
    onConnected?.(repo);
  };
  const modes: [Mode, string][] = [
    ['folder', '📁 Una carpeta de este ordenador'],
    ['github', '🐙 Un repositorio de GitHub'],
    ['new', '✨ Algo nuevo'],
  ];
  return (
    <div className="picker">
      <div className="picker-tabs">
        {modes.map(([k, label]) => (
          <button key={k} className={`picker-tab ${mode === k ? 'picker-tab-on' : ''}`} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={mission}
        onChange={(e) => setMission(e.target.value)}
        rows={2}
        placeholder={mode === 'new' ? '¿Qué debería construir el equipo? P. ej., un juego 3D acogedor para el navegador en el que llevas una pequeña panadería en una isla.' : 'Brief para el CEO (opcional): ¿en qué debería trabajar el equipo ahora?'}
      />
      <label className="toggle small">
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
        ⚡ Empezar a trabajar automáticamente: los agentes libres cogen los issues en cuanto se crean (puedes desactivarlo en cada planta)
      </label>
      {mode === 'folder' && <FolderMode floor={floor} onDone={done} />}
      {mode === 'github' && <GithubMode floor={floor} onDone={done} />}
      {mode === 'new' && <NewMode floor={floor} onDone={done} />}
    </div>
  );
}
