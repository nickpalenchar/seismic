import type { ModelInfo } from '../../../core/types';
import { BadRequest } from '../../board';
import type { AgentHarness, ConfigurationService } from '../../services/configurationService';
import { HttpRoute, type RouteRequest } from '../httpRoute';

const HARNESSES: readonly AgentHarness[] = ['codex', 'agy'];

/**
 * The agents Seismic runs. `GET /api/v1/agents?models=codex,agy` answers the models of the harnesses
 * named (`{ models: { codex: [...] } }`, an empty list for one that is not connected), so a page
 * reads them once when a project loads.
 */
export class Agents extends HttpRoute {
  readonly path = '/api/v1/agents';

  constructor(private readonly configurationService: ConfigurationService) {
    super();
  }

  override GET = async (request: RouteRequest): Promise<{ models: Partial<Record<AgentHarness, ModelInfo[]>> }> => {
    const asked = new URL(request.url).searchParams.get('models');
    const harnesses = (asked?.split(',').filter(Boolean) ?? []).map((name) => {
      const harness = HARNESSES.find((h) => h === name);
      if (!harness) throw new BadRequest('invalid', `models names no harness with a catalog: ${name}`);
      return harness;
    });
    const lists = await Promise.all(harnesses.map((harness) => this.configurationService.getAgentModels(harness)));
    return { models: Object.fromEntries(harnesses.map((harness, i) => [harness, lists[i]])) };
  };
}
