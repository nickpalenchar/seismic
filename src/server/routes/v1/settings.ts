import type { OwnerSettingViews } from '../../../core/types';
import type { ConfigurationService } from '../../services/configurationService';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/**
 * The owner's system-level settings together: all of them as they read, and several saved at once
 * (`{ theme: { theme: 'dark' }, notifications: { on: true } }`, each as its own URL takes it),
 * answered with all of them.
 */
export class Settings extends HttpRoute {
  readonly path = '/api/v1/settings';

  constructor(private readonly configurationService: ConfigurationService) {
    super();
  }

  override GET = async (): Promise<{ settings: OwnerSettingViews }> => ({ settings: (await this.configurationService.getOwnerSettings()).all() });

  override PATCH = async (request: RouteRequest): Promise<{ settings: OwnerSettingViews }> => {
    const settings = await this.configurationService.getOwnerSettings();
    return { settings: settings.patch(await this.bodyOf(request)) };
  };
}
