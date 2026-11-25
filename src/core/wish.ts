




export const ISSUES_REPO = 'nickpalenchar/seismic';
const NEW_ISSUE = `https://github.com/${ISSUES_REPO}/issues/new`;


export const MAX_ISSUE_URL = 8000;


export interface Wish {
  said: string;
  answer?: string;
}

export const isWish = (w: unknown): w is Wish =>
  !!w && typeof w === 'object' && typeof (w as Wish).said === 'string' && ((w as Wish).answer === undefined || typeof (w as Wish).answer === 'string');

/** The line under the body: Seismic's version, the system, and how it runs. */
export const issueFooter = (version: string, os: string, runs: string) => `Seismic ${version} · ${os} · ${runs}`;
const FOOTER = /\n*Seismic \S+ · [^\n]+$/;

/** The body without its footer line, as the owner wrote or edited it. */
export const withoutFooter = (body: string) => body.replace(FOOTER, '').trimEnd();

/**
 * The link that opens the prefilled issue. A body too long for it is cut, with `note` at the cut
 * (the rest goes in by hand), and `trimmed` says so.
 */
export function issueUrl(title: string, body: string, note: string): { url: string; trimmed: boolean } {
  const url = (b: string) => `${NEW_ISSUE}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
  if (url(body).length <= MAX_ISSUE_URL) return { url: url(body), trimmed: false };
  const tail = `\n\n${note}`;
  
  const cut = (n: number) => body.slice(0, n).replace(/[\uD800-\uDBFF]$/, '');
  
  let lo = 0;
  let hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (url(cut(mid) + tail).length <= MAX_ISSUE_URL) lo = mid;
    else hi = mid - 1;
  }
  return { url: url(cut(lo).trimEnd() + tail), trimmed: true };
}
