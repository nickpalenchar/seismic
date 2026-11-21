/**
 * Judges the labels of a card that has its title: a short read-only session reads the card (its
 * screenshots as a help) and gives the labels left to suggest.
 */
import type { Label, Labels } from '../../../../core/labels';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { labelsSystem } from '../../prompts/labelsSystem';
import { labelParams, labelsFrom, labelWords } from '../../skills/labelSuggestion';
import { SeismicJob } from '../seismicJob';

export interface LabelsRun {
  runtime: AgentRuntime;
  /** Where the session reads. */
  cwd: string;
  /** The labels to judge. */
  asked: Label[];
  title: string;
  body: string;
  images?: string[];
}

/** The labels session: what it gives is kept in `labels`. */
class CardLabelsJob extends SeismicJob<Labels> {
  readonly name = 'cardLabels';
  readonly description = "Judges a card's labels from its title, text and screenshots.";
  override readonly capabilities = { images: 'optional' } as const;
  private labels: Labels | undefined;

  constructor(private o: Pick<LabelsRun, 'asked' | 'title' | 'body' | 'images'>) {
    super();
  }

  protected answer() {
    return this.labels ? { value: this.labels } : undefined;
  }

  getPrompt() {
    return labelsSystem(this.o.asked);
  }

  async getBrief() {
    const { title, body, images } = this.o;
    return [`The card's title: ${title.trim()}`, body.trim() ? `Its text:\n${body.trim()}` : '', images?.length ? 'Its screenshots are below.' : ''].filter(Boolean).join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { asked } = this.o;
    return [
      {
        name: 'labels',
        description: `The card's ${labelWords(asked)}.`,
        schema: labelParams(asked),
        run: (a) => {
          this.labels = labelsFrom(a, asked);
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/** The labels the session gave; none where it gave none or failed. */
export async function judgeLabels(o: LabelsRun): Promise<Labels> {
  const job = new CardLabelsJob(o);
  const result = await job.run(o.runtime, { cwd: o.cwd, ...(o.images ? { images: o.images } : {}) });
  return result.ok ? result.value : {};
}
