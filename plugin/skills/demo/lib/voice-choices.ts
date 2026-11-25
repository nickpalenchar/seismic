







export const QWEN3_SPEAKERS = ['founder', 'ryan', 'aiden', 'serena', 'vivian', 'uncle_fu', 'dylan', 'eric', 'ono_anna', 'sohee'] as const;
export type Qwen3Speaker = (typeof QWEN3_SPEAKERS)[number];
export const QWEN3_SPEAKER: Qwen3Speaker = 'founder';




export const BUILT_IN_CLONES: Partial<Record<Qwen3Speaker, string>> = { founder: 'demo-voice_founder.wav' };

export const QWEN3_STOCK_SPEAKER: Qwen3Speaker = 'ryan';

/** The speaker a name means, in the model's spelling; none for a name the model does not have. */
export const qwen3Speaker = (name: string): Qwen3Speaker | undefined => QWEN3_SPEAKERS.find((s) => s === name.trim().toLowerCase());


export const DEFAULT_STYLE =
  'Speak in a calm, professional tone, as if presenting a technical demo to an audience of CTOs: clear, confident and matter-of-fact, at a natural pace.';

export const STYLED_VOICES = ['qwen3', 'gemini', 'openai'] as const;

/** Whether a Qwen3 voice clones a clip (a built-in speaker, or the owner's sample for the language), so no style applies. */
export const qwen3IsClone = (s: { voiceName?: string; language: string; references?: Record<string, string | undefined> }): boolean =>
  !!s.references?.[s.language] || !!BUILT_IN_CLONES[(s.voiceName ? qwen3Speaker(s.voiceName) : QWEN3_SPEAKER) as Qwen3Speaker];
