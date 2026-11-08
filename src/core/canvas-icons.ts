/**
 * The icons a canvas may carry (`Canvas.icon`): one emoji, or `lucide:<name>` for one of a curated
 * set of Lucide icons (kebab-case names as in lucide-react's icon files).
 */
export const CANVAS_LUCIDE_ICONS = [
  'archive', 'award', 'banknote', 'bell', 'book-open', 'bookmark', 'box', 'briefcase', 'bug', 'calendar',
  'camera', 'chart-bar', 'circle-check', 'clipboard-list', 'cloud', 'code', 'cog', 'compass', 'cpu', 'database',
  'file-text', 'flag', 'flame', 'flask-conical', 'folder', 'gift', 'git-branch', 'globe', 'graduation-cap', 'hammer',
  'heart', 'house', 'image', 'inbox', 'key', 'layers', 'layout-dashboard', 'leaf', 'lightbulb', 'link',
  'lock', 'mail', 'map', 'megaphone', 'message-circle', 'moon', 'music', 'package', 'palette', 'paintbrush',
  'pen-tool', 'puzzle', 'rocket', 'route', 'server', 'shield', 'shopping-cart', 'smartphone', 'sparkles', 'star',
  'sun', 'tag', 'target', 'terminal', 'test-tube', 'trophy', 'truck', 'users', 'wallet', 'wrench', 'zap',
] as const;

const LUCIDE = new Set<string>(CANVAS_LUCIDE_ICONS);

/** Whether `icon` is one a canvas may carry: a single emoji, or `lucide:` and a name of the curated set. */
export function isCanvasIcon(icon: string): boolean {
  if (icon.startsWith('lucide:')) return LUCIDE.has(icon.slice('lucide:'.length));
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(icon)];
  // one grapheme that is a pictograph (with its modifiers and joiners) or a flag (two regional indicators)
  return graphemes.length === 1 && (/\p{Extended_Pictographic}/u.test(icon) || /^\p{Regional_Indicator}{2}$/u.test(icon)) && !/[\p{L}\p{N}\s]/u.test(icon.replace(/[⃣️]/g, ''));
}
