export const REOPEN_WITHIN_MS = 15 * 60_000;

const closedAt = new Map<string, number>();

/** The chat panel of the project was closed (or is being left) now. */
export function markChatClosed(project: string, now = Date.now()) {
  closedAt.set(project, now);
}

/** The panel was closed longer ago than it resumes after: it opens on a new chat, with no call. */
export function chatLongClosed(project: string, now = Date.now()): boolean {
  const closed = closedAt.get(project);
  return closed !== undefined && now - closed > REOPEN_WITHIN_MS;
}

/**
 * The panel was never closed on this page (a first open, a reload) and the chat it would resume was
 * talked in longer ago than it resumes after: it opens on a new chat.
 */
export function chatWentQuiet(project: string, lastWordsAt: string, now = Date.now()): boolean {
  return !closedAt.has(project) && now - Date.parse(lastWordsAt) > REOPEN_WITHIN_MS;
}

/** Forgets every closing: for tests. */
export function forgetChatClosings() {
  closedAt.clear();
}
