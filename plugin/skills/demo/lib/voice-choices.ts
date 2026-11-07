// What the settings sheet offers for a voice, apart from the voices (`voices.ts`) so the page can
// import it: Qwen3-TTS's speakers and the default speaking style.
//
// The speakers are Seismic's built-in clones (`BUILT_IN_CLONES`) and the CustomVoice model's
// stock speakers, its `talker_config.spk_id`. A name the model lacks would not fail loudly there:
// it speaks in a voice of the model's choosing, or not at all.

/** The speakers, the default first; the model takes them in any case. */
export const QWEN3_SPEAKERS = ['founder', 'ryan', 'aiden', 'serena', 'vivian', 'uncle_fu', 'dylan', 'eric', 'ono_anna', 'sohee'] as const;
export type Qwen3Speaker = (typeof QWEN3_SPEAKERS)[number];
export const QWEN3_SPEAKER: Qwen3Speaker = 'founder';
/**
 * The speakers that are clips Seismic ships (in the demo skill's `voices/`, each with its transcript
 * beside it as `.txt`), cloned with the Base model like a clip of the owner's.
 */
export const BUILT_IN_CLONES: Partial<Record<Qwen3Speaker, string>> = { founder: 'demo-voice_founder.wav' };
/** The stock speaker a request names none for. */
export const QWEN3_STOCK_SPEAKER: Qwen3Speaker = 'ryan';

/** The speaker a name means, in the model's spelling; none for a name the model does not have. */
export const qwen3Speaker = (name: string): Qwen3Speaker | undefined => QWEN3_SPEAKERS.find((s) => s === name.trim().toLowerCase());

/** How a narration sounds unless the settings' `style` says otherwise. */
export const DEFAULT_STYLE =
  'Speak in a calm, professional tone, as if presenting a technical demo to an audience of CTOs: clear, confident and matter-of-fact, at a natural pace.';
/** The voices that take the style as instructions; a Qwen3 clone does not (it continues its clip). */
export const STYLED_VOICES = ['qwen3', 'gemini', 'openai'] as const;

/** Whether a Qwen3 voice clones a clip (a built-in speaker, or the owner's sample for the language), so no style applies. */
export const qwen3IsClone = (s: { voiceName?: string; language: string; references?: Record<string, string | undefined> }): boolean =>
  !!s.references?.[s.language] || !!BUILT_IN_CLONES[(s.voiceName ? qwen3Speaker(s.voiceName) : QWEN3_SPEAKER) as Qwen3Speaker];
