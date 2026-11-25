

/** `s` cut to `n` characters, the last of them "…" when it was longer. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** `s` on one line: each run of whitespace one space. */
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A string with something in it, else undefined: a field of a message from outside. */
export const nonEmpty = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

/** What went wrong, from anything thrown. */
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
