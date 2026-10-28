import { expect, openPanel, test } from './helpers';

// The control panel's main flows on the demo office: a project's board, an agent's terminal and launching a task.
test('a project shows its board and opens an agent terminal', async ({ page }, info) => {
  await openPanel(page);
  const nav = page.getByRole('complementary', { name: 'Navegación' });
  await nav.getByRole('button', { name: /pixel-todo/ }).click();
  await expect(page.getByRole('heading', { name: /pixel-todo/, level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tablero' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: info.outputPath('panel-proyecto.png') });

  await page.getByRole('tab', { name: /Agentes/ }).click();
  await page.locator('.cp-agent').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('launching a task creates an issue with the first sentence as its title', async ({ page }) => {
  await openPanel(page, '#/project/demo-co/pixel-todo/board');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Lanzar tarea' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('¿Qué hay que hacer?').fill('Añadir un filtro de tareas archivadas. Debe recordar la elección.');
  await expect(dialog.getByLabel('Proyecto', { exact: true })).toHaveValue('demo-co/pixel-todo');
  await dialog.getByRole('button', { name: 'Lanzar tarea' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Añadir un filtro de tareas archivadas$/)).toBeVisible();
});

test('approvals and the CEO chat have their own pages', async ({ page }) => {
  await openPanel(page);
  const nav = page.getByRole('complementary', { name: 'Navegación' });
  await nav.getByRole('button', { name: /Aprobaciones/ }).click();
  await expect(page.getByRole('heading', { name: 'Aprobaciones', level: 1 })).toBeVisible();
  await nav.getByRole('button', { name: /^CEO/ }).click();
  await expect(page.getByRole('heading', { name: 'CEO', level: 1 })).toBeVisible();
  await expect(page.locator('.phone-chat')).toBeVisible();
});
