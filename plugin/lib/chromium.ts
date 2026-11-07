// The Chromium the plugin's skills drive: the demo skill records with it, the browser skill checks
// pages with it. Plain Node with type stripping, like the skills that import it; importing this
// module is what resolves Playwright, found up the tree from here (the checkout's node_modules, or
// the one beside the plugin among Seismic's resources and on a host).

import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

/** The init script every page of it gets: its `speechSynthesis` speaks nothing (`silent-speech.js`). */
export const SILENT_SPEECH = join(import.meta.dirname, 'silent-speech.js');

/**
 * Chromium launched by Playwright: `DEMO_CHROME` when set (the path of any Chromium-based browser),
 * else Chrome where it is installed, else Edge (on every Windows), else Playwright's own Chromium
 * (on Linux on ARM, where there is no Chrome). It shows scrollbars as the machine's browser does
 * (Playwright's headless launch hid them): classic ones on Windows and Linux, on a Mac set to
 * overlay scrollbars a bar that shows while a box scrolls and fades a second later.
 */
export async function launchChromium(options: LaunchOptions = {}): Promise<Browser> {
  const ignored = Array.isArray(options.ignoreDefaultArgs) ? options.ignoreDefaultArgs : [];
  if (options.ignoreDefaultArgs !== true) options = { ...options, ignoreDefaultArgs: [...ignored, '--hide-scrollbars'] };
  if (process.env.DEMO_CHROME) return chromium.launch({ ...options, executablePath: process.env.DEMO_CHROME });
  const missing: string[] = [];
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ ...options, channel });
    } catch (error) {
      const message = String((error as Error).message);
      if (!/is not found at|Executable doesn't exist|not supported on/i.test(message)) throw error;
      missing.push(channel ?? 'chromium');
    }
  }
  throw new Error(
    `no browser (tried ${missing.join(', ')}): install Google Chrome, or run \`npx playwright-core install --with-deps chromium\` in ${join(import.meta.dirname, '..', '..')}, or set DEMO_CHROME to a Chromium-based browser`,
  );
}
