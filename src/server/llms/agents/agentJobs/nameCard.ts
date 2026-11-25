




import { z } from 'zod';
import type { Label, Labels } from '../../../../core/labels';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { nameCardSystem } from '../../prompts/nameCardSystem';
import { labelParams, labelsFrom, labelWords } from '../../skills/labelSuggestion';
import { type JobRun, SeismicJob } from '../seismicJob';

export interface NameCardRun {
  runtime: AgentRuntime;
  
  cwd: string;
  
  language: string;
  
  asked: Label[];
  
  task: string;
  
  preferences?: string;
  images?: string[];
  onLimit?: JobRun['onLimit'];
}

/** Names a card from its task and screenshots, and judges the labels left to suggest in the same call; keeps what it gives in `title` and `labels`. */
class NameCardJob extends SeismicJob<{ title: string; labels: Labels }> {
  readonly name = 'nameCard';
  readonly description = "Gives a card the owner left without a title one, from its text and screenshots.";
  override readonly capabilities = { images: 'optional' } as const;
  title: string | null = null;
  labels: Labels = {};

  constructor(private o: Pick<NameCardRun, 'language' | 'asked' | 'task' | 'preferences'>) {
    super();
  }

  protected answer() {
    return this.title === null ? undefined : { value: { title: this.title, labels: this.labels } };
  }

  getPrompt() {
    const system = nameCardSystem(this.o.language, this.o.asked);
    return this.o.preferences ? `${system}\n\n${this.o.preferences}` : system;
  }

  async getBrief() {
    return this.o.task.trim() ? `The task:\n${this.o.task.trim()}` : 'The task is in the screenshots alone (shown below).';
  }

  getJobTools(): AgentTool[] {
    const { language, asked } = this.o;
    return [
      {
        name: 'title',
        description: `The card's title, in ${language} unless an explicit standing preference names another language${asked.length ? `, and its ${labelWords(asked)}` : ''}.`,
        schema: { title: z.string(), ...labelParams(asked) },
        run: (a) => {
          if (this.title !== null) return 'Already named.';
          this.title = String(a.title).replace(/\s+/g, ' ').trim().slice(0, 200);
          this.labels = labelsFrom(a, asked);
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/**
 * Names a card and judges its labels. Where the session fails it settles with a language-neutral
 * placeholder title, rather than a language inferred from the task or the owner's free-form preferences.
 */
export async function nameCard(o: NameCardRun): Promise<{ title: string; labels: Labels }> {
  const job = new NameCardJob(o);
  const result = await job.run(o.runtime, { cwd: o.cwd, ...(o.images ? { images: o.images } : {}), ...(o.onLimit ? { onLimit: o.onLimit } : {}) });
  return result.ok ? { title: result.value.title || '…', labels: result.value.labels } : { title: '…', labels: {} };
}
