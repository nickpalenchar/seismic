/**
 * The owner's system-level settings by name (`OWNER_SETTINGS`), each read and saved on its own
 * through the functions of `settings.ts`, for the routes under `/api/v1/settings`. What a save sets
 * going besides the file (the usage meters, the pages that follow "Ask for feedback") comes in from
 * the server.
 */
import { OWNER_SETTINGS, type OwnerSetting, type OwnerSettingViews, type UsageMeterView } from '../core/types';
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

type Entry<N extends OwnerSetting> = { view: (home: string) => OwnerSettingViews[N]; save: (home: string, input: unknown) => OwnerSettingViews[N] };

const ENTRIES: { [N in OwnerSetting]: Entry<N> } = {
  language: { view: (home) => languageView(home), save: saveLanguage },
  theme: { view: themeView, save: saveTheme },
  motion: { view: motionView, save: saveMotion },
  notifications: { view: notificationsView, save: saveNotifications },
  usageMeter: { view: usageMeterView, save: saveUsageMeter },
  feedbackPrompt: { view: feedbackPromptView, save: saveFeedbackPrompt },
  projectDefaults: { view: projectDefaultsView, save: saveProjectDefaults },
  agents: { view: agentsView, save: saveAgents },
  codexAutoReview: { view: agentsView, save: saveCodexAutoReview },
};

export interface OwnerSettingsOptions {
  /** Seismic's home, which holds `settings.json`. */
  home: string;
  /** The usage meter turned on or off: the bar's meters fetch the limits from then on, or stop. */
  onUsageMeter?: (view: UsageMeterView) => void;
  /** "Ask for feedback" changed: every project's cards follow at once. */
  onFeedbackPrompt?: () => void;
}

export class OwnerSettings {
  constructor(private readonly o: OwnerSettingsOptions) {}

  /** The setting `name`, as the URL names it; an unknown one is not found. */
  named(name: string): OwnerSetting {
    const known = OWNER_SETTINGS.find((s) => s === name);
    if (!known) throw new NotFound('unknownSetting', `there is no setting ${name}`);
    return known;
  }

  view<N extends OwnerSetting>(name: N): OwnerSettingViews[N] {
    return ENTRIES[name].view(this.o.home);
  }

  /** Every setting as it reads. */
  all(): OwnerSettingViews {
    return Object.fromEntries(OWNER_SETTINGS.map((name) => [name, this.view(name)])) as unknown as OwnerSettingViews;
  }

  /** Saves the setting from what the owner sent (`OwnerSettingChanges`), answered with it as it then reads. */
  save<N extends OwnerSetting>(name: N, input: unknown): OwnerSettingViews[N] {
    const saved = ENTRIES[name].save(this.o.home, input);
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
