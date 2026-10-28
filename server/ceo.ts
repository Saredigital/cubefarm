import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { blockers, holdUps, setDependsOn } from '../shared/issues.ts';
import { PREVIEW_ENV_MAX_CHARS } from '../shared/previewEnv.ts';
import { FLOOR_SEATS, type AgentCli, type CeoJobKind, type QaStatus } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { LANGUAGE, ONE_TURN } from './prompts.ts';
import { MAX_TRIAGES, type TriagePr } from './triage.ts';

// The CEO: a Claude Code session in the lobby that runs the company instead of writing code.
// It studies each floor's repo, sizes its team of interchangeable agents from its throughput (team changes the
// manager approves, or that apply at once), plans work as GitHub issues, and writes each floor's QA brief. Everything
// it changes goes through the office tools below, so the swarm stays the single source of truth.

/** Refused file_issue: the CEO never decides on new work itself (askedFor). */
export const NOT_ASKED = 'Solo el responsable decide el trabajo nuevo, y no ha pedido ninguno en este trabajo. Sugiérelo en tu mensaje final; puede pedirte que lo abras.';

export interface CeoJob {
  kind: CeoJobKind;
  repoId?: string; // onboard / plan / triage
  prNumber?: number; // triage: the stuck pull request
  text?: string; // chat: the manager's message(s)
  at: number;
}

/** What the CEO's tools do. Implemented by the swarm; errors are returned to the CEO as tool errors. */
/** Jobs the manager started by asking for work: a plan from their brief, or their message. Only these may file issues. */
export const askedFor = (job: Pick<CeoJob, 'kind'>) => job.kind === 'plan' || job.kind === 'chat';

export interface OfficeHandlers {
  companyStatus(): string;
  agentDetail(a: { agent_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }): string;
  scaleTeam(a: { floor: number; size: number; reason: string; cli?: AgentCli; model?: string; effort?: string }): string;
  configureAgent(a: { agent_id: string; cli?: AgentCli | ''; model?: string; effort?: string }): string;
  fileIssue(a: { floor: number; title: string; body: string }): Promise<string>;
  setDependencies(a: { floor: number; number: number; depends_on: number[] }): Promise<string>;
  closeIssue(a: { floor: number; number: number; reason: string }): Promise<string>;
  retryQa(a: { floor: number; pr: number }): Promise<string>;
  sendBack(a: { floor: number; pr: number; note: string }): Promise<string>;
  rerunChecks(a: { floor: number; pr: number }): Promise<string>;
  closePull(a: { floor: number; pr: number; comment: string }): Promise<string>;
  escalate(a: { floor: number; pr: number; reason: string }): Promise<string>;
}

export interface OfficeTools {
  server: McpSdkServerConfigWithInstance;
  /** A fresh MCP server with the same tools, for one request from a CEO running in a terminal (served over HTTP). */
  serve(): McpSdkServerConfigWithInstance['instance'];
  /** Run a tool without a model in the loop (the demo CEO). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const CLI = z.enum(['claude', 'codex', 'opencode']);

export function createOfficeTools(h: OfficeHandlers): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Rechazado: ${(err as Error).message}` }], isError: true };
    }
  };
  const defs = [
    tool(
      'company_status',
      'Todo sobre la empresa ahora mismo: ajustes, cada planta (repo, ruta del clon, encargo, perfil, guía de QA), su equipo y su rendimiento, backlog, pull requests y QA, cambios de equipo pendientes del responsable y sus decisiones recientes. Llámala primero.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool(
      'agent_detail',
      'Un agente al completo: estado, tarea actual, y el agente de código, el modelo y el esfuerzo con que trabaja.',
      { agent_id: z.string().describe('Un id (o nombre) de company_status') },
      (a) => run(() => h.agentDetail(a)),
    ),
    tool(
      'set_floor_profile',
      'Registra tu lectura del proyecto de una planta: un resumen de una línea (tipo de proyecto y stack), la guía de QA que dice a los agentes qué comprobar al probar una pull request de este tipo de proyecto, y cómo arrancar la app para el monitor de vista previa de la planta. Escribe el resumen y la guía en español.',
      {
        floor: z.number().int().describe('Número de planta'),
        summary: z.string().max(140).optional().describe('p. ej. "Juego 3D para navegador · Three.js + Vite + TypeScript"'),
        qa_brief: z.string().max(2500).optional().describe('Qué debe comprobar QA en cada PR de este proyecto, en viñetas breves'),
        preview_command: z
          .string()
          .max(2000)
          .optional()
          .describe(
            'Comando de shell que sirve la app en el puerto {port} desde un checkout limpio tras npm install, p. ej. "npm run dev -- --port {port} --strictPort". PORT={port} siempre está definido. {tmp} es una carpeta temporal. Cadena vacía: vuelve al valor por defecto (npm run dev, si no start, si no preview). Defínelo solo cuando el valor por defecto no serviría la app en PORT.',
          ),
        // Not z.record(): the SDK can't turn it into JSON Schema, and one bad tool empties the whole tools/list.
        preview_env: z
          .object({})
          .catchall(z.string())
          .optional()
          .describe(
            `Variables de entorno adicionales para la vista previa; {port} y {tmp} se sustituyen en los valores. Reemplaza el conjunto entero. Como mucho ${PREVIEW_ENV_MAX_CHARS} caracteres en total, contando cada variable como CLAVE=valor más 2: solo lo que la app necesita para arrancar.`,
          ),
      },
      (a) => run(() => h.setFloorProfile(a)),
    ),
    tool(
      'scale_team',
      'Fija cuántos agentes tiene una planta. Cada agente construye issues, prueba pull requests y las corrige, lo que toque. Al crecer: los agentes nuevos esperan en Aprobaciones hasta que el responsable los configura y los acepta (o entran al momento cuando los cambios de equipo se aplican directamente). Al reducir: primero se van los agentes libres; uno ocupado se va cuando el responsable lo acepta o cuando termina.',
      {
        floor: z.number().int(),
        size: z.number().int().min(1).max(FLOOR_SEATS).describe('El tamaño de equipo que quieres, contando a todos los que ya están; como mucho el máximo de la planta en company_status'),
        reason: z.string().min(1).max(600).describe('Por qué, según el rendimiento de la planta. El responsable lo lee: escríbelo en español.'),
        cli: CLI.optional().describe('Agente de código de los nuevos agentes; omítelo para usar el de la oficina por defecto'),
        model: z.string().optional().describe('Modelo de los nuevos agentes; omítelo para usar el de por defecto'),
        effort: EFFORT.optional().describe('Esfuerzo de razonamiento de los nuevos agentes; omítelo para usar el de por defecto'),
      },
      (a) => run(() => h.scaleTeam(a)),
    ),
    tool(
      'configure_agent',
      'Cambia el agente de código, el modelo o el esfuerzo de razonamiento de un agente. Se aplica desde su siguiente tarea.',
      {
        agent_id: z.string(),
        cli: z.union([CLI, z.literal('')]).optional().describe('"" para el valor por defecto de la oficina'),
        model: z.string().optional().describe('"" para el valor por defecto'),
        effort: z.union([EFFORT, z.literal('')]).optional().describe('"" para el valor por defecto de la oficina'),
      },
      (a) => run(() => h.configureAgent(a)),
    ),
    tool(
      'file_issue',
      'Abre un issue de GitHub en una planta, solo para trabajo que el responsable haya pedido en este trabajo (un plan o su mensaje); cualquier otro se rechaza. El siguiente agente libre coge el siguiente issue que pueda empezar. Escribe el título y el cuerpo en español. Escribe "Depends on #N" en el cuerpo (exactamente así, en inglés, porque la oficina lo lee) solo cuando no pueda empezar hasta que se fusione #N: la oficina no lo empezará hasta que #N esté cerrado.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Contexto, qué construir, criterios de aceptación'),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'set_dependencies',
      'Reescribe la línea "Depends on #N" de un issue abierto en lugar de abrir uno duplicado. El resto del cuerpo se queda como está. No sirve para un issue en curso.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('El número del issue'),
        depends_on: z.array(z.number().int().positive()).max(10).describe('Issues a los que espera; [] para ninguno'),
      },
      (a) => run(() => h.setDependencies(a)),
    ),
    tool(
      'close_issue',
      'Cierra un issue abierto que ha quedado sustituido o ya no se quiere, como "not planned", con tu motivo como comentario. No mientras una pull request abierta lo cierre. No se borra nada.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('El número del issue'),
        reason: z.string().min(1).max(1000).describe('Se publica como comentario, p. ej. "Sustituido por #152."'),
      },
      (a) => run(() => h.closeIssue(a)),
    ),
    tool(
      'retry_qa',
      'Solo en triaje: da a una pull request atascada otra ronda de QA (una sesión inestable, o el problema ya se ha arreglado).',
      { floor: z.number().int(), pr: z.number().int().positive().describe('El número de la pull request') },
      (a) => run(() => h.retryQa(a)),
    ),
    tool(
      'send_back',
      'Solo en triaje: devuelve una pull request atascada a un desarrollador con los hallazgos de QA más tu nota, sin otra ronda de QA antes.',
      { floor: z.number().int(), pr: z.number().int().positive(), note: z.string().min(1).max(1000).describe('Qué debe hacer el desarrollador, p. ej. "Haz merge de main y conserva los dos cambios de la barra de herramientas."') },
      (a) => run(() => h.sendBack(a)),
    ),
    tool(
      'rerun_checks',
      'Solo en triaje: relanza las ejecuciones fallidas de GitHub Actions sobre el commit head de una pull request atascada (un check inestable o una caída) y luego la devuelve a la oficina.',
      { floor: z.number().int(), pr: z.number().int().positive() },
      (a) => run(() => h.rerunChecks(a)),
    ),
    tool(
      'close_pull',
      'Solo en triaje: cierra una pull request atascada cuyo enfoque es incorrecto, con tu comentario. Su issue sigue abierto para que se construya de nuevo. No se borra ninguna rama.',
      { floor: z.number().int(), pr: z.number().int().positive(), comment: z.string().min(1).max(1000).describe('Se publica en la PR: por qué se cierra') },
      (a) => run(() => h.closePull(a)),
    ),
    tool(
      'escalate',
      'Solo en triaje: pasa una pull request atascada al responsable con tu diagnóstico en una línea, cuando necesita una decisión que solo él puede tomar.',
      { floor: z.number().int(), pr: z.number().int().positive(), reason: z.string().min(1).max(300).describe('Una línea: qué falla y qué tiene que decidir el responsable') },
      (a) => run(() => h.escalate(a)),
    ),
  ];
  const server = createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs });
  return {
    server,
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No existe la herramienta de oficina ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}

// ---------- team size ----------

/** A floor's team as scale_team sees it. */
export interface TeamNow {
  agents: { id: string; desk: number; free: boolean }[];
  /** Pending hire requests, oldest first. */
  pendingHires: string[];
  /** Pending let-go requests and whom they're for. */
  pendingLetGos: { id: string; agentId: string }[];
}

/** How to reach a team size: requests to add or withdraw. The size counts pending requests as decided. */
export interface ScalePlan {
  size: number; // the size asked for, kept between 1 and the floor's max
  hire: number; // new hire requests
  cancelHires: string[]; // pending hire requests no longer wanted
  letGo: string[]; // agents to let go: idle ones first, then busy ones, the highest desks first
  cancelLetGos: string[]; // pending let-go requests no longer wanted
}

/** The team a floor will have once its pending requests are decided. */
export const plannedSize = (t: TeamNow) => t.agents.length + t.pendingHires.length - t.pendingLetGos.length;

/**
 * scale_team's arithmetic: withdraw requests that go the other way first (a let-go before a new hire, a waiting
 * candidate before someone who's working), then add what's still missing.
 */
export function scalePlan(t: TeamNow, size: number, max: number): ScalePlan {
  const target = Math.max(1, Math.min(max, Math.round(size)));
  const plan: ScalePlan = { size: target, hire: 0, cancelHires: [], letGo: [], cancelLetGos: [] };
  let diff = target - plannedSize(t);
  if (diff > 0) {
    plan.cancelLetGos = t.pendingLetGos.slice(0, diff).map((r) => r.id);
    plan.hire = diff - plan.cancelLetGos.length;
    return plan;
  }
  plan.cancelHires = t.pendingHires.slice(Math.max(0, t.pendingHires.length + diff)).reverse(); // the newest first
  diff += plan.cancelHires.length;
  const leaving = new Set(t.pendingLetGos.map((r) => r.agentId));
  plan.letGo = t.agents
    .filter((a) => !leaving.has(a.id))
    .sort((x, y) => Number(y.free) - Number(x.free) || y.desk - x.desk)
    .slice(0, -diff)
    .map((a) => a.id);
  return plan;
}

// ---------- prompts ----------

export function ceoSystemPrompt(o: {
  name: string;
  company: string;
  manager: string;
  notesFile: string;
  sessionLimit: number;
  maxAgents: number;
  scaling: 'approve' | 'auto';
}) {
  const manager = o.manager ? `el responsable, ${o.manager},` : 'el responsable humano';
  return [
    `Eres ${o.name}, CEO de ${o.company || 'una empresa de software autónoma'}, que funciona con sareoffice, su panel de control.`,
    `Cada proyecto (una planta, en tus herramientas) es un repositorio de GitHub con su propio equipo de agentes de código de IA. Los agentes son intercambiables: cada uno es una sesión de agente de código que coge lo siguiente que haya en el tablero de su planta. Un agente libre construye el siguiente issue en su propio worktree de git y abre una pull request; otro agente libre, en una sesión nueva, revisa y verifica cada pull request (revisión de código, tests, build y un navegador real con Playwright); las que fallan vuelven para corregirse. En las plantas con auto-merge activado, la oficina fusiona sola una PR cuando QA la aprueba y los checks de GitHub están en verde; en las demás, la fusiona ${manager}. El responsable es tu consejo de administración: decide los cambios de equipo.`,
    '',
    'Tu trabajo es dirigir la empresa, no escribir código:',
    '- Entiende cada proyecto: qué es, su stack y lo avanzado que está. Los proyectos son muy distintos: una web estática de marketing, un juego 3D para navegador y una API REST necesitan QA diferente.',
    `- Dimensiona el equipo de cada planta según su rendimiento (equipo, rendimiento y capacidad en company_status): hazlo crecer cuando haya issues listos para empezar o PRs pendientes de QA que siguen esperando a agentes libres, y redúcelo cuando haya agentes parados sin nada listo. Más agentes no siempre es más rápido: los agentes con el mismo agente de código comparten los límites de uso de una suscripción${o.sessionLimit ? `, como mucho se ejecutan ${o.sessionLimit} sesiones a la vez,` : ''} y muchos agentes en un mismo repositorio sobre todo añaden conflictos de merge, así que una planta rara vez necesita más de 4 a 6. Una planta admite como mucho ${o.maxAgents}. Cuando el responsable pida otro tamaño, hazle caso.`,
    '- Planifica el trabajo que pide el responsable (un trabajo de planificación a partir de su encargo, o su mensaje): conviértelo en issues de GitHub bien especificados, con criterios de aceptación. Un issue es una funcionalidad completa que el responsable reconocería (mensajes de voz, una jukebox, el mundo exterior), dimensionada para que un agente trabaje en ella hasta unas pocas horas. Los agentes tienen ventanas de contexto grandes y aguantan trabajos largos. Cada issue de más cuesta una exploración nueva, una PR, una ejecución de CI, una ronda de QA y, a menudo, un conflicto con sus PRs hermanas.',
    '- Divide una funcionalidad solo cuando sus partes sean de verdad independientes Y toquen ficheros distintos, o cuando una parte base arriesgada deba llegar y probarse primero. Nunca dividas una funcionalidad solo para dar algo que hacer a agentes parados: el trabajo en paralelo sale de funcionalidades distintas una al lado de otra. Los arreglos pequeños sin relación siguen siendo issues aparte.',
    '- Escribe la guía de QA de cada planta: qué debe comprobar cada pasada de QA en este tipo de proyecto (en un juego 3D: que el canvas se pinta, que los controles responden, que la tasa de fotogramas es fluida; en una web: enlaces, diseño en móvil, accesibilidad; en una API: códigos de estado, validación, casos de error).',
    '',
    'Cómo trabajas:',
    '- Llama primero a mcp__office__company_status. Lista cada planta, la ruta de su clon, el equipo, el backlog, las pull requests y los cambios de equipo pendientes del responsable.',
    '- Lee los repositorios desde las rutas de sus clones con Read, Glob y Grep. Para ti son de solo lectura. No puedes ejecutar comandos de shell.',
    `- Guarda notas duraderas sobre la empresa en ${o.notesFile}: léelas al empezar y actualízalas al final con las decisiones y todo lo que merezca la pena recordar la próxima vez.`,
    '- Cambia las cosas solo con las herramientas mcp__office__.',
    `- ${LANGUAGE}`,
    `- ${ONE_TURN}`,
    '',
    'Reglas:',
    '- Nunca decidas tú el trabajo nuevo. Solo el responsable pide cambios en sus proyectos: abre issues solo cuando los haya pedido en este trabajo. En revisiones, incorporaciones y triajes, sugiere el trabajo en tu mensaje final y que decida él.',
    '- Cada planta conserva al menos un agente.',
    `- Cambia el tamaño de una planta con una sola llamada a scale_team, con un motivo sobre el que el responsable pueda decidir en una o dos frases. ${o.scaling === 'auto' ? 'Los cambios de equipo se aplican directamente, dentro del máximo de la planta, así que piénsalo bien.' : 'El responsable aprueba cada cambio y configura a cada agente nuevo antes de contratarlo.'} Si el responsable rechazó un cambio parecido (recentDecisions), no vuelvas a pedirlo salvo que algo haya cambiado, y di qué.`,
    '- Los agentes usan el agente de código, el modelo y el esfuerzo por defecto de la oficina. Cambia los de un agente (configure_agent), o elígelos para agentes nuevos (scale_team), solo cuando el responsable lo pida o por un motivo claro.',
    '- Issues: los mismos agentes construyen y prueban, así que PRs en cola para QA (capacity.prsAwaitingQa) significan menos issues y más grandes, no más. La mayoría de los encargos necesitan de 1 a 4 issues. Escribe "Depends on #N" (exactamente así, en inglés: la oficina lo lee) solo cuando un issue de verdad no pueda empezar hasta que se fusione el código de #N, porque espera hasta que #N esté cerrado. Limita las cadenas de dependencias a dos pasos como mucho. La oficina empieza primero los issues que bloquean a otros. No dupliques issues abiertos: corrige las dependencias de un issue existente con set_dependencies. Abre como mucho 12 issues por trabajo, o por mensaje del responsable.',
    '- Cierra un issue sustituido o que ya no se quiere con close_issue, no haciéndolo esperar a otro issue.',
    '- Trabajos de triaje: una pull request se ha atascado (needs-human). Mírala antes que el responsable y llévale solo decisiones reales. Lee los datos del trabajo y el código, y llama exactamente a una de estas: retry_qa (una sesión de QA inestable, o ya se ha arreglado), send_back (un desarrollador puede arreglarla; tu nota dice cómo), rerun_checks (un check en rojo que parece inestable o una caída), close_pull (el enfoque es incorrecto: su issue sigue abierto para construirse de nuevo) o escalate (solo el responsable puede decidir: una decisión de producto, credenciales, una configuración rota).',
    '- Cuando company.usage en company_status diga pacing o paused, el uso de Claude se está agotando y la oficina está terminando primero el trabajo abierto: abre solo lo que haga falta a continuación, no un hito entero.',
    '- Tu mensaje final llega directamente al móvil del responsable. Que sea breve y sencillo, en español: qué has encontrado, qué has cambiado o pedido, qué has abierto y cualquier pregunta que necesites que te responda. Sin encabezados ni tablas.',
  ].join('\n');
}

export function ceoJobPrompt(job: CeoJob, floor: { floor: number; fullName: string; clone: string; mission: string; backlog: number } | null, pr?: TriagePr | null): string {
  switch (job.kind) {
    case 'triage':
      if (!floor || !pr) return `La pull request #${job.prNumber ?? '?'} ya no necesita triaje. Responde "Nada que hacer."`;
      return [
        `Triaje: la pull request #${pr.number} de la planta ${floor.floor} (${floor.fullName}) está atascada y necesita una decisión antes de llegar al responsable.`,
        `"${pr.title}" · ${pr.url} · clon de solo lectura de la rama por defecto en ${floor.clone}`,
        `Por qué se ha parado: ${pr.why ?? 'desconocido'}`,
        `Ronda de QA ${pr.round}. Resumen de QA: ${pr.summary ?? 'todavía ninguno'}`,
        pr.fixInstructions ? `Instrucciones de corrección de QA:\n${pr.fixInstructions}` : '',
        pr.mergeNote ? `Nota de merge: ${pr.mergeNote}` : '',
        `Checks de GitHub: ${pr.checks}${pr.failedChecks.length ? ` (fallidos: ${pr.failedChecks.join(', ')})` : ''}${pr.pendingChecks.length ? ` (en curso: ${pr.pendingChecks.join(', ')})` : ''} · mergeable: ${pr.mergeable} (${pr.mergeState})`,
        `Este es el triaje ${pr.triage} de ${MAX_TRIAGES} para esta PR; después irá directamente al responsable.`,
        '',
        `Averigua por qué está atascada y llama exactamente a una de retry_qa, send_back, rerun_checks, close_pull o escalate con floor ${floor.floor} y pr ${pr.number}. Si terminas sin llamar a ninguna, se avisa al responsable. Tu mensaje final: una o dos frases, en español, sobre lo que has encontrado y hecho.`,
      ]
        .filter((l) => l !== '')
        .join('\n');
    case 'onboard':
      if (!floor) return 'Se añadió una planta, pero ya se ha eliminado. Responde "Nada que hacer."';
      return [
        `La planta ${floor.floor} (${floor.fullName}) acaba de incorporarse a la empresa. Su clon de solo lectura está en ${floor.clone}.`,
        'Estúdiala: README, manifiesto de paquetes, estructura del código, tests y lo avanzado que está. Después:',
        '1. set_floor_profile con un resumen de una línea y una guía de QA para este proyecto, en español. Si npm run dev / start / preview no sirvieran la app en PORT, define también preview_command (y preview_env) para que el monitor de vista previa de la planta pueda arrancarla.',
        '2. scale_team al tamaño que necesita el trabajo previsto. La planta empieza con un agente; de dos a cuatro suele bastar para empezar.',
        '3. Contrasta los issues abiertos con ese tamaño: el equipo crece más adelante si el trabajo sigue esperando a agentes libres.',
        floor.mission
          ? `4. El encargo del responsable para esta planta, para tus notas: """${floor.mission}"""\nNo abras issues: planificarlo es un trabajo aparte, cuando el responsable lo pida.`
          : floor.backlog === 0
            ? '4. No hay encargo y el backlog está vacío. No abras issues; sugiere en tu mensaje final lo que el responsable podría querer a continuación.'
            : `4. Hay ${floor.backlog} issues abiertos. Déjalos como están y no abras ninguno nuevo; solo asegúrate de que el tamaño del equipo encaja con ellos.`,
      ].join('\n');
    case 'plan':
      if (!floor) return 'Se ha eliminado una planta que te pidieron planificar. Responde "Nada que hacer."';
      return [
        `El responsable tiene un encargo para la planta ${floor.floor} (${floor.fullName}, clon en ${floor.clone}):`,
        `"""${floor.mission}"""`,
        '',
        'Planifica el siguiente hito hacia él:',
        `- Lee primero el código actual y los ${floor.backlog} issues abiertos, para construir sobre lo que existe y no duplicar nada.`,
        '- Un issue por funcionalidad completa. Divide una funcionalidad solo cuando sus partes sean independientes y toquen ficheros distintos, o cuando una parte base arriesgada deba llegar primero. Solo en un repositorio vacío o casi vacío va primero un issue de esqueleto, con los demás dependiendo de él.',
        '- Abre los issues, en español.',
        '- Asegúrate de que el tamaño del equipo encaja con el trabajo: scale_team cuando los issues listos fueran a seguir esperando a agentes libres.',
        '- Actualiza el perfil de la planta y la guía de QA si el encargo cambia lo que es el proyecto.',
      ].join('\n');
    case 'review':
      return [
        'Revisión periódica de la empresa. En cada planta, mira:',
        '- plantas sin perfil o sin guía de QA: estúdialas y escribe uno',
        '- tamaño del equipo frente al rendimiento: trabajo que sigue esperando a agentes libres (crecer), o agentes parados sin nada listo para empezar o probar (reducir). Que haya agentes parados no es motivo para trocear funcionalidades.',
        '- backlog frente al equipo (capacity): cadenas de dependencias largas (corrígelas con set_dependencies), o PRs que se acumulan en QA (entonces planifica menos issues y más grandes)',
        '- pull requests atascadas en QA o marcadas como pendientes de una persona',
        '- plantas con encargo y backlog vacío: dilo y sugiere lo que el responsable podría pedir a continuación (no abras issues: solo él decide el trabajo nuevo)',
        'Cambia el tamaño de los equipos solo cuando esté claramente justificado. Si no hay nada que hacer, responde con una frase breve que lo diga.',
      ].join('\n');
    case 'chat':
      return `Mensaje del responsable (lee tu respuesta en el móvil):\n${job.text ?? ''}`;
  }
}

export function jobLabel(job: CeoJob, floor: { floor: number; fullName: string } | null) {
  const where = floor ? `planta ${floor.floor} · ${floor.fullName.split('/')[1] ?? floor.fullName}` : 'una planta eliminada';
  switch (job.kind) {
    case 'onboard':
      return `Incorporando ${where}`;
    case 'plan':
      return `Planificando ${where}`;
    case 'review':
      return 'Revisando la empresa';
    case 'chat':
      return 'Respondiéndote';
    case 'triage':
      return `Triaje de la PR #${job.prNumber ?? '?'} · ${where}`;
  }
}

// ---------- issues ----------

/**
 * The CEO's issue cap: at most `max` issues per request from the manager. A manager message that arrives while the
 * job runs is a new request, so it resets the count.
 */
export class IssueCap {
  filed = 0; // since the job started or the manager's last message
  total = 0; // in the whole job
  readonly repos = new Set<string>(); // floors that got issues, to refresh when the job ends
  constructor(readonly max: number) {}

  check() {
    if (this.filed >= this.max) throw new Error(`Ya has abierto ${this.max} issues en este trabajo. Es suficiente para un hito. El próximo mensaje del responsable permite más.`);
  }

  record(repoId: string) {
    this.filed++;
    this.total++;
    this.repos.add(repoId);
  }

  managerMessage() {
    this.filed = 0;
  }
}

export interface DependsRequest {
  floor: number;
  number: number;
  dependsOn: number[]; // [] = no dependencies
  issues: { number: number; body: string }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
}

export interface DependsPlan {
  body: string | null; // null: leave the body alone
  summary: string;
}

/** Longest chain of open issues this one waits for, one step per "Depends on". */
function waitsDepth(n: number, deps: Map<number, number[]>, seen = new Set<number>()): number {
  if (seen.has(n)) return 0;
  seen.add(n);
  const depth = Math.max(0, ...(deps.get(n) ?? []).map((d) => waitsDepth(d, deps, seen) + 1));
  seen.delete(n);
  return depth;
}

/**
 * What set_dependencies changes, or why it refuses: a closed or unknown issue, one in progress, a dependency on
 * itself, on a closed or unknown issue, a cycle, or a chain deeper than two steps.
 */
export function planDependencies(r: DependsRequest): DependsPlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} está cerrado.` : `No hay ningún issue abierto #${r.number} en la planta ${r.floor}.`);
  if (r.inProgress) throw new Error(`#${r.number} ya está en curso, así que sus dependencias no pueden cambiar.`);
  const deps = [...new Set(r.dependsOn.map(Number))];
  const open = new Set(r.issues.map((i) => i.number));
  for (const d of deps) {
    if (d === r.number) throw new Error(`#${r.number} no puede depender de sí mismo.`);
    if (!open.has(d)) throw new Error(r.closed(d) ? `#${d} está cerrado, así que no hay nada que esperar.` : `No hay ningún issue abierto #${d} en la planta ${r.floor}.`);
  }
  const body = setDependsOn(issue.body, deps);
  const after = r.issues.map((i) => (i.number === r.number ? { ...i, body } : i));
  const waits = new Map(after.map((i) => [i.number, blockers(i.body, open)]));
  const loop = deps.find((d) => reaches(d, r.number, waits));
  if (loop !== undefined) throw new Error(`#${loop} ya espera a #${r.number}, directamente o a través de otros issues, así que eso sería un ciclo.`);
  const depth = waitsDepth(r.number, waits) + (holdUps(after).get(r.number)?.chain ?? 0);
  if (depth > 2) throw new Error(`Eso crea una cadena de dependencias de ${depth} pasos a través de #${r.number}. Limita las cadenas a 2 pasos como mucho: junta las partes dependientes en un solo issue en lugar de dividir más.`);
  return {
    body: body !== issue.body ? body : null,
    summary: `#${r.number} en la planta ${r.floor}: ${deps.length ? `depende de ${deps.map((d) => `#${d}`).join(', ')}` : 'sin dependencias'}.`,
  };
}

// ---------- capacity ----------

export interface FloorCapacity {
  issuesWaitingOnOthers: number; // not started yet and waiting for another open issue
  longestDependencyChain: number;
  prsAwaitingQa: number; // open PRs queued for or in QA, re-test rounds included
  prsBeingFixed: number; // open PRs back for fixes: waiting for an agent, or being fixed
}

/** The backlog, QA and fix numbers in company_status, so the CEO can see where work waits for agents. */
export function floorCapacity(f: {
  issues: { number: number; body: string }[]; // the floor's open issues
  inProgress: (n: number) => boolean;
  openPrs: number[];
  qa: { prNumber: number; status: QaStatus }[]; // the floor's QA records
}): FloorCapacity {
  const open = new Set(f.issues.map((i) => i.number));
  const prs = new Set(f.openPrs);
  return {
    issuesWaitingOnOthers: f.issues.filter((i) => !f.inProgress(i.number) && blockers(i.body, open).length > 0).length,
    longestDependencyChain: Math.max(0, ...[...holdUps(f.issues).values()].map((w) => w.chain)),
    prsAwaitingQa: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'queued' || q.status === 'testing')).length,
    prsBeingFixed: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'failed' || q.status === 'fixing')).length,
  };
}

/**
 * Whether close_issue may close an issue: only one open on that floor (`state` is its state in the floor's repo;
 * null when unknown), and never one an open pull request closes.
 */
export function checkCloseIssue(r: { floor: number; number: number; state: 'OPEN' | 'CLOSED' | null; pulls: { number: number; state: string; closesIssues: number[] }[] }) {
  if (r.state === 'CLOSED') throw new HttpError(404, `#${r.number} de la planta ${r.floor} ya está cerrado.`);
  if (r.state !== 'OPEN') throw new HttpError(404, `No hay ningún issue abierto #${r.number} en la planta ${r.floor}.`);
  const pr = r.pulls.find((p) => p.state === 'OPEN' && p.closesIssues.includes(r.number));
  if (pr) throw new HttpError(409, `La PR #${pr.number} cierra #${r.number}. Cierra o termina antes esa pull request.`);
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}
