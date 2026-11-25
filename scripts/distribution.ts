




export const DISTRIBUTION = true;
export const SITE = false;

export function distributionPaused(what: string): string | null {
  return DISTRIBUTION ? null : `${what} is paused: distribution is switched off (scripts/distribution.ts, docs/release.md). Nothing went out.`;
}

export function sitePaused(what: string): string | null {
  return SITE ? null : `${what} is paused: seismic.im is built from the seismic-site repository, not from site/ here (docs/release.md). Nothing went out.`;
}
