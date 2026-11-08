// A card's built-in labels, the owner's (design: The project): the fixed lists and the complexity
// scale, one place for the server, the UI and the skill that suggests them.

/** A card's priorities, from the lowest to the highest. */
export const PRIORITIES = ['trivial', 'low', 'medium', 'high', 'veryHigh', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** What part of the software a card is about. */
export const CATEGORIES = ['frontend', 'backend', 'dataMigration', 'docs', 'tooling'] as const;
export type Category = (typeof CATEGORIES)[number];

/** What kind of change a card is, with or without a category. */
export const SUBCATEGORIES = ['refactor', 'newFeature', 'bugFix', 'configuration'] as const;
export type Subcategory = (typeof SUBCATEGORIES)[number];

/** How big a card's work is, on Fibonacci steps. */
export const COMPLEXITIES = [1, 2, 3, 5, 8, 13, 21] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

/** The names of the categories and sub-categories, as the suggestion's model reads them. */
export const LABEL_NAMES: Record<Category | Subcategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  dataMigration: 'Data Migration',
  docs: 'Docs',
  tooling: 'Tooling',
  refactor: 'Refactor',
  newFeature: 'New feature',
  bugFix: 'Bug fix',
  configuration: 'Configuration',
};

/** The numeric complexity scale, for a prompt. */
export const complexityScale = () => COMPLEXITIES.join(', ');

/** A card's labels, each empty until the owner or Seismic's suggestion sets it. */
export interface Labels {
  category?: Category;
  subcategory?: Subcategory;
  complexity?: Complexity;
  priority?: Priority;
}
export type Label = keyof Labels;
export const LABELS: readonly Label[] = ['category', 'subcategory', 'complexity', 'priority'];

/** The values each label may take. */
export const LABEL_VALUES: { [L in Label]: readonly NonNullable<Labels[L]>[] } = {
  category: CATEGORIES,
  subcategory: SUBCATEGORIES,
  complexity: COMPLEXITIES,
  priority: PRIORITIES,
};

/** Whether a value is one a label may take. */
export const isLabelValue = <L extends Label>(label: L, v: unknown): v is NonNullable<Labels[L]> => (LABEL_VALUES[label] as readonly unknown[]).includes(v);

/** The names of the priorities, as the suggestion's model reads them. */
export const PRIORITY_NAMES: Record<Priority, string> = {
  trivial: 'Trivial',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  veryHigh: 'Very high',
  critical: 'Critical',
};

/** The project's toggles for what Seismic suggests ("Seismic suggests"): category goes with its sub-category. */
export const SUGGEST_TOGGLES = ['category', 'complexity', 'priority'] as const;
export type SuggestToggle = (typeof SUGGEST_TOGGLES)[number];
export type SuggestToggles = Record<SuggestToggle, boolean>;
export const SUGGEST_ALL: SuggestToggles = { category: true, complexity: true, priority: true };

/** Which labels Seismic may suggest on a project; a toggle left out (a label added later, a project from before) is on. */
export type SuggestSettings = Partial<SuggestToggles>;

/** Every toggle, each on where `s` leaves it out. */
export const suggestToggles = (s: SuggestSettings | undefined): SuggestToggles =>
  Object.fromEntries(SUGGEST_TOGGLES.map((k) => [k, s?.[k] !== false])) as SuggestToggles;

/** The labels the toggles let Seismic suggest; a toggle not given is on. */
export const suggestable = (t: SuggestSettings = {}): Label[] =>
  LABELS.filter((l) => t[l === 'subcategory' ? 'category' : (l as SuggestToggle)] !== false);
