// The frame rate while the canvas pans, the measurement for the look's cost: a scratch Seismic's canvas in headless Chrome without a GPU at 2560×1353, a wheel
// event dispatched in the page each animation frame for 4 s, three runs; prints the runs and their mean.
// The canvas sets `moving` while it pans, so the cards drop their blur as they do for the owner.
//
//   bun scripts/pan-fps.ts <sign-in url from scratch-seismic> [label]
//
// Stage the cards first, e.g. 100 of them spread over the canvas; compare builds side by side
// (`--code <commit>` for the before), on the same machine at the same time, since load elsewhere
// moves the absolute numbers.

import { chromium } from 'playwright-core';

const [url, label = ''] = process.argv.slice(2);
if (!url) throw new Error('usage: bun scripts/pan-fps.ts <sign-in url> [label]');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1353 } });
await page.goto(url);
await page.locator('.card').first().waitFor({ timeout: 60_000 });
const noThanks = page.getByRole('button', { name: 'No thanks' });
if (await noThanks.isVisible().catch(() => false)) await noThanks.click();
await page.waitForTimeout(2000);
const runs: { fps: number; moving: boolean }[] = [];
for (let i = 0; i < 3; i++) {
  runs.push(
    await page.evaluate(
      () =>
        new Promise<{ fps: number; moving: boolean }>((done) => {
          const vp = document.getElementById('viewport')!;
          const box = vp.getBoundingClientRect();
          let frames = 0;
          let moving = false;
          let dir = 1;
          const t0 = performance.now();
          const step = (t: number) => {
            if (document.querySelector('.moving')) moving = true;
            if (t - t0 >= 4000) return done({ fps: frames / ((t - t0) / 1000), moving });
            frames++;
            if (frames % 60 === 0) dir = -dir;
            vp.dispatchEvent(new WheelEvent('wheel', { deltaX: 6 * dir, deltaY: 3 * dir, clientX: box.width / 2, clientY: box.height / 2, bubbles: true, cancelable: true }));
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    ),
  );
  await page.waitForTimeout(1500);
}
const cards = await page.locator('.card').count();
const mean = runs.reduce((a, r) => a + r.fps, 0) / runs.length;
console.log(JSON.stringify({ label, cards, runs: runs.map((r) => +r.fps.toFixed(1)), mean: +mean.toFixed(1), moving: runs.every((r) => r.moving) }));
await browser.close();
