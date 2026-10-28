import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { QaStatus } from '../shared/types.ts';
import type { HttpError } from './httpError.ts';
import { ceoJobPrompt, ceoSystemPrompt, checkCloseIssue, createOfficeTools, floorCapacity, IssueCap, jobLabel, planDependencies, plannedSize, scalePlan, type CeoJob, type DependsRequest, type TeamNow } from './ceo.ts';

describe('scalePlan (scale_team)', () => {
  // Desks 0-3: Ada and Linus are free, Grace and Alan busy; one new agent waits in the lobby.
  const team = (over: Partial<TeamNow> = {}): TeamNow => ({
    agents: [
      { id: 'ada', desk: 0, free: true },
      { id: 'grace', desk: 1, free: false },
      { id: 'linus', desk: 2, free: true },
      { id: 'alan', desk: 3, free: false },
    ],
    pendingHires: ['h1'],
    pendingLetGos: [],
    ...over,
  });

  it('counts waiting team changes as decided', () => {
    expect(plannedSize(team())).toBe(5);
    expect(plannedSize(team({ pendingLetGos: [{ id: 'l1', agentId: 'ada' }] }))).toBe(4);
  });

  it('grows by the difference', () => {
    expect(scalePlan(team(), 7, 10)).toEqual({ size: 7, hire: 2, cancelHires: [], letGo: [], cancelLetGos: [] });
  });

  it('withdraws a waiting let-go before asking for anyone new', () => {
    expect(scalePlan(team({ pendingHires: [], pendingLetGos: [{ id: 'l1', agentId: 'ada' }] }), 5, 10)).toEqual({ size: 5, hire: 1, cancelHires: [], letGo: [], cancelLetGos: ['l1'] });
  });

  it('withdraws waiting new agents, the newest first, before letting anyone go', () => {
    expect(scalePlan(team({ pendingHires: ['h1', 'h2'] }), 4, 10)).toEqual({ size: 4, hire: 0, cancelHires: ['h2', 'h1'], letGo: [], cancelLetGos: [] });
    expect(scalePlan(team({ pendingHires: ['h1', 'h2', 'h3'] }), 1, 10).cancelHires).toEqual(['h3', 'h2', 'h1']);
  });

  it('lets idle agents go first, from the highest desk', () => {
    expect(scalePlan(team(), 3, 10)).toEqual({ size: 3, hire: 0, cancelHires: ['h1'], letGo: ['linus'], cancelLetGos: [] });
    expect(scalePlan(team(), 1, 10).letGo).toEqual(['linus', 'ada', 'alan']);
  });

  it('skips agents already leaving', () => {
    expect(scalePlan(team({ pendingHires: [], pendingLetGos: [{ id: 'l1', agentId: 'linus' }] }), 2, 10).letGo).toEqual(['ada']);
  });

  it("keeps at least one agent, and no more than the floor's max", () => {
    expect(scalePlan(team(), 0, 10).size).toBe(1);
    expect(scalePlan(team(), 40, 10)).toMatchObject({ size: 10, hire: 5 });
    expect(scalePlan(team({ pendingHires: [] }), 4, 10)).toEqual({ size: 4, hire: 0, cancelHires: [], letGo: [], cancelLetGos: [] });
  });
});

describe('jobLabel', () => {
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, repoId: 'r1', at: 0 });
  const floor = { floor: 3, fullName: 'leonvanzyl/office-swarm' };

  it('names the floor and repo for floor jobs', () => {
    expect(jobLabel(job('onboard'), floor)).toBe('Incorporando planta 3 · office-swarm');
    expect(jobLabel(job('plan'), floor)).toBe('Planificando planta 3 · office-swarm');
  });

  it('falls back to the full name when it has no owner', () => {
    expect(jobLabel(job('plan'), { floor: 1, fullName: 'solo' })).toBe('Planificando planta 1 · solo');
  });

  it('says so when the floor is gone', () => {
    expect(jobLabel(job('onboard'), null)).toBe('Incorporando una planta eliminada');
    expect(jobLabel(job('plan'), null)).toBe('Planificando una planta eliminada');
  });

  it('labels company-wide jobs without a floor', () => {
    expect(jobLabel(job('review'), floor)).toBe('Revisando la empresa');
    expect(jobLabel(job('review'), null)).toBe('Revisando la empresa');
    expect(jobLabel({ kind: 'chat', text: 'hi', at: 0 }, null)).toBe('Respondiéndote');
  });

  it('names the PR for a triage', () => {
    expect(jobLabel({ kind: 'triage', repoId: 'r1', prNumber: 108, at: 0 }, floor)).toBe('Triaje de la PR #108 · planta 3 · office-swarm');
  });
});

// The CEO only sees the office tools if the whole list converts to JSON Schema: one schema the SDK can't handle
// (z.record did this) empties tools/list, and the CEO silently loses every tool.
describe('office tools', () => {
  const connect = async () => {
    const floors: unknown[] = [];
    const office = createOfficeTools({
      companyStatus: () => '{}',
      agentDetail: () => '{}',
      setFloorProfile: (a) => (floors.push(a), 'saved'),
      scaleTeam: () => '',
      configureAgent: () => '',
      fileIssue: async () => '',
      setDependencies: async () => '',
      closeIssue: async () => '',
      retryQa: async () => '',
      sendBack: async () => '',
      rerunChecks: async () => '',
      closePull: async () => '',
      escalate: async () => '',
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await office.server.instance.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    return { client, floors };
  };

  it('lists every tool the CEO relies on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'agent_detail',
      'close_issue',
      'close_pull',
      'company_status',
      'configure_agent',
      'escalate',
      'file_issue',
      'rerun_checks',
      'retry_qa',
      'scale_team',
      'send_back',
      'set_dependencies',
      'set_floor_profile',
    ]);
  });

  it('still takes preview_env as a map of strings', async () => {
    const { client, floors } = await connect();
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } } });
    expect(floors).toEqual([{ floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } }]);
  });
});

describe('checkCloseIssue (close_issue)', () => {
  const pulls = [
    { number: 20, state: 'OPEN', closesIssues: [4] },
    { number: 21, state: 'MERGED', closesIssues: [5] },
    { number: 22, state: 'CLOSED', closesIssues: [6] },
  ];
  const status = (state: 'OPEN' | 'CLOSED' | null, number = 6) => {
    try {
      checkCloseIssue({ floor: 1, number, state, pulls });
      return 'ok';
    } catch (err) {
      return (err as HttpError).status;
    }
  };

  it('closes an open issue, even one a merged or closed PR once named', () => {
    expect(status('OPEN')).toBe('ok');
    expect(status('OPEN', 5)).toBe('ok');
  });

  it('refuses a closed or unknown issue, which is how another floor\'s issue looks too', () => {
    expect(status('CLOSED')).toBe(404);
    expect(status(null)).toBe(404);
    expect(() => checkCloseIssue({ floor: 2, number: 6, state: 'CLOSED', pulls })).toThrow('#6 de la planta 2 ya está cerrado.');
  });

  it('refuses an issue an open PR closes', () => {
    expect(status('OPEN', 4)).toBe(409);
    expect(() => checkCloseIssue({ floor: 1, number: 4, state: 'OPEN', pulls })).toThrow('La PR #20 cierra #4. Cierra o termina antes esa pull request.');
  });
});

describe('planDependencies (set_dependencies)', () => {
  // #1 ← #2 ← #3 is a two-step chain; #5 waits for #4; #9 is closed.
  const base: DependsRequest = {
    floor: 1,
    number: 4,
    dependsOn: [],
    issues: [
      { number: 1, body: 'Set up the skeleton' },
      { number: 2, body: 'Depends on #1' },
      { number: 3, body: 'Depends on #2\n\nThe rest' },
      { number: 4, body: 'Some text' },
      { number: 5, body: 'Intro\n\nDepends on #4\n\nMore' },
      { number: 6, body: 'Free' },
    ],
    closed: (n) => n === 9,
    inProgress: false,
  };
  const deps = (over: Partial<DependsRequest>) => planDependencies({ ...base, ...over });

  it('rewrites the Depends on line and leaves the rest of the body alone', () => {
    expect(deps({ number: 5, dependsOn: [6] }).body).toBe('Depends on #6\n\nIntro\n\nMore');
    expect(deps({ number: 5, dependsOn: [] }).body).toBe('Intro\n\nMore');
    expect(deps({ number: 6, dependsOn: [1, 4] })).toEqual({ body: 'Depends on #1, #4\n\nFree', summary: '#6 en la planta 1: depende de #1, #4.' });
    expect(deps({ number: 4, dependsOn: [] })).toEqual({ body: null, summary: '#4 en la planta 1: sin dependencias.' });
  });

  it('refuses a closed or unknown issue', () => {
    expect(() => deps({ number: 9 })).toThrow('#9 está cerrado.');
    expect(() => deps({ number: 42 })).toThrow('No hay ningún issue abierto #42 en la planta 1.');
  });

  it('refuses dependencies on itself, on closed and on unknown issues', () => {
    expect(() => deps({ dependsOn: [4] })).toThrow('#4 no puede depender de sí mismo.');
    expect(() => deps({ dependsOn: [9] })).toThrow('#9 está cerrado, así que no hay nada que esperar.');
    expect(() => deps({ dependsOn: [42] })).toThrow('No hay ningún issue abierto #42 en la planta 1.');
  });

  it('refuses a cycle', () => {
    expect(() => deps({ number: 1, dependsOn: [3] })).toThrow('#3 ya espera a #1, directamente o a través de otros issues, así que eso sería un ciclo.');
    expect(() => deps({ number: 4, dependsOn: [5] })).toThrow(/#5 ya espera a #4/);
  });

  it('refuses a chain deeper than two steps', () => {
    expect(() => deps({ number: 1, dependsOn: [6] })).toThrow('Eso crea una cadena de dependencias de 3 pasos a través de #1. Limita las cadenas a 2 pasos como mucho: junta las partes dependientes en un solo issue en lugar de dividir más.');
    expect(() => deps({ number: 6, dependsOn: [3] })).toThrow(/de 3 pasos/);
    expect(deps({ number: 6, dependsOn: [2] }).body).toBe('Depends on #2\n\nFree');
  });

  it('leaves an issue in progress alone', () => {
    expect(() => deps({ inProgress: true })).toThrow('#4 ya está en curso, así que sus dependencias no pueden cambiar.');
  });
});

describe('planning guidance', () => {
  const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
  const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: 'Add voice messages', backlog: 0 };
  const plan = ceoJobPrompt({ kind: 'plan', repoId: 'r1', at: 0 }, floor);
  const review = ceoJobPrompt({ kind: 'review', at: 0 }, null);

  it('plans whole features, not slices per developer', () => {
    for (const old of ['small, well-specified', 'one agent-session each', 'at least one per developer', 'split big pieces', 'keep foundation issues small']) expect(system).not.toContain(old);
    expect(system).toContain('Un issue es una funcionalidad completa que el responsable reconocería');
    expect(system).toContain('Divide una funcionalidad solo cuando sus partes sean de verdad independientes Y toquen ficheros distintos, o cuando una parte base arriesgada deba llegar y probarse primero.');
    expect(system).toContain('Nunca dividas una funcionalidad solo para dar algo que hacer a agentes parados');
  });

  it('keeps the dependency rules and the issue cap, and points at the QA queue', () => {
    expect(system).toContain('los mismos agentes construyen y prueban, así que PRs en cola para QA (capacity.prsAwaitingQa) significan menos issues y más grandes');
    expect(system).toContain('La mayoría de los encargos necesitan de 1 a 4 issues.');
    expect(system).toContain('Limita las cadenas de dependencias a dos pasos como mucho.');
    expect(system).toContain('con set_dependencies');
    expect(system).toContain('Abre como mucho 12 issues por trabajo');
  });

  it('plan job: one issue per feature, a skeleton first only for an empty repo', () => {
    expect(plan).not.toContain('una al lado de otra');
    expect(plan).toContain('Un issue por funcionalidad completa.');
    expect(plan).toContain('Solo en un repositorio vacío o casi vacío va primero un issue de esqueleto');
  });

  it('review job: sizes teams from throughput, and idle agents are no reason to slice features', () => {
    expect(review).toContain('tamaño del equipo frente al rendimiento');
    expect(review).toContain('PRs que se acumulan en QA (entonces planifica menos issues y más grandes)');
    expect(review).toContain('Que haya agentes parados no es motivo para trocear funcionalidades');
  });
});

describe('team guidance', () => {
  const prompt = (scaling: 'approve' | 'auto') => ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 8, scaling });

  it('sizes teams from throughput, within the floor max, and keeps one agent', () => {
    expect(prompt('approve')).toContain('Dimensiona el equipo de cada planta según su rendimiento');
    expect(prompt('approve')).toContain('Una planta admite como mucho 8.');
    expect(prompt('approve')).toContain('Cada planta conserva al menos un agente.');
    for (const old of ['QA tester', 'job description', 'specialty', 'propose_hire', 'update_job']) expect(prompt('approve')).not.toContain(old);
  });

  it('says who decides on team changes', () => {
    expect(prompt('approve')).toContain('El responsable aprueba cada cambio y configura a cada agente nuevo antes de contratarlo.');
    expect(prompt('auto')).toContain('Los cambios de equipo se aplican directamente, dentro del máximo de la planta, así que piénsalo bien.');
  });

  it('onboarding sizes the team instead of hiring specialists', () => {
    const onboard = ceoJobPrompt({ kind: 'onboard', repoId: 'r1', at: 0 }, { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: '', backlog: 3 });
    expect(onboard).toContain('scale_team');
    expect(onboard).not.toContain('update_job');
  });
});

describe('triage', () => {
  const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
  const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: '', backlog: 3 };
  const job: CeoJob = { kind: 'triage', repoId: 'r1', prNumber: 108, at: 0 };
  const pr = {
    number: 108,
    title: 'Jukebox volume',
    url: 'https://github.com/acme/app/pull/108',
    round: 3,
    why: 'it still conflicts with main after 3 fixes',
    summary: 'Works, but the slider overflows on phones.',
    fixInstructions: 'Wrap the slider below 480px.',
    mergeNote: 'the conflict was never resolved',
    checks: 'failing',
    failedChecks: ['CI / e2e'],
    pendingChecks: [],
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
    triage: 1,
  };

  it('gives the job everything QA and GitHub know about the PR', () => {
    const prompt = ceoJobPrompt(job, floor, pr);
    for (const fact of ['#108', 'Jukebox volume', 'Ronda de QA 3', pr.summary, pr.fixInstructions, pr.mergeNote, pr.why, 'Checks de GitHub: failing (fallidos: CI / e2e)', 'mergeable: CONFLICTING (DIRTY)', 'triaje 1 de 2']) {
      expect(prompt).toContain(fact);
    }
    expect(prompt).toContain('retry_qa, send_back, rerun_checks, close_pull o escalate');
  });

  it('has nothing to do once the PR is no longer stuck', () => {
    expect(ceoJobPrompt(job, floor, null)).toBe('La pull request #108 ya no necesita triaje. Responde "Nada que hacer."');
  });

  it('adds a triage section to the system prompt and keeps its safety rules', () => {
    expect(system).toContain('Trabajos de triaje:');
    expect(system).toContain('Para ti son de solo lectura. No puedes ejecutar comandos de shell.');
    expect(system).toContain('Cambia las cosas solo con las herramientas mcp__office__.');
  });
});

describe('floorCapacity', () => {
  // #1 ← #2 ← #3, and #5 waits for #4. #2 is already in progress.
  const issues = [
    { number: 1, body: 'Skeleton' },
    { number: 2, body: 'Depends on #1' },
    { number: 3, body: 'Depends on #2' },
    { number: 4, body: 'Free' },
    { number: 5, body: 'Depends on #4' },
  ];
  const qa: { prNumber: number; status: QaStatus }[] = [
    { prNumber: 10, status: 'queued' },
    { prNumber: 11, status: 'testing' },
    { prNumber: 12, status: 'fixing' },
    { prNumber: 13, status: 'passed' },
    { prNumber: 14, status: 'failed' },
    { prNumber: 15, status: 'needs-human' },
    { prNumber: 16, status: 'queued' }, // a re-test round
    { prNumber: 20, status: 'queued' }, // closed since
  ];
  const cap = floorCapacity({ issues, inProgress: (n) => n === 2, openPrs: [10, 11, 12, 13, 14, 15, 16], qa });

  it('counts only issues not yet in progress as waiting on others', () => {
    expect(cap.issuesWaitingOnOthers).toBe(2); // #3 and #5; #2 is in progress
    expect(floorCapacity({ issues, inProgress: () => false, openPrs: [], qa: [] }).issuesWaitingOnOthers).toBe(3);
  });

  it('keeps the longest dependency chain', () => {
    expect(cap.longestDependencyChain).toBe(2);
    expect(floorCapacity({ issues: [], inProgress: () => false, openPrs: [], qa: [] }).longestDependencyChain).toBe(0);
  });

  it('counts open PRs queued for or in QA', () => {
    expect(cap.prsAwaitingQa).toBe(3); // #10, #11, #16
  });
});

describe('IssueCap', () => {
  it('refuses the 13th issue and says the next manager message allows more', () => {
    const cap = new IssueCap(12);
    for (let i = 0; i < 12; i++) {
      cap.check();
      cap.record('a/b');
    }
    expect(() => cap.check()).toThrow('Ya has abierto 12 issues en este trabajo. Es suficiente para un hito. El próximo mensaje del responsable permite más.');
  });

  it('resets when a manager message arrives, and still counts the whole job', () => {
    const cap = new IssueCap(2);
    cap.record('a/b');
    cap.record('c/d');
    expect(() => cap.check()).toThrow();
    cap.managerMessage();
    expect(() => cap.check()).not.toThrow();
    cap.record('a/b');
    expect(cap.total).toBe(3);
    expect([...cap.repos]).toEqual(['a/b', 'c/d']);
  });
});
