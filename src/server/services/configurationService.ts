import type { ModelInfo } from '../../core/types';
import type { Config } from '../config';
import { NotFound } from '../notFound';
import type { OwnerSettings } from '../ownerSettings';

export type AgentHarness = 'codex' | 'agy';

/**
 * What a Seismic with a configuration of its own keeps: the configuration of its projects, the
 * owner's settings and the model catalogs of the agents. One without has none of them, and each is
 * then refused with `NotFound`.
 */
export class ConfigurationService {
  constructor(
    private readonly config: Config | undefined,
    private readonly ownerSettings: OwnerSettings | undefined,
    private readonly modelsOf: ((harness: AgentHarness) => Promise<ModelInfo[]>) | undefined,
  ) {}

  /** The configuration of the projects and their repositories. */
  async getConfig(): Promise<Config> {
    if (!this.config) throw new NotFound('noConfiguration', 'this Seismic runs without a configuration of its own');
    return this.config;
  }

  /** The owner's system-level settings. */
  async getOwnerSettings(): Promise<OwnerSettings> {
    if (!this.ownerSettings) throw new NotFound('noConfiguration', 'this Seismic keeps no settings of its own');
    return this.ownerSettings;
  }

  /** The models of the harness. */
  async getAgentModels(harness: AgentHarness): Promise<ModelInfo[]> {
    if (!this.modelsOf) throw new NotFound('noConfiguration', 'this Seismic keeps no settings of its own');
    return this.modelsOf(harness);
  }
}
