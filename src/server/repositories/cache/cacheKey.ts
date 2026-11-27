/**
 * The cache key of a query: its fields in sorted order as JSON, and the lists under `unorderedFields`
 * sorted too, so `{ ids: [4, 1, 3] }` and `{ ids: [1, 3, 4] }` share one key. A list under any other
 * field keeps its order, since it may mean something (a sort, a page).
 */
export function cacheKey(query: object, unorderedFields: readonly string[]): string {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([field, value]) => [field, Array.isArray(value) && unorderedFields.includes(field) ? sortedLexically(value) : value]);
  return JSON.stringify(entries);
}

function sortedLexically(values: unknown[]): unknown[] {
  return [...values].sort((a, b) => {
    const left = String(a);
    const right = String(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
