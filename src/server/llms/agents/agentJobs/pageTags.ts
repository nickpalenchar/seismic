/**
 * The tags a demo page lacks for the site's vocabulary: a short session chooses them from the title
 * and text of the page's demos, each dimension with the values that fit.
 */
import { dimensions } from '../../../../core/page-tags';
import type { PageTags } from '../../../../core/types';
import type { AgentRuntime, AgentTool } from '../../../runtime';
import { pageTagsSystem } from '../../prompts/pageTagsSystem';
import { SeismicJob } from '../seismicJob';
import { picked, TAGS_FIELD, tagsSchema } from './pageTagging';

export interface PageTagsRun {
  runtime: AgentRuntime;
  /** Where the session reads: the card's repository. */
  cwd: string;
  /** The title and text of the page's demos, the page's first. */
  demos: { title: string; text: string }[];
  /** The dimensions to choose for, each with its values. */
  lacking: PageTags;
}

/** The tagging session: what it chose is kept in `tags`. */
class PageTagsJob extends SeismicJob<PageTags> {
  readonly name = 'pageTags';
  readonly description = "Chooses a demo page's tags from its title and text.";
  private tags: PageTags | null = null;

  constructor(private o: Pick<PageTagsRun, 'demos' | 'lacking'>) {
    super();
  }

  protected answer() {
    return this.tags ? { value: this.tags } : undefined;
  }

  getPrompt() {
    return pageTagsSystem;
  }

  getBrief() {
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

/** The tags the session chose, kept to the dimensions and values asked for; none where it gave none. */
export async function chooseTags(o: PageTagsRun): Promise<PageTags | null> {
  const { runtime, cwd, ...rest } = o;
  const result = await new PageTagsJob(rest).run(runtime, { cwd });
  return result.ok ? result.value : null;
}
