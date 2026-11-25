import { afterAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright-core';
import { launchChromium } from './chromium.ts';

let browser: Browser | undefined;


afterAll(() => browser?.close(), 30_000);



test('a scrolling box shows its scrollbar', async () => {
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent('<body style="margin:0"><div style="height:200px;width:200px;overflow:auto;background:#fff"><div style="height:2000px"></div></div>');
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(150);
  
  const shot = await page.screenshot({ clip: { x: 180, y: 10, width: 20, height: 180 } });
  const dark = await page.evaluate(async (png) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 200) n++;
    return n;
  }, shot.toString('base64'));
  expect(dark).toBeGreaterThan(50);
}, 60_000);
