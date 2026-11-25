




export const INERT = { dirs: ['docs', 'design', 'site', '.github', '.claude', '.codex'], ending: '.md' };

/** Whether a change to `path` (relative to the repository) leaves the running code as it is. */
export const inert = (path: string) => INERT.dirs.some((d) => path.startsWith(`${d}/`)) || path.endsWith(INERT.ending);
