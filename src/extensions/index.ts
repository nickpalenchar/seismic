/** The one list of enabled fork extensions. Their client and server implementations are loaded
 * separately, so server code never enters the browser bundle. */
export const enabled: readonly string[] = ['always-allow'];

/**
 * Files that call the seam or carry its plumbing (project.ts, runtime.ts, config.tsx), for Lander's
 * outgoing-diff check: it reads this list from obeya's main and refuses changes to the lines in
 * these files that call into the extensions (best effort; the porting agent removes what it misses).
 */
export const SEAM_FILES = [
  'src/extensions/index.ts',
  'src/extensions/client.ts',
  'src/extensions/server.ts',
  'src/adapters/index.ts',
  'src/adapters/schema.ts',
  'src/server/project.ts',
  'src/server/config.ts',
  'src/server/runtime.ts',
  'src/server/server.ts',
  'src/server/workers.ts',
  'src/ui/App.tsx',
  'src/ui/config.tsx',
  'src/ui/detail.tsx',
  'src/ui/strings.ts',
] as const;
