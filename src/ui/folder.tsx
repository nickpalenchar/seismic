// What a card changed in a folder without git: the line in place of its branch, the list above its
// conversation where no files show beside it, and "Discard changes", with a moment to take
// that back before it happens.

import { useEffect, useState } from 'react';
import { type CardDiff, diffSize, shownChanges } from '../core/diff';
import { changeRows } from '../core/files';
import type { CardAction, Item } from '../core/types';
import { api } from './api';
import { useCopy } from './copy';
import type { ActDone } from './detail';
import { cn } from 'cn';
import { DiffView, diffSizeClass, Lines } from './diff';
import { atWork, ChangeList } from './files';
import { t } from './strings';
import { X } from 'lucide-react';
import { Button, LinkButton } from './components/button';

/** How often an open card at work reads its change list again: its agent changes the folder as it goes. */
const LOOK_MS = 5000;
/** How long "Discard changes" waits for a second click that calls it off before it goes ahead: putting the files back cannot be taken back. */
const DISCARD_WAIT_S = 8;

/** The card's change list in its folder, read again as the card moves on, while its agent works, and on `reload`. */
export function useFolderDiff(item: Item, on: boolean): { diff: CardDiff | null; reload: () => void } {
  const [diff, setDiff] = useState<CardDiff | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    const look = () => api.diff(item.id).then((d) => !gone && setDiff(d), () => {});
    void look();
    const timer = item.state === 'working' ? setInterval(look, LOOK_MS) : undefined;
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [on, item.id, item.state, item.need, item.agent?.statusLine, item.review?.summary, item.review?.noChange, asked]);
  return { diff, reload: () => setAsked((n) => n + 1) };
}

/** Which undo the card has, with what it means on hover. */
function UndoKind({ undo }: { undo: 'full' | 'partial' }) {
  return (
    <span className={cn('f-undo', undo, undo === 'partial' && 'text-muted-foreground')} title={t.folder.undoHint[undo]}>
      {t.folder.undo[undo]}
    </span>
  );
}

/**
 * The card's line in place of a branch: how much it changed in the folder, its undo, the folder's
 * path to copy. `sizeBelow`: the card's change list shows how much instead.
 */
export function FolderLine({ item, diff, sizeBelow }: { item: Item; diff: CardDiff | null; sizeBelow?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopy(3000);
  const changes = diff?.folder?.changes ?? [];
  const size = diff && diffSize(diff.files);
  const below = sizeBelow && !!changes.length;
  return (
    <>
      {t.folder.changed}
      {diff && (
        <>
          {below ? null : ': '}
          {below ? null : changes.length ? (
            <LinkButton className={diffSizeClass} title={t.diff.show} onClick={() => setOpen(true)}>
              {t.folder.files(shownChanges(changes).length)}
              {size && (size.added || size.removed) ? (
                <>
                  {' '}
                  <Lines n={size} />
                </>
              ) : null}
            </LinkButton>
          ) : (
            t.folder.none
          )}
          {diff.folder?.undo && (
            <>
              {' · '}
              <UndoKind undo={diff.folder.undo} />
            </>
          )}
        </>
      )}
      {item.agent?.workstation && (
        <>
          {' · '}
          <LinkButton className={copied ? 'font-semibold text-approved' : undefined} title={item.agent.workstation} onClick={() => copy(item.agent!.workstation!)}>
            {copied ? t.diff.copied : t.diff.copyPath}
          </LinkButton>
        </>
      )}
      {open && <DiffView item={item} onClose={() => setOpen(false)} onRead={() => {}} />}
    </>
  );
}

/**
 * What the card changed in the folder, above its conversation where it shows no files beside it
 * (before its first handover, say): the change list, a click on a file's name or lines opening its diff.
 */
export function FolderBox({ item, diff }: { item: Item; diff: CardDiff | null }) {
  const rows = changeRows(diff);
  if (!rows.length) return null;
  return (
    <div className="f-box mt-2.5 mb-1 py-2.5 px-3 border border-border rounded-[8px] max-w-[760px] text-[12.5px] [&_p]:mt-1.5 [&_p]:mb-0 [&_.cl-list]:mt-1.5 [&_.cl-list]:mb-0">
      <b>{t.folder.changed}</b>
      <ChangeList item={item} rows={rows} fold={atWork(item)} />
    </div>
  );
}

/**
 * "Discard changes" on a card waiting for approval: puts back what it changed in the folder.
 * That cannot be taken back once done, so the button first counts down, and a second click on it (or its ×) calls it off.
 */
export function DiscardChanges({ diff, act, onDone }: { diff: CardDiff | null; act: (a: CardAction, done: ActDone) => Promise<void>; onDone: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  const undoable = (diff?.folder?.changes ?? []).filter((c) => c.undo === 'yes').length;
  useEffect(() => {
    if (left === null) return;
    if (left === 0) {
      setLeft(null);
      void act({ action: 'undo' }, { close: false }).then(onDone);
      return;
    }
    const h = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(h);
  }, [left]);
  if (!undoable && left === null) return null;
  // the button stays itself while it counts down: a second click on it, or its ×, calls it off
  const counting = left !== null;
  return (
    <>
      <Button
        className={cn('f-discard', counting && 'counting border border-destructive')}
        title={counting ? t.folder.cancelHint : t.folder.discardHint(undoable)}
        onClick={() => setLeft(counting ? null : DISCARD_WAIT_S)}
      >
        {t.folder.discard}
        {counting && (
          <>
            <span className="f-count ml-2 tabular-nums font-semibold">{t.folder.seconds(left)}</span>
            <X className="f-cancel ml-1.5 text-destructive stroke-3" size={14} aria-label={t.folder.cancel} />
          </>
        )}
      </Button>
      {counting && <span className="f-discarding self-center text-[12.5px] text-muted-foreground">{t.folder.clickToCancel}</span>}
    </>
  );
}
