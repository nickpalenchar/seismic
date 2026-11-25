



export const PRIORITIES = ['trivial', 'low', 'medium', 'high', 'veryHigh', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];


export const CATEGORIES = ['frontend', 'backend', 'dataMigration', 'docs', 'tooling'] as const;
export type Category = (typeof CATEGORIES)[number];


export const SUBCATEGORIES = ['refactor', 'newFeature', 'bugFix', 'configuration'] as const;
export type Subcategory = (typeof SUBCATEGORIES)[number];


export const COMPLEXITIES = [1, 2, 3, 5, 8, 13, 21] as const;
export type Complexity = (typeof COMPLEXITIES)[number];


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


export interface Labels {
  category?: Category;
  subcategory?: Subcategory;
  complexity?: Complexity;
  priority?: Priority;
}
export type Label = keyof Labels;
export const LABELS: readonly Label[] = ['category', 'subcategory', 'complexity', 'priority'];


export const LABEL_VALUES: { [L in Label]: readonly NonNullable<Labels[L]>[] } = {
  category: CATEGORIES,
  subcategory: SUBCATEGORIES,
  complexity: COMPLEXITIES,
  priority: PRIORITIES,
};

/** Whether a value is one a label may take. */
export const isLabelValue = <L extends Label>(label: L, v: unknown): v is NonNullable<Labels[L]> => (LABEL_VALUES[label] as readonly unknown[]).includes(v);


export const PRIORITY_NAMES: Record<Priority, string> = {
  trivial: 'Trivial',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  veryHigh: 'Very high',
  critical: 'Critical',
};


export const SUGGEST_TOGGLES = ['category', 'complexity', 'priority'] as const;
export type SuggestToggle = (typeof SUGGEST_TOGGLES)[number];
export type SuggestToggles = Record<SuggestToggle, boolean>;
export const SUGGEST_ALL: SuggestToggles = { category: true, complexity: true, priority: true };


export type SuggestSettings = Partial<SuggestToggles>;

/** Every toggle, each on where `s` leaves it out. */
export const suggestToggles = (s: SuggestSettings | undefined): SuggestToggles =>
  Object.fromEntries(SUGGEST_TOGGLES.map((k) => [k, s?.[k] !== false])) as SuggestToggles;

/** The labels the toggles let Seismic suggest; a toggle not given is on. */
export const suggestable = (t: SuggestSettings = {}): Label[] =>
  LABELS.filter((l) => t[l === 'subcategory' ? 'category' : (l as SuggestToggle)] !== false);
