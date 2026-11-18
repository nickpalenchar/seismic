// What Seismic puts out. Its app goes out as GitHub releases (docs/release.md): the release status
// (scripts/release-status.ts) stops at DISTRIBUTION first. This repository's own site (site/) and its
// hero video do not go out: seismic.im is built from the separate seismic-site repository, so the
// scripts that would publish them stop at SITE; their tests run them in a temp checkout with a copy
// of this file that says yes.
export const DISTRIBUTION = true;
export const SITE = false;

export function distributionPaused(what: string): string | null {
  return DISTRIBUTION ? null : `${what} is paused: distribution is switched off (scripts/distribution.ts, docs/release.md). Nothing went out.`;
}

export function sitePaused(what: string): string | null {
  return SITE ? null : `${what} is paused: seismic.im is built from the seismic-site repository, not from site/ here (docs/release.md). Nothing went out.`;
}
