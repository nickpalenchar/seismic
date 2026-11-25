





import type { ModelInfo } from '../../../core/types';
import { agyModels } from './agy';
import { codexModels } from './codex';

export class ModelCatalog {
  private last?: { models: ModelInfo[]; at: number };
  private pending: Promise<ModelInfo[]> | null = null;

  constructor(private list: () => Promise<ModelInfo[]>, private maxAge = 5 * 60_000, private now = Date.now) {}

  /** The last list, or the first one once it is listed; a failed listing fails only while none is known. */
  async models(): Promise<ModelInfo[]> {
    if (!this.last) return this.refresh();
    if (this.now() - this.last.at > this.maxAge) this.refresh().catch(() => {});
    return this.last.models;
  }

  /** Lists again, or joins the listing under way. */
  refresh(): Promise<ModelInfo[]> {
    if (!this.pending) {
      const started = this.now();
      this.pending = this.list()
        .then((models) => { this.last = { models, at: started }; return models; })
        .finally(() => { this.pending = null; });
    }
    return this.pending;
  }
}

export const catalogs = { codex: new ModelCatalog(() => codexModels()), agy: new ModelCatalog(() => agyModels()) };
