/** Paths relative to a repository, as scheduling accepts them. */
export const normalize = (p: string) => p.trim().replace(/^\.\//, '').replace(/^\/+/, '');

/** Equal paths, or a directory (trailing slash) containing the other path. */
export function overlaps(a: string, b: string): boolean {
  return a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}
