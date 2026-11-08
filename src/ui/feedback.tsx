// The owner's feedback on an agent's approved work: 1 to 5 stars and an optional comment, the same
// on the project and on the phone. Right after an approval it asks above the microphone, where the
// owner can skip it; the card itself keeps asking until it is answered, and shows the answer after.
// Saving goes its own way: approval and landing never wait for it, nor fail with it.

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FeedbackAnswer, Item } from '../core/types';
import { api } from './api';
import { dropDraft, rateDraft, updateDraft, useDraft } from './draft';
import { plain } from './markdown';
import { OpenPerformance } from './performance';
import { failText, t } from './strings';

/** Stars and the comment for the card's approved work; `prompt`: the one after the approval, with its title and "Skip". */
export function Rate({ item, prompt, onClose }: { item: Item; prompt?: boolean; onClose?: () => void }) {
  const rate = item.review!.rate!;
  const key = rateDraft(item.id);
  const draft = useDraft(key);
  // what was saved, ahead of the snapshot that brings it
  const [saved, setSaved] = useState<FeedbackAnswer | undefined>(rate.answer);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [thanked, setThanked] = useState(false);
  const compare = useContext(OpenPerformance);
  useEffect(() => setSaved(rate.answer), [rate.handover, rate.answer?.rating, rate.answer?.comment]);
  const rating = saved?.rating ?? 0;
  const give = async (answer: FeedbackAnswer) => {
    const before = saved;
    setSaved(answer);
    setBusy(true);
    setError('');
    try {
      await api.giveFeedback(item.id, rate.handover, answer);
      setThanked(true);
      return true;
    } catch (e) {
      setSaved(before);
      setError(failText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const text = draft.text.trim();
  const sendComment = async () => {
    if (!text || busy) return;
    if (await give({ ...(saved?.rating ? { rating: saved.rating } : {}), comment: text })) {
      dropDraft(key);
      onClose?.();
    }
  };
  // the comment field opens with the first star, or stands where a comment was given or begun
  const commenting = rating > 0 || !!saved?.comment || !!draft.text;
  const shown = hover || rating;
  return (
    <div className={prompt ? 'rate prompt' : 'rate'}>
      <div className="rate-row">
        <span className="rate-q">{prompt ? t.feedback.ask(plain(item.title)) : t.feedback.askCard}</span>
        <span className="stars" role="radiogroup" aria-label={t.feedback.askCard} onPointerLeave={() => setHover(0)}>
          {t.feedback.stars.map((name, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n + 1}
              aria-label={t.feedback.star(n + 1, name)}
              title={name}
              className={n < shown ? 'star on' : 'star'}
              disabled={busy}
              // a mouse's only: Safari on the iPhone takes a tap that changes what shows on hover for the hover alone, and the star stayed unsaved
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(n + 1)}
              onClick={() => rating !== n + 1 && void give({ rating: n + 1, ...(saved?.comment ? { comment: saved.comment } : {}) })}
            >
              {n < shown ? '★' : '☆'}
            </button>
          ))}
        </span>
        {shown > 0 && <span className="rate-name">{t.feedback.stars[shown - 1]}</span>}
        {prompt && (
          <button type="button" className="btn rate-skip" title={rating || text ? undefined : t.feedback.skipHint} disabled={busy} onClick={() => (text ? void sendComment() : onClose?.())}>
            {rating || text ? t.feedback.done : t.feedback.skip}
          </button>
        )}
      </div>
      {commenting && (
        <div className="rate-comment">
          {saved?.comment && !draft.text ? (
            <p className="rate-given">
              {t.feedback.quoted(saved.comment)}{' '}
              <button type="button" className="link" onClick={() => updateDraft(key, { text: saved.comment ?? '' })}>
                {t.feedback.change}
              </button>
            </p>
          ) : (
            <>
              <textarea
                rows={2}
                placeholder={t.feedback.comment}
                value={draft.text}
                onChange={(e) => updateDraft(key, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendComment();
                }}
              />
              {!prompt && (
                <button type="button" className="btn" disabled={!text || busy || text === saved?.comment} onClick={() => void sendComment()}>
                  {t.feedback.send}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="p-error">{error}</p>}
      {thanked && !error && !prompt && <p className="hint">{t.feedback.thanks}</p>}
      {!prompt && rating > 0 && compare && (
        <button type="button" className="link rate-compare" title={t.performance.openHint} onClick={compare}>
          {t.performance.open}
        </button>
      )}
    </div>
  );
}

/**
 * The prompt after an approval or archiving: `ask` it for a card (or, archiving several at once, for
 * each in turn) once that went through; it shows while the card's approved work takes feedback and
 * has none yet, and stays until answered or skipped. Another approval asks about its own card instead.
 * A card that is not on the project (archived, by the owner or by itself after landing) is looked up
 * in the archive.
 */
export function useRatePrompt(items: Item[]) {
  const [queue, setQueue] = useState<string[]>([]);
  const card = queue[0] ?? null;
  // the archive as read for the cards asked about, and which cards that read covers
  const [archive, setArchive] = useState<{ covers: Set<string>; items: Item[] } | null>(null);
  const here = card ? items.find((i) => i.id === card) : undefined;
  const looked = !!card && !!archive?.covers.has(card);
  const away = looked ? archive!.items.find((i) => i.id === card) : undefined;
  const found = here?.review?.rate ? here : away?.review?.rate ? away : undefined;
  // the card as last shown: it stays while the archive is read after it left the project
  const shown = useRef<Item | undefined>(undefined);
  if (found) shown.current = found;
  const item = found ?? (!looked && shown.current?.id === card ? shown.current : undefined);
  // answered elsewhere (the card, another device) or no longer asked for: nothing left to ask
  const [answeredHere, setAnsweredHere] = useState(false);
  useEffect(() => setAnsweredHere(false), [card]);
  useEffect(() => {
    if (!card || here?.review?.rate || looked) return;
    let live = true;
    api.archived().then((a) => live && setArchive((was) => ({ covers: new Set([...(was?.covers ?? []), card, ...a.map((i) => i.id)]), items: a })), console.error);
    return () => void (live = false);
  }, [card, !!here?.review?.rate, looked]);
  const open = !!item?.review?.rate && (!item.review.rate.answer || answeredHere);
  // nothing to ask about this one: on to the next
  useEffect(() => {
    if (card && !open && (here?.review?.rate || looked)) setQueue((q) => q.slice(1));
  }, [card, open, !!here?.review?.rate, looked]);
  const close = () => setQueue((q) => q.slice(1));
  const prompt = open ? (
    <div className="rate-pop" onClickCapture={() => setAnsweredHere(true)}>
      <Rate key={item!.id} item={item!} prompt onClose={close} />
    </div>
  ) : null;
  const ask = useCallback((ids: string | string[]) => {
    setArchive(null);
    shown.current = undefined;
    setQueue(typeof ids === 'string' ? [ids] : ids);
  }, []);
  return { ask, prompt };
}
