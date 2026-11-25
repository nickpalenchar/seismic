



import { PDFJS_BASE } from '../core/files';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.min.mjs' with { type: 'file' };
import worker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' with { type: 'file' };
import jbig2 from 'pdfjs-dist/wasm/jbig2.wasm' with { type: 'file' };
import jbig2Js from 'pdfjs-dist/wasm/jbig2_nowasm_fallback.js' with { type: 'file' };
import openjpeg from 'pdfjs-dist/wasm/openjpeg.wasm' with { type: 'file' };
import openjpegJs from 'pdfjs-dist/wasm/openjpeg_nowasm_fallback.js' with { type: 'file' };
import qcms from 'pdfjs-dist/wasm/qcms_bg.wasm' with { type: 'file' };
import dingbats from 'pdfjs-dist/standard_fonts/FoxitDingbats.pfb' with { type: 'file' };
import fixed from 'pdfjs-dist/standard_fonts/FoxitFixed.pfb' with { type: 'file' };
import fixedBold from 'pdfjs-dist/standard_fonts/FoxitFixedBold.pfb' with { type: 'file' };
import fixedBoldItalic from 'pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb' with { type: 'file' };
import fixedItalic from 'pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb' with { type: 'file' };
import serif from 'pdfjs-dist/standard_fonts/FoxitSerif.pfb' with { type: 'file' };
import serifBold from 'pdfjs-dist/standard_fonts/FoxitSerifBold.pfb' with { type: 'file' };
import serifBoldItalic from 'pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb' with { type: 'file' };
import serifItalic from 'pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb' with { type: 'file' };
import symbol from 'pdfjs-dist/standard_fonts/FoxitSymbol.pfb' with { type: 'file' };
import sansBold from 'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf' with { type: 'file' };
import sansBoldItalic from 'pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf' with { type: 'file' };
import sansItalic from 'pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf' with { type: 'file' };
import sans from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf' with { type: 'file' };

const FILES: Record<string, string> = {
  'pdf.min.mjs': pdfjs,
  'pdf.worker.min.mjs': worker,
  'wasm/jbig2.wasm': jbig2,
  'wasm/jbig2_nowasm_fallback.js': jbig2Js,
  'wasm/openjpeg.wasm': openjpeg,
  'wasm/openjpeg_nowasm_fallback.js': openjpegJs,
  'wasm/qcms_bg.wasm': qcms,
  'standard_fonts/FoxitDingbats.pfb': dingbats,
  'standard_fonts/FoxitFixed.pfb': fixed,
  'standard_fonts/FoxitFixedBold.pfb': fixedBold,
  'standard_fonts/FoxitFixedBoldItalic.pfb': fixedBoldItalic,
  'standard_fonts/FoxitFixedItalic.pfb': fixedItalic,
  'standard_fonts/FoxitSerif.pfb': serif,
  'standard_fonts/FoxitSerifBold.pfb': serifBold,
  'standard_fonts/FoxitSerifBoldItalic.pfb': serifBoldItalic,
  'standard_fonts/FoxitSerifItalic.pfb': serifItalic,
  'standard_fonts/FoxitSymbol.pfb': symbol,
  'standard_fonts/LiberationSans-Bold.ttf': sansBold,
  'standard_fonts/LiberationSans-BoldItalic.ttf': sansBoldItalic,
  'standard_fonts/LiberationSans-Italic.ttf': sansItalic,
  'standard_fonts/LiberationSans-Regular.ttf': sans,
};

/** The file of pdf.js the request names (`<PDFJS_BASE><name>`), or 404. */
export function servePdfjs(req: Request): Response {
  const at = new URL(req.url).pathname;
  const name = at.startsWith(PDFJS_BASE) ? at.slice(PDFJS_BASE.length) : '';
  const path = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (!path) return new Response('not found', { status: 404 });
  const type = name.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(name) ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  return new Response(Bun.file(path), { headers: { 'content-type': type, 'cache-control': 'max-age=31536000, immutable' } });
}
