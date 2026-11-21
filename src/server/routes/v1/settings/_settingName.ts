import type { OwnerSettingViews } from '../../../../core/types';
import { HttpRoute, type RouteRequest } from '../../httpRoute';

/** One of the owner's system-level settings (`OWNER_SETTINGS`, as `settings.json` names it): read, and saved on its own. */
export class Setting extends HttpRoute {
  readonly path = '/api/v1/settings/:settingName';

  override GET = (request: RouteRequest): { setting: OwnerSettingViews[keyof OwnerSettingViews] } => {
    const settings = this.settings;
    return { setting: settings.view(settings.named(request.params.settingName!)) };
  };

  override PUT = async (request: RouteRequest): Promise<{ setting: OwnerSettingViews[keyof OwnerSettingViews] }> => {
    const settings = this.settings;
    const name = settings.named(request.params.settingName!);
    return { setting: settings.save(name, await this.bodyOf(request)) };
  };
}
