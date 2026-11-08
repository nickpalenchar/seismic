// Push-to-talk: hold Space or the microphone, speak, let go. With the cursor in a text field the
// words are written into it, for the owner to add to and send. Otherwise the recording goes to
// Seismic with what stands in the field of the card or sidebar in view (its words first, its
// screenshots, the message it quotes): with an agent on the open card straight to that agent, else
// to the Koordinator, which answers with a confirmation to show. Where no field is in view,
// screenshots picked or pasted beside the microphone, and the paths of other files dropped on it,
// go with the next recording. The microphone is
// free again at once: each spoken command has its own line above it while it is read, which becomes
// its confirmation; a typed one gets its line with the confirmation.

import { createPortal } from 'react-dom';
import { Mic } from 'lucide-react';
import { createContext, useEffect, useRef, useState } from 'react';
import type { Place } from '../core/layout';
import type { Notice } from '../core/types';
import { ApiError, api, confirmShownMs, type Heard, holdRestart, undoShownMs, type Where } from './api';
import { beginDictation, dictate, draftOf, focusedDraft, insertFiles, MIC_DRAFT, moveFiles, moveImages, takesImages, toObeya, updateDraft, useDraft, useFieldOn, uploaded, useFocusedDraft, wordsOf } from './draft';
import { Aside } from './aside';
import { type Recording, record } from './recorder';
import { AttachButton, ShotStrip, useShotInput } from './shots';
import { replyOn, setReply, useReply } from './reply';
import { sent, take, type Taken } from './spot';
import { failText, t } from './strings';

/** Starts a recording, for a text field's microphone and Space held in it; null where nobody listens. */
export const HoldToTalk = createContext<(() => void) | null>(null);

type Phase = 'idle' | 'listening';

/** Space let go sooner is a tap, which plays or pauses the demo video: push-to-talk takes no shorter recording. */
export const TAP_MS = 350;

/** Below this peak a working microphone delivers nothing, not even room noise (the sidecar's threshold too). */
const QUIET_DBFS = -60;
/** How long the level may stay flat at the start of a recording before the owner is told. */
const FLAT_MS = 1500;

/**
 * How long Space is held before the microphone shows it listens: a tap on Space plays or pauses the
 * demo video, and the microphone lit up for that tap flickered. The recording runs from the press.
 */
export const SPACE_SHOWS_MS = 200;

/** How long a note under a field about its dictation stays. */
const NOTE_MS = 6000;

/**
 * Whether Seismic has the recording the page sent as `sent`, for a command whose answer the broken
 * connection lost: asked until Seismic answers, for as long as the page lives. A page going away
 * (another project, a reload) never hears, and gives nothing back.
 */
async function arrived(sent: string): Promise<boolean> {
  for (let wait = 500; ; wait = Math.min(wait * 2, 8000)) {
    try {
      return await api.voiceArrived(sent);
    } catch {
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** A name for a recording, unique enough to ask about it; `crypto.randomUUID` is missing outside a secure context. */
const recordingName = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Recording and sending; `level` drives the ring while listening, `flat` says the microphone delivers
 * nothing. A recording begun with the cursor in a text field is dictated into it. Any other one
 * `send` hands on with the draft `field` names for its target, and settles with what Seismic made of
 * it; the next one may start meanwhile.
 */
export function usePushToTalk(
  where: () => Where,
  field: (target: Where) => string,
  send: (target: Where, request: () => Promise<Heard>) => Promise<Heard>,
  onHeard: (h: Heard) => void,
  place: () => Place | undefined,
) {
  const [phase, setPhase] = useState<Phase>('idle');
  /** The microphone shows it listens: `shownAfter` into the recording. */
  const [shown, setShown] = useState(false);
  const showing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [level, setLevel] = useState(0);
  const [flat, setFlat] = useState(false);
  /** Recordings let go of that Seismic has not answered yet. */
  const [writing, setWriting] = useState(0);
  const mic = useRef<Promise<{ stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode }> | null>(null);
  const rec = useRef<{ recording: Recording; t0: number; target: Where; into: string | null; spot: Taken | null } | null>(null);
  const held = useRef<number | null>(null);
  const frame = useRef(0);

  /** `shownAfter`: how long after the press the microphone shows it listens. */
  async function start(shownAfter = 0) {
    if (held.current !== null || rec.current) return;
    const pressed = performance.now();
    held.current = pressed;
    const target = where();
    // the cursor in a field: the words go into it
    const into = focusedDraft();
    // the video stands where the owner started speaking: what they say is about that place
    const spot = !into && target && 'card' in target ? take(target.card) : null;
    api.warmVoice();
    let m;
    try {
      // the first press after a page load opens the microphone, which takes a moment
      mic.current ??= navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        return { stream, ctx, analyser };
      });
      m = await mic.current;
    } catch {
      mic.current = null;
      held.current = null;
      onHeard({ confirm: t.voice.noMic });
      return;
    }
    if (held.current !== pressed) {
      // let go before the microphone was open: nothing was recorded, and a recording started now would run on unheld
      if (held.current === null && performance.now() - pressed >= TAP_MS) onHeard({ confirm: t.voice.notReady });
      return;
    }
    void m.ctx.resume();
    const r = { recording: record(m.stream, m.ctx), t0: performance.now(), target, into, spot };
    rec.current = r;
    if (into) beginDictation(into);
    setPhase('listening');
    const wait = shownAfter - (performance.now() - pressed);
    if (wait > 0) showing.current = setTimeout(() => rec.current === r && setShown(true), wait);
    else setShown(true);
    const buf = new Float32Array(m.analyser.fftSize);
    let loudest = 0;
    const meter = () => {
      if (rec.current !== r) return;
      m.analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) {
        s += x * x;
        loudest = Math.max(loudest, Math.abs(x));
      }
      setLevel(Math.min(1, Math.sqrt(s / buf.length) * 6));
      // a suspended context reads flat too; only a running one tells about the microphone
      setFlat(m.ctx.state === 'running' && performance.now() - r.t0 > FLAT_MS && 20 * Math.log10(loudest) < QUIET_DBFS);
      frame.current = requestAnimationFrame(meter);
    };
    meter();
  }

  function stop() {
    held.current = null;
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    cancelAnimationFrame(frame.current);
    clearTimeout(showing.current);
    setShown(false);
    setLevel(0);
    setFlat(false);
    const length = performance.now() - r.t0;
    // a card the command makes goes where the owner was when they stopped speaking, not once it is read
    const at = r.into ? undefined : place();
    setPhase('idle');
    setWriting((n) => n + 1);
    void r.recording.stop().then(async (audio) => {
      if (r.into) return into(r.into, r.target, length < TAP_MS ? null : audio);
      // a tap is not a command
      if (length < TAP_MS) return;
      // what stands in the field goes out with the words and leaves it; nothing heard, it comes back
      const key = field(r.target);
      await uploaded(key);
      const { text, images } = draftOf(key);
      updateDraft(key, (d) => ({ text: '', images: d.images.filter((id) => !images.includes(id)) }));
      // said in reply to the message the field quotes, as typed words are
      const reply = replyOn(key);
      if (reply) setReply(key, null);
      // the field gets them back only when Seismic says it has not taken the command: until
      // 2026-10-16 a connection that broke (the browser cutting it off as the page went to another
      // project, say) counted as that, although Seismic had the command and read on, and the draft
      // kept for the page's next load brought the screenshots back
      const name = recordingName();
      let failed = false;
      const h = await send(r.target, async () => {
        try {
          return await api.voice(audio, r.target, { images, replyTo: reply?.to, text, spot: await sent(r.spot), place: at, sent: name });
        } catch (e) {
          if (!(e instanceof ApiError) && (await arrived(name))) return { confirm: t.voice.answerLost };
          failed = true;
          throw e;
        }
      });
      if (!h.unheard && !failed) return;
      updateDraft(key, (d) => ({ text: [text, d.text].filter((x) => x.trim()).join(' '), images: [...images, ...d.images.filter((id) => !images.includes(id))] }));
      if (reply && !replyOn(key)) setReply(key, reply);
    }).finally(() => setWriting((n) => n - 1));
  }

  /** A dictation: what was heard goes into the field at its cursor; nothing heard leaves the field as it was, and says so. */
  async function into(key: string, target: Where, audio: Blob | null) {
    if (!audio) return updateDraft(key, { dictation: '' });
    updateDraft(key, { dictation: 'writing' });
    let h: Heard;
    try {
      h = await api.voice(audio, target, { listen: true });
    } catch (e) {
      h = { confirm: failText(e, { offline: t.voice.failed }), unheard: true };
    }
    if (!h.unheard && h.text) dictate(key, h.text);
    const note = h.unheard ? h.confirm : '';
    updateDraft(key, { dictation: '', note });
    if (note) setTimeout(() => draftOf(key).note === note && updateDraft(key, { note: '' }), NOTE_MS);
  }

  useEffect(() => () => void mic.current?.then((m) => m.stream.getTracks().forEach((tr) => tr.stop())), []);
  // a restart waits while the owner speaks and until what they said is in the field or answered:
  // until 2026-10-14 it went ahead once they let go, and a long dictation's words were lost
  useEffect(() => {
    holdRestart('voice', phase === 'idle' && !writing ? null : 'voice');
    return () => holdRestart('voice', null);
  }, [phase, writing]);
  return { phase: shown ? phase : 'idle', level, flat, start, stop };
}

/** How long a confirmation's line stays once it offers to go to the cards its command made: time to read it and reach for the button. */
const MADE_SHOWN_MS = 15_000;

/** A command on its way: while it is transcribed or the Koordinator reads it, then its confirmation. */
export interface Told {
  id: number;
  /** What the line says meanwhile: the card in view, and what happens to the words; null for typed words, which the conversation shows at once. */
  pending: string | null;
  /** The card it was said to, named in the confirmation when another card is open by then. */
  card?: { id: string; title: string };
  heard?: Heard;
  /** "Undo" shows while the command still waits. */
  undo?: boolean;
  /** The cards the command made, once it ran: the line offers to go to them. */
  made?: NonNullable<Notice['made']>;
}

/**
 * Commands spoken or typed, each with its own line from sending to its confirmation; one that went
 * out quietly (to the open card's agent) leaves no line. The server reads them one after the other.
 * `show` adds a confirmation that comes without a request: a request a card's agent passed on.
 * `made` gives a confirmation's line the cards its commands made, once they ran, and keeps it a while longer.
 * `inView` says whether the conversation the owner looks at shows the reply already: then it gets
 * no line, unless it has "Undo", which only the line offers.
 */
export function useTold(onHeard: (h: Heard) => void, inView: (h: Heard) => boolean = () => false) {
  const [told, setTold] = useState<Told[]>([]);
  const toldRef = useRef(told);
  toldRef.current = told;
  const next = useRef(0);
  const update = (id: number, fn: (x: Told) => Told | null) => setTold((ts) => ts.flatMap((x) => (x.id === id ? (fn(x) ?? []) : [x])));
  const gone = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** The line goes `ms` from now. */
  function goneIn(id: number, ms: number) {
    clearTimeout(gone.current.get(id));
    gone.current.set(
      id,
      setTimeout(() => {
        gone.current.delete(id);
        update(id, () => null);
      }, ms),
    );
  }

  function settle(id: number, h: Heard) {
    if (h.quiet || (!h.token && inView(h))) return update(id, () => null);
    const undo = !!(h.token && h.undoMs);
    update(id, (x) => ({ ...x, heard: h, undo }));
    if (undo) setTimeout(() => update(id, (x) => ({ ...x, undo: false })), undoShownMs(h.undoMs!));
    goneIn(id, confirmShownMs(h.undoMs));
  }

  function made(token: string, cards: NonNullable<Notice['made']>) {
    const x = toldRef.current.find((y) => y.heard?.token === token);
    if (!x) return;
    update(x.id, (y) => ({ ...y, made: cards }));
    goneIn(x.id, MADE_SHOWN_MS);
  }

  async function tell(pending: string | null, card: Told['card'], request: () => Promise<Heard>): Promise<Heard> {
    const id = ++next.current;
    setTold((ts) => [...ts, { id, pending, ...(card ? { card } : {}) }]);
    let h: Heard;
    try {
      h = await request();
    } catch (e) {
      h = { confirm: failText(e, { offline: t.voice.failed }) };
    }
    settle(id, h);
    onHeard(h);
    return h;
  }

  function show(card: Told['card'], h: Heard) {
    // the server offers a command's undo again when the connection comes back: one line for it
    if (h.token && toldRef.current.some((x) => x.heard?.token === h.token)) return;
    const id = ++next.current;
    setTold((ts) => [...ts, { id, pending: '', ...(card ? { card } : {}) }]);
    settle(id, h);
  }

  async function undo(x: Told) {
    update(x.id, (y) => ({ ...y, undo: false }));
    try {
      const { undone } = await api.undo(x.heard!.token!);
      update(x.id, (y) => (undone ? null : { ...y, heard: { confirm: t.voice.tooLate } }));
    } catch {
      update(x.id, (y) => ({ ...y, heard: { confirm: t.offlineError } }));
    }
  }

  // a restart waits while Seismic reads what the owner said or typed
  const reading = told.some((x) => !x.heard);
  useEffect(() => {
    holdRestart('told', reading ? 'voice' : null);
    return () => holdRestart('told', null);
  }, [reading]);
  /** A line the owner swiped aside: gone, and the confirmation of a command still read does not follow. */
  const drop = (x: Told) => update(x.id, () => null);
  return { told, tell, show, made, undo, drop };
}

/**
 * The commands on their way, above the microphone, oldest first; `open`: the card open now. With
 * `aside` (the phone) the owner swipes a line away, and `onGone` drops it.
 */
export function ToldList({ told, open, onUndo, onGo, aside = false, onGone }: { told: Told[]; open?: string; onUndo: (x: Told) => void; onGo: (card: NonNullable<Told['made']>[number], x: Told) => void; aside?: boolean; onGone?: (x: Told) => void }) {
  return (
    <>
      {told.map((x) => (x.heard || x.pending) && (
        <Aside key={x.id} on={aside} onGone={() => onGone?.(x)} className={`ack told ${x.heard ? 'heard' : 'reading'}${!x.undo && (x.made?.length ?? 0) > 1 ? ' several' : ''}`}>
          <span>
            {x.heard ? (
              <>
                {x.card && x.card.id !== open && <b>{t.voice.about(x.card.title)}</b>}
                {x.heard.confirm}
              </>
            ) : (
              x.pending
            )}
          </span>
          {x.undo && <button onClick={() => onUndo(x)}>{t.undo}</button>}
          {!x.undo &&
            x.made?.filter((c) => c.id !== open).map((c) => (
              <button key={c.id} onClick={() => onGo(c, x)}>
                {x.made!.length > 1 ? t.voice.goTo(c.title) : t.voice.goToCard}
              </button>
            ))}
        </Aside>
      ))}
    </>
  );
}

/**
 * A microphone held by a finger: the touch is the press and nothing else. Held for half a second,
 * Chrome on Android took it for a long press on what stands around the button (the field's frame):
 * it began selecting text, which closed the keyboard and cancelled the touch, so the recording ended
 * at once. A touch whose start is cancelled makes no long press, no selection and no focus change.
 */
export function useHeldByTouch<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React listens to touchstart passively, where cancelling it does nothing
    const hold = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchstart', hold, { passive: false });
    return () => el.removeEventListener('touchstart', hold);
  });
  return ref;
}

/**
 * The microphone at the bottom, and under it where what is said goes: into the field with the
 * cursor, or to `target` with what stands in its field (`field`, the draft of the card or sidebar in
 * view, while that has its field on the page). With no `target` (the phone, where what is in view
 * fills the screen) that line is left out. Without such a field, screenshots for the next
 * recording are picked beside the microphone; dropped on it or pasted (App), they go to the field
 * when there is one. So do the paths of other files dropped on it, which show beside it by their
 * names while they wait there. Those for Seismic stay in view: they go into Seismic's field when it
 * opens, and back beside the microphone when it closes, the paths that still stand in its words too.
 * With a `slot` (the middle of the project's status bar) the line stands there, not under the microphone.
 */
export function PushToTalk({ phase, level, flat, target, field, slot, onDown }: { phase: Phase; level: number; flat: boolean; target: string | null; field: string | null; slot?: HTMLElement | null; onDown: () => void }) {
  const on = useFieldOn(field);
  const key = on ? field! : MIC_DRAFT;
  const shots = useShotInput({ draft: key, off: !takesImages(key) });
  // the screenshots and files for Seismic show where Seismic is spoken to: in its field while that is in view, else beside the microphone
  const obeya = useRef<string | null>(null);
  const { images: waiting, text: paths } = useDraft(MIC_DRAFT);
  useEffect(() => {
    if (toObeya(key) && takesImages(key)) {
      obeya.current = key;
      moveImages(MIC_DRAFT, key);
      if (paths.trim()) {
        insertFiles(key, wordsOf(paths));
        updateDraft(MIC_DRAFT, { text: '' });
      }
    } else if (key === MIC_DRAFT && obeya.current) {
      moveImages(obeya.current, MIC_DRAFT);
      moveFiles(obeya.current, MIC_DRAFT);
      obeya.current = null;
    }
  }, [key, waiting, paths]);
  const { text } = useDraft(key);
  const quote = useReply(key);
  const into = useFocusedDraft();
  const n = shots.images.length;
  const mic = useHeldByTouch<HTMLButtonElement>();
  const parts = [...(text.trim() ? [t.voice.withText] : []), ...(n ? [t.voice.withShots(n)] : []), ...(on && quote ? [t.voice.withQuote] : [])];
  const line = flat ? (
        <div id="target" className="flat">
          {t.voice.flat}
        </div>
      ) : into ? (
        <div id="target" className="into">
          → <b>{t.voice.intoField}</b>
          {t.voice.sendWithEnter && ` · ${t.voice.sendWithEnter}`}
        </div>
      ) : (
        target !== null && (
          <div id="target">
            → <b>{target}</b>
            {parts.length > 0 && <span className="with"> {t.voice.with(parts)}</span>}
          </div>
        )
      );
  return (
    <div id="ptt" className={`${phase}${shots.dropping ? ' dropping' : ''}`} {...shots.drop}>
      <div className="ptt-row">
        <button
          id="mic"
          ref={mic}
          title={t.voice.hold}
          style={{ ['--lvl' as string]: 1 + level * 0.45 }}
          onPointerDown={(e) => {
            // the cursor stays where it is: in a field, what is said is written into it
            e.preventDefault();
            onDown();
          }}
          // held by a finger, it shows no menu
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="ring" />
          <MicIcon />
        </button>
        {key === MIC_DRAFT && (
          <div className="ptt-shots">
            <AttachButton shots={shots} title={t.voice.attach} />
            <ShotStrip shots={shots} />
            <FileChips />
          </div>
        )}
      </div>
      {shots.error && key === MIC_DRAFT && <div className="ptt-error">{shots.error}</div>}
      {slot === undefined && line}
      {slot && createPortal(line, slot)}
    </div>
  );
}

/** The files dropped on the microphone without a field to take their paths, by name, each to remove. */
function FileChips() {
  const words = wordsOf(useDraft(MIC_DRAFT).text);
  if (!words.length) return null;
  return (
    <div className="ptt-files">
      {words.map((w, i) => (
        <span key={i} className="c-file" title={w}>
          <span className="name">{w.replace(/"/g, '').split(/[\\/]/).at(-1)}</span>
          <button className="remove" title={t.shots.remove} onClick={() => updateDraft(MIC_DRAFT, { text: words.filter((_, j) => j !== i).join(' ') })}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function MicIcon({ size }: { size?: number }) {
  return (
    <Mic size={size} strokeWidth={2} aria-hidden="true" />
  );
}
