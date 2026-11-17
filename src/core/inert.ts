// The paths whose change leaves the running code as it is: docs, the design, the site for seismic.im,
// the workflows and the agents' own configuration (an allow rule the owner added, say). The self-update restarts for a change anywhere else; a release's notes list the
// commits that change something there (scripts/release.ts).

/** Their directories, at the repository's top, and the ending of such a file anywhere. */
export const INERT = { dirs: ['docs', 'design', 'site', '.github', '.claude', '.codex'], ending: '.md' };

/** Whether a change to `path` (relative to the repository) leaves the running code as it is. */
export const inert = (path: string) => INERT.dirs.some((d) => path.startsWith(`${d}/`)) || path.endsWith(INERT.ending);
