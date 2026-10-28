import { expect, openPanel, test } from './helpers';

// The boot smoke: a fresh demo office opens the control panel, first-run setup is skipped, and nothing 3D loads.
test('the demo office opens the control panel in Spanish', async ({ page }, info) => {
  await openPanel(page);
  await expect(page.getByRole('heading', { name: 'Resumen', level: 1 })).toBeVisible();
  await expect(page.getByText(/Modo demo/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Indicadores' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('panel-resumen.png') });
});
