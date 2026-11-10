// A wish or a bug for Seismic's makers: a dialog over the page, opened from the foot of Seismic's
// sidebar, from the `?` legend, by the Koordinator when the owner asks it to tell the makers
// something, and from the link under a reply that says Seismic cannot do what they asked. What the
// owner writes or says in its field a small job writes up as a GitHub issue in English; title and
// body stand editable as they go out, and "Open on GitHub" opens the prefilled issue for the
// owner to submit under their own account. The draft is kept per tab and project, like every input.

import { MessageCircle } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { issueUrl, type Wish, withoutFooter } from '../core/wish';
import { api, ApiError } from './api';
import { Composer } from './composer';
import { WISH_DRAFT } from './draft';
import { useFitHeight } from './fitHeight';
import { imageUrl, Shots } from './shots';
import { clock, errorText, t } from './strings';
import { Button, CloseButton } from './components/button';
import { Input, Textarea } from './components/input';

/** The issue as it will go out; `raw`: the job wrote nothing, the owner's words stand as they are. */
interface Issue {
  title: string;
  body: string;
  images: string[];
  raw?: true;
  /**
   * The account's usage limit kept the job from writing: it writes the draft from the same words at
   * `until` (ISO time), reworking the draft before them (`base`), unless the owner edits it first.
   */
  again?: { wish: Wish; images: string[]; until: string; base: { title: string; body: string } | null };
  /** The wish the draft was written from, when it started from one: its link opens this draft again. */
  from?: Wish;
}

interface WishState {
  open: boolean;
  issue: Issue | null;
  writing: boolean;
  error: string;
  /** A wish to write once the draft that stands is discarded. */
  pending?: Wish;
  /** Opened on GitHub: what the owner still needs to know (the clipboard). */
  sent?: string[];
}

let state: WishState = { open: false, issue: null, writing: false, error: '' };
const listeners = new Set<() => void>();
let kept: { store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; key: string } | null = null;

function set(change: Partial<WishState>) {
  const before = state.issue;
  state = { ...state, ...change };
  if (state.issue !== before) {
    if (kept)
      try {
        if (state.issue) kept.store.setItem(kept.key, JSON.stringify(state.issue));
        else kept.store.removeItem(kept.key);
      } catch {}
    writeAgain();
  }
  for (const fn of listeners) fn();
}

let again: ReturnType<typeof setTimeout> | undefined;

/** A draft the usage limit kept the job from writing is written once it lifts, after a reload too. */
function writeAgain() {
  clearTimeout(again);
  const a = state.issue?.again;
  if (!a) return;
  again = setTimeout(() => {
    if (state.issue?.again === a && !state.writing) void write(a.wish, a.images, { base: a.base });
  }, Math.min(Math.max(0, Date.parse(a.until) - Date.now()), 2 ** 31 - 1));
}

/** The draft `at` keeps in its storage. */
function storedIssue(at: typeof kept): Issue | null {
  try {
    const issue = at && (JSON.parse(at.store.getItem(at.key) ?? 'null') as Issue | null);
    return issue && typeof issue.title === 'string' && typeof issue.body === 'string' ? { ...issue, images: issue.images ?? [] } : null;
  } catch {
    return null;
  }
}

/** Whether `at` is the draft the page shows now: the same project's, also after switching away and back. */
const shown = (at: typeof kept) => kept?.key === at?.key && kept?.store === at?.store;

/** Takes back the project's draft that `store` kept, and writes it down there from now on; for another project (switched to within the page), in place of the one's before. */
export function keepWish(store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, project: string) {
  const key = `obeya-wish-${project}`;
  if (kept?.key === key && kept.store === store) return;
  // the project before keeps its draft under its own name
  if (kept) state = { open: false, issue: null, writing: false, error: '' };
  kept = { store, key };
  const issue = storedIssue(kept);
  if (issue) state = { ...state, issue };
  writeAgain();
  for (const fn of listeners) fn();
}

export const useWish = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => state,
  );

/** The dialog's state as it stands, outside React. */
export const wishNow = () => state;

/** Whether a draft waits to be opened on GitHub. */
export const useWishDraft = () => !!useWish().issue;

const same = (a: Wish | undefined, b: Wish) => !!a && a.said === b.said && a.answer === b.answer;

/** Whether the draft holds something of the owner's to lose: text in its body, or screenshots. A title alone does not count. */
const holds = (issue: Issue) => !!withoutFooter(issue.body).trim() || issue.images.length > 0;

/**
 * Opens the dialog; with `seed` (what the owner wants the makers told, or a request Seismic could not
 * do and its answer) the job writes a draft from it. A draft written from that seed opens as it
 * stands; another one with something in it stays, and the owner decides; one without goes.
 */
export function openWish(seed?: Wish) {
  if (!seed || same(state.issue?.from, seed)) return set({ open: true, sent: undefined });
  if (state.writing || (state.issue && holds(state.issue))) return set({ open: true, sent: undefined, pending: seed });
  set({ open: true, sent: undefined, pending: undefined, issue: null });
  void write(seed, [], { seed: true });
}

export const closeWish = () => set({ open: false, sent: undefined });

/**
 * The job writes the issue from the owner's words, reworking the draft that stands; `base`: the
 * draft it reworks instead, for words the usage limit kept it from writing up, whose screenshots
 * stand already; `seed`: the words are a wish the draft starts from.
 */
async function write(w: Wish, images: string[], { base, seed }: { base?: { title: string; body: string } | null; seed?: true } = {}) {
  const before = base === undefined ? state.issue : base;
  const from = seed ? w : state.issue?.from;
  const at = kept;
  set({ writing: true, error: '' });
  try {
    const out = await api.writeWish({
      said: w.said,
      ...(w.answer ? { answer: w.answer } : {}),
      ...(before ? { title: before.title, body: before.body } : {}),
      ...(images.length ? { images } : {}),
      app: !!window.obeyaApp,
    });
    // the draft as it stands now on the project it was asked on: after a switch, the one kept there
    const now = shown(at) ? state.issue : storedIssue(at);
    const shots = base === undefined ? [...(now?.images ?? []), ...images] : (now?.images ?? images);
    const limited = out.limitedUntil ? { again: { wish: w, images, until: out.limitedUntil, base: before ? { title: before.title, body: before.body } : null } } : {};
    const issue: Issue = { title: out.title, body: out.body, images: shots, ...(out.raw ? { raw: true as const } : {}), ...limited, ...(from ? { from } : {}) };
    if (shown(at)) set({ writing: false, issue });
    // the owner switched to another project meanwhile: the draft goes to the project it was written on
    else if (at)
      try {
        at.store.setItem(at.key, JSON.stringify(issue));
      } catch {}
  } catch (e) {
    if (shown(at)) set({ writing: false, error: e instanceof ApiError ? errorText(e.code) : t.offlineError });
  }
}

function discard() {
  const next = state.pending;
  set({ issue: null, pending: undefined, error: '' });
  if (next) void write(next, [], { seed: true });
}

/** An image as PNG, the one kind every clipboard takes. */
async function png(id: string): Promise<Blob> {
  const blob = await (await fetch(imageUrl(id))).blob();
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no PNG'))), 'image/png'));
}

/**
 * Opens the prefilled issue in the browser (in the app the shell hands it to the system's), with
 * the first screenshot on the clipboard, or without one the whole text when the link had to cut it.
 * The clipboard is filled before the browser takes the focus; then the draft goes, and a wish that
 * waited for it is written.
 */
async function send(issue: Issue) {
  const { url, trimmed } = issueUrl(issue.title.trim(), issue.body.trim(), t.wish.cut);
  const shot = issue.images[0];
  const at = kept;
  const lines = [t.wish.sent];
  try {
    if (shot) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png(shot) })]);
      lines.push(t.wish.sentImage);
    } else if (trimmed) {
      await navigator.clipboard.writeText(issue.body.trim());
      lines.push(t.wish.sentText);
    }
  } catch {
    lines.push(t.wish.clipFailed);
  }
  window.open(url, '_blank', 'noopener');
  if (!shown(at)) {
    // sent from the project before the owner switched: its draft is done there, this project's stays
    if (at)
      try {
        at.store.removeItem(at.key);
      } catch {}
    return;
  }
  const next = state.pending;
  set({ issue: null, sent: next ? [...lines, t.wish.sentNext] : lines, pending: undefined });
  if (next) void write(next, [], { seed: true });
}

/** The dialog over the page; a click beside it, Esc or ✕ closes it, and the draft stays. */
export function WishDialog() {
  const w = useWish();
  if (!w.open) return null;
  const { issue } = w;
  return (
    <div id="wish" onClick={closeWish}>
      <div className="box" role="dialog" aria-label={t.wish.title} onClick={(e) => e.stopPropagation()}>
        <CloseButton label={t.close} className="close" onClick={closeWish} />
        <h2>{t.wish.title}</h2>
        {w.sent ? (
          <div className="w-sent">
            {w.sent.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <Button variant="primary" autoFocus onClick={closeWish}>
              {t.newCardHint.ok}
            </Button>
          </div>
        ) : (
          <>
            {w.pending && (
              <div className="w-pending">
                <p>{t.wish.pending}</p>
                <blockquote>{short(w.pending.said)}</blockquote>
                <p>{t.wish.pendingThen}</p>
                <Button size="small" disabled={w.writing} onClick={discard}>
                  {t.wish.replace}
                </Button>
              </div>
            )}
            {issue && <IssueFields issue={issue} disabled={w.writing} />}
            {w.writing && <p className="hint w-writing">{t.wish.writing}</p>}
            {w.error && <p className="p-error">{w.error}</p>}
            <Composer
              className="w-compose"
              draft={WISH_DRAFT}
              placeholder={issue ? t.wish.add : t.wish.placeholder}
              {...(issue ? { label: t.wish.rework } : { action: t.wish.write })}
              onSend={(text, images) => write({ said: text || '(see the screenshot)' }, images ?? [])}
            />
            {issue && (
              <>
                <p className="w-public">
                  {t.wish.public}
                  {issue.images.length > 0 && ` ${t.wish.shots(issue.images.length)}`}
                  {issueUrl(issue.title, issue.body, t.wish.cut).trimmed && ` ${t.wish.long(issue.images.length > 0)}`}
                </p>
                <div className="w-actions">
                  <button className="w-discard" onClick={discard}>
                    {t.wish.discard}
                  </button>
                  <Button variant="primary" disabled={w.writing || !issue.title.trim() || !issue.body.trim()} onClick={() => void send(issue)}>
                    {t.wish.open}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The owner's words of a waiting wish, as the dialog quotes them. */
const short = (said: string) => {
  const one = said.replace(/\s+/g, ' ').trim();
  return one.length > 160 ? `${one.slice(0, 159).trimEnd()} …` : one;
};

/** Title and body exactly as they go out, for the owner to edit; the screenshots that go on GitHub by hand below them. */
function IssueFields({ issue, disabled }: { issue: Issue; disabled: boolean }) {
  const body = useRef<HTMLTextAreaElement>(null);
  useFitHeight(body, issue.body);
  // what the owner edits stands: the job does not write it again once the usage limit lifts
  const edit = (change: Partial<Issue>) => {
    const { again: _, ...rest } = issue;
    set({ issue: { ...rest, ...change } });
  };
  // the job's draft arrives: the title is where the owner reads first
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => title.current?.focus(), [disabled]);
  return (
    <div className="w-issue">
      <label>
        <span>{t.wish.issueTitle}</span>
        <Input className="text-sm font-semibold" ref={title} value={issue.title} disabled={disabled} spellCheck onChange={(e) => edit({ title: e.target.value })} />
      </label>
      <label>
        <span>{t.wish.issueBody}</span>
        <Textarea className="text-sm" ref={body} value={issue.body} disabled={disabled} spellCheck rows={4} onChange={(e) => edit({ body: e.target.value })} />
      </label>
      {issue.again ? <p className="hint">{t.wish.limited(clock(issue.again.until))}</p> : issue.raw && <p className="hint">{t.wish.raw}</p>}
      <Shots ids={issue.images} />
    </div>
  );
}

/** The quiet link that opens the dialog: under "Check setup" in the Konfiguration dialog, and in the legend (`onOpen` closes either). */
export function WishLink({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const draft = useWishDraft();
  return (
    <button
      className={['wish-link', className].filter(Boolean).join(' ')}
      onClick={() => {
        onOpen?.();
        openWish();
      }}
    >
      <BubbleIcon />
      <span className="w-text">{t.wish.link}</span>
      {draft && <span className="w-draft"> · {t.wish.draftOpen}</span>}
    </button>
  );
}

/** Under a reply that says Seismic cannot do what the owner asked, or that opened a draft for the makers. */
export function WishReplyLink({ wish }: { wish: Wish }) {
  return (
    <button className="wish-link on-reply" onClick={() => openWish(wish)}>
      ↗ <span className="w-text">{wish.answer ? t.wish.report : t.wish.reopen}</span>
    </button>
  );
}

function BubbleIcon() {
  return (
    <MessageCircle size={13} strokeWidth={2} aria-hidden="true" />
  );
}
