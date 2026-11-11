/**
 * The icons a canvas may carry (`Canvas.icon`): one emoji, or `lucide:<name>` for one of a curated
 * set of Lucide icons (kebab-case names as in lucide-react's icon files), optionally in a colour of
 * the palette: `lucide:<name>:<colour>` (`lucide:rocket:blue`). Without a colour it is drawn in the
 * text's colour.
 */
export const CANVAS_LUCIDE_ICONS = [
  'activity', 'airplay', 'alarm-clock', 'anchor', 'aperture', 'apple', 'archive', 'armchair', 'atom', 'award',
  'axe', 'baby', 'backpack', 'badge-check', 'banknote', 'barcode', 'baseline', 'battery', 'beaker', 'bed',
  'beer', 'bell', 'bike', 'binary', 'bird', 'blocks', 'bluetooth', 'bolt', 'bomb', 'bone', 'book', 'book-open',
  'bookmark', 'bot', 'box', 'boxes', 'brain', 'brick-wall', 'briefcase', 'brush', 'bug', 'building',
  'building-2', 'bus', 'cake', 'calculator', 'calendar', 'camera', 'candy', 'car', 'carrot', 'cast', 'castle',
  'cat', 'chart-bar', 'chart-line', 'chart-pie', 'check-check', 'chef-hat', 'cherry', 'church', 'circle-check',
  'circle-dollar-sign', 'citrus', 'clapperboard', 'clipboard-list', 'clock', 'cloud', 'cloud-rain',
  'cloud-sun', 'code', 'coffee', 'cog', 'coins', 'compass', 'component', 'construction', 'contact',
  'container', 'cookie', 'cpu', 'crown', 'cuboid', 'cup-soda', 'database', 'diamond', 'dice-5', 'dna', 'dog',
  'dollar-sign', 'drama', 'droplet', 'drum', 'dumbbell', 'earth', 'egg', 'euro', 'eye', 'factory', 'feather',
  'file-code', 'file-text', 'film', 'fingerprint-pattern', 'fish', 'flag', 'flame', 'flask-conical', 'flower',
  'folder', 'folder-git', 'footprints', 'fuel', 'gamepad-2', 'gauge', 'gem', 'ghost', 'gift', 'git-branch',
  'git-merge', 'git-pull-request', 'glasses', 'globe', 'goal', 'graduation-cap', 'grape', 'grid-3x3', 'guitar',
  'hammer', 'hand-heart', 'handshake', 'hard-drive', 'hash', 'headphones', 'heart', 'heart-pulse', 'hexagon',
  'highlighter', 'hospital', 'hourglass', 'house', 'ice-cream-cone', 'image', 'inbox', 'infinity', 'joystick',
  'key', 'keyboard', 'lamp', 'landmark', 'languages', 'laptop', 'layers', 'layout-dashboard', 'layout-grid',
  'leaf', 'library', 'life-buoy', 'lightbulb', 'link', 'list-checks', 'list-todo', 'lock', 'magnet', 'mail',
  'map', 'map-pin', 'medal', 'megaphone', 'message-circle', 'message-square', 'mic', 'microscope', 'milestone',
  'monitor', 'moon', 'mountain', 'mouse-pointer', 'music', 'navigation', 'network', 'newspaper', 'notebook',
  'nut', 'orbit', 'package', 'paintbrush', 'palette', 'paperclip', 'party-popper', 'paw-print', 'pen-tool',
  'pencil', 'phone', 'piano', 'pickaxe', 'piggy-bank', 'pill', 'pizza', 'plane', 'plug', 'podcast', 'popcorn',
  'presentation', 'printer', 'puzzle', 'qr-code', 'radar', 'radio', 'rainbow', 'receipt', 'recycle', 'rocket',
  'route', 'rss', 'ruler', 'sailboat', 'satellite', 'save', 'scale', 'school', 'scissors', 'scroll', 'search',
  'send', 'server', 'settings', 'shapes', 'share-2', 'shield', 'shield-check', 'ship', 'shirt', 'shopping-bag',
  'shopping-cart', 'shovel', 'shrub', 'signpost', 'siren', 'skull', 'smartphone', 'smile', 'snowflake', 'sofa',
  'sparkles', 'speaker', 'sprout', 'square-terminal', 'stamp', 'star', 'sticker', 'store', 'sun', 'swords',
  'syringe', 'table', 'tag', 'target', 'tent', 'terminal', 'test-tube', 'thermometer', 'thumbs-up', 'ticket',
  'timer', 'tornado', 'tractor', 'traffic-cone', 'train-front', 'tree-pine', 'trees', 'trophy', 'truck', 'tv',
  'umbrella', 'university', 'user', 'users', 'utensils', 'vault', 'video', 'wallet', 'wand-sparkles',
  'warehouse', 'watch', 'waves', 'webhook', 'wifi', 'wind', 'wine', 'workflow', 'wrench', 'zap',
] as const;

/** The colours a Lucide icon may be drawn in, each legible on the light and the dark theme. */
export const CANVAS_ICON_COLORS = {
  red: '#e5484d', orange: '#f76b15', amber: '#e2a100', green: '#30a46c', teal: '#12a594',
  blue: '#0090ff', indigo: '#3e63dd', purple: '#8e4ec6', pink: '#d6409f', gray: '#8b8d98',
} as const;

export type CanvasIconColor = keyof typeof CANVAS_ICON_COLORS;

const LUCIDE = new Set<string>(CANVAS_LUCIDE_ICONS);

/** A Lucide icon as `Canvas.icon` holds it: its name and colour, if it is one of the curated set (and the palette). */
export function lucideIcon(icon: string | undefined): { name: (typeof CANVAS_LUCIDE_ICONS)[number]; color?: CanvasIconColor } | undefined {
  if (!icon?.startsWith('lucide:')) return undefined;
  const [name = '', color, ...rest] = icon.slice('lucide:'.length).split(':');
  if (rest.length || !LUCIDE.has(name) || (color !== undefined && !Object.hasOwn(CANVAS_ICON_COLORS, color))) return undefined;
  return { name: name as (typeof CANVAS_LUCIDE_ICONS)[number], ...(color ? { color: color as CanvasIconColor } : {}) };
}

/** `Canvas.icon` for a Lucide icon in a colour (none: the text's). */
export const lucideIconValue = (name: string, color?: CanvasIconColor | null) => `lucide:${name}${color ? `:${color}` : ''}`;

/** Whether `icon` is one a canvas may carry: a single emoji, or `lucide:` and a name of the curated set, with a colour of the palette or none. */
export function isCanvasIcon(icon: string): boolean {
  if (icon.startsWith('lucide:')) return !!lucideIcon(icon);
  if (/^[#*0-9]\uFE0F?\u20E3$/u.test(icon)) return true; // a keycap
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(icon)];
  // one grapheme that is a pictograph (with its modifiers and joiners) or a flag (two regional indicators)
  return graphemes.length === 1 && (/\p{Extended_Pictographic}/u.test(icon) || /^\p{Regional_Indicator}{2}$/u.test(icon)) && !/[\p{L}\p{N}\s]/u.test(icon.replace(/[⃣️\p{Extended_Pictographic}]/gu, ''));
}
