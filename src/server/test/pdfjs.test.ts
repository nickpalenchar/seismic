import { expect, test } from 'bun:test';
import { PDFJS_BASE } from '../../core/files';
import { servePdfjs } from '../pdfjs';

const get = (path: string) => servePdfjs(new Request(`http://127.0.0.1${path}`));

test('pdf.js and its worker come as scripts, its decoders and fonts as they are', async () => {
  for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    const r = get(`${PDFJS_BASE}${name}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toStartWith('text/javascript');
    expect((await r.text()).length).toBeGreaterThan(100_000);
  }
  expect(get(`${PDFJS_BASE}wasm/jbig2.wasm`).headers.get('content-type')).toBe('application/wasm');
  expect(get(`${PDFJS_BASE}standard_fonts/FoxitSerif.pfb`).status).toBe(200);
});

test('nothing else, nor another version of pdf.js', () => {
  expect(get(`${PDFJS_BASE}../package.json`).status).toBe(404);
  expect(get(`${PDFJS_BASE}constructor`).status).toBe(404);
  expect(get('/pdfjs/1.0.0/pdf.min.mjs').status).toBe(404);
});
