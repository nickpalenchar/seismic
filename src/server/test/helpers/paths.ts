// Where the tests find the server's sources and their fixtures, now that they sit apart from them.

import { join } from 'node:path';

/** src/server */
export const serverDir = join(import.meta.dir, '..', '..');
/** src/server/test/fixtures */
export const fixturesDir = join(import.meta.dir, '..', 'fixtures');
