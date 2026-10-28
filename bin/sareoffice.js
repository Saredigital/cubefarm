#!/usr/bin/env node
// `npm start`: checks this machine is ready, starts the office and opens it in the browser.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MIN_NODE = 22;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const HELP = `
  sareoffice ${pkg.version}: la oficina 3D de Saredigital donde un equipo de agentes de código con IA trabaja tus issues de GitHub.

  Uso (desde el clon del repositorio)
    npm start                  arranca la oficina (con el lanzador, que la actualiza) y la abre en el navegador
    npm run login              inicia sesión en Claude Code, el agente de código incluido
    npm run doctor             comprueba que esta máquina está lista
    node bin/sareoffice.js     arranca la oficina construida sin el lanzador (admite las opciones de abajo)

  Opciones
    --port <n>                 puerto de la oficina (por defecto, 4317)
    --demo                     GitHub y agentes simulados: echa un vistazo sin gastar uso
    --floors <n> --agents <n>  con --demo: una empresa más grande, n plantas con n personas cada una (hasta 20 y 15)
    --no-open                  no abrir el navegador
    -v, --version              muestra la versión
    -h, --help                 muestra esta ayuda

  La oficina guarda su estado y sus espacios de trabajo en ~/.sareoffice (define SWARM_HOME para usar otra carpeta).
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (open, close) => (s) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
const green = paint(32, 39);
const red = paint(31, 39);
const dim = paint(2, 22);
const fail = (msg) => {
  console.error(`\n  ${red('✗')} ${msg}\n`);
  process.exit(1);
};

if (Number(process.versions.node.split('.')[0]) < MIN_NODE) fail(`sareoffice necesita Node.js ${MIN_NODE} o posterior (este es ${process.version}). Descárgalo de https://nodejs.org`);

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      demo: { type: 'boolean' },
      floors: { type: 'string' },
      agents: { type: 'string' },
      'no-open': { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(`${err.message}\n    Ejecuta node bin/sareoffice.js --help para ver las opciones.`);
}
const { values, positionals } = args;
const command = positionals[0] ?? 'start';

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

// ---------- Claude Code ----------

// The Agent SDK ships Claude Code as a per-platform package. The office runs its agents on it, so logging in with it
// is logging the agents in. Same lookup as the SDK's own.
function claudeBinary() {
  let sdk;
  try {
    sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return null;
  }
  const { platform, arch } = process;
  const musl = platform === 'linux' && !process.report?.getReport?.()?.header?.glibcVersionRuntime;
  const targets = platform === 'linux' ? (musl ? [`linux-${arch}-musl`, `linux-${arch}`] : [`linux-${arch}`, `linux-${arch}-musl`]) : [`${platform}-${arch}`];
  const fromSdk = createRequire(sdk);
  for (const target of targets) {
    try {
      return fromSdk.resolve(`@anthropic-ai/claude-agent-sdk-${target}/claude${platform === 'win32' ? '.exe' : ''}`);
    } catch {
      // not installed for this target
    }
  }
  return null;
}

// Like the agents: no API keys or settings inherited from a Claude Code session this was started from.
function claudeEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ANTHROPIC_|CLAUDE)/i.test(k) || k === 'CLAUDE_CONFIG_DIR') env[k] = v;
  return env;
}

// ---------- checks ----------

const sh = (cmd, cmdArgs, env) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', windowsHide: true, timeout: 30_000, env });

/** What the office needs: { name, ok, detail, fix, required }. */
function checks() {
  const out = [{ name: 'Node.js', ok: true, detail: process.version }];

  const git = sh('git', ['--version']);
  out.push({ name: 'git', ok: git.status === 0, detail: git.stdout?.trim().replace(/^git version /, ''), fix: 'instala git: https://git-scm.com/downloads', required: true });

  if (sh('gh', ['--version']).status !== 0) {
    out.push({ name: 'GitHub CLI', ok: false, fix: 'instálala desde https://cli.github.com y ejecuta: gh auth login' });
  } else {
    const ok = sh('gh', ['auth', 'status']).status === 0;
    out.push({ name: 'GitHub CLI', ok, detail: ok ? 'sesión iniciada' : 'sin sesión iniciada', fix: 'ejecuta: gh auth login' });
  }

  const claude = claudeBinary();
  if (!claude) {
    out.push({ name: 'Claude Code', ok: false, fix: `ejecuta npm install en el clon: falta Claude Code para ${process.platform}-${process.arch}` });
  } else {
    let status = null;
    try {
      status = JSON.parse(sh(claude, ['auth', 'status', '--json'], claudeEnv()).stdout);
    } catch {
      // unreadable: treated as signed out
    }
    const ok = status?.loggedIn === true;
    out.push({ name: 'Claude', ok, detail: ok ? `sesión iniciada${status.subscriptionType ? ` (${status.subscriptionType})` : ''}` : 'sin sesión iniciada', fix: 'ejecuta: npm run login' });
  }

  // Agents test in a browser through Playwright, which drives Google Chrome by default.
  const chrome = chromePaths().some((p) => fs.existsSync(p));
  out.push({ name: 'Chrome', ok: chrome, detail: chrome ? 'para las pruebas en navegador' : 'no se encuentra Google Chrome', fix: 'instala Google Chrome para que los agentes puedan probar en un navegador' });
  // The pinned Playwright MCP server the agents' browser runs on (server/browser.ts), installed with sareoffice.
  let mcp = null;
  try {
    mcp = JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('@playwright/mcp/package.json'), 'utf8')).version;
  } catch {
    // not installed
  }
  out.push({ name: 'Navegador', ok: !!mcp, detail: mcp ? `@playwright/mcp ${mcp}` : 'no instalado', fix: 'ejecuta npm install en el clon' });
  return out;
}

function chromePaths() {
  const env = process.env;
  if (process.platform === 'win32') {
    return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications', 'Google Chrome.app')];
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

const printCheck = (c) => console.log(`  ${c.ok ? green('✓') : red('✗')} ${c.name.padEnd(12)} ${c.detail ? dim(c.detail) : ''}${c.ok ? '' : `  → ${c.fix}`}`);

// ---------- helpers ----------

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function isOffice(url) {
  try {
    const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return Array.isArray(data?.repos) && Array.isArray(data?.agents);
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const [cmd, cmdArgs, opts] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `"start "" "${url}""`], { windowsVerbatimArguments: true }]
      : process.platform === 'darwin'
        ? ['open', [url], {}]
        : ['xdg-open', [url], {}];
  try {
    spawn(cmd, cmdArgs, { ...opts, stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => undefined)
      .unref();
  } catch {
    // no browser to open: the URL is printed anyway
  }
}

// ---------- commands ----------

if (command === 'doctor') {
  console.log(`\n  sareoffice ${pkg.version}\n`);
  const results = checks();
  results.forEach(printCheck);
  const ok = results.every((c) => c.ok);
  console.log(ok ? `\n  Todo listo. Arranca la oficina con: npm start\n` : '');
  process.exit(ok ? 0 : 1);
}

if (command === 'login') {
  const claude = claudeBinary();
  if (!claude) fail(`Falta Claude Code para ${process.platform}-${process.arch}. Ejecuta npm install en el clon.`);
  console.log('\n  Iniciando sesión en Claude. Tus agentes usan esta sesión y tu suscripción.\n');
  const res = spawnSync(claude, ['auth', 'login'], { stdio: 'inherit', env: claudeEnv() });
  process.exit(res.status ?? 1);
}

if (command !== 'start') fail(`Comando desconocido "${command}". Ejecuta node bin/sareoffice.js --help para ver las opciones.`);

const port = Number(values.port ?? process.env.SWARM_PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`"${values.port ?? process.env.SWARM_PORT}" no es un número de puerto.`);
const url = `http://localhost:${port}`;
const demo = values.demo || process.env.SWARM_DEMO === '1' || process.env.SWARM_DEMO === 'true';

// A second office on the same state would resume every agent's session a second time.
if (port !== 0 && (await portOpen(port))) {
  if (!(await isOffice(`http://127.0.0.1:${port}`))) fail(`Otro programa está usando el puerto ${port}. Arranca sareoffice en otro: node bin/sareoffice.js --port 4400`);
  console.log(`\n  sareoffice ya está en marcha: ${url}\n`);
  if (!values['no-open']) openBrowser(url);
  process.exit(0);
}

if (!demo) {
  const problems = checks().filter((c) => !c.ok);
  if (problems.length) {
    console.log('');
    problems.forEach(printCheck);
    if (problems.some((c) => c.required)) fail('sareoffice no puede funcionar sin esto.');
    console.log(dim('\n  Arrancando de todos modos. Corrige lo anterior y vuelve a comprobarlo con: npm run doctor'));
  }
}

const entry = path.join(root, 'dist-server', 'index.js');
if (!fs.existsSync(entry)) fail(`Falta ${path.relative(process.cwd(), entry) || entry}. Ejecuta antes npm run build en el clon del repositorio.`);

process.env.SWARM_PORT = String(port);
if (demo) process.env.SWARM_DEMO = '1';
if (values.floors) process.env.SWARM_DEMO_FLOORS = values.floors;
if (values.agents) process.env.SWARM_DEMO_AGENTS = values.agents;
process.setSourceMapsEnabled(true);
// The server loads its state, then listens.
await import(pathToFileURL(entry).href);

if (!values['no-open'] && port !== 0) {
  for (let i = 0; i < 100 && !(await portOpen(port)); i++) await new Promise((r) => setTimeout(r, 200));
  openBrowser(url);
}
