// Imported first by main.tsx: the browser's names from before the rename move before any module reads them (browserState.ts).

import { migrateBrowserState } from './browserState';

try {
  migrateBrowserState([localStorage, sessionStorage]);
} catch {}
