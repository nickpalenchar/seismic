/**
 * The owner's system-level settings by name (`OWNER_SETTINGS`), each read and saved on its own
 * through the functions of `settings.ts` (the demo settings through `Config`), for the routes
 * under `/api/v1/settings`. What a save sets
 * going besides the file (the usage meters, the pages that follow "Ask for feedback") comes in from
 * the server.
 */
import { type DemoSettingsView, OWNER_SETTINGS, type OwnerSetting, type OwnerSettingViews, type UsageMeterView } from '../core/types';
import { BadRequest } from './board';
import { NotFound } from './routes/notFound';
import {
  agentsView,
  feedbackPromptView,
  languageView,
  motionView,
  notificationsView,
  projectDefaultsView,
  saveAgents,
  saveCodexAutoReview,
  saveFeedbackPrompt,
  saveLanguage,
  saveMotion,
  saveNotifications,
  saveProjectDefaults,
  saveTheme,
  saveUsageMeter,
  themeView,
  usageMeterView,
} from './settings';

type Entry<N extends OwnerSetting> = { view: () => OwnerSettingViews[N]; save: (input: unknown) => OwnerSettingViews[N] };

export interface OwnerSettingsOptions {
  /** Seismic's home, which holds `settings.json`. */
  home: string;
  /** The demo settings (`Config.demo`, `Config.saveDemo`): with the voice's check and the space demos take. */
  demo: { view: () => DemoSettingsView; save: (input: unknown) => DemoSettingsView };
  /** The usage meter turned on or off: the bar's meters fetch the limits from then on, or stop. */
  onUsageMeter?: (view: UsageMeterView) => void;
  /** "Ask for feedback" changed: every project's cards follow at once. */
  onFeedbackPrompt?: () => void;
}

const entries = ({ home, demo }: OwnerSettingsOptions): { [N in OwnerSetting]: Entry<N> } => ({
  language: { view: () => languageView(home), save: (input) => saveLanguage(home, input) },
  theme: { view: () => themeView(home), save: (input) => saveTheme(home, input) },
  motion: { view: () => motionView(home), save: (input) => saveMotion(home, input) },
  notifications: { view: () => notificationsView(home), save: (input) => saveNotifications(home, input) },
  usageMeter: { view: () => usageMeterView(home), save: (input) => saveUsageMeter(home, input) },
  feedbackPrompt: { view: () => feedbackPromptView(home), save: (input) => saveFeedbackPrompt(home, input) },
  projectDefaults: { view: () => projectDefaultsView(home), save: (input) => saveProjectDefaults(home, input) },
  agents: { view: () => agentsView(home), save: (input) => saveAgents(home, input) },
  codexAutoReview: { view: () => agentsView(home), save: (input) => saveCodexAutoReview(home, input) },
  demo,
});

export class OwnerSettings {
  private readonly entries: { [N in OwnerSetting]: Entry<N> };

  constructor(private readonly o: OwnerSettingsOptions) {
    this.entries = entries(o);
  }

  /** The setting `name`, as the URL names it; an unknown one is not found. */
  named(name: string): OwnerSetting {
    const known = OWNER_SETTINGS.find((s) => s === name);
    if (!known) throw new NotFound('settingNotFound', `there is no setting ${name}`);
    return known;
  }

  view<N extends OwnerSetting>(name: N): OwnerSettingViews[N] {
    return this.entries[name].view();
  }

  /** Every setting as it reads. */
  all(): OwnerSettingViews {
    return Object.fromEntries(OWNER_SETTINGS.map((name) => [name, this.view(name)])) as unknown as OwnerSettingViews;
  }

  /** Saves the setting from what the owner sent (`OwnerSettingChanges`), answered with it as it then reads. */
  save<N extends OwnerSetting>(name: N, input: unknown): OwnerSettingViews[N] {
    const saved = this.entries[name].save(input);
    if (name === 'usageMeter') this.o.onUsageMeter?.(saved as UsageMeterView);
    if (name === 'feedbackPrompt') this.o.onFeedbackPrompt?.();
    return saved;
  }

  /**
   * Several settings saved at once, one after the other in the order given. A name that is no
   * setting refuses the whole patch before anything is saved; a value a setting refuses stops the
   * patch there, those before it saved.
   */
  patch(input: unknown): OwnerSettingViews {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new BadRequest('invalid', 'the settings must be an object');
    const given = Object.entries(input as Record<string, unknown>);
    const unknown = given.find(([name]) => !OWNER_SETTINGS.some((s) => s === name));
    if (unknown) throw new BadRequest('invalid', `there is no setting ${unknown[0]}`);
    for (const [name, value] of given) this.save(name as OwnerSetting, value);
    return this.all();
  }
}
