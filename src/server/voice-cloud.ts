// Voice in through a cloud service, for a machine whose own recognition is too slow: one client for
// the OpenAI-style `/audio/transcriptions` endpoint (Groq, Mistral, OpenAI or any compatible
// server), with its base URL, model and API key in `voice.json` in Seismic's home, never in a
// repository. What Seismic measured of the recognition on this machine is kept there too.

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { CLOUD_PRESETS, CLOUD_VOICES, type CloudPreset, type CloudVoiceView, type VoiceSpeed } from '../core/types';
import { BadRequest } from './board';
import type { Transcript } from './voice';

export const VOICE_FILE = 'voice.json';

export interface CloudVoice {
  preset: CloudPreset;
  baseUrl: string;
  model: string;
  key: string;
}

/** What `voice.json` holds. */
interface VoiceFile {
  /** Recordings go to the cloud service rather than to the recognition on this machine. */
  use?: 'cloud' | 'local';
  cloud?: CloudVoice & { tested?: CloudVoiceView['tested'] };
  /** The last measurement of the recognition on this machine. */
  speed?: VoiceSpeed;
}

export function readVoiceFile(home: string): VoiceFile {
  try {
    return JSON.parse(readFileSync(join(home, VOICE_FILE), 'utf8')) as VoiceFile;
  } catch {
    return {};
  }
}

/** Writes the file, readable by the owner alone: it holds an API key. */
export function writeVoiceFile(home: string, f: VoiceFile) {
  const file = join(home, VOICE_FILE);
  writeFileSync(file, `${JSON.stringify(f, null, 2)}\n`, { mode: 0o600 });
  // a file written before with other rights keeps them through writeFileSync
  if (process.platform !== 'win32' && existsSync(file)) chmodSync(file, 0o600);
}

/** The cloud service in use, if recordings go to one. */
export function cloudInUse(home: string): CloudVoice | null {
  const f = readVoiceFile(home);
  return f.use === 'cloud' && f.cloud?.key ? f.cloud : null;
}

/** The service as the page sees it: without its key. */
export function cloudView(home: string): CloudVoiceView | undefined {
  const f = readVoiceFile(home);
  if (!f.cloud) return undefined;
  const { preset, baseUrl, model, key, tested } = f.cloud;
  return { preset, baseUrl, model, key: !!key, used: f.use === 'cloud', ...(tested ? { tested } : {}) };
}

/** The service a request names, its key the stored one when it brings none for the same endpoint. */
export function cloudFrom(input: unknown, stored?: CloudVoice): CloudVoice {
  const o = (input ?? {}) as Partial<Record<keyof CloudVoice, unknown>>;
  const preset = CLOUD_PRESETS.find((p) => p === o.preset);
  if (!preset) throw new BadRequest('invalid', `preset must be one of ${CLOUD_PRESETS.join(', ')}`);
  const fixed = CLOUD_VOICES[preset];
  // Groq's and Mistral's endpoints are theirs; "OpenAI" stands for any compatible one
  const own = (v: unknown, fallback: string) => (preset === 'openai' && typeof v === 'string' && v.trim() ? v.trim() : fallback);
  const baseUrl = own(o.baseUrl, fixed.baseUrl).replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/.test(baseUrl)) throw new BadRequest('invalid', 'the base URL must start with http:// or https://');
  const typed = typeof o.key === 'string' ? o.key.trim() : '';
  // the stored key goes only where it went before: to another endpoint only once typed for it
  const key = typed || (stored?.preset === preset && stored.baseUrl === baseUrl ? stored.key : '');
  if (!key) throw new BadRequest('invalid', 'an API key');
  return { preset, baseUrl, model: own(o.model, fixed.model), key };
}

/** A request the service failed or refused, with what it said. */
export class CloudError extends Error {
  constructor(
    readonly service: string,
    message: string,
  ) {
    super(message);
  }
}

/** The service's name for the owner: the preset's, or the host of an endpoint of their own. */
export function serviceName(c: Pick<CloudVoice, 'preset' | 'baseUrl'>) {
  const fixed = CLOUD_VOICES[c.preset];
  if (c.baseUrl === fixed.baseUrl) return fixed.name;
  try {
    return new URL(c.baseUrl).host;
  } catch {
    return c.baseUrl;
  }
}

const TYPES: Record<string, string> = { '.webm': 'audio/webm', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

/** How long a request may take before it counts as failed: the owner waits under the mic meanwhile. */
export const CLOUD_TIMEOUT_MS = 30_000;

/**
 * Sends a recording to the service. Groq and OpenAI take the card titles as a prompt (Whisper's
 * limit is 224 tokens, so the first 400 characters go); the language is the service's to hear.
 */
export async function transcribeInCloud(c: CloudVoice, audioPath: string, vocabulary: string, fetcher: typeof fetch = fetch): Promise<Transcript> {
  const name = serviceName(c);
  const form = new FormData();
  const file = Bun.file(audioPath);
  form.set('file', new Blob([await file.arrayBuffer()], { type: TYPES[extname(audioPath)] ?? file.type }), basename(audioPath));
  form.set('model', c.model);
  const steered = CLOUD_VOICES[c.preset].prompt && !!vocabulary;
  if (steered) form.set('prompt', vocabulary.slice(0, 400));
  let res: Response;
  try {
    res = await fetcher(`${c.baseUrl}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${c.key}` }, body: form, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new CloudError(name, timeout ? `no answer within ${CLOUD_TIMEOUT_MS / 1000} s` : (e as Error).message);
  }
  const body = await res.text();
  let json: { text?: unknown; error?: unknown; message?: unknown; detail?: unknown } = {};
  try {
    json = JSON.parse(body);
  } catch {}
  if (!res.ok) {
    const err = json.error as { message?: unknown } | string | undefined;
    const said = typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : typeof json.message === 'string' ? json.message : typeof json.detail === 'string' ? json.detail : body.slice(0, 200);
    throw new CloudError(name, `${res.status}${said ? `: ${said}` : ''}`);
  }
  if (typeof json.text !== 'string') throw new CloudError(name, 'the answer held no text');
  return { text: json.text.trim(), doubtful: false, ...(steered ? {} : { unprompted: true as const }) };
}
