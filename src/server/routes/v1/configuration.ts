import type { ConfigSaved, ConfigView } from '../../../core/types';
import type { ConfigurationService } from '../../services/configurationService';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/**
 * Seismic's configuration: its projects and their repositories, as the Configuration sheet shows
 * them; saved as a whole with the sheet's Save. A save answers with what came of it (applied at
 * once, or a restart to come) and the configuration as it then reads, so the sheet need not read it
 * again; only the projects it changed are applied (`ProjectRuntime.apply`).
 */
export class Configuration extends HttpRoute {
  readonly path = '/api/v1/configuration';

  constructor(private readonly configurationService: ConfigurationService) {
    super();
  }

  override GET = async (): Promise<{ configuration: ConfigView }> => ({ configuration: (await this.configurationService.getConfig()).view() });

  override PUT = async (request: RouteRequest): Promise<{ saved: ConfigSaved; configuration: ConfigView }> => {
    const config = await this.configurationService.getConfig();
    const saved = await config.save(await request.json());
    return { saved, configuration: config.view() };
  };
}
