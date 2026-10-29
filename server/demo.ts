import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Backend } from './backend.ts';
import type { PreviewBackend } from './previewRunner.ts';
import { describeOfficeTool, type LogEntry, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { CLIS } from './clis.ts';
import { FLOOR_SEATS, type GhRepoSummary, type IssueInfo, type PullInfo } from '../shared/types.ts';
import type { LocalFolder } from './workspace.ts';
import { HOME_DIR, type DemoScale } from './config.ts';
import { DAY_MS, emptyHistory, HOUR_MS, prune, startOfDay, type OpsHistory } from './metrics.ts';
import { takeLastUpdate, underLauncher, type OfficeHost } from './officeUpdate.ts';
import type { UsageWarning } from './pacing.ts';
import { VoiceApiError, type VoiceApi } from './voice.ts';
import type { NotifyTransport } from './notifier.ts';
import { CloudError, type BoxApi, type BoxInfo } from './box.ts';
import type { CloudBackend } from './backend.ts';
import type { BoxSignIn } from './cliRunner.ts';
import type { AgentTerminal } from './terminal.ts';

// `npm run demo`: a fake GitHub and fake Claude Code sessions, so the office (including the
// build → QA → fix loop) can be explored without spending any usage or touching real repos.

interface FakeRepo {
  fullName: string;
  description: string;
  issues: IssueInfo[];
  pulls: PullInfo[];
  nextNumber: number;
}

const now = () => new Date().toISOString();

function issue(n: number, title: string, body: string, fullName: string, labels: string[] = []): IssueInfo {
  return { number: n, title, body, url: `https://github.com/${fullName}/issues/${n}`, labels, createdAt: now() };
}

const repos = new Map<string, FakeRepo>();
/** Repos made in the demo (new projects, published folders): empty, so no package.json for the preview to fall back on. */
const bareRepos = new Set<string>();
const mergedSinceSync = new Map<string, number>(); // merges the fake project folder hasn't pulled yet
const closedIssues = new Set<string>(); // `${fullName}#${n}`: issues closed by a merge
const stalls = new Map<string, () => void>(); // agent id -> silences their running fake session (the office doctor's demo)
const signOuts = new Map<string, { boxId: string; end: () => void }>(); // agent id -> ends their cloud session as an expired sign-in would

const fakeSha = () => crypto.randomBytes(20).toString('hex');

// GitHub never gives two PRs the same number, and the office's ledger (coins, careers) counts each PR once by it, so
// the fake's numbers carry on across restarts (the issues and PRs themselves start over).
const NUMBERS_FILE = path.join(HOME_DIR, 'demo-github.json');

function restoreNumbers() {
  try {
    const saved = JSON.parse(fs.readFileSync(NUMBERS_FILE, 'utf8')) as Record<string, number>;
    for (const r of repos.values()) if (Number.isInteger(saved[r.fullName])) r.nextNumber = Math.max(r.nextNumber, saved[r.fullName]);
  } catch {
    // first run
  }
}

/** The repo's next issue or PR number, remembered for the next start. */
function takeNumber(r: FakeRepo) {
  const n = r.nextNumber++;
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.writeFileSync(`${NUMBERS_FILE}.tmp`, JSON.stringify(Object.fromEntries([...repos.values()].map((x) => [x.fullName, x.nextNumber]))));
    fs.renameSync(`${NUMBERS_FILE}.tmp`, NUMBERS_FILE);
  } catch (err) {
    console.warn('could not save the demo PR numbers', err);
  }
  return n;
}

/**
 * An issue or PR number the fake GitHub handed out before the office restarted: it starts over on every start (only
 * its numbers carry on), so what it forgot was closed while the office was down, as far as the office can tell.
 */
function forgotten(fullName: string, n: number) {
  const r = repos.get(fullName);
  return !!r && n > 0 && n < r.nextNumber && !r.issues.some((i) => i.number === n) && !r.pulls.some((p) => p.number === n);
}

let runSeq = 1000; // fake Actions run ids, so the office can re-run a failed one
/**
 * Fake CI: checks run for a while after every push, and now and then one fails so the fix loop shows. They say they
 * took a few minutes, like real CI, though the demo doesn't make you wait that long.
 */
function runChecks(pr: PullInfo, fail = Math.random() < 0.2) {
  Object.assign(pr, { checks: 'pending', pendingChecks: ['CI / build', 'Vercel'], failedChecks: [], checkRun: null });
  setTimeout(() => {
    Object.assign(pr, {
      checks: fail ? 'failing' : 'passing',
      pendingChecks: [],
      failedChecks: fail ? [{ name: 'CI / build', url: `${pr.url.replace(/\/pull\/\d+$/, '')}/actions/runs/${++runSeq}/job/1` }] : [],
      checkRun: { ms: Math.round((2.5 + Math.random() * 5) * 60_000), doneAt: Date.now() },
    });
  }, 12_000 + Math.random() * 10_000);
}

function seed(fullName: string, description: string, titles: [string, string][]) {
  const r: FakeRepo = { fullName, description, issues: [], pulls: [], nextNumber: 1 };
  for (const [title, body] of titles) r.issues.push(issue(r.nextNumber++, title, body, fullName));
  repos.set(fullName, r);
}

seed('demo-co/pixel-todo', 'Una alegre app de tareas', [
  ['Añadir un interruptor de modo oscuro', 'Los usuarios quieren un tema oscuro. Guarda la elección en localStorage.'],
  ['Las tareas deberían admitir fechas límite', 'Añade una fecha límite opcional y resalta las tareas vencidas.'],
  ['Arrastrar y soltar para reordenar', 'Deja que los usuarios reordenen las tareas arrastrándolas.'],
  ['Ilustración para la lista vacía', 'Muestra una ilustración amable cuando la lista esté vacía.'],
  ['Atajos de teclado', 'N para una tarea nueva, / para buscar, ? para la ayuda.'],
  ['Corregir: el contador de completadas va uno por encima', 'El pie muestra una tarea completada más de las que hay.'],
]);
seed('demo-co/weather-api', 'Pequeña API REST del tiempo', [
  ['Añadir el endpoint /forecast', 'Devuelve la previsión de 5 días de una ciudad.'],
  ['Limitar las llamadas anónimas', '60 peticiones por minuto por IP.'],
  ['Especificación OpenAPI', 'Publica un documento OpenAPI 3.1 en /openapi.json.'],
]);

// ---------- the big company (--floors / --agents, #228) ----------

const PRODUCTS: [string, string][] = [
  ['pixel-todo', 'Una alegre app de tareas'],
  ['weather-api', 'Pequeña API REST del tiempo'],
  ['recipe-box', 'Recetas con lista de la compra'],
  ['budget-buddy', 'Presupuestos y facturas personales'],
  ['chat-lite', 'Un pequeño chat de equipo'],
  ['photo-wall', 'Álbumes de fotos compartidos'],
  ['fit-log', 'Entrenamientos y rachas'],
  ['book-club', 'Listas de lectura entre amigos'],
  ['trip-planner', 'Itinerarios y listas de equipaje'],
  ['beat-maker', 'Una caja de ritmos en el navegador'],
  ['garden-diary', 'Qué plantar y cuándo'],
  ['habit-hero', 'Hábitos diarios, con seguimiento amable'],
  ['invoice-flow', 'Facturas para autónomos'],
  ['pet-pals', 'Visitas al veterinario y paseos'],
  ['study-cards', 'Tarjetas de estudio con repetición espaciada'],
  ['parking-spot', 'Encuentra y comparte aparcamiento'],
  ['meal-prep', 'Menús semanales'],
  ['job-board', 'Un pequeño portal de empleo'],
  ['event-hub', 'Quedadas y confirmaciones de asistencia'],
  ['link-short', 'Un acortador de enlaces con estadísticas'],
];

const FEATURES = [
  'Añadir modo oscuro', 'Búsqueda con filtros', 'Exportar a CSV', 'Atajos de teclado', 'Funcionar sin conexión', 'Deshacer y rehacer',
  'Recordatorios por correo', 'Arrastrar y soltar para reordenar', 'Compartir enlaces', 'Fotos de perfil', 'Paginar las listas largas', 'Limitar las peticiones',
  'Un registro de auditoría', 'Inicio de sesión en dos pasos', 'Edición masiva', 'Etiquetas y colores', 'Un feed de actividad', 'Traducciones',
  'Repaso de accesibilidad', 'Estados vacíos amables', 'Esqueletos de carga', 'Arreglar el test de fechas inestable', 'Acelerar la build',
  'Mensajes de error más claros',
];

/** The big company's floors: `floors` products, each with a long backlog (topped up as it shrinks, see listIssues). */
function seedBigCompany(floors: number) {
  repos.clear();
  for (let f = 0; f < floors; f++) {
    const [name, description] = PRODUCTS[f] ?? [`project-${f + 1}`, `Proyecto número ${f + 1}`];
    seed(`demo-co/${name}`, description, []);
    topUp(repos.get(`demo-co/${name}`)!, 30);
  }
}

/** Files new issues until the repo has `open` of them, so a big floor's agents always have something to pick up. */
function topUp(r: FakeRepo, open: number) {
  while (r.issues.length < open) {
    const n = r.nextNumber++;
    const feature = FEATURES[n % FEATURES.length];
    const title = n > FEATURES.length ? `${feature} (parte ${Math.ceil(n / FEATURES.length)})` : feature;
    r.issues.push(issue(n, title, `Los usuarios de ${r.fullName.split('/')[1]} lo han pedido: ${feature.toLowerCase()}.`, r.fullName));
  }
}

/** How many agents each demo floor starts with: six on floor 1 and four on the others, or a big company's `agents`. */
export function demoTeam(scale: DemoScale | null, floor: number): number {
  if (!scale) return floor === 1 ? 6 : 4;
  return Math.max(1, Math.min(FLOOR_SEATS, scale.agents));
}

function screenshotSvg(title: string, url: string, hue: number) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect width="640" height="400" fill="hsl(${hue},60%,97%)"/>
  <rect width="640" height="56" fill="hsl(${hue},70%,55%)"/>
  <text x="24" y="37" font-family="Segoe UI, Arial" font-size="22" font-weight="700" fill="#fff">${safe(title)}</text>
  <text x="620" y="36" text-anchor="end" font-family="Segoe UI, Arial" font-size="13" fill="#fff">${safe(url)}</text>
  ${[0, 1, 2, 3]
    .map(
      (i) => `<rect x="24" y="${84 + i * 70}" width="592" height="56" rx="10" fill="#fff" stroke="hsl(${hue},40%,85%)"/>
  <circle cx="54" cy="${112 + i * 70}" r="11" fill="none" stroke="hsl(${hue},60%,55%)" stroke-width="3"/>
  <rect x="80" y="${104 + i * 70}" width="${180 + ((i * 97) % 220)}" height="14" rx="7" fill="hsl(${hue},25%,80%)"/>`,
    )
    .join('\n')}
</svg>`;
}

type Step = LogEntry[] | (() => void);

function analysisScript(title: string): Step[] {
  return [
    [{ kind: 'text', text: `● Analizo "${title}": primero cómo está hecho hoy.` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ 23 ficheros encontrados' }],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ 6 coincidencias en 4 ficheros' }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/api/routes.ts' }, { kind: 'result', text: '  ⎿ 142 líneas leídas' }],
    [{ kind: 'thinking', text: '✻ Comparo dos enfoques…' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git log --oneline -- src/api' }, { kind: 'result', text: '  ⎿ 12 commits' }],
    [{ kind: 'text', text: '● Tengo lo que necesito. Redacto el informe.' }],
  ];
}

/** The demo analyst's report, in the shape the analysis prompt asks for. */
function analysisReport(title: string) {
  return [
    `# ${title}`,
    '',
    '**Resumen.** Se puede hacer sin cambiar la API pública: el estado vive en un único hook (`useTodos`) y las rutas ya validan la entrada. La opción recomendada cuesta unos dos días.',
    '',
    '## Hallazgos',
    '- `src/hooks/useTodos.ts` concentra el estado y lo usan 4 componentes.',
    '- `src/api/routes.ts` no pagina: con más de 500 tareas la lista tarda en cargar.',
    '- No hay tests de la API; los del cliente cubren el filtrado.',
    '',
    '## Opciones',
    '1. **Ampliar el hook** (recomendada): poco riesgo, ~2 días.',
    '2. **Mover el estado a un store global**: más flexible, pero toca todos los componentes (~5 días).',
    '',
    '## Issues propuestos',
    '- Paginar `GET /api/todos`.',
    '- Añadir tests de la API.',
    '- Ampliar `useTodos` con la funcionalidad nueva.',
  ].join('\n');
}

function issueScript(opts: SessionOptions, cb: SessionCallbacks, issueNumber: number, issueTitle: string): Step[] {
  const branch = path.basename(opts.cwd);
  const hue = (issueNumber * 67) % 360;
  const file = ['src/App.tsx', 'src/components/TodoList.tsx', 'src/api/routes.ts', 'src/styles.css'][issueNumber % 4];
  const port = 5200 + (issueNumber % 50);
  return [
    [{ kind: 'text', text: `● Empiezo familiarizándome con el código para "${issueTitle}".` }],
    [{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*.{ts,tsx}' }, { kind: 'result', text: '  ⎿ 23 ficheros encontrados' }],
    [{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: '  ⎿ 184 líneas leídas' }],
    [{ kind: 'thinking', text: '✻ Pensando…' }],
    [
      { kind: 'tool', tool: 'TodoWrite', text: '⏺ Actualizar la lista de tareas' },
      { kind: 'result', text: '  ◐ Entender el comportamiento actual' },
      { kind: 'result', text: '  ☐ Implementar el cambio' },
      { kind: 'result', text: '  ☐ Añadir tests' },
      { kind: 'result', text: '  ☐ Comprobarlo en el navegador' },
    ],
    [{ kind: 'tool', tool: 'Grep', text: '⏺ Grep "useTodos"' }, { kind: 'result', text: '  ⎿ 6 coincidencias en 4 ficheros' }],
    [{ kind: 'text', text: '● El estado vive en un único hook. Lo amplío y mantengo la API retrocompatible.' }],
    [{ kind: 'tool', tool: 'Edit', text: `⏺ Edit ${file}` }, { kind: 'result', text: '  ⎿ Actualizado' }],
    [{ kind: 'tool', tool: 'Write', text: '⏺ Write src/__tests__/feature.test.ts' }, { kind: 'result', text: '  ⎿ Guardado' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }],
    [
      { kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' },
      { kind: 'result', text: '    Test Files  7 passed (7)' },
    ],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run typecheck' }, { kind: 'result', text: '  ⎿ (no output)' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run dev -- --port ${port} &` }, { kind: 'result', text: '  ⎿ VITE ready in 412 ms' }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(issueTitle, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Captura de la página actual guardada' }],
    [{ kind: 'text', text: '● En el navegador se ve bien. Una build de producción y luego la PR.' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.62s' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ git commit -am "feat: ${issueTitle.toLowerCase()}"` }, { kind: 'result', text: `  ⎿ [${branch} 3f2a91c] feat: ${issueTitle.toLowerCase()}` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git push -u origin HEAD' }, { kind: 'result', text: '  ⎿ branch set up to track origin' }],
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr create --title "${issueTitle}" --body "Closes #${issueNumber}"` }],
  ];
}

function qaScript(cb: SessionCallbacks, pr: number, title: string, round: number, checks: string): Step[] {
  const port = 5600 + (pr % 50);
  const hue = (pr * 41) % 360;
  // With GitHub checks on the PR, QA reads what they cover instead of re-running the suite.
  const verify: Step[] = /: (?:none|ninguno)$/.test(checks)
    ? [
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm test -- --run' }],
        [
          { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' },
          { kind: 'result', text: '    Tests  41 passed (41)' },
        ],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm run lint && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ]
    : [
        [{ kind: 'tool', tool: 'Read', text: '⏺ Read .github/workflows/ci.yml' }, { kind: 'result', text: '  ⎿ 41 líneas leídas' }],
        [{ kind: 'text', text: '● La CI ya ejecuta los tests, el lint y la build, así que solo necesito una build para arrancar la app.' }],
        [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm ci && npm run build' }, { kind: 'result', text: '  ⎿ ✓ built in 1.84s' }],
      ];
  return [
    [{ kind: 'text', text: `● Probando la PR #${pr} "${title}" (ronda ${round}). ${checks}. Primero, los criterios de aceptación del issue.` }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git diff origin/main...HEAD --stat' }, { kind: 'result', text: '  ⎿  3 files changed, 82 insertions(+), 9 deletions(-)' }],
    ...verify,
    [{ kind: 'tool', tool: 'Bash', text: `⏺ $ npm run preview -- --port ${port} &` }, { kind: 'result', text: `  ⎿ Local: http://localhost:${port}/` }],
    () => cb.browserUrl(`http://localhost:${port}/`),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_navigate', text: `⏺ 🌐 navigate http://localhost:${port}/` }, { kind: 'result', text: `  ⎿ Page URL: http://localhost:${port}/` }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · ${title}`, `localhost:${port}`, hue)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Captura de la página actual guardada' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_click', text: '⏺ 🌐 click "Añadir tarea"' }, { kind: 'result', text: '  ⎿ Clic realizado' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_resize', text: '⏺ 🌐 resize 375x740' }, { kind: 'result', text: '  ⎿ Resized' }],
    () => cb.screenshot(Buffer.from(screenshotSvg(`QA · móvil · ${title}`, `localhost:${port}`, (hue + 40) % 360)), 'image/svg+xml'),
    [{ kind: 'tool', tool: 'mcp__playwright__browser_take_screenshot', text: '⏺ 🌐 take_screenshot' }, { kind: 'result', text: '  ⎿ Captura de la página actual guardada' }],
    [{ kind: 'tool', tool: 'mcp__playwright__browser_console_messages', text: '⏺ 🌐 console_messages' }, { kind: 'result', text: '  ⎿ Sin errores' }],
  ];
}

function fixScript(pr: number, pushes: boolean, nudged: boolean): Step[] {
  if (nudged) {
    return [
      [{ kind: 'text', text: `● Compruebo si la PR #${pr} todavía necesita un cambio.` }],
      pushes
        ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: la barra de herramientas salta de línea en pantallas estrechas" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
        : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git fetch origin && git diff origin/main --stat -- src/styles.css' }, { kind: 'result', text: '  ⎿ (no differences)' }],
    ];
  }
  return [
    [{ kind: 'text', text: `● Leo el informe de QA de la PR #${pr}. La barra de herramientas se desborda en el móvil; haré que salte de línea.` }],
    [{ kind: 'tool', tool: 'Read', text: '⏺ Read src/styles.css' }, { kind: 'result', text: '  ⎿ 212 líneas leídas' }],
    [{ kind: 'tool', tool: 'Edit', text: '⏺ Edit src/styles.css' }, { kind: 'result', text: '  ⎿ Actualizado' }],
    [{ kind: 'tool', tool: 'Bash', text: '⏺ $ npm test -- --run' }, { kind: 'result', text: '  ⎿ Test Files  8 passed (8)' }],
    pushes
      ? [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix: la barra de herramientas salta de línea en pantallas estrechas" && git push origin HEAD' }, { kind: 'result', text: '  ⎿ pushed' }]
      : [{ kind: 'tool', tool: 'Bash', text: '⏺ $ git status --short' }, { kind: 'result', text: '  ⎿  M src/styles.css' }],
    ...(pushes ? [[{ kind: 'tool', tool: 'Bash', text: `⏺ $ gh pr checks ${pr} --watch` }, { kind: 'result', text: '  ⎿ All checks were successful' }] as LogEntry[]] : []),
  ];
}

/** The PR a fix prompt is about ("QA passed pull request #6…", "Pull request #6 (url) conflicts…"), and its title if given. */
export function fixPromptPull(prompt: string): { number: number; title?: string } {
  const m = prompt.match(/pull request #(\d+)(?::\s*(.+))?/i);
  return { number: Number(m?.[1] ?? 0), title: m?.[2]?.trim() };
}

function fakeSession(opts: SessionOptions, cb: SessionCallbacks, fullName: string): SessionHandle {
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let stalled = false; // stuck: no more output, and messages go unanswered
  if (opts.agentId) {
    stalls.set(opts.agentId, () => {
      stalled = true;
      timers.forEach(clearTimeout);
    });
  }
  // A cloud agent's session ends the way an expired login ends a real one when the fake account expires sign-ins.
  const signOut = opts.box && opts.agentId ? { boxId: opts.box.boxId, end: () => expired() } : null;
  if (signOut) signOuts.set(opts.agentId!, signOut);
  const forgetSignOut = () => {
    if (signOut && signOuts.get(opts.agentId!) === signOut) signOuts.delete(opts.agentId!);
  };
  const nudged = /^(?:You pushed nothing|No has subido nada)/.test(opts.prompt); // the office's nudge after a fix that pushed nothing
  const resumedFix = opts.resumeSessionId?.startsWith('demo-fix-') ?? false;
  // The task picks the script; a session started without one (a follow-up) is read from its prompt.
  const fixPrompt = !opts.task && /FAILED|taking over pull request|git push origin HEAD:/.test(opts.prompt);
  const kind = opts.task === 'qa' ? 'qa' : opts.task === 'analysis' ? 'analysis' : opts.task === 'fix' || nudged || resumedFix || fixPrompt ? 'fix' : 'issue';
  // Fix sessions can be resumed (the office's nudge), like real ones.
  if (kind === 'fix') cb.sessionId(opts.resumeSessionId ?? `demo-fix-${crypto.randomUUID()}`);
  const pull = fixPromptPull(opts.prompt);
  const issueMatch = opts.prompt.match(/#(\d+):\s*(.+)/);
  const fromIssue = kind === 'issue' || kind === 'analysis';
  const number = fromIssue ? Number(issueMatch?.[1] ?? 0) : pull.number;
  const title = (fromIssue ? issueMatch?.[2]?.trim() : pull.title) ?? 'follow-up';
  const round = Number(opts.prompt.match(/(?:QA round|[Rr]onda de QA) (\d+)/)?.[1] ?? 1);
  // Now and then a QA fix ends without pushing, so the office's nudge can be seen; half the nudged answer NO CHANGE NEEDED.
  const pushes = kind !== 'fix' || !(nudged || /FAILED|taking over pull request/.test(opts.prompt)) || Math.random() > (nudged ? 0.5 : 0.25);

  const header: Step = [
    { kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort` },
    { kind: 'system', text: `  cwd ${opts.cwd}` },
  ];
  const checks = opts.prompt.match(/^(?:GitHub checks right now|Checks de GitHub ahora mismo): .*$/m)?.[0] ?? 'Checks de GitHub ahora mismo: ninguno';
  const body = kind === 'qa' ? qaScript(cb, number, title, round, checks) : kind === 'fix' ? fixScript(number, pushes, nudged) : kind === 'analysis' ? analysisScript(title) : issueScript(opts, cb, number, title);
  const script = [header, ...body];

  const expired = () => {
    if (stopped) return;
    stopped = true;
    forgetSignOut();
    timers.forEach(clearTimeout);
    cb.tool(null);
    cb.log([{ kind: 'error', text: 'API Error: 401 · Login expired · Please run /login (demo)' }]);
    const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
    cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: [`${name} se ha detenido: ha fallado la autenticación`], signedOut: true });
  };

  const finish = () => {
    forgetSignOut();
    const costUsd = 0.3 + Math.random();
    const turns = 15 + Math.floor(Math.random() * 20);
    cb.tool(null);
    if (kind === 'qa') {
      // Most first rounds pass; some fail so the fix loop can be seen in action.
      const pass = round > 1 || Math.random() > 0.35;
      cb.log([{ kind: 'text', text: pass ? '● Todo cuadra. Redacto el informe.' : '● La barra de herramientas se desborda en una pantalla de 375px. Suspendo esta ronda.' }]);
      cb.finished({
        ok: true,
        text: '',
        costUsd,
        turns,
        errors: [],
        structured: {
          verdict: pass ? 'pass' : 'fail',
          summary: pass
            ? 'El cambio hace lo que pide el issue: la funcionalidad va bien en escritorio y en móvil, pasan los 41 tests, y el lint y la build están limpios.'
            : 'La funcionalidad va bien en escritorio, pero en una pantalla de 375px de ancho la barra de herramientas se desborda y el botón nuevo queda cortado.',
          checks: [
            { name: 'Tests unitarios', result: 'pass', details: '41 pasados, 0 fallidos' },
            { name: 'Lint + build', result: 'pass', details: 'Sin errores de lint; la build de producción funciona' },
            { name: 'Funciona en escritorio', result: 'pass', details: 'Recorrido el flujo nuevo a 1280x800' },
            { name: 'Diseño móvil (375px)', result: pass ? 'pass' : 'fail', details: pass ? 'El diseño salta de línea correctamente' : 'La barra se desborda en horizontal; no se llega al botón' },
            { name: 'Errores de consola', result: 'pass', details: 'Ninguno' },
          ],
          commands: [
            { command: 'npm test -- --run', result: '41 pasados' },
            { command: 'npm run lint && npm run build', result: 'limpio, build en 1.84s' },
          ],
          screenshots: ['Vista de escritorio tras el cambio', 'Vista móvil a 375px'],
          fixInstructions: pass ? undefined : 'Haz que la barra de herramientas salte de línea (flex-wrap: wrap) por debajo de 480px para que todos los botones sigan visibles.',
        },
      });
      return;
    }
    if (kind === 'analysis') {
      const text = analysisReport(title);
      cb.log([{ kind: 'text', text: '● Informe listo.' }]);
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    if (kind === 'fix') {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr && pushes) {
        pr.headSha = fakeSha();
        pr.mergeState = 'CLEAN';
        pr.mergeable = 'MERGEABLE';
        runChecks(pr, false);
      }
      const text = pushes
        ? `● PR #${number} corregida y subida. Lista para otra ronda de QA.`
        : nudged
          ? 'NO CHANGE NEEDED: main ya hace que la barra de herramientas salte de línea, así que la PR está bien como está.'
          : '● La barra de herramientas ya salta de línea en pantallas estrechas. Lista para otra ronda de QA.';
      cb.log([{ kind: 'text', text }]);
      cb.finished({ ok: true, text, costUsd, turns, errors: [] });
      return;
    }
    const repo = repos.get(fullName);
    let url = '';
    if (repo && number) {
      const n = takeNumber(repo);
      url = `https://github.com/${fullName}/pull/${n}`;
      repo.pulls.unshift({
        number: n,
        title,
        url,
        headRefName: `swarm/issue-${number}-${path.basename(opts.cwd).replace(/-[0-9a-f]{4}$/, '')}`,
        state: 'OPEN',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: null,
        closesIssues: [number],
        createdAt: now(),
        mergedAt: null,
        additions: 40 + ((number * 13) % 200),
        deletions: (number * 7) % 40,
        checks: 'pending',
        headSha: fakeSha(),
        mergeState: 'CLEAN',
        failedChecks: [],
        pendingChecks: [],
      });
      runChecks(repo.pulls[0]);
      cb.log([{ kind: 'result', text: `  ⎿ ${url}` }]);
    }
    cb.log([{ kind: 'text', text: `● He abierto ${url || 'la pull request'}. Cierra el #${number} e incluye tests.` }]);
    cb.finished({ ok: true, text: url, costUsd, turns, errors: [] });
  };

  let i = 0;
  const step = () => {
    if (stopped || stalled) return;
    if (i >= script.length) {
      if (opts.agentId) stalls.delete(opts.agentId);
      return finish();
    }
    const s = script[i++];
    if (typeof s === 'function') s();
    else {
      const tool = s.find((e) => e.kind === 'tool');
      cb.tool(tool?.tool ?? null);
      cb.log(s);
    }
    timers.push(setTimeout(step, 1600 + Math.random() * 3800));
  };
  timers.push(setTimeout(step, 600));

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || stalled) return;
          cb.log([{ kind: 'text', text: `● Entendido: "${text.slice(0, 60)}". Ajusto el enfoque.` }]);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      forgetSignOut();
      if (opts.agentId) stalls.delete(opts.agentId);
      timers.forEach(clearTimeout);
      cb.finished({ ok: false, text: '', costUsd: 0.1, turns: i, errors: ['Stopped by manager'] });
    },
  };
}

// ---------- the terminal runtime ----------

const ANSI: Record<LogEntry['kind'], (text: string) => string> = {
  text: (t) => t.replace(/^● /, '\x1b[97m●\x1b[0m '),
  tool: (t) => `\x1b[32m●\x1b[0m \x1b[1m${t.replace(/^⏺ /, '')}\x1b[0m`,
  result: (t) => `\x1b[2m${t}\x1b[0m`,
  thinking: (t) => `\x1b[35m${t}\x1b[0m`,
  error: (t) => `\x1b[31m${t}\x1b[0m`,
  system: (t) => `\x1b[2m${t}\x1b[0m`,
  manager: (t) => `\x1b[36m${t.replace(/^▶ /, '❯ ')}\x1b[0m`,
  done: (t) => `\x1b[32m${t}\x1b[0m`,
};

/**
 * With a terminal (the terminal runtime), the fake session's lines are drawn there the way Claude Code draws them,
 * and what the manager types into it is taken as a message.
 */
function inTerminal(opts: SessionOptions, cb: SessionCallbacks, start: (cb: SessionCallbacks) => SessionHandle): SessionHandle {
  const term = opts.terminal;
  if (!term) return start(cb);
  const name = CLIS.find((c) => c.id === (opts.cli ?? 'claude'))?.label ?? 'Claude Code';
  term.note(`── ${name}${opts.label ? ` · ${opts.label}` : ''} ──`);
  term.write(
    [
      '',
      ` \x1b[38;5;209m▐▛███▜▌\x1b[0m   \x1b[1m${name}\x1b[0m (demo)`,
      `\x1b[38;5;209m▝▜█████▛▘\x1b[0m  ${opts.model || 'default model'} · ${opts.effort} effort`,
      `\x1b[38;5;209m  ▘▘ ▝▝\x1b[0m    \x1b[2m${opts.cwd}\x1b[0m`,
      '',
      `\x1b[36m❯\x1b[0m ${opts.prompt.split('\n')[0].slice(0, 200)}`,
      '',
    ].join('\r\n'),
  );
  let handle: SessionHandle | null = null;
  let line = '';
  term.bind({
    write: (data) => {
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (ch === '\r') {
          const text = line.trim();
          line = '';
          term.write('\r\n');
          if (text && handle) {
            cb.log([{ kind: 'manager', text: `▶ Escrito en el terminal: ${text}` }]);
            handle.send(text);
          }
        } else if (ch === '\x7f' || ch === '\b') {
          if (line) term.write('\b \b');
          line = line.slice(0, -1);
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    },
    resize: () => undefined,
  });
  handle = start({
    ...cb,
    log: (entries) => {
      cb.log(entries);
      for (const e of entries) term.write(`${e.kind === 'tool' || (e.kind === 'text' && e.text.startsWith('●')) ? '\r\n' : ''}${ANSI[e.kind](e.text)}\r\n`);
    },
    finished: (r) => {
      term.bind(null);
      term.note(`── sesión de ${name} terminada ──`);
      cb.finished(r);
    },
  });
  return handle;
}

/**
 * Claude's usage on demand (the manager's console → Mission control, in the demo): a weekly-limit warning at 91% that
 * resets at midnight, or the 5-hour limit reached for 3 minutes.
 */
export function demoUsage(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number } {
  if (kind === 'limit') return { limitResetsAt: now + 3 * 60_000 };
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return { resetsAt: midnight.getTime(), rateLimitType: 'seven_day', utilization: 0.91 };
}

/**
 * A believable past week for mission control: each floor merged a few PRs every working day (the first floor more),
 * most QA rounds and check runs passed, and sessions cost around a dollar. `rand` is there for the tests.
 */
export function demoPastWeek(repos: string[], now: number, rand: () => number = Math.random): OpsHistory {
  const h = emptyHistory();
  const min = 60_000;
  let n = 0;
  repos.forEach((repo, floor) => {
    const pace = floor === 0 ? 1 : 0.6;
    for (let day = 6; day >= 0; day--) {
      const midnight = startOfDay(now) - day * DAY_MS;
      const merges = Math.round((3 + rand() * 4) * pace);
      for (let k = 0; k < merges; k++) {
        const at = midnight + (9 + rand() * 9) * HOUR_MS; // working hours
        const rounds = rand() < 0.3 ? 2 : 1; // now and then QA failed it once first
        h.merges.push([at, repo, 0, Math.round((25 + rand() * 200) * min)]);
        for (let r = 0; r < rounds; r++) {
          const before = (rounds - r) * 20 * min;
          h.qa.push([at - before, repo, r === rounds - 1, Math.round((1 + rand() * 14) * min)]);
          h.checks.push([at - before - 6 * min, repo, `past${String(n++).padStart(4, '0')}`, rand() > 0.12, Math.round((2.5 + rand() * 5) * min)]);
          h.cost.push([at - before, repo, Math.round((0.3 + rand()) * 100) / 100], [at - before - 40 * min, repo, Math.round((0.4 + rand() * 1.2) * 100) / 100]);
        }
      }
      for (const hour of [10, 15]) h.cost.push([midnight + hour * HOUR_MS, '', Math.round((0.5 + rand() * 0.8) * 100) / 100]); // the CEO's reviews
    }
  });
  for (const list of [h.merges, h.qa, h.checks, h.cost] as [number, ...unknown[]][][]) {
    for (let i = list.length - 1; i >= 0; i--) if (list[i][0] > now) list.splice(i, 1); // nothing from later today
  }
  prune(h, now);
  return h;
}

// Claude's usage warning, faked once so the office can be seen pacing new work: the 4th session gets it, and the
// window "resets" 5 minutes later.
const USAGE_WARNING_AT = 4;
const USAGE_WARNING_MS = 5 * 60_000;
let sessionsStarted = 0;

function fakeUsageWarning(cb: SessionCallbacks) {
  setTimeout(() => {
    const resetsAt = Date.now() + USAGE_WARNING_MS;
    cb.log([{ kind: 'error', text: `⚠ Aviso de uso de la suscripción (five_hour) · se reinicia a las ${new Date(resetsAt).toLocaleTimeString('es-ES')} (demo)` }]);
    cb.usageWarning?.({ resetsAt, rateLimitType: 'five_hour', utilization: 0.82 });
  }, 3000);
}

/** A made-up install and build of 300-900 MB freed, so the idle-desk setting and its phone message can be seen. */
async function fakeTrim(stillIdle: () => boolean) {
  await new Promise((r) => setTimeout(r, 300));
  if (!stillIdle()) return null;
  return { freed: Math.round((300 + Math.random() * 600) * 2 ** 20), removed: ['node_modules', 'dist'], skipped: [] };
}

/** The demo's fake world; `scale` (--floors / --agents) makes it the big company instead of the usual two floors. */
export function createDemoBackend(scale: DemoScale | null = null): Backend {
  if (scale) seedBigCompany(scale.floors);
  restoreNumbers();
  // Tie each fake session back to its repo via the desk directory name.
  const deskRepo = new Map<string, string>();
  // Desks whose pretend dependencies are installed: the first task on a desk installs, the next ones skip.
  const installedDesks = new Set<string>();
  // The branch each desk has checked out (null: detached), so a PR branch another desk holds plays out as for real (#199).
  // A pretend projects folder: the demo repos, one git folder that isn't on GitHub yet, and one plain folder.
  const folders = new Map<string, LocalFolder>();
  const addFolder = (name: string, github: string | null, git = true) =>
    folders.set(name, { name, path: `/demo/projects/${name}`, git, github, modified: Date.now() - folders.size * 3_600_000 });
  for (const r of repos.values()) addFolder(r.fullName.split('/')[1], r.fullName);
  addFolder('sketchbook', null);
  addFolder('recipe-notes', null, false);
  const newRepo = (name: string, description = '') => {
    const fullName = `demo-co/${name}`;
    if (!repos.has(fullName)) {
      repos.set(fullName, { fullName, description, issues: [], pulls: [], nextNumber: 1 });
      bareRepos.add(fullName);
      restoreNumbers();
    }
    addFolder(name, fullName);
    return fullName;
  };
  const folderOf = (dir: string) => {
    const f = folders.get(dir.replace(/\\/g, '/').split('/').pop() ?? '');
    if (!f) throw new Error(`${dir} no es una carpeta`);
    return f;
  };
  return {
    demo: true,
    user: async () => 'demo-manager',
    listMyRepos: async (): Promise<GhRepoSummary[]> =>
      [...repos.values()].map((r) => ({ nameWithOwner: r.fullName, description: r.description, visibility: 'PUBLIC', updatedAt: now() })),
    repoMeta: async (fullName) => {
      const r = repos.get(fullName);
      if (!r) throw new Error(`Repo de demo desconocido: ${fullName}`);
      return { nameWithOwner: fullName, description: r.description, url: `https://github.com/${fullName}`, defaultBranch: 'main' };
    },
    setLocalPath: () => undefined,
    scanProjects: async () => [...folders.values()].sort((a, b) => b.modified - a.modified),
    inspectFolder: async (dir) => folderOf(dir),
    publishFolder: async (dir, opts) => {
      const f = folderOf(dir);
      return f.github ?? newRepo(f.name, opts.description);
    },
    createProject: async (_root, name, opts) => {
      if (folders.has(name)) throw new Error(`/demo/projects/${name} ya existe. Elige otro nombre o conecta esa carpeta.`);
      return { fullName: newRepo(name, opts.description), path: `/demo/projects/${name}` };
    },
    listIssues: async (fullName) => {
      const r = repos.get(fullName);
      if (r && scale) topUp(r, scale.agents * 2);
      return [...(r?.issues ?? [])];
    },
    // Like GitHub's list: the open PRs and the 8 latest merges, never closed ones, so the office asks about those.
    listPulls: async (fullName) => {
      const pulls = repos.get(fullName)?.pulls ?? [];
      return [...pulls.filter((p) => p.state === 'OPEN'), ...pulls.filter((p) => p.state === 'MERGED').slice(0, 8)];
    },
    createIssue: async (fullName, title, body, labels = []) => {
      const r = repos.get(fullName);
      if (!r) throw new Error('Repo desconocido');
      const n = takeNumber(r);
      r.issues.push(issue(n, title, body, fullName, labels));
      return n;
    },
    issueState: async (fullName, number) => {
      const r = repos.get(fullName);
      return r?.issues.some((i) => i.number === number) ? 'OPEN' : closedIssues.has(`${fullName}#${number}`) || forgotten(fullName, number) ? 'CLOSED' : null;
    },
    editIssue: async (fullName, number, edit) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      if (!i) throw new Error(`Issue #${number} desconocido`);
      if (edit.body !== undefined) i.body = edit.body;
      i.labels = [...i.labels.filter((l) => !edit.removeLabels?.includes(l)), ...(edit.addLabels ?? []).filter((l) => !i.labels.includes(l))];
    },
    mergePull: async (fullName, number, _method, headSha) => {
      const r = repos.get(fullName);
      const pr = r?.pulls.find((p) => p.number === number);
      if (!r || !pr) throw new Error('PR desconocida');
      if (headSha && pr.headSha !== headSha) throw new Error('La rama de la PR ha cambiado. Revísala y vuelve a intentar el merge.');
      mergedSinceSync.set(fullName, (mergedSinceSync.get(fullName) ?? 0) + 1);
      pr.state = 'MERGED';
      // Now and then a merge leaves another open PR conflicting, so conflict fixes (before QA and after it) can be seen.
      for (const other of r.pulls) if (other.state === 'OPEN' && Math.random() < 0.25) Object.assign(other, { mergeable: 'CONFLICTING', mergeState: 'DIRTY' });
      pr.mergedAt = now();
      // GitHub closes what "Closes #N" links a little after the merge, not straight away.
      setTimeout(() => {
        for (const n of pr.closesIssues) closedIssues.add(`${fullName}#${n}`);
        r.issues = r.issues.filter((i) => !pr.closesIssues.includes(i.number));
      }, 20_000).unref();
    },
    closeIssue: async (fullName, number) => {
      const r = repos.get(fullName);
      if (!r?.issues.some((i) => i.number === number)) throw new Error(`El issue #${number} no está abierto`);
      closedIssues.add(`${fullName}#${number}`);
      r.issues = r.issues.filter((i) => i.number !== number);
    },
    updateBranch: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr) throw new Error('PR desconocida');
      Object.assign(pr, { headSha: fakeSha(), mergeState: 'CLEAN' });
      runChecks(pr, false);
    },
    failedRunLog: async (_fullName, runId) =>
      [
        `build\tRun npm test\t2025-01-01T00:00:00Z > vitest run (run ${runId})`,
        'build\tRun npm test\t2025-01-01T00:00:01Z  FAIL  src/__tests__/toolbar.test.ts > wraps below 480px',
        'build\tRun npm test\t2025-01-01T00:00:01Z AssertionError: expected "nowrap" to be "wrap"',
        'build\tRun npm test\t2025-01-01T00:00:02Z Test Files  1 failed | 7 passed (8)',
        'build\tRun npm test\t2025-01-01T00:00:02Z ##[error]Process completed with exit code 1.',
      ].join('\n'),
    rerunFailedJobs: async (fullName, runIds) => {
      // The re-run passes: a flake, as the office hoped.
      for (const pr of repos.get(fullName)?.pulls ?? []) {
        if (pr.failedChecks.some((c) => runIds.some((id) => c.url?.includes(`/actions/runs/${id}/`)))) runChecks(pr, false);
      }
    },
    closePull: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (pr) pr.state = 'CLOSED';
    },
    prForBranch: async () => null,
    prDetails: async (fullName, number) => {
      const pr = repos.get(fullName)?.pulls.find((p) => p.number === number);
      if (!pr && forgotten(fullName, number)) {
        // From before a restart: the fake GitHub starts over, so it was closed while the office was down.
        return {
          number,
          title: `PR #${number}`,
          body: '',
          url: `https://github.com/${fullName}/pull/${number}`,
          headRefName: '',
          headSha: fakeSha(),
          isCrossRepository: false,
          closesIssues: [],
          state: 'CLOSED',
          mergeable: 'UNKNOWN',
          mergeState: 'UNKNOWN',
          checks: 'none',
          checkNames: [],
          failedChecks: [],
          pendingChecks: [],
        };
      }
      if (!pr) throw new Error(`PR #${number} desconocida`);
      return {
        number,
        title: pr.title,
        body: `Implementa el cambio.\n\nCloses #${pr.closesIssues[0] ?? '?'}`,
        url: pr.url,
        headRefName: pr.headRefName,
        headSha: pr.headSha,
        isCrossRepository: false,
        closesIssues: pr.closesIssues,
        state: pr.state,
        mergeable: pr.mergeable,
        mergeState: pr.mergeState,
        checks: pr.checks,
        checkNames: pr.checks === 'none' ? [] : ['CI / build', 'Vercel'],
        failedChecks: pr.failedChecks.map((c) => c.name),
        pendingChecks: pr.pendingChecks,
      };
    },
    issueDetails: async (fullName, number) => {
      const i = repos.get(fullName)?.issues.find((x) => x.number === number);
      return { title: i?.title ?? `Issue #${number}`, body: i?.body ?? '', createdAt: i?.createdAt };
    },
    commentPull: async (fullName, number) => `https://github.com/${fullName}/pull/${number}#issuecomment-${Date.now()}`,
    uploadEvidence: async (fullName, filePath) => `https://github.com/${fullName}/raw/swarm-qa-evidence/${filePath}`,
    ensureClone: async () => new Promise((r) => setTimeout(r, 400)),
    syncMain: async (fullName, _branch, { touch }) => {
      const behind = mergedSinceSync.get(fullName) ?? 0;
      if (behind === 0) return { status: 'in sync', behind: 0, updatable: false };
      if (!touch) return { status: `update ready (${behind} commit${behind === 1 ? '' : 's'})`, behind, updatable: true };
      mergedSinceSync.set(fullName, 0);
      return { status: `updated to ${fakeSha().slice(0, 7)}`, behind: 0, updatable: false };
    },
    mainDir: (fullName) => `/demo/${fullName}/main`,
    deskDir: (fullName, slug) => `/demo/${fullName}/desks/${slug}`,
    // The fake desks are the ones set up since the demo started: after a restart, every desk is gone.
    deskExists: (dir) => deskRepo.has(dir),
    prepareDesk: async (fullName, _base, slug) => {
      await new Promise((r) => setTimeout(r, 900));
      const dir = `/demo/${fullName}/desks/${slug}`;
      deskRepo.set(dir, fullName);
      return dir;
    },
    // Each agent's machine has a clone of its own, so no other desk ever holds its branch.
    machines: {
      deskDir: (machine, fullName) => `/demo/machines/${machine}/work/${fullName}`,
      prepareDesk: async (machine, fullName) => {
        await new Promise((r) => setTimeout(r, 900));
        const dir = `/demo/machines/${machine}/work/${fullName}`;
        deskRepo.set(dir, fullName);
        return dir;
      },
      env: () => ({}),
      release: async () => undefined,
      trimDesk: (_machine, _fullName, stillIdle) => fakeTrim(stillIdle),
      sweep: async () => 0,
      remove: async () => ({ removed: true, patches: [] }),
      list: async () => [],
      exists: async () => true,
      installDeps: async () => 'none',
    },
    installDeps: async (dir, cb) => {
      if (installedDesks.has(dir)) {
        cb.log(['Las dependencias no han cambiado desde la última instalación; me la salto.']);
        return 'skipped';
      }
      cb.log(['Instalando dependencias…', '$ npm ci']);
      cb.installing();
      await new Promise((r) => setTimeout(r, 1500));
      cb.log(['Dependencias instaladas.']);
      installedDesks.add(dir);
      return 'installed';
    },
    removeDesk: async () => undefined,
    sweepDesks: async () => ({ desks: 0, folders: 0, branches: 0, patches: [], skipped: [] }),
    trimDesk: (_fullName, _slug, stillIdle) => fakeTrim(stillIdle),
    releaseDesk: async () => undefined,
    startSession: (opts, cb) => {
      // The big company is for measuring the office at full speed, so it never paces.
      if (++sessionsStarted === USAGE_WARNING_AT && !scale) fakeUsageWarning(cb);
      return inTerminal(opts, cb, (c) => (opts.role === 'ceo' ? ceoSession(opts, c) : fakeSession(opts, c, deskRepo.get(opts.cwd) ?? boxDeskRepo(opts.cwd) ?? [...repos.keys()][0])));
    },
    terminals: true,
    reconnectClis: async () => [], // fake sessions end with the office
    hooksReady: () => undefined,
    releaseClis: async () => undefined,
    detectClis: async () =>
      CLIS.map((c) => ({ id: c.id, label: c.label, installed: true, version: 'demo', integrated: c.integrated })),
    previews: demoPreviews,
    office: demoOffice,
    voice: demoVoice,
    notify: demoNotify,
    cloud: demoCloud(),
    seedOps: (ids, at) => demoPastWeek(ids, at),
    demoTeam: (floor) => demoTeam(scale, floor),
    simulateUsage: demoUsage,
    demoDoctor: {
      dropDesk: (dir) => {
        deskRepo.delete(dir);
        installedDesks.delete(dir);
      },
      finishQuietly: (fullName, kind, n) => {
        const r = repos.get(fullName);
        if (!r) return;
        const pr = kind === 'pr' ? r.pulls.find((p) => p.number === n) : undefined;
        if (pr) Object.assign(pr, { state: 'MERGED', mergedAt: now() });
        for (const i of kind === 'issue' ? [n] : (pr?.closesIssues ?? [])) {
          closedIssues.add(`${fullName}#${i}`);
          r.issues = r.issues.filter((x) => x.number !== i);
        }
      },
      stall: (agentId) => {
        const stall = stalls.get(agentId);
        stall?.();
        return !!stall;
      },
      unclosedMerge: (fullName, mergedAgoMs) => {
        const r = repos.get(fullName);
        const open = r?.issues[r.issues.length - 1];
        if (!r || !open) return null;
        const n = takeNumber(r);
        r.pulls.unshift({
          number: n,
          title: open.title,
          url: `https://github.com/${fullName}/pull/${n}`,
          headRefName: `fix/issue-${open.number}`,
          state: 'MERGED',
          isDraft: false,
          mergeable: 'MERGEABLE',
          reviewDecision: null,
          closesIssues: [open.number],
          createdAt: new Date(Date.now() - mergedAgoMs - 3_600_000).toISOString(),
          mergedAt: new Date(Date.now() - mergedAgoMs).toISOString(),
          additions: 12,
          deletions: 3,
          checks: 'passing',
          headSha: fakeSha(),
          mergeState: 'CLEAN',
          failedChecks: [],
          pendingChecks: [],
        });
        return { issue: open.number, pr: n };
      },
    },
  };
}

// ---------- the office's own update ----------

/**
 * Floor 1's folder plays the office's own folder, so merges there make an update ready. There is a launcher when
 * the real one started the demo, or with SWARM_DEMO_LAUNCHER=1; either way the update is faked: a short pause, then
 * the result message, and nothing restarts.
 */
const OFFICE_REPO = 'demo-co/pixel-todo';
const DEMO_HEAD = `0ff1ce5${'0'.repeat(33)}`;
const lastFakeUpdate = { to: '', commits: 0 };
const demoOffice: OfficeHost = {
  launcher: underLauncher() || process.env.SWARM_DEMO_LAUNCHER === '1',
  head: async () => DEMO_HEAD,
  isOwnFolder: (dir) => dir === `/demo/${OFFICE_REPO}/main`,
  // Only its own fake updates have a count; one the real launcher did (u) gets no count rather than a wrong one.
  commitsBetween: async (_from, to) => (to === lastFakeUpdate.to ? lastFakeUpdate.commits : null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    await new Promise((r) => setTimeout(r, 4000));
    lastFakeUpdate.commits = mergedSinceSync.get(OFFICE_REPO) ?? 0;
    mergedSinceSync.set(OFFICE_REPO, 0);
    lastFakeUpdate.to = fakeSha();
    return { from, to: lastFakeUpdate.to, ok: true, installed: true, built: true, at: Date.now() };
  },
};

// ---------- the demo preview ----------

/**
 * The demo's stand-in for a floor's app: a page per path (Home and About link to each other), long enough to scroll.
 * A PR's build says so and shows its change, so main and the PR look different side by side.
 */
function placeholderPage(title: string, hue: number, at: string, pr: { number: number; title: string } | null) {
  const safe = (s: string) => s.replace(/[<>&"]/g, '');
  const rows = Array.from({ length: 24 }, (_, i) => `<li>Tarea ${i + 1}: ${['regar las plantas', 'contestar a Sam', 'pedir cita al dentista', 'comprar café', 'arreglar la bici', 'planear el viaje'][i % 6]}</li>`);
  if (pr) rows.splice(2, 0, `<li class="new">✨ Nuevo en la PR #${pr.number}: ${safe(pr.title)}</li>`);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><link rel="icon" href="data:,">
<style>
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; background: hsl(${hue},60%,96%); color: #222; }
  nav { position: sticky; top: 0; display: flex; gap: 18px; align-items: center; padding: 12px 24px; background: hsl(${hue},70%,55%); color: #fff; }
  nav a { color: #fff; font-weight: 600; }
  nav .at { margin-left: auto; font-family: Consolas, monospace; font-size: 14px; opacity: .9; }
  .pr { margin: 18px auto 0; max-width: 560px; padding: 10px 16px; border-radius: 12px; background: #fff3c4; border: 2px dashed hsl(${hue},60%,45%); font-weight: 600; }
  main { margin: 22px auto; max-width: 560px; padding: 28px 36px; background: #fff; border-radius: 18px; box-shadow: 0 8px 30px hsla(${hue},50%,40%,.18); }
  h1 { margin: 0 0 6px; font-size: 26px; color: hsl(${hue},60%,38%); }
  p { margin: 0 0 18px; color: #666; }
  button { font: inherit; font-size: 18px; padding: 10px 26px; border: 0; border-radius: 999px; background: hsl(${hue},70%,55%); color: #fff; cursor: pointer; }
  button:active { transform: scale(.97); }
  #count { display: block; margin-top: 16px; font-size: 15px; color: #444; }
  ol { margin: 22px 0 0; padding-left: 22px; line-height: 2.2; }
  li.new { font-weight: 700; color: hsl(${hue},60%,32%); background: #fff3c4; border-radius: 6px; padding: 0 6px; }
</style></head>
<body>
<nav><a href="/">Inicio</a><a href="/about">Acerca de</a><span class="at">${safe(at)}</span></nav>
${pr ? `<div class="pr">🧪 Esta es la build de la PR #${pr.number}: ${safe(pr.title)}</div>` : ''}
<main>
  <h1>${safe(title)}</h1>
  <p>${at === '/about' ? 'Acerca de esta app: una página provisional que sirve la oficina de demo.' : 'Una app provisional que sirve la oficina de demo.'}</p>
  <button id="btn" type="button">Púlsame</button>
  <span id="count">Pulsado 0 veces</span>
  <ol>${rows.join('')}</ol>
</main>
<script>
  let n = 0;
  document.getElementById('btn').addEventListener('click', () => {
    n++;
    document.getElementById('count').textContent = 'Pulsado ' + n + (n === 1 ? ' vez' : ' veces');
  });
</script>
</body></html>`;
}

/** Programs the demo pretends to have, so a bogus preview command fails the way it would for real. */
const DEMO_PROGRAMS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'vite', 'next', 'python', 'python3', 'py', 'php', 'ruby', 'go', 'cargo', 'dotnet'];

/**
 * No git, no npm: short fake delays through the real statuses, then a placeholder page on the floor's port.
 * Floors made in the demo have nothing to run until they get a command, and a command whose program isn't in
 * DEMO_PROGRAMS fails, so the viewer's unconfigured and error states can be tried out.
 */
const demoPreviews: PreviewBackend = {
  hasDefault: async (fullName) => !bareRepos.has(fullName),
  start(job, cb) {
    let stopped = false;
    let server: http.Server | null = null;
    const timers: NodeJS.Timeout[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(() => !stopped && fn(), ms));
    const pull = job.pr ? repos.get(job.fullName)?.pulls.find((p) => p.number === job.pr) : undefined;
    const hue = ([...job.fullName].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7) + (job.pr ? 150 : 0)) % 360;
    const sha = (job.pr ? pull?.headRefName ?? String(job.pr) : job.fullName + job.defaultBranch)
      .split('')
      .reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381)
      .toString(16)
      .padStart(7, '0')
      .slice(0, 7);

    cb.status('preparing');
    later(700, () => {
      cb.commit(sha);
      cb.log([`HEAD is now at ${sha} (${job.pr ? `PR #${job.pr}` : job.defaultBranch})`]);
      if (!job.command && bareRepos.has(job.fullName)) {
        stopped = true;
        cb.failed('No hay nada que ejecutar: esta planta no tiene comando de vista previa ni package.json.', true);
        return;
      }
      cb.status('installing');
      cb.log(['$ npm ci', 'added 214 packages in 1s (demo)']);
    });
    later(1600, () => {
      cb.status('starting');
      cb.log([`$ ${job.command ?? 'npm run dev'}`.replaceAll('{port}', String(job.port))]);
      const program = job.command?.trim().split(/\s+/)[0] ?? 'npm';
      if (!DEMO_PROGRAMS.includes(program.toLowerCase())) {
        later(400, () => {
          cb.log([`"${program}" no se reconoce como un comando interno o externo,`, 'programa o archivo por lotes ejecutable.']);
          stopped = true;
          cb.failed(`La app terminó (código 1) antes de escuchar en el puerto ${job.port}.`);
        });
        return;
      }
      server = http.createServer((req, res) => {
        const at = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (at.includes('.')) return void res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(placeholderPage(job.title, hue, at, job.pr ? { number: job.pr, title: pull?.title ?? `PR #${job.pr}` } : null));
      });
      server.once('error', (err) => {
        if (stopped) return;
        stopped = true;
        cb.failed(`No se pudo escuchar en el puerto ${job.port}: ${err.message}`);
      });
      server.listen(job.port, '127.0.0.1', () => {
        if (stopped) return void server?.close();
        later(500, () => {
          cb.log([`  ➜  Local:   http://localhost:${job.port}/`]);
          cb.status('running');
        });
      });
    });

    return {
      async stop() {
        stopped = true;
        timers.forEach(clearTimeout);
        const s = server;
        server = null;
        if (!s?.listening) return;
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      },
    };
  },
};

// ---------- the demo CEO ----------

interface Profile {
  summary: string;
  qa: string;
}

const PROFILES: Record<string, Profile> = {
  'pixel-todo': {
    summary: 'App web de tareas · React + Vite + TypeScript',
    qa: '- Añadir, completar, editar y borrar tareas; sobreviven a una recarga\n- Solo con teclado: todas las acciones accesibles, el foco siempre visible\n- Ancho de móvil (375px): nada se desborda ni queda cortado\n- Sin errores en la consola del navegador',
  },
  'weather-api': {
    summary: 'API REST · Node + Express',
    qa: '- Cada endpoint: caso normal, entrada errónea (400), ciudad desconocida (404)\n- Las respuestas encajan con el documento OpenAPI\n- La limitación de peticiones devuelve 429 con Retry-After\n- Los tests y el lint pasan',
  },
};

const GENERIC: Profile = {
  summary: 'Proyecto web · fase inicial',
  qa: '- La app compila y arranca\n- La funcionalidad cambiada funciona de principio a fin en el navegador\n- Ancho de móvil: nada se desborda\n- Sin errores en la consola',
};

/** A floor in company_status, as far as the demo CEO reads it. */
export interface DemoFloor {
  floor: number;
  repo: string;
  brief: string | null;
  team: { size: number; max: number; free: number; pendingHires: number; pendingLetGos: number };
  capacity: { issuesReadyToStart: number; prsAwaitingQa: number };
  backlog: { number: number; title: string; inProgress: boolean }[];
  pullRequests: unknown[];
}

interface DemoStatus {
  company: { scaling: string }; // how team changes go, in words ("team changes apply straight away")
  floors: DemoFloor[];
  pendingChanges: unknown[];
}

/** The team a floor will have once the changes waiting for the manager are decided. */
const plannedSize = (t: DemoFloor['team']) => t.size + t.pendingHires - t.pendingLetGos;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** An office tool's refusal (ceo.ts prefixes it "Rechazado: "; "Refused: " before the translation). */
const isRefused = (out: string) => /^(?:Rechazado|Refused)\b/.test(out);

/** The demo CEO grows a floor up to this many agents on its own (the real CEO's "rarely more than 4 to 6"). */
const DEMO_GROW_TO = 6;

/**
 * The demo CEO's call to grow a floor: when the issues ready to start (`ready`) outnumber its free agents and the
 * agents already on their way, up to DEMO_GROW_TO and the floor's max. Null: the team can keep up.
 */
export function demoGrow(f: DemoFloor, ready: number): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const waiting = ready - f.team.free - f.team.pendingHires;
  const size = Math.min(f.team.max, Math.max(now, DEMO_GROW_TO), now + waiting);
  if (waiting <= 0 || size <= now) return null;
  return {
    size,
    reason: `${plural(ready, 'issue')} ${ready === 1 ? 'está listo' : 'están listos'} para empezar en la planta ${f.floor} y ${plural(f.team.free, 'agente')} ${f.team.free === 1 ? 'está libre' : 'están libres'}: con ${size} agentes se trabajan a la vez en lugar de esperar.`,
  };
}

/** The demo CEO's call to shrink a floor: several agents idle with nothing ready to start or test. Never below one. */
export function demoShrink(f: DemoFloor): { size: number; reason: string } | null {
  const now = plannedSize(f.team);
  const idle = f.team.free - f.team.pendingLetGos;
  if (idle < 2 || f.capacity.issuesReadyToStart > 0 || f.capacity.prsAwaitingQa > 0) return null;
  const size = Math.max(1, now - (idle - 1));
  if (size >= now) return null;
  return { size, reason: `${idle} de los ${f.team.size} agentes de la planta ${f.floor} están parados sin nada listo para empezar ni probar; con ${size} basta para lo que va llegando.` };
}

/** A scripted CEO that uses the real office tools, so team changes, profiles and issues behave exactly as in the real thing. */
function ceoSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle {
  const office = opts.office!;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let done = false;
  const wait = (ms: number) => new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)));
  const step = async (entries: LogEntry[], ms = 900 + Math.random() * 1500) => {
    if (stopped) throw new Error('Stopped by manager');
    cb.tool(entries.find((e) => e.tool)?.tool ?? null);
    cb.log(entries);
    await wait(ms);
  };
  const status = async () => {
    await step([{ kind: 'tool', tool: 'mcp__office__company_status', text: `⏺ ${describeOfficeTool('company_status', {})}` }]);
    const s = JSON.parse(await office.call('company_status', {})) as DemoStatus;
    const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
    const free = s.floors.reduce((n, f) => n + f.team.free, 0);
    const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
    cb.log([{ kind: 'result', text: `  ⎿ ${plural(s.floors.length, 'planta')} · ${plural(agents, 'agente')} · ${free} ${free === 1 ? 'libre' : 'libres'} · ${plural(issues, 'issue')} ${issues === 1 ? 'abierto' : 'abiertos'} · ${plural(s.pendingChanges.length, 'cambio')} de equipo ${s.pendingChanges.length === 1 ? 'pendiente' : 'pendientes'}` }]);
    return s;
  };
  const use = async (name: string, args: Record<string, unknown>) => {
    await step([{ kind: 'tool', tool: `mcp__office__${name}`, text: `⏺ ${describeOfficeTool(name, args)}` }]);
    const out = await office.call(name, args);
    cb.log([{ kind: isRefused(out) ? 'error' : 'result', text: `  ⎿ ${out.split('\n')[0].slice(0, 170)}` }]);
    return out;
  };
  const read = (file: string, lines: number) => step([{ kind: 'tool', tool: 'Read', text: `⏺ Read ${file}` }, { kind: 'result', text: `  ⎿ Read ${lines} lines` }]);
  const think = (text: string) => step([{ kind: 'thinking', text: '✻ Pensando…' }, { kind: 'text', text: `● ${text}` }], 1800);
  const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
  const refused = (out: string) => out.replace(/^(?:Rechazado|Refused): /, '');
  /** What happens next, by Settings → Team changes; `added`: new agents (negative: agents leaving). */
  const after = (s: DemoStatus, added: number) => {
    const who = added === 1 ? 'El agente nuevo' : 'Los agentes nuevos';
    if (/auto|straight away/i.test(s.company.scaling)) return added > 0 ? `${who} ${added === 1 ? 'ya está' : 'ya están'} en el equipo.` : 'Los agentes parados se van primero; quien esté ocupado termina su tarea.';
    return added > 0 ? `${who} ${added === 1 ? 'espera en Aprobaciones a que lo configures y aceptes' : 'esperan en Aprobaciones a que los configures y aceptes'}.` : 'La salida de quien he elegido espera tu decisión en Aprobaciones.';
  };
  /** scale_team with the call made, and a sentence on how it went. */
  const scale = async (s: DemoStatus, f: DemoFloor, call: { size: number; reason: string }) => {
    const out = await use('scale_team', { floor: f.floor, ...call });
    return isRefused(out)
      ? `Quería la planta ${f.floor} con ${plural(call.size, 'agente')}, pero la oficina ha dicho que no: ${refused(out)}`
      : `La planta ${f.floor} pasa de ${f.team.size} a ${plural(call.size, 'agente')}: ${call.reason} ${after(s, call.size - plannedSize(f.team))}`;
  };

  /** Files the brief's first three issues; returns the skeleton's number. */
  const planIssues = async (floor: number, mission: string) => {
    const first = await use('file_issue', {
      floor,
      title: 'Montar el esqueleto del proyecto',
      body: `Prepara la base de la app para que el resto del hito tenga sobre qué construir.\n\nEncargo: ${mission}\n\nCriterios de aceptación:\n- El servidor de desarrollo arranca\n- Se muestra una página de inicio provisional\n- Existen los scripts de lint, tests y build`,
    });
    const n = Number(first.match(/#(\d+)/)?.[1] ?? 0);
    await use('file_issue', {
      floor,
      title: `Construir el núcleo: ${short(mission, 60)}`,
      body: `${n ? `Depends on #${n}\n\n` : ''}Implementa el corazón del encargo.\n\nCriterios de aceptación:\n- El flujo principal funciona de principio a fin\n- Cubierto por tests`,
    });
    await use('file_issue', {
      floor,
      title: 'Pulido: diseño móvil y estados vacíos',
      body: `${n ? `Depends on #${n}\n\n` : ''}Haz que todas las pantallas funcionen a 375px y añade estados vacíos amables.`,
    });
    return n;
  };

  const scripts = {
    async onboard(floor: number, fullName: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'Esa planta ya no existe, así que no había nada que incorporar.';
      const p = PROFILES[fullName.split('/')[1] ?? ''] ?? GENERIC;
      await read(`${f.repo}/README.md`, 48);
      await step([{ kind: 'tool', tool: 'Glob', text: '⏺ Glob src/**/*' }, { kind: 'result', text: '  ⎿ 23 ficheros encontrados' }]);
      await read('package.json', 36);
      await think(`${p.summary}. Voy a dimensionar el equipo para el trabajo que hay a la vista.`);
      await use('set_floor_profile', { floor, summary: p.summary, qa_brief: p.qa });
      const ready = f.capacity.issuesReadyToStart;
      const grow = demoGrow(f, ready);
      const team = grow ? await scale(s, f, grow) : `Su equipo de ${plural(f.team.size, 'agente')} da abasto con ${plural(ready, 'issue')} ${ready === 1 ? 'listo' : 'listos'} para empezar.`;
      const next = f.brief ? ' Tu encargo es lo siguiente en mi lista: lo planifico en cuanto termine con esto.' : f.backlog.length === 0 ? ' El backlog está vacío: dime qué quieres que se construya y lo planifico.' : '';
      return [`Planta ${floor}: ${p.summary}. Le he escrito unas pautas de QA.`, team, next].filter(Boolean).join(' ');
    },
    async plan(floor: number, mission: string) {
      const s = await status();
      const f = s.floors.find((x) => x.floor === floor);
      if (!f) return 'Esa planta ya no existe, así que no había nada que planificar.';
      await read(`${f.repo}/README.md`, 12);
      await think('Primero los cimientos, para que el trabajo en paralelo no choque.');
      const n = await planIssues(floor, mission);
      const grow = demoGrow(f, f.capacity.issuesReadyToStart + (n ? 1 : 0));
      const team = grow ? ` ${await scale(s, f, grow)}` : '';
      return `He convertido el encargo en tres issues en la planta ${floor}. El #${n} monta el esqueleto; los otros dos dicen "Depends on #${n}", así que nadie los empieza antes de tiempo.${team}`;
    },
    async review() {
      const s = await status();
      await think('Reviso cada planta en busca de trabajo que espera agentes libres y de agentes que esperan trabajo.');
      for (const f of s.floors) {
        const call = demoShrink(f) ?? demoGrow(f, f.capacity.issuesReadyToStart);
        if (call) return scale(s, f, call);
      }
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const prs = s.floors.reduce((n, f) => n + f.pullRequests.length, 0);
      return `${s.floors.length === 1 ? 'La planta está sana' : `Las ${s.floors.length} plantas están sanas`}: ${plural(issues, 'issue')} ${issues === 1 ? 'abierto' : 'abiertos'} y ${plural(prs, 'pull request')} en marcha. No hace falta ningún cambio.`;
    },
    // A stuck PR: read what QA and GitHub say, then act through the real triage tools, as the real CEO would.
    async triage(floor: number, pr: number, facts: string) {
      await step([{ kind: 'tool', tool: 'Read', text: `⏺ Read informe de QA de la PR #${pr}` }, { kind: 'result', text: '  ⎿ 38 líneas leídas' }]);
      const conflict = /mergeable: CONFLICTING/.test(facts);
      const red = /checks[^:\n]*: failing/i.test(facts);
      const again = !/(?:triage|triaje) 1 (?:of|de)/i.test(facts);
      await think(conflict ? 'Solo tiene conflictos con main; el cambio en sí está bien.' : red ? 'Un check en rojo que parece un fallo puntual.' : again ? 'Atascada por segunda vez. Esto necesita una decisión del responsable.' : 'Se atascaron las sesiones de corrección, no el código. Otra ronda de QA debería resolverlo.');
      const [tool, args, done] = conflict
        ? ['send_back', { note: 'Haz merge de main y mantén los dos cambios funcionando; a QA ya le gustó el resto.' }, 'Ha vuelto a corrección para hacer merge de main']
        : red
          ? ['rerun_checks', {}, 'Se han relanzado sus checks fallidos']
          : again
            ? ['escalate', { reason: 'Se ha atascado dos veces por el mismo motivo; merece la pena revisar el propio issue.' }, 'Ahora está en tus manos']
            : ['retry_qa', {}, 'Vuelve a estar en la cola de QA'];
      const out = await use(tool, { floor, pr, ...args });
      if (!isRefused(out)) return `La PR #${pr} de la planta ${floor} estaba atascada. ${done}.`;
      await use('escalate', { floor, pr, reason: `He probado ${tool}, pero la oficina lo ha rechazado: ${refused(out)}` });
      return `La PR #${pr} de la planta ${floor} está atascada y no he podido moverla, así que ahora está en tus manos.`;
    },
    async chat(text: string) {
      const s = await status();
      await think('Leyendo tu mensaje.');
      // "close #3, superseded by #5": through the real tool.
      const close = text.match(/\b(?:close|cierra|cerrar)\s+(?:el\s+)?#(\d+)[\s,:;.-]*(.*)/i);
      const closeFloor = close && (s.floors.find((f) => f.backlog.some((i) => i.number === Number(close[1]))) ?? s.floors[0]);
      if (close && closeFloor) {
        const reason = close[2].trim() || 'Ya no hace falta.';
        const out = await use('close_issue', { floor: closeFloor.floor, number: Number(close[1]), reason });
        return isRefused(out) ? `No he podido cerrar el #${close[1]}: ${refused(out)}` : `Hecho: ${out} He dejado "${short(reason, 80)}" como comentario.`;
      }
      // Asked for a bigger team: one more agent where the most work waits, through the real tool.
      if (/\b(hire|hiring|grow|team|bigger|contrat|equipo|crece|crecer|ampli|mpl[ií]a)|más agentes/i.test(text)) {
        if (!s.floors.length) return 'Todavía no hay plantas: añade primero un proyecto y dimensionaré su equipo.';
        const room = s.floors.filter((f) => plannedSize(f.team) < f.team.max);
        if (!room.length) return `Todas las plantas están en su máximo de agentes (${s.floors[0].team.max}). Súbelo en Ajustes → Máximo de agentes por planta y haré crecer la más ocupada.`;
        const f = room.sort((a, b) => b.capacity.issuesReadyToStart - b.team.free - (a.capacity.issuesReadyToStart - a.team.free) || a.floor - b.floor)[0];
        const ready = f.capacity.issuesReadyToStart;
        return scale(s, f, {
          size: plannedSize(f.team) + 1,
          reason: `Has pedido un equipo más grande, y la planta ${f.floor} es la que más trabajo tiene esperando: ${plural(ready, 'issue')} ${ready === 1 ? 'listo' : 'listos'} para empezar, ${plural(f.team.free, 'agente')} ${f.team.free === 1 ? 'libre' : 'libres'}.`,
        });
      }
      const agents = s.floors.reduce((n, f) => n + f.team.size, 0);
      const issues = s.floors.reduce((n, f) => n + f.backlog.length, 0);
      const pending = s.pendingChanges.length;
      // Real CEOs answer in Markdown, so the demo one does too: every element the phone renders.
      const rows = s.floors.map((f) => `| ${f.floor} | \`${f.repo.split('/').pop()}\` | ${f.team.size} | ${f.backlog.length} | ${f.pullRequests.length} |`);
      return [
        `**Estado rápido:** ${plural(s.floors.length, 'planta')}, ${plural(agents, 'agente')} y ${plural(issues, 'issue')} ${issues === 1 ? 'abierto' : 'abiertos'}.`,
        '',
        '- El equipo está *a tope* con el backlog',
        `- ${pending ? `**${pending}** ${pending === 1 ? 'cambio de equipo espera' : 'cambios de equipo esperan'} tu decisión` : 'Ningún cambio de equipo espera tu decisión'}`,
        '  - QA vuelve a probar cada PR después de una corrección',
        '',
        '| Planta | Repo | Agentes | Issues | PRs |',
        '| ---: | --- | ---: | ---: | ---: |',
        ...(rows.length ? rows : ['| – | aún no hay proyectos | 0 | 0 | 0 |']),
        '',
        'Lo que haría a continuación:',
        '',
        '1. Fusionar todo lo que haya pasado QA',
        '2. Ejecutar `npm run build` en cada planta antes del próximo hito',
        '3. Hacer crecer un equipo solo donde el trabajo siga esperando agentes libres',
        '',
        '```bash',
        'SWARM_HOME=/tmp/sareoffice-demo SWARM_PORT=5260 node --import tsx server/index.ts --demo',
        '```',
        '',
        `> Soy el CEO de la demo, así que no puedo actuar sobre "${short(text)}", pero el de verdad lo haría. Echa un vistazo a la [documentación de Claude Code](https://docs.claude.com/en/docs/claude-code/overview).`,
      ].join('\n');
    },
  };

  const prompt = opts.prompt;
  // The office's CEO prompts (ceo.ts), in Spanish or, from before the translation, in English.
  const where = prompt.match(/(?:[Ff]loor|[Pp]lanta) (\d+) \(([^,)]+)/);
  const triage = prompt.match(/^(?:Triage: pull request|Triaje: la pull request) #(\d+) (?:on floor|de la planta) (\d+)/);
  const run = triage
    ? () => scripts.triage(Number(triage[2]), Number(triage[1]), prompt)
    : /no longer needs triage|ya no necesita triaje|Responde "Nada que hacer\."|Reply "Nothing to do\."/.test(prompt)
      ? async () => 'Nada que hacer.'
      : /just joined the company|acaba de incorporarse a la empresa/.test(prompt)
        ? () => scripts.onboard(Number(where?.[1]), where?.[2] ?? '')
        : /has a brief for floor|tiene un encargo para la planta/.test(prompt)
          ? () => scripts.plan(Number(where?.[1]), prompt.match(/"""([\s\S]*?)"""/)?.[1]?.trim() ?? '')
          : /Periodic review|Revisión periódica/.test(prompt)
            ? () => scripts.review()
            : () => scripts.chat(prompt.split('\n').slice(1).join(' ').trim() || prompt);

  const finish = (ok: boolean, text: string, error?: string) => {
    if (done) return;
    done = true;
    cb.tool(null);
    cb.finished({ ok, text, costUsd: ok ? 0.4 + Math.random() : 0.05, turns: 6 + Math.floor(Math.random() * 10), errors: error ? [error] : [] });
  };

  timers.push(
    setTimeout(async () => {
      try {
        cb.log([{ kind: 'system', text: `✻ Claude Code (demo) · ${opts.model} · ${opts.effort} effort · CEO` }]);
        const reply = await run();
        cb.log([{ kind: 'text', text: `● ${reply}` }]);
        cb.turn?.(reply);
        finish(true, reply);
      } catch (err) {
        finish(false, '', stopped ? 'Stopped by manager' : (err as Error).message);
      }
    }, 500),
  );

  return {
    send(text) {
      timers.push(
        setTimeout(() => {
          if (stopped || done) return;
          const said = text.split('\n').slice(1).join(' ').trim() || text;
          cb.log([{ kind: 'text', text: `● Anotado: "${short(said, 70)}"` }]);
          cb.turn?.(`Anotado, lo tendré en cuenta: "${short(said, 90)}"`);
        }, 1500),
      );
    },
    stop() {
      stopped = true;
      timers.forEach(clearTimeout);
      finish(false, '', 'Stopped by manager');
    },
  };
}

// ---------- voice ----------

/**
 * A short two-note chime as 8 kHz mono WAV: something to hear without ElevenLabs, a little longer for longer text, and
 * pitched by the voice, so a replayed clip is audibly the one made in the voice of its day.
 */
export function demoChime(chars: number, voiceId = ''): Buffer {
  const rate = 8000;
  const seconds = Math.min(0.4 + chars / 400, 2);
  const n = Math.round(rate * seconds);
  const wav = Buffer.alloc(44 + n);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(n, 40);
  const pitch = 2 ** ([...voiceId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 7, 0) / 12);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = (t < seconds / 2 ? 660 : 880) * pitch;
    const fade = Math.min(1, (seconds - t) * 8, t * 40);
    wav[44 + i] = Math.round(128 + 40 * fade * Math.sin(2 * Math.PI * f * t));
  }
  return wav;
}

const demoVoices = [
  { id: 'demoVoiceAvery00001', name: 'Avery', category: 'premade', labels: { accent: 'american', gender: 'female', age: 'middle aged', description: 'calm', use_case: 'conversational' }, previewUrl: null },
  { id: 'demoVoiceBasil00002', name: 'Basil', category: 'premade', labels: { accent: 'british', gender: 'male', age: 'middle aged', description: 'warm', use_case: 'narration' }, previewUrl: null },
  { id: 'demoVoiceCleo000003', name: 'Cleo', category: 'premade', labels: { accent: 'australian', gender: 'female', age: 'young', description: 'friendly', use_case: 'conversational' }, previewUrl: null },
];

/** What the demo's Speech to Text hears in any recording (docs/voice.md). */
export const DEMO_TRANSCRIPT = '¿En qué está trabajando todo el mundo?';

/** No network: any key works except one containing "bad", three voices, a chime for every message, and one fixed transcript. */
const demoVoice: VoiceApi = {
  checkKey: async (key) => {
    if (/bad/i.test(key)) throw new VoiceApiError(401, '401: invalid_api_key (demo)');
  },
  listVoices: async () => demoVoices,
  synthesize: async (_key, { text, voiceId }) => {
    await new Promise((r) => setTimeout(r, 300));
    return demoChime(text.length, voiceId);
  },
  transcribe: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return DEMO_TRANSCRIPT;
  },
};

// ---------- notifications ----------

/**
 * Nothing is sent: each channel logs the message it would get. A demo office starts with every chat app set up (fake
 * addresses in demo-secrets.json), so a needs-human PR shows one line per channel; an address containing "bad" fails.
 */
const demoNotify: NotifyTransport = {
  demoWebhooks: {
    ntfy: { url: 'https://ntfy.sh/sareoffice-demo-office' },
  },
  post: async ({ channel, url, text }) => {
    const ok = !/bad/i.test(url);
    console.log(`🔔 demo ${channel}${ok ? '' : ' (fails: "bad" address)'} would get: ${text.replace(/\n/g, ' ⏎ ')}`);
    return ok ? 200 : 404;
  },
};

// ---------- cloud agents ----------

/** The repo a cloud agent's desk in its Box is for (/workspace/home/work/<owner>__<repo>). */
function boxDeskRepo(cwd: string): string | null {
  const m = cwd.match(/\/work\/([\w.-]+)__([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * A fake Upstash account (docs/cloud.md): any key opens it, and its Boxes are created, set up, paused and deleted
 * with a little delay, so a demo office shows cloud agents' Boxes coming up. Their sessions are the demo's fake ones.
 * A new Box's coding agents aren't signed in (`logins`: Box id -> the CLIs signed in there) until the fake sign-in.
 */
function demoBoxes(logins: Map<string, Set<string>>): BoxApi {
  const boxes = new Map<string, BoxInfo>();
  const installed = new Set<string>();
  let seq = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const box = (id: string) => {
    const b = boxes.get(id);
    if (!b) throw new CloudError('Esa Box ya no existe.', 'gone');
    return b;
  };
  return {
    list: async () => [...boxes.values()].map((b) => ({ ...b })),
    create: async (o) => {
      await wait(2500);
      const b: BoxInfo = { id: `demo-box-${++seq}`, name: o.name, labels: o.labels, status: 'running' };
      boxes.set(b.id, b);
      return { ...b };
    },
    get: async (id) => (boxes.has(id) ? { ...boxes.get(id)! } : null),
    resume: async (id) => {
      await wait(800);
      box(id).status = 'running';
    },
    pause: async (id) => {
      box(id).status = 'paused';
    },
    remove: async (id) => {
      boxes.delete(id);
      logins.delete(id);
    },
    run: async (id, script) => {
      box(id).status = 'running';
      const cli = /claude'? auth /.test(script) ? 'claude' : 'codex';
      if (script.includes('SAREOFFICE_SIGNED_IN')) return { code: 0, output: logins.get(id)?.has(cli) ? 'SAREOFFICE_SIGNED_IN' : 'SAREOFFICE_SIGNED_OUT' };
      if (/auth logout|' logout/.test(script)) {
        logins.get(id)?.delete(cli);
        return { code: 0, output: '' };
      }
      if (script.includes('SAREOFFICE_SETUP_OK')) {
        await wait(3500);
        return { code: 0, output: 'SAREOFFICE_SETUP_OK' };
      }
      if (script.includes('git worktree add')) {
        await wait(900);
        return { code: 0, output: '' };
      }
      if (script.includes('DEPS_')) {
        if (installed.has(id)) return { code: 0, output: 'DEPS_SKIPPED' };
        if (!script.includes('npm ci')) return { code: 0, output: 'DEPS_STALE' };
        await wait(1500);
        installed.add(id);
        return { code: 0, output: 'DEPS_INSTALLED' };
      }
      return { code: 0, output: script.includes('leftovers.patch') ? 'NONE' : '' };
    },
    read: async () => null,
    write: async () => undefined,
    files: async () => [],
    session: async () => {
      throw new CloudError('Las Boxes de la demo no tienen terminal: sus sesiones son de mentira.', 'other');
    },
    browser: async () => true,
  };
}

/**
 * The demo's cloud: one fake account and gh login, nothing to pick up after a restart. No Claude token or keys, so
 * each cloud agent signs in in their terminal (demoSignIn), and expireSignIns signs every Box out again.
 */
function demoCloud(): CloudBackend {
  const logins = new Map<string, Set<string>>();
  const account = demoBoxes(logins);
  return {
    boxes: () => account,
    env: () => ({}),
    ghToken: async () => 'demo-github-token-0000',
    gitIdentity: async (login) => ({ name: login ?? 'Demo Manager', email: 'demo@example.com' }),
    reconnect: async () => [], // fake sessions end with the office
    detach: () => undefined,
    signIn: (o, exited) => demoSignIn(o, logins, exited),
    expireSignIns: () => {
      const ours = new Set(logins.keys());
      logins.clear();
      for (const s of [...signOuts.values()]) if (ours.has(s.boxId)) s.end();
    },
  };
}

/** Where the demo's sign-ins send the manager: nowhere real. */
const DEMO_SIGN_IN = { claude: 'https://example.com/sareoffice-demo/claude-sign-in', codex: 'https://example.com/sareoffice-demo/codex-device' };

/**
 * The demo's sign-in in a cloud agent's terminal, drawn as each CLI's own one looks, with a made-up link: Enter (after
 * pasting anything, for Claude Code) finishes it, and the fake account remembers the Box as signed in.
 */
function demoSignIn(o: { boxId: string; cli: 'claude' | 'codex'; term: AgentTerminal }, logins: Map<string, Set<string>>, exited: (code: number) => void): BoxSignIn {
  const { term } = o;
  const claude = o.cli === 'claude';
  term.note(`── Iniciando sesión en ${claude ? 'Claude Code' : 'Codex'} · ☁ máquina en la nube (demo) ──`);
  term.write(
    (claude
      ? ['Opening browser to sign in…', `If the browser didn't open, visit: ${DEMO_SIGN_IN.claude}`, '', '\x1b[2m(demo) Pega cualquier cosa y pulsa Enter.\x1b[0m', 'Paste code here if prompted > ']
      : [
          'Welcome to Codex (demo)',
          '',
          'Follow these steps to sign in with ChatGPT using device code authorization:',
          '',
          '1. Open this link in your browser and sign in to your account',
          `   ${DEMO_SIGN_IN.codex}`,
          '',
          '2. Enter this one-time code (expires in 15 minutes)',
          '   DEMO-0000',
          '',
          '\x1b[2m(demo) Pulsa Enter aquí cuando lo hayas hecho.\x1b[0m',
        ]
    ).join('\r\n'),
  );
  let line = '';
  let over = false;
  const close = () => {
    over = true;
    term.bind(null);
  };
  term.bind({
    write: (data) => {
      for (const ch of data.replace(/\x1b\[[0-9;?]*[A-Za-z~]|\x1b./g, '')) {
        if (over) return;
        if (ch === '\r') {
          if (claude && !line.trim()) continue;
          term.write(`\r\n\x1b[32m${claude ? 'Login successful.' : 'Successfully logged in'}\x1b[0m\r\n`);
          const set = logins.get(o.boxId) ?? new Set<string>();
          set.add(o.cli);
          logins.set(o.boxId, set);
          close();
          exited(0);
        } else if (ch === '\x7f' || ch === '\b') line = line.slice(0, -1);
        else if (ch >= ' ') line += ch; // never echoed, as the real prompt doesn't
      }
    },
    resize: () => undefined,
  });
  return {
    stop: () => {
      if (over) return;
      close();
      term.note('── inicio de sesión cerrado ──');
    },
  };
}
