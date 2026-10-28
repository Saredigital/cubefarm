import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './helpers';

let server: ChildProcess | undefined;
let stateRoot = '';
let temporaryPassword = '';
test.skip(process.env.E2E_COMPANY_LOCAL !== '1', 'Este escenario requiere la configuración dedicada de instancia local.');

test.beforeAll(async ({ baseURL }) => {
  stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sareoffice-company-local-e2e-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/company-security/setupLocal.ts', '--state-dir', path.join(stateRoot, 'instance'), '--port', new URL(baseURL!).port], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-16_000);
    temporaryPassword = /Contraseña temporal:\s*([A-Za-z0-9_-]+)/u.exec(output)?.[1] ?? temporaryPassword;
  });
  // Do not forward stdout/stderr: the launcher prints a temporary access secret.
  server.stderr?.on('data', () => {});
  await expect.poll(async () => {
    if (server?.exitCode !== null) return false;
    try { return temporaryPassword.length > 0 && (await fetch(`${baseURL}/api/company/public`)).ok; }
    catch { return false; }
  }, { timeout: 45_000, message: 'La instancia local vacía debe arrancar en loopback.' }).toBe(true);
});

test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const ended = new Promise<void>((resolve) => server!.once('exit', () => resolve()));
    server.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ended, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('El servidor de prueba no ha terminado; se conserva su estado.')), 5_000); })]); }
    finally { clearTimeout(timer); }
  }
  temporaryPassword = '';
  const resolved = path.resolve(stateRoot);
  const parent = path.resolve(os.tmpdir()) + path.sep;
  if (stateRoot && resolved.startsWith(parent) && path.basename(resolved).startsWith('sareoffice-company-local-e2e-')) await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5 });
});

test('abre una oficina local nueva y configura trabajo sin demo, conexiones ni ejecución', async ({ page }, info) => {
  const requests: string[] = [];
  const sockets: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto('/');
  await expect(page).toHaveURL(/\?company=1$/);
  await expect(page.getByText('Configuración local · sin conexiones ni ejecución', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('empresa-configuracion-local.png') });
  await expect(page.getByRole('heading', { name: 'Acceso a la configuración local', exact: true })).toBeVisible();
  await expect(page.getByText(/No es un entorno confidencial/)).toBeVisible();
  await expect(page.getByText(/Entorno de demostración|Sesión protegida|Contraseña de prueba/)).toHaveCount(0);
  await page.getByLabel('Contraseña temporal de la terminal', { exact: true }).fill(temporaryPassword);
  await page.getByRole('button', { name: 'Entrar en la configuración', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Gestión de empresa' });
  await expect(nav).toBeVisible();
  const snapshot = await (await page.request.get('/api/company/state')).json();
  for (const collection of ['agents', 'projects', 'tasks', 'contacts', 'opportunities', 'calendar', 'knowledge', 'deliverables', 'runs']) expect(snapshot[collection], collection).toHaveLength(0);
  expect(snapshot.departments).toHaveLength(5);
  expect(snapshot.runtime.mode).toBe('blocked');
  await page.getByText('Editar empresa y objetivo', { exact: true }).click();
  await page.setViewportSize({ width: 714, height: 612 });
  const modalBody = page.locator('.co-panel .panel-body');
  await expect.poll(() => modalBody.evaluate((element) => element.scrollWidth <= element.clientWidth), { message: 'El contenido del modal debe caber a 714 px sin desplazamiento horizontal.' }).toBe(true);
  await page.screenshot({ path: info.outputPath('empresa-configuracion-local-modal-714.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('Nombre de la empresa', { exact: true }).fill('Empresa local de prueba');
  await page.getByLabel('Objetivo de empresa', { exact: true }).fill('Preparar una configuración propia sin conexiones.');
  await page.getByRole('button', { name: 'Guardar empresa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresa local de prueba', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Departamentos', exact: true }).click();
  await page.getByText('Crear departamento sin GitHub', { exact: true }).click();
  const departmentForm = page.locator('.co-create').filter({ has: page.locator('summary').filter({ hasText: /^Crear departamento sin GitHub$/ }) });
  await departmentForm.getByLabel('Nombre del departamento', { exact: true }).fill('Planificación local');
  await departmentForm.getByLabel('Misión', { exact: true }).fill('Preparar la estructura sin conectar cuentas.');
  await departmentForm.getByRole('button', { name: 'Crear departamento', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planificación local', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Especialistas', exact: true }).click();
  await expect(page.getByText(/Aún no hay especialistas incorporados/)).toBeVisible();
  await page.locator('summary').filter({ hasText: /^Incorporar especialista$/ }).click();
  await page.getByLabel('Nombre del especialista', { exact: true }).fill('Planificador local');
  await expect(page.getByRole('textbox', { name: 'Modelo de IA', exact: true })).toBeDisabled();
  await page.locator('form').filter({ has: page.getByLabel('Nombre del especialista', { exact: true }) }).getByRole('button', { name: 'Incorporar especialista', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planificador local', exact: true })).toBeVisible();
  await expect(page.getByText('Sin modelo configurado', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Integraciones y correo', exact: true }).click();
  await expect(page.getByText(/No hay buzones configurados/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Sincronizar|Enviar versión/ })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Marketing', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir conectores y publicaciones', exact: true })).toBeDisabled();
  await expect(page.getByText('Sin piezas para este canal.', { exact: true })).toHaveCount(4);
  await nav.getByRole('button', { name: 'Trabajo', exact: true }).click();
  await page.getByText('Crear tarea general', { exact: true }).click();
  await page.getByLabel('Título de la tarea', { exact: true }).fill('Preparar estructura local');
  await page.getByLabel('Objetivo de la tarea', { exact: true }).fill('Definir el trabajo sin ejecutarlo.');
  await page.getByRole('combobox', { name: 'Responsable de la tarea', exact: true }).selectOption({ label: 'Planificador local' });
  await page.getByLabel('Criterio de finalización', { exact: true }).fill('Configuración revisada.');
  await page.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await page.getByRole('button', { name: /Preparar estructura local/ }).click();
  await expect(page.getByRole('button', { name: 'Ejecutar especialista', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('empresa-configuracion-local.png') });
  expect(sockets).toEqual([]);
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== new URL(page.url()).origin)).toEqual([]);
  expect(requests.filter((url) => /\/api\/(state|events|ws)(?:[?\/]|$)/.test(url))).toEqual([]);
});

test('configura en móvil sin cargar 3D ni cuentas de ejemplo', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?company=1');
  await page.getByLabel('Contraseña temporal de la terminal', { exact: true }).fill(temporaryPassword);
  await page.getByRole('button', { name: 'Entrar en la configuración', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Gestión de empresa' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.getByText(/Entorno de demostración|Sesión protegida/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('empresa-configuracion-local-movil.png') });
});

