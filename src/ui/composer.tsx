// The field the owner writes in under a conversation, the same on a card and in Seismic's sheet: one
// frame with the text, the screenshot button, the microphone and Send (an arrow, as in chat apps) in
// a footer row, as wide as the conversation above it. The text grows with what is written (or
// with its placeholder, which shows in full), up to a part of the window.
// Screenshot and microphone stand at the left of the footer, Send at the right. A replied-to
// message stands above the text as a quote. With the cursor in the field, speaking dictates into it: hold its microphone, the one at
// the bottom, or Space. Under a card's conversation, `/` at the start of a word opens the menu of the
// skills of the card's agent (`skills.ts`).

import { ArrowUp } from 'lucide-react';
import { type MouseEvent, type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { dropDraft, typeInto, updateDraft, useDraft, useDraftField } from './draft';
import { useFitHeight } from './fitHeight';
import { Quote } from './message';
import { type Reply, replyOn, setReply, useReply } from './reply';
import { Listbox, type ListboxState, useListbox } from './components/listbox';
import { knowsSkills, matching, type Slash, skillWord, slashAt, useSkills, usedSkills } from './skills';
import { AttachButton, ShotStrip, useShotInput } from './shots';
import { t } from './strings';
import { cn } from 'cn';
import { menuClass } from './cardClasses';
import type { Skill } from '../core/types';
import { HoldToTalk, MicIcon, TAP_MS, useHeldByTouch } from './voice';
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputHint, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from './components/ai/prompt-input';
import { Tooltip } from './components/tooltip';

/**
 * How long Space stays down before it is held to speak rather than typed. Typing presses it for
 * well under this, and a key pressed meanwhile (fast typing overlaps keys) makes it a typed space at once.
 */
const HOLD_MS = 250;

/** Whether Enter sends what is written (Shift+Enter breaks the line), as at the desk. */
let enterSends = true;

/**
 * On a phone Enter breaks the line and only Send sends: the keyboard's Enter key is where a line
 * break is typed, and a message sent half written cannot be taken back.
 */
export function enterBreaksLines() {
  enterSends = false;
}

/**
 * What the owner writes to an agent or to Seismic; screenshots are pasted, dropped or picked, unless
 * `noImages`. `draft`: the draft it shows and keeps (`draft.ts`), which the microphone reads; without
 * one the field keeps its own. `label` names what Send does (its tooltip); `action` puts words on the button instead
 * of the arrow, for a button that starts something rather than sends. The message the words reply
 * to stands in the draft (`reply.ts`): quoted above the text, with × to take it out (Escape takes it
 * out too, before it closes the card or the sidebar), and `onSend` gets it. `skills`: the card whose
 * agent reads the words, whose skills `/` offers.
 */
export function Composer({
  placeholder,
  onSend,
  label = t.send,
  action,
  allowEmpty = false,
  noImages = false,
  obeya,
  onText,
  className,
  draft,
  chip,
  skills,
}: {
  draft?: string;
  placeholder: string;
  onSend: (text: string, images?: string[], replyTo?: Reply['to']) => Promise<void> | void;
  label?: string;
  action?: string;
  allowEmpty?: boolean;
  noImages?: boolean;
  /** Seismic reads what is typed: it gets ready while the owner types; a text here says so under the field. */
  obeya?: true | string;
  /** Hears the text as it is typed. */
  onText?: (text: string) => void;
  className?: string;
  /** What else the words go out with, above them beside the quote (a place in the demo video). */
  chip?: ReactNode;
  skills?: string;
}) {
  const own = useId();
  const key = draft ?? `field:${own}`;
  useEffect(() => (draft ? undefined : () => dropDraft(key)), [key]);
  const { text, dictation, note } = useDraft(key);
  const setText = (text: string) => updateDraft(key, { text });
  const [busy, setBusy] = useState(false);
  const shots = useShotInput({ draft: key, off: noImages });
  const images = shots.images;
  const field = useRef<HTMLTextAreaElement>(null);
  useDraftField(key, () => field.current, !noImages);
  // as high as the text; the stylesheet caps it, and beyond that it scrolls
  useFitHeight(field, text);
  const listen = useRef(onText);
  listen.current = onText;
  useEffect(() => listen.current?.(text), [text]);
  const reply = useReply(key);
  const [focused, setFocused] = useState(false);
  const skillList = useSkills(skills, focused);
  // the `/` word at the cursor, the skill marked in the menu, and where Escape closed the menu
  const [slash, setSlash] = useState<Slash | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const atCursor = () => {
    const el = field.current;
    const at = el && el.selectionStart === el.selectionEnd ? slashAt(el.value, el.selectionStart) : null;
    setSlash((s) => (s?.start === at?.start && s?.query === at?.query ? s : at));
    if (!at) setDismissed(null);
  };
  useEffect(atCursor, [text]);
  // the menu: undefined while the skills are asked, else those that fit (none: no menu)
  const menu = skills && focused && slash && dismissed !== slash.start ? (skillList ? matching(skillList, slash.query) : undefined) : [];
  const menuOn = menu === undefined || menu.length > 0;
  // typed into the field, as if by hand: the cursor stays after it, and undo takes it back
  const pickSkill = (name: string) => {
    const el = field.current;
    if (!el || !slash) return;
    const { from, to, word, skip } = skillWord(el.value, slash, el.selectionStart, name);
    el.focus();
    el.setSelectionRange(from, to);
    typeInto(el, word);
    if (skip) el.setSelectionRange(el.selectionStart + skip, el.selectionStart + skip);
    usedSkills();
  };
  const list = useListbox({
    count: menu?.length ?? 0,
    open: menuOn && !!slash,
    wrap: true,
    pickKeys: ['Tab'],
    resetOn: slash?.query,
    onPick: (i) => pickSkill(menu![i]!.name),
    onNavigate: usedSkills,
    // while the menu is open, Escape closes it, not the card
    onEscape: () => slash && setDismissed(slash.start),
  });
  // replying to a message is writing to it: the field takes the focus (not for a reply kept from before)
  const quoted = useRef(reply?.quote.ev);
  useEffect(() => {
    if (reply && reply.quote.ev !== quoted.current) field.current?.focus();
    quoted.current = reply?.quote.ev;
  }, [reply?.quote.ev]);
  const talk = useContext(HoldToTalk);
  const mic = useHeldByTouch<HTMLButtonElement>();
  // Space pressed in the field: typed, or held to speak once it stays down (`held`)
  const space = useRef<number | 'held' | null>(null);
  const spaceDown = useRef(0);
  // While Space is down the field is read-only: the browser on the Mac hides the pointer at every key
  // pressed into a text field, so the key repeating while held made it flicker as the mouse moved.
  const spaceUp = () => {
    space.current = null;
    if (field.current) field.current.readOnly = false;
  };
  const typeSpace = () => {
    const s = space.current;
    if (s === null || s === 'held') return;
    clearTimeout(s);
    spaceUp();
    if (field.current) typeInto(field.current, ' ');
  };
  const ready = (!!text.trim() || images.length > 0 || allowEmpty) && !busy && !shots.uploading && !shots.marking.length;
  const send = async () => {
    if (!ready) return;
    setBusy(true);
    await onSend(text.trim(), images.length ? images : undefined, reply?.to);
    setBusy(false);
    setText('');
    shots.clear();
    // a reply chosen meanwhile stays for the next words
    if (reply && replyOn(key) === reply) setReply(key, null);
  };
  /**
   * The cursor stays in the field when Send is pressed. On a phone the field's blur took the keyboard
   * down and moved the layout before the click landed, so the first tap only closed the keyboard.
   */
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <PromptInput className={className} dropping={shots.dropping} {...shots.drop}>
      <ShotStrip shots={shots} />
      {menuOn && <SkillMenu skills={menu} box={list} />}
      <PromptInputBody dictating={!!dictation}>
        {reply && <Quote q={reply.quote} onClear={() => setReply(key, null)} />}
        {chip}
        <PromptInputTextarea
          ref={field}
          value={text}
          placeholder={placeholder}
          {...(skills ? list.field : {})}
          data-esc={menuOn || undefined}
          onFocus={() => {
            setFocused(true);
            if (obeya) api.warmVoice();
          }}
          onChange={(e) => setText(e.target.value)}
          onSelect={atCursor}
          onPaste={shots.onPaste}
          onBlur={() => {
            setFocused(false);
            if (typeof space.current === 'number') clearTimeout(space.current);
            spaceUp();
          }}
          onKeyUp={(e) => {
            if (e.code !== 'Space') return;
            // a held Space ends the recording wherever it is let go (App); too short for one, it was typed
            if (space.current !== 'held') return typeSpace();
            spaceUp();
            if (e.timeStamp - spaceDown.current < HOLD_MS + TAP_MS && field.current) typeInto(field.current, ' ');
          }}
          onKeyDown={(e) => {
            if (talk && e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.nativeEvent.isComposing) {
              // the key repeating while held types nothing
              if (space.current !== null) return e.preventDefault();
              if (!e.repeat) {
                e.preventDefault();
                e.currentTarget.readOnly = true;
                spaceDown.current = e.timeStamp;
                space.current = window.setTimeout(() => {
                  space.current = 'held';
                  talk();
                }, HOLD_MS);
              }
              return;
            }
            // another key while Space is down: Space was typed, before it
            typeSpace();
            if (list.onKeyDown(e)) return;
            // Enter confirming an IME candidate is the IME's (Safari reports it as keyCode 229)
            if (enterSends && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              send();
            }
          }}
        />
        <PromptInputTools>
          <AttachButton shots={shots} />
          {talk && (
            <PromptInputButton
              ref={mic}
              icon={<MicIcon size={18} />}
              label={t.voice.dictate}
              active={dictation === 'listening'}
              className="rounded-full touch-none"
              onPointerDown={(e) => {
                // the cursor stays in the field, or goes there: what is said is written into it
                e.preventDefault();
                field.current?.focus();
                talk();
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
          <span className="flex-1" />
          {action ? (
            <PromptInputSubmit disabled={!ready} onMouseDown={keepFocus} onClick={send}>
              {action}
            </PromptInputSubmit>
          ) : (
            <Tooltip content={label}>
              <PromptInputSubmit arrow aria-label={label} disabled={!ready} onMouseDown={keepFocus} onClick={send}>
                <ArrowUp size={16} strokeWidth={2.25} aria-hidden="true" />
              </PromptInputSubmit>
            </Tooltip>
          )}
        </PromptInputTools>
      </PromptInputBody>
      {shots.error && <p className="p-error c-error m-0 basis-full">{shots.error}</p>}
      {dictation === 'listening' ? (
        <PromptInputHint tone="working">
          → <b>{t.voice.intoField}</b>
          {t.voice.sendWithEnter && ` · ${t.voice.sendWithEnter}`}
        </PromptInputHint>
      ) : dictation === 'writing' ? (
        <PromptInputHint tone="working">{t.voice.writing}</PromptInputHint>
      ) : note ? (
        <PromptInputHint tone="warn">{note}</PromptInputHint>
      ) : typeof obeya === 'string' ? (
        <PromptInputHint>→ {obeya}</PromptInputHint>
      ) : (
        focused && !!skillList?.length && !knowsSkills() && <PromptInputHint>{t.skills.hint}</PromptInputHint>
      )}
    </PromptInput>
  );
}

/**
 * The skills that fit the `/` word at the cursor, above the field: the active one is picked with
 * Enter or Tab, another with the arrow keys or a click. `skills` undefined: they are still asked.
 */
function SkillMenu({ skills, box }: { skills: Skill[] | undefined; box: ListboxState }) {
  return (
    <div className={cn(menuClass, 'bottom-full mb-1')}>
      {skills ? (
        <Listbox box={box} items={skills} label={t.skills.menu} itemKey={(s) => s.name} className="p-1!">
          {(s) => (
            <>
              <span className="sk-name flex-none max-w-[55%] overflow-hidden text-ellipsis whitespace-nowrap [font-family:var(--mono)] text-[12.5px] text-ink">
                /{s.name}
                {s.hint && <span className="sk-hint text-muted-foreground"> {s.hint}</span>}
              </span>
              <span className="sk-desc flex-1 min-w-0 text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">{s.description}</span>
            </>
          )}
        </Listbox>
      ) : (
        <p className="sk-loading m-0 py-2.5 px-3 text-muted-foreground">{t.skills.loading}</p>
      )}
    </div>
  );
}
