import type { OwnerSettingViews } from '../../../core/types';
import { HttpRoute, type RouteRequest } from '../httpRoute';

/**
 * The owner's system-level settings together: all of them as they read, and several saved at once
 * (`{ theme: { theme: 'dark' }, notifications: { on: true } }`, each as its own URL takes it),
 * answered with all of them.
 */
export class Settings extends HttpRoute {
  readonly path = '/api/v1/settings';

  override GET = (): { settings: OwnerSettingViews } => ({ settings: this.settings.all() });

  override PATCH = async (request: RouteRequest): Promise<{ settings: OwnerSettingViews }> => {
    const settings = this.settings;
    return { settings: settings.patch(await this.bodyOf(request)) };
  };
}
