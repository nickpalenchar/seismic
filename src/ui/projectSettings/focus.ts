// Where the project settings sheet is to open: its list, or a section, the repository it shows, and the field there
// to mark, as from a card waiting for a free clone or slot or a proposal for a setting. Kept in the
// tab until the sheet of that project takes it, so it survives switching to the project first.

import type { SettingKey } from '../config';

/** A sheet's sections, in the order its list shows them; Allowed commands stands apart above the others. */
export const SECTIONS = ['commands', 'agents', 'suggestions', 'environment', 'reviews', 'git', 'archiving', 'demos'] as const;
export type Section = (typeof SECTIONS)[number];

export interface SettingsFocus {
  project: string;
  /** The repository's id; none for the project's list of sections. */
  repo?: string;
  /** The section to open; none for the list. */
  section?: Section;
  /** The field to focus and mark: the clone count or slots under Agents and models, or a repository setting. */
  field?: 'clones' | 'slots' | SettingKey;
}

const FOCUS_KEY = 'seismic-settings-focus';
const FOCUS_EVENT = 'seismic-settings-focus';

/** The section that holds a repository setting (`REPO_SETTING_GROUPS`). */
export function sectionOfSetting(k: string): Section {
  if (['setup', 'checks', 'run', 'stop', 'keep', 'softPaths'].includes(k)) return 'environment';
  if (k === 'demoLanguage' || k === 'artifacts') return 'demos';
  return 'git';
}

/** Has the sheet of `f.project` open at `f` next: at once where it shows that project, else once it does. */
export function showSettingsAt(f: SettingsFocus) {
  sessionStorage.setItem(FOCUS_KEY, JSON.stringify(f));
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** The place the sheet of `project` is to open at, taken: it is shown once. */
export function takeSettingsFocus(project: string): SettingsFocus | null {
  const kept = sessionStorage.getItem(FOCUS_KEY);
  if (!kept) return null;
  const f = JSON.parse(kept) as SettingsFocus;
  if (f.project !== project) return null;
  sessionStorage.removeItem(FOCUS_KEY);
  return f;
}

/** Calls `on` whenever a place to open at is asked for while the sheet is up. */
export function onSettingsFocus(on: () => void) {
  window.addEventListener(FOCUS_EVENT, on);
  return () => window.removeEventListener(FOCUS_EVENT, on);
}
