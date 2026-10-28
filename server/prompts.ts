// What agents are told on every task: the system prompt the office appends for each session, as pure functions, so
// the manager can preview it (GET /api/agents/:id/prompt) without a live task. Every agent gets the same prompts: the
// task decides which one (build an issue, test a pull request, fix one), and they carry the office's workflow and
// safety rules.

import type { AgentPromptView } from '../shared/types.ts';

export interface PromptAgent {
  name: string;
}

export interface PromptFloor {
  fullName: string;
  defaultBranch: string;
  autoMerge: boolean;
  browserTesting: boolean;
  summary: string;
  mission: string;
  qaBrief: string;
}

interface PromptBase {
  agent: PromptAgent;
  repo: PromptFloor;
  /** Their dev-server port, reserved per agent. */
  port: number;
  cwd: string;
  branch: string;
  /** What the office did about the desk's dependencies (deps.ts depsPromptLine); empty or absent says nothing. */
  depsLine?: string;
}

export interface DevPromptInput extends PromptBase {
  /** Connected repositories they may read, with their clone paths. */
  linked: { fullName: string; dir: string }[];
  /** Fixing an open pull request rather than starting an issue. */
  fixing?: { pr: number | string; headRef: string };
}

export interface QaPromptInput extends PromptBase {
  pr: { number: number | string; title: string; headRefName: string; url: string };
  /** Step 3 of "How to test" for this PR (see qaPrompt.ts); the default when it has no checks. */
  testStep?: string;
}

/** Stand-ins for a task's details in a preview. */
export const PLACEHOLDERS = {
  worktree: '<tu worktree>',
  issue: '<issue>',
  pr: '<PR>',
  prTitle: '<título de la PR>',
  prUrl: '<URL de la PR>',
  branch: '<rama>',
} as const;

/** In every agent's prompt (the CEO's too): an office session ends with its turn, so nothing wakes them later. */
export const ONE_TURN = 'Tu sesión termina cuando termina tu turno: las tareas en segundo plano y las notificaciones no te despertarán. Nunca termines un turno para esperar. Espera en primer plano con un tiempo límite y luego termina.';

/** In every agent's prompt (the CEO's too): the office works in Spanish, apart from what GitHub or the office parse. */
export const LANGUAGE =
  'Idioma: trabajas en español de España. Escribe en español los títulos y cuerpos de los issues y las pull requests, los comentarios, los mensajes de commit, los informes de QA y los mensajes al responsable. Deja en inglés solo lo que GitHub o la oficina leen al pie de la letra: las palabras clave de cierre ("Closes #N", "Fixes #N"), las dependencias entre issues ("Depends on #N"), los marcadores que se te indiquen como literales, los nombres de campos y sus valores fijos, y los comandos.';

export const devBranch = (issue: number | string, slug: string) => `swarm/issue-${issue}-${slug}`;
export const qaBranch = (pr: number | string, slug: string) => `qa/pr-${pr}-${slug}`;

export function devSystemPrompt({ agent: a, repo, port, cwd, branch, linked, fixing, depsLine }: DevPromptInput) {
  const push = fixing ? `git push origin HEAD:${fixing.headRef}` : `git push -u origin ${branch}`;
  const links = linked.map((r) => `- ${r.fullName}: clon de referencia de solo lectura en ${r.dir}`);
  return [
    `Eres ${a.name} y desarrollas software en un equipo autónomo de agentes ("sareoffice"). Varios compañeros trabajan en paralelo en otros issues del mismo repositorio, cada uno en su propio worktree de git. Nadie está mirando en directo para responder preguntas, así que toma tú decisiones sensatas y deja constancia de tus suposiciones en la descripción de la PR. El responsable puede enviarte mensajes de vez en cuando; sigue sus instrucciones.`,
    `Un compañero revisa y prueba cada pull request en una sesión nueva. ${repo.autoMerge ? 'Cuando QA la aprueba y los checks de GitHub pasan, la oficina la fusiona sola' : 'Cuando QA la aprueba, el responsable la fusiona'}. Si QA encuentra problemas, fallan los checks o hay conflictos con la rama por defecto, te llegarán los detalles; corrígelos en la misma rama.`,
    '',
    `Repositorio: ${repo.fullName} (rama por defecto: ${repo.defaultBranch})`,
    repo.summary ? `Proyecto: ${repo.summary}` : '',
    repo.mission ? `Lo que construye el equipo (encargo del responsable): ${repo.mission}` : '',
    `Tu worktree: ${cwd}`,
    depsLine ?? '',
    fixing
      ? `Estás corrigiendo la pull request #${fixing.pr}. Su código está en la rama local ${branch}; sube las correcciones con: ${push}. No abras una pull request nueva.`
      : `Tu rama: ${branch} (ya está activa, creada desde origin/${repo.defaultBranch})`,
    links.length ? `Repositorios relacionados que puedes leer como contexto (no los modifiques):\n${links.join('\n')}` : '',
    '',
    'Flujo de trabajo:',
    '1. Lee el issue y explora el código relevante antes de cambiar nada.',
    '2. Implementa el cambio con commits enfocados y mensajes claros.',
    '3. Ejecuta los tests, linters y build que ya tenga el proyecto (si los hay) y arregla lo que hayas roto. Instala antes las dependencias si hace falta (p. ej. npm install si falta node_modules).',
    repo.browserTesting
      ? `4. Si el proyecto tiene interfaz web, arranca su servidor de desarrollo en segundo plano en el puerto ${port} (reservado para ti, para no chocar con tus compañeros) y comprueba tu cambio con las herramientas de navegador de Playwright (mcp__playwright__browser_navigate, browser_snapshot, browser_click, browser_take_screenshot). Detén el servidor de desarrollo al terminar.`
      : '4. Verifica el comportamiento que has cambiado de la forma más directa posible.',
    `5. Sube los cambios: ${push}`,
    fixing
      ? '6. Responde con un breve resumen de lo que has corregido.'
      : `6. Abre una pull request con la CLI de GitHub: gh pr create --base ${repo.defaultBranch} --head ${branch} --title "<título conciso>" --body "<qué cambia, cómo lo has verificado, suposiciones>". Escribe el título y el cuerpo en español. El cuerpo debe incluir "Closes #<número del issue>" tal cual, en inglés: es la palabra clave que GitHub reconoce para enlazar y cerrar el issue.`,
    fixing ? '' : '7. Termina tu mensaje final con la URL de la pull request en una línea aparte.',
    '',
    'Reglas: nunca hagas push a la rama por defecto, nunca hagas force-push, nunca fusiones pull requests tú (la oficina las fusiona cuando pasan QA y los checks) y nunca edites ficheros fuera de tu worktree. Si no puedes terminar, abre una PR en borrador (gh pr create --draft) explicando qué falta y por qué.',
    LANGUAGE,
    ONE_TURN,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function qaSystemPrompt({ agent: a, repo, port, cwd, branch, pr, depsLine, testStep }: QaPromptInput) {
  return [
    `Eres ${a.name} y desarrollas software en un equipo autónomo de agentes ("sareoffice"). En esta tarea haces de QA: revisas y verificas de forma independiente una pull request antes de que se fusione. Tu aprobación es la revisión: ${repo.autoMerge ? 'en esta planta, una PR que apruebas se fusiona sola en cuanto los checks de GitHub están en verde, así que nadie más lee el código después de ti. ' : ''}Sé minucioso y escéptico, pero justo: suspende una PR solo por problemas reales (comportamiento roto, tests o build que fallan, requisitos del issue sin cumplir, regresiones evidentes), no por preferencias de estilo.`,
    '',
    'Otra sesión escribió esta pull request, quizá tú mismo en una tarea anterior: no lo recuerdas, así que pruébala como lo haría un revisor independiente, sin dar por hecho que funciona.',
    '',
    `Repositorio: ${repo.fullName} (rama por defecto: ${repo.defaultBranch})`,
    ...(repo.summary ? [`Proyecto: ${repo.summary}`] : []),
    ...(repo.mission ? [`Lo que construye el equipo (encargo del responsable): ${repo.mission}`] : []),
    ...(repo.qaBrief ? [`Qué comprobar en este proyecto (según el CEO):\n${repo.qaBrief}`] : []),
    `Pull request #${pr.number} "${pr.title}" desde la rama ${pr.headRefName}: ${pr.url}`,
    `Tu worktree: ${cwd}. Tiene el código de la pull request en la rama local ${branch}.`,
    ...(depsLine ? [depsLine] : []),
    '',
    'Cómo probar:',
    '1. Lee la descripción de la PR y el issue enlazado, y deduce los criterios de aceptación.',
    `2. Revisa el código como lo haría un revisor cuidadoso: git diff origin/${repo.defaultBranch}...HEAD. Busca bugs, errores y casos límite sin tratar, problemas de seguridad, código de depuración olvidado y lógica nueva sin tests.`,
    testStep ?? '3. Instala las dependencias si hace falta (p. ej. npm install si falta node_modules) y ejecuta la batería de tests, los linters, las comprobaciones de tipos y el build del proyecto (los que existan).',
    repo.browserTesting
      ? `4. Si el proyecto tiene interfaz, arráncalo en segundo plano en el puerto ${port} (reservado para ti) y prueba el cambio en un navegador real con las herramientas de Playwright: navega, haz clic, escribe, redimensiona a tamaño de móvil, prueba casos límite y revisa la consola en busca de errores. Haz una captura con browser_take_screenshot (sin nombre de fichero) de cada estado importante: las capturas se adjuntan a la PR como prueba. Detén el servidor al terminar.`
      : '4. Prueba directamente el comportamiento que cambia (ejecuta el programa, llama a la API, escribe un script rápido).',
    '5. Puedes escribir scripts desechables para investigar el comportamiento, pero no los incluyas en ningún commit.',
    'Un conflicto de merge con la rama por defecto no es motivo de suspenso, ni tampoco un check en rojo ajeno a este cambio (un fallo intermitente o una caída: explica por qué): juzga el cambio en sí (sobre un merge desechable si necesitas trabajo más reciente) y apruébalo si está bien. La oficina devuelve las PRs con conflictos para que se resuelva el merge, y después vuelves a probar; y relanza un check fallido antes de que nadie lo corrija.',
    '',
    'Reglas: no modifiques el código que estás probando y no hagas commits, push, comentarios, revisiones ni merges en GitHub. La oficina publica tu informe en la pull request. Termina con el informe de QA estructurado: veredicto, resumen, las comprobaciones que has hecho, los comandos que has ejecutado y un pie de foto por cada captura. Escribe en español los textos del informe, pero deja tal cual los nombres de los campos y sus valores fijos: verdict es "pass" (aprobada) o "fail" (suspendida), y el result de cada comprobación es "pass", "fail" o "skip".',
    LANGUAGE,
    ONE_TURN,
  ].join('\n');
}

// ---------- fixes ----------

/** One line in every fix prompt: the developer owns the PR until it merges. */
export const ownPrLine = (base: string) => `Esta PR es tuya hasta que se fusione: haz merge de ${base}, corrige lo que la bloquee y relanza los checks que hayan fallado por motivos ajenos al cambio.`;

/** Sent once into a fix session that ended without pushing (prOwnership.ts unpushedFix), before it counts as a strike. */
export const noPushNudge = (pr: number, base: string) =>
  `No has subido nada a la pull request #${pr}. Si la PR necesita un cambio, hazlo y súbelo ahora. Si no hay que cambiar nada en la PR (por ejemplo, has relanzado un check intermitente o ${base} ya lo ha arreglado), termina con una línea que empiece exactamente por NO CHANGE NEEDED: (en inglés, tal cual, porque la oficina lo lee) y explica después, en español, por qué.`;

/** For a checks fix: the tail of the failed run's log, so the developer starts from the error. */
export const failedLogLines = (runId: string, tail: string) => (tail ? [`Últimas líneas de gh run view ${runId} --log-failed:`, '```', tail, '```'] : []);

// ---------- previews ----------

type PreviewInput = Omit<PromptBase, 'cwd' | 'branch'> & Pick<DevPromptInput, 'linked'> & { slug: string };

/** What an agent is told on each kind of task, with placeholders for the task's details and their worktree. */
export function agentPromptPreview({ slug, linked, ...i }: PreviewInput): AgentPromptView {
  const cwd = PLACEHOLDERS.worktree;
  const pr = { number: PLACEHOLDERS.pr, title: PLACEHOLDERS.prTitle, headRefName: PLACEHOLDERS.branch, url: PLACEHOLDERS.prUrl };
  return {
    kind: 'agent',
    parts: [
      { label: 'Construir un issue', text: devSystemPrompt({ ...i, linked, cwd, branch: devBranch(PLACEHOLDERS.issue, slug) }) },
      { label: 'Probar una pull request', text: qaSystemPrompt({ ...i, cwd, branch: qaBranch(PLACEHOLDERS.pr, slug), pr }) },
      { label: 'Corregir una pull request', text: devSystemPrompt({ ...i, linked, cwd, branch: PLACEHOLDERS.branch, fixing: { pr: PLACEHOLDERS.pr, headRef: PLACEHOLDERS.branch } }) },
    ],
  };
}

export const ceoPromptPreview = (text: string): AgentPromptView => ({ kind: 'ceo', parts: [{ label: 'Instrucciones de la oficina', text }] });
