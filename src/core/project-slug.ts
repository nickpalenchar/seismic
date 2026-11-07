// How a project shows in addresses (`/p/<segment>`): its name as a slug, its id where the name
// would not tell projects apart. Server and page share it.

/** A name as a lowercase address part: accents and ß folded, runs of other characters one dash. */
export const slug = (s: string) =>
  s
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-|-$/g, '');

interface Named {
  id: string;
  name: string;
  /** Names it had before: their addresses lead to it. */
  oldNames?: string[];
}

/**
 * The address part of `project` among `all`: the slug of its name, unless that is empty, another
 * project has it too, or it is another project's id (that id must keep opening that project); then
 * its id. Segments are unique across `all`, so each opens one project.
 */
export function projectSegment(project: Named, all: Named[]): string {
  const s = slug(project.name);
  const taken = all.some((o) => o !== project && o.id !== project.id && (slug(o.name) === s || o.id === s));
  return s && !taken ? s : project.id;
}

/**
 * The project an address part names: by its segment, else by its id (links from before names),
 * else by a name it had before (a renamed project's old links).
 */
export function projectAt<T extends Named>(all: T[], segment: string | undefined): T | undefined {
  if (!segment) return undefined;
  const find = (seg: string) =>
    all.find((p) => projectSegment(p, all) === seg) ?? all.find((p) => p.id === seg) ?? all.find((p) => p.oldNames?.some((n) => slug(n) === seg));
  // typed by hand ("/p/Store"), the name works as the owner writes it
  const typed = slug(segment);
  return find(segment) ?? (typed && typed !== segment ? find(typed) : undefined);
}
