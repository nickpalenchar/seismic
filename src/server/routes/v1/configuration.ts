import type { ConfigSaved, ConfigView } from '../../../core/types';
import type { Config } from '../../config';
import { HttpRoute, type RouteRequest } from '../httpRoute';
import { NotFound } from '../../notFound';

/**
 * Seismic's configuration: its projects and their repositories, as the Configuration sheet shows
 * them; saved as a whole with the sheet's Save. A save answers with what came of it (applied at
 * once, or a restart to come) and the configuration as it then reads, so the sheet need not read it
 * again; only the projects it changed are applied (`ProjectRuntime.apply`).
 */
export class Configuration extends HttpRoute {
  readonly path = '/api/v1/configuration';

  override GET = (): { configuration: ConfigView } => ({ configuration: this.config().view() });

  override PUT = async (request: RouteRequest): Promise<{ saved: ConfigSaved; configuration: ConfigView }> => {
    const config = this.config();
    const saved = await config.save(await request.json());
    return { saved, configuration: config.view() };
  };

  private config(): Config {
    const config = this.dependencies.configuration;
    if (!config) throw new NotFound('noConfiguration', 'this Seismic runs without a configuration of its own');
    return config;
  }
}
