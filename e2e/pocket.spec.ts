import { expect, test } from './helpers';

// Mobile verification uses the same demo office as the panel specs, after smoke completed setup.
test('the pocket office navigates in Spanish without loading the 3D scene', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?pocket=1');
  const tabs = page.getByRole('navigation', { name: 'Oficina de bolsillo' });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acceso del responsable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar en la gestión' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('bolsillo-empresa.png') });

  await tabs.getByRole('button', { name: /Equipo/ }).click();
  // Demo agents can finish while earlier desktop specs run; terminal access remains available.
  await expect(page.getByRole('button', { name: 'Terminal', exact: true }).first()).toBeVisible();
  await tabs.getByRole('button', { name: /Kanban/ }).click();
  await expect(page.getByText('En curso', { exact: false }).first()).toBeVisible();
  await tabs.getByRole('button', { name: /Aprobaciones/ }).click();
  await expect(tabs.getByRole('button', { name: /Aprobaciones/ })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Ajustes y notificaciones', exact: true }).click();
  await expect(page.getByRole('button', { name: '🗂️ Abrir el panel de control' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});
