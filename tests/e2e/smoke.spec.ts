// Smoke test: the app starts, shows the sign-in screen and blocks remote content.
import { _electron as electron, expect, test } from '@playwright/test';

test('starts on the sign-in screen', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, PRGRAPH_GITHUB_CLIENT_ID: '' } });
  const win = await app.firstWindow();
  await expect(win.getByText('PRsight', { exact: true })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Use My GitHub CLI Sign-In' })).toBeVisible();
  const blocked = await win.evaluate(async () => {
    try {
      await fetch('https://example.com');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  await app.close();
});
