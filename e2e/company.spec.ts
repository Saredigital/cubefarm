import { expect, test } from './helpers';

async function login(page: import('@playwright/test').Page) {
  await page.getByLabel('Contraseña del responsable').fill('demo-oficina');
  await page.getByRole('button', { name: 'Entrar en la gestión' }).click();
  await expect(page.getByRole('navigation', { name: 'Gestión de empresa' })).toBeVisible();
}

test('gestiona departamentos, campañas y revisiones sin GitHub en escritorio', async ({ page }, info) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?company=1');
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Gestión de empresa' });
  await nav.getByRole('button', { name: 'Departamentos', exact: true }).click();
  await page.getByText('Crear departamento sin GitHub', { exact: true }).click();
  await page.getByLabel('Nombre del departamento').first().fill('Atención demo navegador');
  await page.getByLabel('Misión', { exact: true }).first().fill('Organizar peticiones internas');
  await page.getByRole('button', { name: 'Crear departamento', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Atención demo navegador', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Marketing', exact: true }).click();
  await page.getByText('Crear campaña de marketing', { exact: true }).click();
  await page.getByLabel('Objetivo del flujo').fill('Dar a conocer nuestros servicios de automatización');
  await page.getByRole('button', { name: 'Crear campaña', exact: true }).click();
  for (const channel of ['X', 'Instagram', 'Facebook', 'TikTok']) await expect(page.getByRole('heading', { name: channel, exact: true })).toBeVisible();
  await page.getByText('Crear campaña de marketing', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.screenshot({ path: info.outputPath('empresa-calendario-escritorio.png') });
  await nav.getByRole('button', { name: 'Proyectos', exact: true }).click();
  await page.getByRole('button', { name: 'Ejecutar tareas disponibles' }).last().click();
  await nav.getByRole('button', { name: 'Revisiones', exact: true }).click();
  await expect(page.getByLabel('Decisión de revisión').first()).toBeVisible();
  await page.getByLabel('Comentario de revisión').first().fill('Revisado en la demostración');
  await page.getByRole('button', { name: /Registrar revisión de v/ }).first().click();
  await expect(page.getByText('Aceptado', { exact: true }).first()).toBeVisible();
  expect(requests.some((url) => url.endsWith('/api/state') || url.includes('/api/repos/'))).toBe(false);
  expect(requests.some((url) => /\/assets\/Office-/.test(url))).toBe(false);
});

test('ofrece gestión móvil y revisión exacta del correo con aprobación invalidada al editar', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1');
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Gestión de empresa' });
  await nav.getByRole('button', { name: 'Integraciones y correo', exact: true }).click();
  await page.getByLabel('Buzón que quieres consultar').selectOption('mail-operaciones');
  await page.getByText('Simulado en demo', { exact: true }).first().waitFor();
  await page.locator('summary').filter({ hasText: /Propuesta de colaboración.*Sin leer/ }).first().click();
  await page.getByRole('button', { name: 'Preparar respuesta para revisión' }).first().click();
  await page.locator('.co-mail-list button').last().click();
  await page.getByLabel('Texto completo de la respuesta').fill('Gracias por tu mensaje. Revisaremos la propuesta.');
  await page.getByRole('checkbox', { name: /encargo-demo.txt/ }).check();
  await page.getByRole('button', { name: 'Guardar cambios e invalidar aprobación anterior' }).click();
  await page.getByLabel(/He revisado todo el envío/).check();
  await page.getByRole('button', { name: /Aprobar versión/ }).click();
  await expect(page.getByRole('button', { name: 'Enviar versión aprobada' })).toBeEnabled();
  await page.getByLabel('Asunto', { exact: true }).fill('Asunto modificado tras aprobar');
  await expect(page.getByRole('button', { name: 'Enviar versión aprobada' })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar cambios e invalidar aprobación anterior' }).click();
  await expect(page.getByRole('button', { name: 'Enviar versión aprobada' })).toBeDisabled();
  await page.getByLabel(/He revisado todo el envío/).check();
  await page.getByRole('button', { name: /Aprobar versión/ }).click();
  await page.getByRole('button', { name: 'Enviar versión aprobada' }).click();
  await expect(page.getByText('Aceptado por el proveedor', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('empresa-correo-movil.png'), fullPage: true });
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('convierte un correo de un buzón autorizado en una oportunidad con propuesta y seguimiento', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?company=1');
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Gestión de empresa' });
  await nav.getByRole('button', { name: 'Integraciones y correo', exact: true }).click();
  await page.getByLabel('Buzón que quieres consultar').selectOption('mail-negocio');
  await page.getByText('Accesos de especialistas por buzón', { exact: true }).click();
  for (const name of ['Investigación y propuestas', 'Asistencia de operaciones']) {
    const specialist = page.locator('.co-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await specialist.getByLabel('Leer mensajes', { exact: true }).check();
    await specialist.getByRole('button', { name: `Guardar accesos de ${name}`, exact: true }).click();
    await expect(page.getByText('Operación registrada.', { exact: true })).toBeVisible();
  }
  await page.locator('summary').filter({ hasText: /Propuesta de colaboración.*Sin leer/ }).first().click();
  await page.getByText('Crear trabajo a partir de este correo', { exact: true }).click();
  await page.getByLabel('Objetivo derivado del correo').fill('Propuesta de colaboración derivada de buzón único');
  await page.getByLabel('Nombre del contacto de origen').fill('Contacto de prueba');
  await page.getByRole('button', { name: 'Crear flujo con contexto autorizado' }).click();
  await expect(page.getByText(/Trabajo creado con las restricciones del correo/)).toBeVisible();
  await nav.getByRole('button', { name: 'Negocio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Propuesta de colaboración derivada de buzón único', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Trabajo', exact: true }).click();
  await page.getByRole('button', { name: /Ficha de oportunidad y necesidades/ }).last().click();
  await page.getByRole('button', { name: 'Ejecutar especialista', exact: true }).click();
  await nav.getByRole('button', { name: 'Revisiones', exact: true }).click();
  const research = page.locator('.co-card').filter({ has: page.getByRole('heading', { name: 'Ficha de oportunidad y necesidades · v1', exact: true }) });
  await research.getByLabel('Comentario de revisión').fill('Necesidades contrastadas en demo');
  await research.getByRole('button', { name: 'Registrar revisión de v1', exact: true }).click();
  await nav.getByRole('button', { name: 'Trabajo', exact: true }).click();
  await page.getByRole('button', { name: /Ficha de oportunidad y necesidades/ }).last().click();
  await page.getByRole('combobox', { name: 'Estado de la tarea', exact: true }).selectOption('completed');
  await page.getByRole('button', { name: /Propuesta comercial/ }).last().click();
  await page.getByRole('button', { name: 'Ejecutar especialista', exact: true }).click();
  await nav.getByRole('button', { name: 'Revisiones', exact: true }).click();
  const proposal = page.locator('.co-card').filter({ has: page.getByRole('heading', { name: 'Propuesta comercial · v1', exact: true }) });
  await proposal.getByLabel('Comentario de revisión').fill('Propuesta revisada para responder');
  await proposal.getByRole('button', { name: 'Registrar revisión de v1', exact: true }).click();
  await nav.getByRole('button', { name: 'Integraciones y correo', exact: true }).click();
  await page.getByLabel('Buzón que quieres consultar').selectOption('mail-negocio');
  await page.locator('summary').filter({ hasText: /Propuesta de colaboración.*Sin leer/ }).first().click();
  await page.getByText('Responder con un entregable aprobado', { exact: true }).click();
  await page.getByLabel('Resultado autorizado para la respuesta').selectOption({ label: 'Propuesta comercial · v1' });
  await page.getByRole('button', { name: 'Preparar borrador desde versión aprobada', exact: true }).click();
  await expect(page.getByLabel('Texto completo de la respuesta')).toHaveValue(/Alcance: analizar la necesidad/);
  await page.getByLabel(/He revisado todo el envío/).check();
  await page.getByRole('button', { name: /Aprobar versión/ }).click();
  await page.getByRole('button', { name: 'Enviar versión aprobada', exact: true }).click();
  await expect(page.getByText('Aceptado por el proveedor', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('empresa-flujo-correo-propuesta.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acceso del responsable' })).toBeVisible();
});

