






import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { issueFooter, withoutFooter } from '../../../../core/wish';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { SeismicJob } from '../seismicJob';
import type { SessionOptions } from '../types';
import { writeWishSystem } from '../../prompts/writeWishSystem';

export interface WishInput {
  
  said: string;
  
  answer?: string;
  
  title?: string;
  body?: string;
}

export interface WishDraft {
  title: string;
  body: string;
  
  raw?: true;
  
  limitedUntil?: string;
}


const WRITE_MS = 90_000;

function brief(w: WishInput, shots: number): string {
  const parts: string[] = [];
  if (w.title?.trim() || w.body?.trim())
    parts.push(`The draft so far, which the user may have edited (keep it, and rework it only where the new words change or add something):\nTitle: ${w.title?.trim() ?? ''}\n\n${withoutFooter(w.body ?? '')}`);
  if (w.answer) parts.push(`The user asked Seismic: “${w.said}”\nSeismic answered that it cannot do this: “${w.answer}”\nThe issue is the user's wish for what they asked; Seismic's answer only shows that Seismic lacks it.`);
  else parts.push(`${parts.length ? 'The user adds' : 'The user wrote'}: “${w.said}”`);
  if (shots) parts.push(`The user attached ${shots === 1 ? 'a screenshot' : `${shots} screenshots`} (below); they paste ${shots === 1 ? 'it' : 'them'} into the issue themselves, so describe only what the text needs.`);
  return parts.join('\n\n');
}

/** Writes the draft of an issue from the owner's wish; keeps it in `draft`, and the owner's own words with when the job can write it where the usage limit stops it. */
class WriteWishJob extends SeismicJob<WishDraft> {
  readonly name = 'writeWish';
  readonly description = "Writes the owner's wish or bug up as a GitHub issue for Seismic's makers.";
  private draft: WishDraft | undefined;

  constructor(
    private o: {
      w: WishInput;
      footer: string;
      imageCount: number;
      
      fallback: () => WishDraft;
    },
  ) {
    super();
  }

  protected answer() {
    return this.draft ? { value: this.draft } : undefined;
  }

  getPrompt() {
    return writeWishSystem;
  }

  async getBrief() {
    return brief(this.o.w, this.o.imageCount);
  }

  
  override getSessionOptions(): SessionOptions {
    return {
      onLimit: (until) => {
        if (until == null) return;
        this.draft = { ...this.o.fallback(), limitedUntil: new Date(until).toISOString() };
        this.cancel();
      },
    };
  }

  getJobTools(): AgentTool[] {
    return [
      {
        name: 'issue',
        description: 'The issue: its title and its body (markdown), in English.',
        schema: { title: z.string(), body: z.string() },
        run: (a) => {
          const title = String(a.title).replace(/\s+/g, ' ').trim().slice(0, 200);
          const body = withoutFooter(String(a.body).trim());
          if (!title || !body) return 'Both title and body, please.';
          this.draft = { title, body: `${body}\n\n${this.o.footer}` };
          this.cancel();
          return 'Recorded. End your turn now.';
        },
      },
    ];
  }
}

/** Writes the issue's title and body from the owner's wish, the body ending with `footer`; the owner's own words stand in it where the job writes nothing in time. */
export async function writeWish(runtime: AgentRuntime, w: WishInput, footer: string, images: string[] = []): Promise<WishDraft> {
  const said = w.said.trim();
  const fallback = (): WishDraft => {
    const own = [withoutFooter(w.body ?? '').trim(), w.answer ? `> ${said}\n\n${w.answer}` : said].filter(Boolean).join('\n\n');
    const title = w.title?.trim() || said.replace(/\s+/g, ' ').slice(0, 70);
    return { title, body: `${own}\n\n${footer}`, raw: true };
  };
  
  const cwd = mkdtempSync(join(tmpdir(), 'seismic-wish-'));
  const job = new WriteWishJob({ w: { ...w, said }, footer, imageCount: images.length, fallback });
  const timer = setTimeout(() => job.cancel(), WRITE_MS);
  try {
    const result = await job.run(runtime, { cwd, images });
    return result.ok ? result.value : fallback();
  } catch {
    return fallback();
  } finally {
    clearTimeout(timer);
    try { rmSync(cwd, { recursive: true, force: true }); } catch {  }
  }
}

/** The system Seismic runs on, as the issue names it. */
export const osName = (platform: string = process.platform) =>
  platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux' : platform;

/** The footer of an issue from this Seismic: in the app, from a checkout (its commit), or the binary on its own. */
export const footerOf = (version: string, commit: string | null, app: boolean) =>
  issueFooter(version, osName(), app ? 'app' : commit ? `checkout ${commit.slice(0, 7)}` : 'binary');
