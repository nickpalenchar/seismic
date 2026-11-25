



import { dimensions } from '../../../../core/page-tags';
import type { PageTags } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { chooseDemoPageTagsSystem } from '../../prompts/chooseDemoPageTagsSystem';
import { SeismicJob } from '../seismicJob';
import { picked, TAGS_FIELD, tagsSchema } from './pageTagging';

export interface ChooseDemoPageTagsRun {
  runtime: AgentRuntime;
  
  cwd: string;
  
  demos: { title: string; text: string }[];
  
  lacking: PageTags;
}

/** Chooses a demo page's tags from its title and text; keeps them in `tags`. */
class ChooseDemoPageTagsJob extends SeismicJob<PageTags> {
  readonly name = 'chooseDemoPageTags';
  readonly description = "Chooses a demo page's tags from its title and text.";
  private tags: PageTags | null = null;

  constructor(private o: Pick<ChooseDemoPageTagsRun, 'demos' | 'lacking'>) {
    super();
  }

  protected answer() {
    return this.tags ? { value: this.tags } : undefined;
  }

  getPrompt() {
    return chooseDemoPageTagsSystem;
  }

  async getBrief() {
    const { demos, lacking } = this.o;
    return [
      `The dimensions to choose for, each with its values:\n${dimensions(lacking)
        .map(([d, v]) => `- ${d}: ${v.join(', ')}`)
        .join('\n')}`,
      ...demos.map((d, i) => `${i ? 'A later demo on the page' : 'The page'}: “${d.title}”\n${d.text}`),
    ].join('\n\n');
  }

  getJobTools(): AgentTool[] {
    const { lacking } = this.o;
    return [
      {
        name: 'tags',
        description: `The page's tags: ${TAGS_FIELD}.`,
        schema: { tags: tagsSchema(lacking) },
        run: ({ tags: given }) => {
          if (this.tags) return 'Already chosen.';
          this.tags = picked(given, lacking);
          return this.finish('Recorded. End your turn now.');
        },
      },
    ];
  }
}

/** Chooses the tags a demo page lacks, kept to the dimensions and values asked for; gives none where the session gives none. */
export async function chooseDemoPageTags(o: ChooseDemoPageTagsRun): Promise<PageTags | null> {
  const { runtime, cwd, ...rest } = o;
  const result = await new ChooseDemoPageTagsJob(rest).run(runtime, { cwd });
  return result.ok ? result.value : null;
}
