



import { z } from 'zod';
import { LANGUAGE_NAMES } from '../../../../core/locale';
import type { Demo, DemoPage, Item, PageTags } from '../../../../core/types';
import type { PageLanguage } from '../../../demo-page';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { writeDemoPageSystem } from '../../prompts/writeDemoPageSystem';
import { SeismicJob } from '../seismicJob';
import { picked, TAGS_FIELD, tagsSchema } from './pageTagging';

export const plainText = (s: string) => s.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();

export interface WriteDemoPageRun {
  runtime: AgentRuntime;
  
  cwd: string;
  card: Item;
  demo: Demo;
  
  summary: string;
  language: PageLanguage;
  
  lacking: PageTags | null;
}

/** Writes a demo page from the worker's summary; keeps the page in `page`, and falls back on the card's title and the summary's start where it gives none. */
class WriteDemoPageJob extends SeismicJob<DemoPage> {
  readonly name = 'writeDemoPage';
  readonly description = "Writes the page a demo is shared on, from the worker's summary.";
  private page: DemoPage | null = null;
  readonly fallback: DemoPage;

  constructor(private o: Omit<WriteDemoPageRun, 'runtime' | 'cwd'>) {
    super();
    const { card, summary } = o;
    this.fallback = { title: plainText(card.title), text: plainText(summary).split(/(?<=[.!?])\s+/).slice(0, 4).join(' ') || plainText(card.title) };
  }

  protected answer() {
    return this.page ? { value: this.page } : undefined;
  }

  getPrompt() {
    return writeDemoPageSystem(LANGUAGE_NAMES[this.o.language], this.o.lacking);
  }

  async getBrief() {
    const { card, demo, summary } = this.o;
    return [
      `The card: “${plainText(card.title)}”.`,
      card.body.trim() ? `Its task:\n${card.body.trim().slice(0, 3000)}` : '',
      summary ? `What its worker handed over:\n${summary.slice(0, 4000)}` : '',
      demo.kind === 'html'
        ? 'The demo is a page to look at (an HTML artifact: charts, a comparison, an analysis), not a video.'
        : demo.chapters.length
          ? `The demo video's chapters: ${demo.chapters.map(([, t]) => t).join(' · ')}`
          : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { language, lacking } = this.o;
    const { fallback } = this;
    return [
      {
        name: 'page',
        description: `The page's title and text, in ${LANGUAGE_NAMES[language]}${lacking ? `, and its tags: ${TAGS_FIELD}` : ''}.`,
        schema: { title: z.string(), text: z.string(), ...(lacking ? { tags: tagsSchema(lacking) } : {}) },
        run: ({ title, text, tags }) => {
          if (this.page) return 'Already written.';
          this.page = {
            title: String(title).trim().slice(0, 200) || fallback.title,
            text: String(text).trim().slice(0, 2000) || fallback.text,
            ...(lacking ? { tags: picked(tags, lacking) } : {}),
          };
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/** Writes the page of a demo; falls back on the card's title and the summary's start where the session gives none. */
export async function writeDemoPage(o: WriteDemoPageRun): Promise<DemoPage> {
  const { runtime, cwd, ...rest } = o;
  const job = new WriteDemoPageJob(rest);
  const result = await job.run(runtime, { cwd });
  return result.ok ? result.value : job.fallback;
}
