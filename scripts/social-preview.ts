// The repository's social preview on GitHub (the picture a link to github.com/sadilek/obeya shows
// when it is shared): 1280×640, the wordmark and the site's headline beside the site's screenshot of
// the canvas (`site/img/canvas.png`), in the site's palette and type. GitHub's API cannot set it: the
// owner uploads the PNG under the repository's Settings → General → Social preview.
//
//   bun scripts/social-preview.ts [out.png]     (default dist/social-preview.png; needs Google Chrome)

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const SITE = join(import.meta.dirname, '..', 'site');
const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', 'dist', 'social-preview.png'));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="style.css">
<style>
  body { width: 1280px; height: 640px; overflow: hidden; position: relative; }
  .text { position: absolute; left: 56px; top: 0; bottom: 0; width: 380px; display: flex; flex-direction: column; justify-content: center; }
  .text h1 { font-size: 46px; letter-spacing: -0.02em; margin: 40px 0 28px; }
  .text .eyebrow { margin: 0; font-size: 14px; }
  .canvas { position: absolute; left: 464px; top: 105px; width: 760px; }
</style></head>
<body>
  <div class="text">
    <img src="img/wordmark.svg" alt="Seismic" width="190" height="54">
    <h1>Direct coding agents like an engineering director.</h1>
    <p class="eyebrow">Open source · runs on your machine · obeya.si</p>
  </div>
  <img class="canvas shot" src="img/canvas.png" alt="">
</body></html>`;

// the page and the site's files from one origin, so the browser loads its fonts
const server = Bun.serve({
  port: 0,
  fetch: (req) => {
    const { pathname } = new URL(req.url);
    if (pathname === '/') return new Response(html, { headers: { 'content-type': 'text/html' } });
    const file = Bun.file(join(SITE, decodeURIComponent(pathname)));
    return file.exists().then((found) => (found ? new Response(file) : new Response(null, { status: 404 })));
  },
});
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.goto(server.url.href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
} finally {
  await browser.close();
  server.stop();
}
console.log(`${out}: upload it on GitHub under Settings → General → Social preview.`);
