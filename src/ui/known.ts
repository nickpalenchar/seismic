

/** Whether the owner has used what the hint under `key` points to. */
export function known(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Remembers that the owner has used it: its hint goes. */
export function know(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {}
}
