/* global process, console, URL */
// In `pnpm dev` macOS shows the name of the Electron.app bundle in node_modules ("Electron") in the
// menu bar and Dock. Rename that dev copy to the app's productName. Packaged builds don't need this.
import { readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.platform !== 'darwin') process.exit(0);

const require = createRequire(import.meta.url);
const name = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).productName;
const app = join(dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app');
const plist = join(app, 'Contents', 'Info.plist');

try {
  const before = readFileSync(plist, 'utf8');
  const after = before.replace(/(<key>CFBundle(?:Display)?Name<\/key>\s*<string>)[^<]*(<\/string>)/g, `$1${name}$2`);
  if (after !== before) {
    writeFileSync(plist, after);
    const now = new Date();
    utimesSync(app, now, now); // nudge macOS to pick up the new name
    console.log(`[prsight] dev app is now called "${name}"`);
  }
} catch (e) {
  console.warn(`[prsight] could not rename the dev app (${e.message}); the menu bar will say "Electron" in dev`);
}
