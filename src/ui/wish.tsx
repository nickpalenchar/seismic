






import { cn } from 'cn';
import { MessageCircle } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { issueUrl, type Wish, withoutFooter } from '../core/wish';
import { api, ApiError } from './api';
import { Composer } from './composer';
import { WISH_DRAFT } from './draft';
import { draftSession, onHandOverEntries } from './draftSession';
import { useFitHeight } from './fitHeight';
import { imageUrl, Shots } from './shots';
import { clock, errorText, t } from './strings';
import { Button, CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { Input, Textarea } from './components/input';


interface Issue {
  title: string;
  body: string;
  images: string[];
  raw?: true;
  



  again?: { wish: Wish; images: string[]; until: string; base: { title: string; body: string } | null };
  
  from?: Wish;
}

interface WishState {
  open: boolean;
  issue: Issue | null;
  writing: boolean;
  error: string;
  
  pending?: Wish;
  
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
  const key = `seismic-wish-${project}`;
  if (kept?.key === key && kept.store === store) return;
  
  if (kept) state = { open: false, issue: null, writing: false, error: '' };
  kept = { store, key };
  const issue = storedIssue(kept);
  if (issue) state = { ...state, issue };
  writeAgain();
  for (const fn of listeners) fn();
}

onHandOverEntries((keys) => {
  if (kept?.store !== draftSession || !keys.has(kept.key) || state.issue || state.writing) return;
  const issue = storedIssue(kept);
  if (issue) set({ issue });
});

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
      app: !!window.seismicApp,
    });
    
    const now = shown(at) ? state.issue : storedIssue(at);
    const shots = base === undefined ? [...(now?.images ?? []), ...images] : (now?.images ?? images);
    const limited = out.limitedUntil ? { again: { wish: w, images, until: out.limitedUntil, base: before ? { title: before.title, body: before.body } : null } } : {};
    const issue: Issue = { title: out.title, body: out.body, images: shots, ...(out.raw ? { raw: true as const } : {}), ...limited, ...(from ? { from } : {}) };
    if (shown(at)) set({ writing: false, issue });
    
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
    <Dialog open onOpenChange={(open) => !open && closeWish()}>
      <DialogContent
        id="wish"
        glass
        className="flex w-[760px] flex-col gap-3 overflow-auto px-6 py-6"
        onOpenAutoFocus={(e) => {
          
          const field = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('textarea, [contenteditable]');
          if (!field) return;
          e.preventDefault();
          field.focus();
        }}
      >
        <CloseButton label={t.close} className="close absolute top-3 right-3.5" onClick={closeWish} />
        <DialogTitle asChild>
          <h2 className="m-0 mb-0.5 text-xl">{t.wish.title}</h2>
        </DialogTitle>
        {w.sent ? (
          <div className="flex flex-col items-start gap-1.5">
            {w.sent.map((line) => (
              <p key={line} className="m-0 text-base leading-[1.45]">
                {line}
              </p>
            ))}
            <Button variant="primary" className="mt-2.5 self-end" autoFocus onClick={closeWish}>
              {t.newCardHint.ok}
            </Button>
          </div>
        ) : (
          <>
            {w.pending && (
              <div className="mx-0 mt-2.5 mb-3.5 flex flex-col items-start gap-2 rounded-xs bg-muted px-3 py-2.5 text-base [--button-bg:var(--surface)]">
                <p className="m-0 leading-[1.45]">{t.wish.pending}</p>
                <blockquote className="m-0 border-l-2 border-l-muted-foreground pl-2.5 leading-[1.45]">{short(w.pending.said)}</blockquote>
                <p className="m-0 leading-[1.45]">{t.wish.pendingThen}</p>
                <Button size="small" disabled={w.writing} onClick={discard}>
                  {t.wish.replace}
                </Button>
              </div>
            )}
            {issue && <IssueFields issue={issue} disabled={w.writing} />}
            {w.writing && <p className="hint m-0 !text-base">{t.wish.writing}</p>}
            {w.error && <p className="p-error">{w.error}</p>}
            <Composer
              className="mt-0 max-w-none"
              draft={WISH_DRAFT}
              placeholder={issue ? t.wish.add : t.wish.placeholder}
              {...(issue ? { label: t.wish.rework } : { action: t.wish.write })}
              onSend={(text, images) => write({ said: text || '(see the screenshot)' }, images ?? [])}
            />
            {issue && (
              <>
                <p className="m-0 text-xs text-muted-foreground">
                  {t.wish.public}
                  {issue.images.length > 0 && ` ${t.wish.shots(issue.images.length)}`}
                  {issueUrl(issue.title, issue.body, t.wish.cut).trimmed && ` ${t.wish.long(issue.images.length > 0)}`}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <button className="cursor-pointer border-b border-b-border bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground" onClick={discard}>
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
      </DialogContent>
    </Dialog>
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
  
  const edit = (change: Partial<Issue>) => {
    const { again: _, ...rest } = issue;
    set({ issue: { ...rest, ...change } });
  };
  
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => title.current?.focus(), [disabled]);
  return (
    <div className="flex flex-col gap-2.5">
      <label className={issueLabel}>
        <span>{t.wish.issueTitle}</span>
        <Input className="text-sm font-semibold" ref={title} value={issue.title} disabled={disabled} spellCheck onChange={(e) => edit({ title: e.target.value })} />
      </label>
      <label className={issueLabel}>
        <span>{t.wish.issueBody}</span>
        <Textarea className="min-h-[90px] resize-none overflow-hidden text-sm" ref={body} value={issue.body} disabled={disabled} spellCheck rows={4} onChange={(e) => edit({ body: e.target.value })} />
      </label>
      {issue.again ? <p className="hint m-0">{t.wish.limited(clock(issue.again.until))}</p> : issue.raw && <p className="hint m-0">{t.wish.raw}</p>}
      <Shots ids={issue.images} />
    </div>
  );
}


const issueLabel = 'flex flex-col gap-1 text-xs text-muted-foreground';


const wishLinkClass = 'group/wish inline-flex cursor-pointer items-baseline gap-1.5 bg-transparent p-0 text-left text-xs text-muted-foreground hover:text-foreground';
const wishTextClass = 'border-b border-b-border group-hover/wish:border-muted-foreground';

/** The quiet link that opens the dialog from Settings or the legend. `onOpen` closes the current panel. */
export function WishLink({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const draft = useWishDraft();
  return (
    <button
      className={cn(wishLinkClass, className)}
      onClick={() => {
        onOpen?.();
        openWish();
      }}
    >
      <BubbleIcon />
      <span className={wishTextClass}>{t.wish.link}</span>
      {draft && <span className="w-draft"> · {t.wish.draftOpen}</span>}
    </button>
  );
}

/** Under a reply that says Seismic cannot do what the owner asked, or that opened a draft for the makers. */
export function WishReplyLink({ wish }: { wish: Wish }) {
  return (
    <button className={cn(wishLinkClass, 'mt-1.5 flex')} onClick={() => openWish(wish)}>
      ↗ <span className={wishTextClass}>{wish.answer ? t.wish.report : t.wish.reopen}</span>
    </button>
  );
}

function BubbleIcon() {
  return (
    <MessageCircle className="self-center" size={13} strokeWidth={2} aria-hidden="true" />
  );
}
