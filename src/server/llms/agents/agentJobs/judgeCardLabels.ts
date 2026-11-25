



import type { Label, Labels } from '../../../../core/labels';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { judgeCardLabelsSystem } from '../../prompts/judgeCardLabelsSystem';
import { labelParams, labelsFrom, labelWords } from '../../skills/labelSuggestion';
import { SeismicJob } from '../seismicJob';

export interface JudgeCardLabelsRun {
  runtime: AgentRuntime;
  
  cwd: string;
  
  asked: Label[];
  title: string;
  body: string;
  images?: string[];
}

/** Judges a card's labels from its title, text and screenshots; keeps what it gives in `labels`. */
class JudgeCardLabelsJob extends SeismicJob<Labels> {
  readonly name = 'judgeCardLabels';
  readonly description = "Judges a card's labels from its title, text and screenshots.";
  override readonly capabilities = { images: 'optional' } as const;
  private labels: Labels | undefined;

  constructor(private o: Pick<JudgeCardLabelsRun, 'asked' | 'title' | 'body' | 'images'>) {
    super();
  }

  protected answer() {
    return this.labels ? { value: this.labels } : undefined;
  }

  getPrompt() {
    return judgeCardLabelsSystem(this.o.asked);
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

/** Judges the labels of a card; gives none where the session gives none or fails. */
export async function judgeCardLabels(o: JudgeCardLabelsRun): Promise<Labels> {
  const job = new JudgeCardLabelsJob(o);
  const result = await job.run(o.runtime, { cwd: o.cwd, ...(o.images ? { images: o.images } : {}) });
  return result.ok ? result.value : {};
}
