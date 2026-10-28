import path from 'node:path';
import { expect, test } from './helpers';

async function prepareSocial(page: import('@playwright/test').Page, suffix: string) {
  await page.goto('/?company=1');
  await page.getByLabel('Contraseña del responsable').fill('demo-oficina');
  await page.getByRole('button', { name: 'Entrar en la gestión', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Gestión de empresa' });
  await nav.getByRole('button', { name: 'Trabajo', exact: true }).click();
  await page.getByText('Crear tarea general', { exact: true }).click();
  await page.getByLabel('Título de la tarea', { exact: true }).fill(`Publicación demo ${suffix}`);
  await page.getByLabel('Objetivo de la tarea', { exact: true }).fill('Preparar una pieza breve para los cuatro canales.');
  await page.getByRole('combobox', { name: 'Departamento', exact: true }).selectOption('marketing');
  await page.getByRole('combobox', { name: 'Responsable de la tarea', exact: true }).selectOption('specialist:marketing');
  await page.getByLabel('Criterio de finalización', { exact: true }).fill('Texto revisado y aprobación específica para cada publicación.');
  await page.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`Publicación demo ${suffix}`) }).click();
  await page.getByText('Añadir entregable', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Tipo de entregable', exact: true }).selectOption('social_content');
  await page.getByLabel('Título del entregable', { exact: true }).fill(`Contenido social revisado ${suffix}`);
  await page.getByLabel('Contenido del entregable', { exact: true }).fill('Descubre cómo Saredigital puede ayudarte a organizar tus procesos digitales. Hablemos de tus próximos pasos.');
  await page.getByRole('button', { name: 'Guardar entregable', exact: true }).click();
  await nav.getByRole('button', { name: 'Revisiones', exact: true }).click();
  const review = page.locator('.co-card').filter({ has: page.getByRole('heading', { name: `Contenido social revisado ${suffix} · v1`, exact: true }) });
  await review.getByLabel('Comentario de revisión').fill('Contenido contrastado para la demostración.');
  await review.getByRole('button', { name: 'Registrar revisión de v1', exact: true }).click();
  await nav.getByRole('button', { name: 'Marketing', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conectores y publicaciones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Publicación y aprobación por canal', exact: true })).toBeVisible();
}

test('publica en los simuladores X, Facebook e Instagram y exporta TikTok con evidencia manual', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  await prepareSocial(page, 'escritorio');
  const upload = page.locator('.co-social-upload');
  await upload.locator('summary').click();
  for (const filename of ['company-demo.jpg', 'company-demo.mp4']) {
    await upload.getByLabel('Archivo JPEG o MP4 (máximo 12 MB)').setInputFiles(path.resolve('e2e/fixtures', filename));
    await upload.getByRole('button', { name: 'Añadir archivo a revisión', exact: true }).click();
    await expect(upload.getByText(filename, { exact: true })).toBeVisible();
  }
  await upload.locator('summary').click();
  const form = page.locator('.co-social-create');
  await form.locator('summary').click();
  for (const channel of ['x', 'facebook', 'instagram']) {
    await form.getByRole('combobox', { name: 'Cuenta de publicación', exact: true }).selectOption(`demo-${channel}`);
    await form.getByRole('combobox', { name: 'Entregable de origen aprobado', exact: true }).selectOption({ label: 'Contenido social revisado escritorio · v1' });
    for (const checkbox of await form.locator('input[name="assetIds"]').all()) await checkbox.uncheck();
    if (channel === 'instagram') await form.getByRole('checkbox', { name: /company-demo.jpg/ }).check();
    await form.getByRole('button', { name: 'Guardar publicación para revisión', exact: true }).click();
    let review = page.locator('.co-social-review');
    await review.getByRole('checkbox', { name: /He revisado la cuenta/ }).check();
    await review.getByRole('button', { name: 'Aprobar publicación exacta', exact: true }).click();
    if (channel === 'x') {
      await review.getByText('Editar publicación antes de enviar', { exact: true }).click();
      await review.getByRole('textbox', { name: 'Texto exacto de la publicación', exact: true }).fill('Texto actualizado de la publicación demo, pendiente de aprobar de nuevo.');
      await expect(review.getByRole('button', { name: 'Publicar contenido aprobado', exact: true })).toBeDisabled();
      await review.getByRole('button', { name: 'Guardar publicación e invalidar aprobación', exact: true }).click();
      review = page.locator('.co-social-review');
      await review.getByRole('checkbox', { name: /He revisado la cuenta/ }).check();
      await review.getByRole('button', { name: 'Aprobar publicación exacta', exact: true }).click();
    }
    await review.getByRole('button', { name: 'Publicar contenido aprobado', exact: true }).click();
    await expect(review.getByText('Aceptado por el proveedor', { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Comprobar publicación con el proveedor', exact: true }).click();
    await expect(review.getByText('Publicación confirmada', { exact: true })).toBeVisible();
  }
  await form.getByRole('combobox', { name: 'Cuenta de publicación', exact: true }).selectOption('demo-tiktok');
  await expect(form.getByRole('combobox', { name: 'Forma de publicación', exact: true })).toHaveValue('manual');
  for (const checkbox of await form.locator('input[name="assetIds"]').all()) await checkbox.uncheck();
  await form.getByRole('checkbox', { name: /company-demo.mp4/ }).check();
  await form.getByRole('button', { name: 'Guardar publicación para revisión', exact: true }).click();
  const manual = page.locator('.co-social-review');
  await manual.getByRole('checkbox', { name: /He revisado la cuenta/ }).check();
  await manual.getByRole('button', { name: 'Aprobar paquete para publicación manual', exact: true }).click();
  await manual.getByRole('button', { name: 'Exportar texto y archivos aprobados', exact: true }).click();
  await expect(manual.getByRole('link', { name: 'Descargar company-demo.mp4', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await manual.getByRole('link', { name: 'Descargar company-demo.mp4', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('company-demo.mp4');
  await manual.getByRole('textbox', { name: 'URL de la publicación manual', exact: true }).fill('https://www.tiktok.com/@equipo-demo/video/1234567890');
  await manual.getByRole('textbox', { name: 'Evidencia y comprobación de la publicación', exact: true }).fill('Registro de demostración aportado por el responsable; no se ha contactado con TikTok.');
  await manual.getByRole('checkbox', { name: /He publicado manualmente/ }).check();
  await manual.getByRole('button', { name: 'Registrar publicación manual', exact: true }).click();
  await expect(manual.getByText('Publicación manual registrada por el responsable', { exact: true })).toBeVisible();
  await manual.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('empresa-social-publicacion-manual.png') });
});

test('ofrece la revisión social esencial en móvil sin cargar el mundo 3D', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareSocial(page, 'móvil');
  const form = page.locator('.co-social-create');
  await form.locator('summary').click();
  await form.getByRole('combobox', { name: 'Cuenta de publicación', exact: true }).selectOption('demo-x');
  await form.getByRole('combobox', { name: 'Entregable de origen aprobado', exact: true }).selectOption({ label: 'Contenido social revisado móvil · v1' });
  await form.getByRole('button', { name: 'Guardar publicación para revisión', exact: true }).click();
  const review = page.locator('.co-social-review');
  await review.getByRole('checkbox', { name: /He revisado la cuenta/ }).check();
  await review.getByRole('button', { name: 'Aprobar publicación exacta', exact: true }).click();
  await expect(review.getByRole('button', { name: 'Publicar contenido aprobado', exact: true })).toBeEnabled();
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('empresa-social-revision-movil.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(0);
});
