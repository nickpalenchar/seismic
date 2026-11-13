// Push-to-talk: hold Space or the microphone, speak, let go. With the cursor in a text field the
// words are written into it, for the owner to add to and send. Otherwise the recording goes to
// Seismic with what stands in the field of the card or sidebar in view (its words first, its
// screenshots, the message it quotes): with an agent on the open card straight to that agent, else
// to the Koordinator, which answers with a confirmation to show. Where no field is in view,
// screenshots picked or pasted beside the microphone, and the paths of other files dropped on it,
// go with the next recording. The microphone is
// free again at once: each spoken command has its own line above it while it is read, which becomes
// its confirmation; a typed one gets its line with the confirmation.

import { Tooltip } from './components/tooltip';
import { Mic } from 'lucide-react';
import { createContext, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Place } from '../core/layout';
import type { Notice } from '../core/types';
import { ApiError, api, type Heard, holdRestart, shownProject, type Where } from './api';
import { appended, beginDictation, dictate, draftIn, draftOf, focusedDraft, insertFiles, MIC_DRAFT, moveFiles, moveImages, takesImages, toObeya, updateDraft, useDraft, useFieldOn, uploaded, useFocusedDraft, wordsOf } from './draft';
import type { ToastStore } from './components/toast';
import { toldLines } from './components/told';
import { type Recording, record } from './recorder';
import { AttachButton, ShotStrip, useShotInput } from './shots';
import { replyOn, setReply, useReply } from './reply';
import { sent, take, type Taken } from './spot';
import { failText, t } from './strings';
import { CloseButton } from './components/button';
import { cn } from 'cn';

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
async function arrived(sent: string, project: string): Promise<boolean> {
  for (let wait = 500; ; wait = Math.min(wait * 2, 8000)) {
    try {
      return await api.voiceArrived(sent, project);
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
    // the project and field it was said on, before the audio is ready: the owner may switch to another project meanwhile
    const project = shownProject();
    const key = r.into ?? field(r.target);
    const back = draftIn(key);
    void r.recording.stop().then(async (audio) => {
      if (r.into) return into(r.into, r.target, length < TAP_MS ? null : audio, back, project);
      // a tap is not a command
      if (length < TAP_MS) return;
      // what stands in the field goes out with the words and leaves it; nothing heard, it comes back.
      // Switched away already, the field there keeps it: the words go alone
      const here = back.here();
      if (here) await uploaded(key);
      const { text, images } = here ? draftOf(key) : { text: '', images: [] as string[] };
      if (here) updateDraft(key, (d) => ({ text: '', images: d.images.filter((id) => !images.includes(id)) }));
      // said in reply to the message the field quotes, as typed words are
      const reply = here ? replyOn(key) : null;
      if (reply) setReply(key, null);
      // the field gets them back only when Seismic says it has not taken the command: until
      // 2026-10-16 a connection that broke (the browser cutting it off as the page went to another
      // project, say) counted as that, although Seismic had the command and read on, and the draft
      // kept for the page's next load brought the screenshots back
      const name = recordingName();
      let failed = false;
      const h = await send(r.target, async () => {
        try {
          return await api.voice(audio, r.target, { images, replyTo: reply?.to, text, spot: await sent(r.spot), place: at, sent: name, project });
        } catch (e) {
          if (!(e instanceof ApiError) && (await arrived(name, project))) return { confirm: t.voice.answerLost };
          failed = true;
          throw e;
        }
      });
      if (!h.unheard && !failed) return;
      // into the draft kept for the project it was said on, where the owner has switched to another meanwhile
      back.update((d) => ({ text: [text, d.text].filter((x) => x.trim()).join(' '), images: [...images, ...d.images.filter((id) => !images.includes(id))] }));
      if (back.here() && reply && !replyOn(key)) setReply(key, reply);
    }).finally(() => setWriting((n) => n - 1));
  }

  /** A dictation: what was heard goes into the field at its cursor; nothing heard leaves the field as it was, and says so. */
  async function into(key: string, target: Where, audio: Blob | null, draft: ReturnType<typeof draftIn>, project: string) {
    if (!audio) return draft.update({ dictation: '' });
    draft.update({ dictation: 'writing' });
    let h: Heard;
    try {
      h = await api.voice(audio, target, { listen: true, project });
    } catch (e) {
      h = { confirm: failText(e, { offline: t.voice.failed }), unheard: true };
    }
    // the owner switched to another project meanwhile: the words go to the end of the draft kept for the one they were said on
    if (!draft.here()) return void (h.text && !h.unheard && draft.update((d) => ({ text: appended(d.text, h.text!) })));
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

/**
 * Commands spoken or typed, each with its own line in the toast stack from sending to its
 * confirmation; one that went out quietly (to the open card's agent) leaves no line. The server
 * reads them one after the other. `show` adds a confirmation that comes without a request: a
 * request a card's agent passed on. `made` gives a confirmation's line the cards its commands made
 * ("Go to card", which `onGo` follows), once they ran, and keeps it a while longer. `inView` says
 * whether the conversation the owner looks at shows the reply already: then it gets no line, unless
 * it has "Undo", which only the line offers.
 */
export function useTold(
  toasts: ToastStore,
  onHeard: (h: Heard) => void,
  inView: (h: Heard) => boolean = () => false,
  onGo: (card: NonNullable<Notice['made']>[number]) => void = () => {},
) {
  // the lines outlive renders: they call what the latest render passed
  const latest = useRef({ onHeard, inView, onGo });
  latest.current = { onHeard, inView, onGo };
  const [reading, setReading] = useState(false);
  const told = useRef<ReturnType<typeof toldLines> | undefined>(undefined);
  told.current ??= toldLines({ toasts, onHeard: (h) => latest.current.onHeard(h), inView: (h) => latest.current.inView(h), onGo: (c) => latest.current.onGo(c), undo: (token) => api.undo(token), onReading: setReading });

  // a restart waits while Seismic reads what the owner said or typed
  useEffect(() => {
    holdRestart('told', reading ? 'voice' : null);
    return () => holdRestart('told', null);
  }, [reading]);
  return told.current;
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
 * With `instead` (the desktop's view switcher) that stands where the microphone and its screenshot
 * button would: Space is the only way to talk, the microphone shows only while it listens, and the
 * target line stays hidden.
 */
export function PushToTalk({ phase, level, flat, target, field, onDown, instead }: { phase: Phase; level: number; flat: boolean; target: string | null; field: string | null; onDown: () => void; instead?: ReactNode; hint?: boolean }) {
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
  // whom the microphone speaks to: in the status bar on its glass, else under the microphone (the
  // phone, where a field's own microphone says it, and turned, the line wraps to four in the strip)
  const lineClass = cn(
    'overflow-hidden rounded-[3px] text-ellipsis whitespace-nowrap text-muted-foreground [&_b]:font-semibold [&_b]:text-ink',
    'max-w-[calc((100vw-var(--left,0px)-var(--side,0px))*.6)] bg-card px-3 py-1 text-[12px] shadow-glass ph-landscape:max-w-[104px] ph-landscape:border-y-4 ph-landscape:border-[var(--card)] ph-landscape:px-2 ph-landscape:py-0 ph-landscape:text-center ph-landscape:whitespace-normal ph-landscape:[-webkit-box-orient:vertical] ph-landscape:[-webkit-line-clamp:4] ph-landscape:[display:-webkit-box]',
  );
  const line = flat ? (
        <div id="target" className={cn(lineClass, 'bg-error font-semibold text-on-ink')}>
          {t.voice.flat}
        </div>
      ) : into ? (
        <div id="target" className={cn(lineClass, 'text-working [&_b]:text-working', 'hidden')}>
          → <b>{t.voice.intoField}</b>
          {t.voice.sendWithEnter && ` · ${t.voice.sendWithEnter}`}
        </div>
      ) : (
        target !== null && (
          <div id="target" className={lineClass}>
            {target !== null && (
              <>
                → <b>{target}</b>
                {parts.length > 0 && <span className="text-warn"> {t.voice.with(parts)}</span>}
              </>
            )}
          </div>
        )
      );
  const micButton = (
        <Tooltip content={t.voice.hold}>
          <button
            id="mic"
            className={micClass}
            ref={mic}
            style={{ ['--lvl' as string]: 1 + level * 0.45 }}
            onPointerDown={(e) => {
              // the cursor stays where it is: in a field, what is said is written into it
              e.preventDefault();
              onDown();
            }}
            // held by a finger, it shows no menu
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className={micRingClass} />
            <MicIcon />
          </button>
        </Tooltip>
  );
  return (
    <div id="ptt" className={cn(phase, shots.dropping && 'dropping', instead && 'switching', pttClass, instead && pttSwitchingClass)} {...shots.drop}>
      {instead && phase === 'listening' && (
        <div id="mic" className={cn(micClass, 'w-[46px] h-[46px] cursor-default [&_svg]:w-5 [&_svg]:h-5')} style={{ ['--lvl' as string]: 1 + level * 0.45 }} aria-hidden="true">
          <span className={micRingClass} />
          <MicIcon />
        </div>
      )}
      {/* the screenshots stand beside it; in a narrow window the project's settings, floating over the page, hide it */}
      <div className="ptt-row relative [@media(max-width:760px)]:[body:has(#project-settings.on)_&]:invisible">
        {instead ?? micButton}
        {key === MIC_DRAFT && (
          <div className={shotsClass}>
            {!instead && <AttachButton shots={shots} title={t.voice.attach} className={attachClass} />}
            <ShotStrip shots={shots} />
            <FileChips />
          </div>
        )}
      </div>
      {shots.error && key === MIC_DRAFT && <div className="text-[12px] text-error bg-card [box-shadow:var(--shadow)] rounded-[2px] py-1 px-2.5 max-w-[calc((100vw_-_var(--left,0px)_-_var(--side,0px))_*_.6)] ph-ptt:ph-landscape:max-w-[104px]">{shots.error}</div>}
      {!instead && line}
    </div>
  );
}

/** The files dropped on the microphone without a field to take their paths, by name, each to remove. */
function FileChips() {
  const words = wordsOf(useDraft(MIC_DRAFT).text);
  if (!words.length) return null;
  return (
    <div className="flex flex-wrap gap-2 max-w-[calc(50vw_-_160px)] ph-ptt:ph-landscape:flex-col-reverse ph-ptt:ph-landscape:flex-nowrap ph-ptt:ph-landscape:max-w-[104px]">
      {words.map((w, i) => (
        <span key={i} className="relative h-[46px] inline-flex items-center py-0 px-3 max-w-[180px] rounded-[2px] border border-solid border-line bg-card [box-shadow:var(--shadow)] text-[12px] text-ink whitespace-nowrap group-[.switching]/ptt:h-[38px] ph-ptt:ph-landscape:max-w-[104px]" title={w}>
          <span className="overflow-hidden text-ellipsis">{w.replace(/"/g, '').split(/[\\/]/).at(-1)}</span>
          <CloseButton label={t.shots.remove} size="small" className="remove absolute -top-[7px] -right-[7px] [--button-bg:var(--card)] [box-shadow:0_0_0_1px_var(--line)]" onClick={() => updateDraft(MIC_DRAFT, { text: words.filter((_, j) => j !== i).join(' ') })} />
        </span>
      ))}
    </div>
  );
}

/**
 * The push-to-talk row: in the middle of the project, left of a sheet docked on the right; on the phone
 * centred under its views, and turned, at the right edge where the thumb holds the phone, in a strip of
 * its own beside the cards. While the keyboard is up the field has its own microphone, so the big one goes.
 */
const pttClass = cn(
  'group/ptt fixed left-[calc(50%_+_(var(--left,0px)_-_var(--side,0px))_/_2)] bottom-[46px] [transform:translateX(-50%)] z-50 flex flex-col items-center gap-2',
  '[transition:left_.45s_cubic-bezier(.3,.9,.3,1)] resizing:[transition:none]',
  'ph-ptt:left-1/2 ph-ptt:bottom-[calc(18px_+_env(safe-area-inset-bottom))] [.ph-kb_.ph-view~&]:hidden',
  'ph-ptt:ph-landscape:left-auto ph-ptt:ph-landscape:right-[env(safe-area-inset-right)] ph-ptt:ph-landscape:w-[112px] ph-ptt:ph-landscape:top-[calc(50%_-_34px)] ph-ptt:ph-landscape:bottom-auto ph-ptt:ph-landscape:[transform:none]',
);

/**
 * With the desktop's view switcher where the microphone was, on medium screens: centred, the switcher would
 * run into the canvas tabs at the bottom right, whose width grows with the canvases and which a right dock
 * pushes inward. It moves to the left and one row up, above the tab row (and above the minimap, which shows
 * from 761px), so no width of either can make them meet. It stays above the full-page views (z 23), so
 * Canvas always leads back, and shrinks to fit the main area left of a dock.
 */
const pttSwitchingClass =
  '[@media(max-width:1100px)]:left-[calc(var(--left,0px)_+_14px)] [@media(max-width:760px)]:bottom-[98px] [@media(min-width:761px)_and_(max-width:1100px)]:bottom-[188px] [@media(max-width:1100px)]:[transform:none] [@media(max-width:1100px)]:items-start [@media(max-width:1100px)]:z-24 [@media(max-width:1100px)]:max-w-[calc(100vw_-_var(--left,0px)_-_var(--side,0px)_-_28px)]';

/** The microphone: a round glass button, filled with the waiting colour while it listens; outlined while files are dragged over the row. */
const micClass = cn(
  'w-[58px] h-[58px] rounded-[50%] border border-solid border-glass-edge bg-glass backdrop-blur-glass [box-shadow:var(--lift)] cursor-pointer grid place-items-center relative [&_svg]:w-6 [&_svg]:h-6',
  // held by a finger: no long-press menu, no text selected
  '[-webkit-touch-callout:none] select-none touch-none',
  'group-[.listening]/ptt:bg-waiting group-[.listening]/ptt:text-on-ink',
  'group-[.dropping]/ptt:outline-2 group-[.dropping]/ptt:outline-dashed group-[.dropping]/ptt:outline-working group-[.dropping]/ptt:outline-offset-[5px]',
  'ph-ptt:w-[68px] ph-ptt:h-[68px]',
);

/** The ring around the microphone that swells with the voice's level (`--lvl`) while it listens. */
const micRingClass =
  'absolute -inset-1.5 rounded-[50%] border-3 border-solid border-waiting opacity-0 [transform:scale(var(--lvl,1))] [transition:transform_.08s_linear,opacity_.2s] group-[.listening]/ptt:opacity-80';

/**
 * Screenshots for the next recording: a small button and thumbnails to the right of the microphone, which
 * stays centred (smaller beside the view switcher); turned, above the microphone instead of beside it.
 */
const shotsClass = cn(
  'absolute left-[calc(100%_+_12px)] top-1/2 [transform:translateY(-50%)] flex items-center gap-2.5',
  '[&_.c-shots]:flex-nowrap [&_.c-shots]:items-center [&_.c-shots]:basis-auto [&_.c-paste-hint]:flex-[0_0_auto] [&_.c-paste-hint]:w-[320px]',
  '[&_.c-shot]:h-[46px] [&_.c-shot]:min-w-[46px] [&_.c-shot]:[box-shadow:var(--shadow)] [&_.c-shot_img]:max-w-[82px] group-[.switching]/ptt:[&_.c-shot]:h-[38px] group-[.switching]/ptt:[&_.c-shot]:min-w-[38px]',
  'ph-ptt:ph-landscape:left-1/2 ph-ptt:ph-landscape:top-auto ph-ptt:ph-landscape:bottom-[calc(100%_+_12px)] ph-ptt:ph-landscape:[transform:translateX(-50%)] ph-ptt:ph-landscape:flex-col-reverse ph-ptt:ph-landscape:[&_.c-shots]:flex-col-reverse',
);

/** The screenshot button beside the microphone: a small glass tile. */
const attachClass =
  'static size-[34px] rounded-[12px] grid place-items-center p-0 bg-glass hover:not-disabled:bg-glass border border-solid border-glass-edge [box-shadow:var(--shadow)] backdrop-blur-glass hover:text-ink hover:[box-shadow:var(--lift)]';

export function MicIcon({ size }: { size?: number }) {
  return (
    <Mic size={size} strokeWidth={2} aria-hidden="true" />
  );
}
