import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STYLE } from './voice-choices.ts';
import { builtInClip, installState, onMlx, qwen3Serve, voiceProblem, voiceSpec } from './voices.ts';

let home: string;
let hub: string;
const hubBefore = process.env.HF_HUB_CACHE;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'obeya-voices-'));
  hub = join(home, 'hub');
  process.env.HF_HUB_CACHE = hub;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (hubBefore === undefined) delete process.env.HF_HUB_CACHE;
  else process.env.HF_HUB_CACHE = hubBefore;
});

describe('voices', () => {
  test("a Qwen3 speaker the model lacks is named as such, not as a voice to install", () => {
    expect(voiceProblem({ language: 'en', voice: 'qwen3', voiceName: 'Kai' })).toContain('no speaker "Kai"');
    expect(voiceProblem({ language: 'en', voice: 'qwen3', voiceName: 'Ono_Anna' })).toBeUndefined();
    // a clone needs no speaker, and Piper's voices are files to download
    expect(voiceProblem({ language: 'en', voice: 'qwen3', voiceName: 'Kai', references: { en: '/me.wav' } })).toBeUndefined();
    expect(voiceProblem({ language: 'en', voice: 'piper', voiceName: 'Kai' })).toBeUndefined();
    expect(voiceSpec({ language: 'en', voice: 'qwen3', voiceName: 'Ryan' }, home)).toMatchObject({ host: { speaker: 'ryan' } });
  });

  test('Piper speaks with the voice of the language, from its own environment in the home', () => {
    const spec = voiceSpec({ language: 'en', voice: 'piper' }, home);
    expect(spec).toMatchObject({ kind: 'command', tag: 'piper|en_US-ryan-high', heavy: false });
    expect(spec.kind === 'command' && spec.argv).toContain(join(home, 'voices', 'piper', 'en_US-ryan-high.onnx'));
    expect(voiceSpec({ language: 'en', voice: 'piper', voiceName: 'en_GB-alan-medium' }, home)).toMatchObject({ tag: 'piper|en_GB-alan-medium' });
  });

  test('Piper is installed once its environment and its voice are there', () => {
    const s = { language: 'en', voice: 'piper' } as const;
    expect(installState(s, home)).toEqual({ installed: false, missing: ['Piper', 'Piper voice en_US-ryan-high'], mb: 265 });
    mkdirSync(join(home, 'voices', 'piper', 'env'), { recursive: true });
    writeFileSync(join(home, 'voices', 'piper', 'env', '.obeya-installed'), 'piper-tts\n');
    writeFileSync(join(home, 'voices', 'piper', 'en_US-ryan-high.onnx'), '');
    expect(installState(s, home).missing).toEqual(['Piper voice en_US-ryan-high']);
    writeFileSync(join(home, 'voices', 'piper', 'en_US-ryan-high.onnx.json'), '{}');
    expect(installState(s, home)).toEqual({ installed: true, missing: [], mb: 0 });
  });

  test('Qwen3-TTS speaks with a stock speaker, or clones a clip; a model downloaded before counts as installed', () => {
    const stock = voiceSpec({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home);
    expect(stock).toMatchObject({ kind: 'command', heavy: true });
    expect(stock.kind === 'command' && stock.argv).toEqual(expect.arrayContaining(['--speaker', 'ryan', '--language', 'en']));
    const clone = voiceSpec({ language: 'en', voice: 'qwen3', references: { en: '/x/me.wav' } }, home);
    expect(clone.kind === 'command' && clone.argv).toEqual(expect.arrayContaining(['--reference', '/x/me.wav']));
    const repo = onMlx() ? 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16' : 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';
    expect(stock.kind === 'command' && stock.argv).toContain(repo);
    expect(installState({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home).missing).toHaveLength(2);
    const snapshot = join(hub, `models--${repo.replace('/', '--')}`, 'snapshots', 'abc');
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, 'config.json'), '{}');
    expect(installState({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home).missing).toHaveLength(2);
    writeFileSync(join(snapshot, 'model.safetensors'), '');
    expect(installState({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home).missing).toEqual([onMlx() ? 'Qwen3-TTS (MLX)' : 'Qwen3-TTS (PyTorch)']);
    // an environment from before Qwen3 heard its sentences back lacks the speech recognition
    const tts = onMlx() ? 'mlx-audio' : 'qwen-tts';
    mkdirSync(join(home, 'voices', 'qwen3', 'env'), { recursive: true });
    writeFileSync(join(home, 'voices', 'qwen3', 'env', '.obeya-installed'), `${tts}\n`);
    expect(installState({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home).installed).toBe(false);
    writeFileSync(join(home, 'voices', 'qwen3', 'env', '.obeya-installed'), `${tts} onnx-asr[cpu,hub]\n`);
    expect(installState({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home)).toEqual({ installed: true, missing: [], mb: 0 });
  });

  test('the default speaker, Founder, is a clone of the clip Seismic ships, in every language without a clip of its own', () => {
    const clip = builtInClip('demo-voice_founder.wav');
    expect(existsSync(clip)).toBe(true);
    expect(readFileSync(clip.replace(/\.wav$/, '.txt'), 'utf8').trim()).not.toBe('');
    for (const s of [{ language: 'en', voice: 'qwen3' }, { language: 'en', voice: 'qwen3', voiceName: 'Founder', style: 'Cheerful.' }] as const) {
      const spec = voiceSpec(s, home);
      // Seismic holds it by name and clones its own copy of the clip, wherever the render runs
      expect(spec).toMatchObject({ kind: 'command', host: { speaker: 'founder' } });
      if (spec.kind !== 'command' || !spec.host) throw new Error('Founder is not held');
      expect(spec.host).toEqual({ speaker: 'founder' });
      expect(qwen3Serve(spec.host, s.language, home)).toEqual(spec.serve!);
      expect(spec.kind === 'command' && spec.argv).toEqual(expect.arrayContaining(['--reference', clip]));
      expect(spec.kind === 'command' && spec.argv?.some((a) => a.startsWith('--speaker') || a.startsWith('--instruct'))).toBe(false);
      expect(spec.kind === 'command' && spec.argv).toContain(onMlx() ? 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16' : 'Qwen/Qwen3-TTS-12Hz-1.7B-Base');
      expect(voiceProblem(s)).toBeUndefined();
    }
    // the owner's own clip for the language comes first
    expect(voiceSpec({ language: 'en', voice: 'qwen3', references: { en: '/x/me.wav' } }, home)).toMatchObject({ host: { reference: '/x/me.wav' } });
  });

  test('Qwen3-TTS stays loaded for a render; Piper, say and the own command run once per clip', () => {
    for (const s of [{ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, { language: 'en', voice: 'qwen3', references: { en: '/x/me.wav' } }] as const) {
      const spec = voiceSpec(s, home);
      if (spec.kind !== 'command' || !spec.argv || !spec.serve) throw new Error('Qwen3-TTS has no serve command');
      // the same voice, model and language as one clip, just without a WAV of its own
      expect(spec.serve).toEqual([...spec.argv.slice(0, -2), '--serve']);
      expect(spec.argv.slice(-2)).toEqual(['--out', '{out}']);
      // what Seismic runs to hold it across renders is the same command
      expect(spec.host).toEqual('references' in s ? { reference: '/x/me.wav' } : { speaker: 'ryan', style: DEFAULT_STYLE });
      expect(qwen3Serve(spec.host!, s.language, home)).toEqual(spec.serve);
    }
    for (const voice of ['piper', 'say', 'command'] as const) {
      expect(voiceSpec({ language: 'en', voice, command: 'speak' }, home)).not.toHaveProperty('serve');
    }
  });

  test('a stock speaker and the services that take instructions speak in the style of the settings, a clone does not', () => {
    const stock = voiceSpec({ language: 'en', voice: 'qwen3', voiceName: 'ryan' }, home);
    // one argument with its value, so a style that starts with a dash stays a value
    expect(stock.kind === 'command' && stock.argv).toContain(`--instruct=${DEFAULT_STYLE}`);
    const own = voiceSpec({ language: 'en', voice: 'qwen3', voiceName: 'ryan', style: 'Cheerful.' }, home);
    expect(own.kind === 'command' && own.argv).toContain('--instruct=Cheerful.');
    // another style is another voice for the clip cache
    expect(own.kind === 'command' && stock.kind === 'command' && own.tag !== stock.tag).toBe(true);
    const clone = voiceSpec({ language: 'en', voice: 'qwen3', style: 'Cheerful.', references: { en: '/x/me.wav' } }, home);
    expect(clone.kind === 'command' && clone.argv?.some((a) => a.startsWith('--instruct'))).toBe(false);
    expect(voiceSpec({ language: 'en', voice: 'openai', style: 'Cheerful.' }, home)).toMatchObject({ style: 'Cheerful.' });
    expect(voiceSpec({ language: 'en', voice: 'gemini' }, home)).toMatchObject({ style: DEFAULT_STYLE });
  });

  test('the own command runs through the shell and takes the machine like a clone; services need nothing installed', () => {
    expect(voiceSpec({ language: 'en', voice: 'command', command: 'speak --fast' }, home)).toEqual({
      kind: 'command',
      shell: 'speak --fast',
      tag: 'command|speak --fast',
      heavy: true,
    });
    expect(voiceSpec({ language: 'en', voice: 'say' }, home)).toMatchObject({ tag: 'say|Samantha', heavy: false });
    expect(voiceSpec({ language: 'en', voice: 'elevenlabs', voiceName: 'abc', keyFile: '~/k' }, home)).toMatchObject({
      kind: 'http',
      service: 'elevenlabs',
      voiceName: 'abc',
      keyFile: expect.not.stringContaining('~'),
    });
    expect(voiceSpec({ language: 'en', voice: 'http', url: 'http://x' }, home)).toMatchObject({ kind: 'http', service: 'http', url: 'http://x' });
    for (const voice of ['say', 'command', 'http', 'gemini', 'openai', 'elevenlabs', 'azure'] as const) {
      expect(installState({ language: 'en', voice }, home).installed).toBe(true);
    }
  });
});
