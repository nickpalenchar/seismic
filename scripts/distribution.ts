// Whether Seismic distributes anything: switched off until it publishes its own app
// (docs/release.md). Scripts that would put something out (a release, its assets, the site) stop
// here first; their tests run them in a temp checkout with a copy of this file that says yes.
export const DISTRIBUTION = false;

export function distributionPaused(what: string): string | null {
  return DISTRIBUTION ? null : `${what} is paused until Seismic distributes its own app (docs/release.md): nothing went out.`;
}
