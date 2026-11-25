

import { migrateBrowserState } from './browserState';

try {
  migrateBrowserState([localStorage, sessionStorage]);
} catch {}
