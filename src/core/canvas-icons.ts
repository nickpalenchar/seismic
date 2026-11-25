






export const CANVAS_LUCIDE_ICONS = [
  'code', 'terminal', 'square-terminal', 'file-code', 'git-branch', 'git-fork', 'git-merge',
  'git-pull-request', 'folder-git', 'bug', 'bot', 'cpu', 'database', 'server', 'hard-drive', 'container',
  'cloud', 'network', 'webhook', 'workflow', 'component', 'blocks', 'puzzle', 'layers', 'app-window',
  'layout-dashboard', 'layout-grid', 'monitor', 'laptop', 'smartphone', 'keyboard', 'mouse-pointer', 'wifi',
  'binary', 'plug', 'settings', 'cog', 'wrench', 'hammer', 'rocket', 'zap', 'sparkles', 'brain', 'atom',
  'satellite', 'radar', 'gamepad-2', 'joystick', 'kanban', 'list-checks', 'list-todo', 'clipboard-list',
  'calendar', 'milestone', 'target', 'goal', 'flag', 'route', 'signpost', 'map', 'compass', 'package', 'box',
  'boxes', 'archive', 'folder', 'notebook', 'book', 'book-open', 'file-text', 'presentation', 'chart-bar',
  'chart-line', 'chart-pie', 'activity', 'gauge', 'building', 'building-2', 'factory', 'warehouse', 'store',
  'house', 'hotel', 'hospital', 'school', 'university', 'landmark', 'castle', 'church', 'construction',
  'brick-wall', 'tent', 'briefcase', 'handshake', 'banknote', 'coins', 'dollar-sign', 'circle-dollar-sign',
  'euro', 'wallet', 'piggy-bank', 'receipt', 'shopping-cart', 'shopping-bag', 'scale', 'vault', 'megaphone',
  'mail', 'phone', 'newspaper', 'globe', 'earth', 'languages', 'shield', 'shield-check', 'lock', 'key', 'user',
  'user-round', 'users', 'contact', 'person-standing', 'baby', 'smile', 'hand-heart', 'heart',
  'graduation-cap', 'crown', 'trophy', 'medal', 'award', 'dumbbell', 'volleyball', 'bike', 'footprints',
  'timer', 'swords', 'airplay', 'alarm-clock', 'anchor', 'aperture', 'apple', 'armchair', 'axe', 'backpack',
  'badge-check', 'barcode', 'baseline', 'battery', 'beaker', 'bed', 'beer', 'bell', 'bird', 'bluetooth',
  'bolt', 'bomb', 'bone', 'bookmark', 'brush', 'bus', 'cake', 'calculator', 'camera', 'candy', 'car', 'carrot',
  'cast', 'cat', 'check-check', 'chef-hat', 'cherry', 'circle-check', 'citrus', 'clapperboard', 'clock',
  'cloud-rain', 'cloud-sun', 'coffee', 'cookie', 'cuboid', 'cup-soda', 'diamond', 'dice-5', 'dna', 'dog',
  'drama', 'droplet', 'drum', 'egg', 'eye', 'feather', 'film', 'fingerprint-pattern', 'fish', 'flame',
  'flask-conical', 'flower', 'fuel', 'gem', 'ghost', 'gift', 'glasses', 'grape', 'grid-3x3', 'guitar', 'hash',
  'headphones', 'heart-pulse', 'hexagon', 'highlighter', 'hourglass', 'ice-cream-cone', 'image', 'inbox',
  'infinity', 'lamp', 'leaf', 'library', 'life-buoy', 'lightbulb', 'link', 'magnet', 'map-pin',
  'message-circle', 'message-square', 'mic', 'microscope', 'moon', 'mountain', 'music', 'navigation', 'nut',
  'orbit', 'paintbrush', 'palette', 'paperclip', 'party-popper', 'paw-print', 'pen-tool', 'pencil', 'piano',
  'pickaxe', 'pill', 'pizza', 'plane', 'podcast', 'popcorn', 'printer', 'qr-code', 'radio', 'rainbow',
  'recycle', 'rss', 'ruler', 'sailboat', 'save', 'scissors', 'scroll', 'search', 'send', 'shapes', 'share-2',
  'ship', 'shirt', 'shovel', 'shrub', 'siren', 'skull', 'snowflake', 'sofa', 'speaker', 'sprout', 'stamp',
  'star', 'sticker', 'sun', 'syringe', 'table', 'tag', 'test-tube', 'thermometer', 'thumbs-up', 'ticket',
  'tornado', 'tractor', 'traffic-cone', 'train-front', 'tree-pine', 'trees', 'truck', 'tv', 'umbrella',
  'utensils', 'video', 'wand-sparkles', 'watch', 'waves', 'wind', 'wine',
] as const;


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
  if (/^[#*0-9]\uFE0F?\u20E3$/u.test(icon)) return true; 
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(icon)];
  
  return graphemes.length === 1 && (/\p{Extended_Pictographic}/u.test(icon) || /^\p{Regional_Indicator}{2}$/u.test(icon)) && !/[\p{L}\p{N}\s]/u.test(icon.replace(/[⃣️\p{Extended_Pictographic}]/gu, ''));
}

/** A random curated Lucide icon in a random palette colour, for a canvas made without the owner choosing one. */
export function randomCanvasIcon(): string {
  const names = CANVAS_LUCIDE_ICONS;
  const colors = Object.keys(CANVAS_ICON_COLORS) as CanvasIconColor[];
  return lucideIconValue(names[Math.floor(Math.random() * names.length)]!, colors[Math.floor(Math.random() * colors.length)]!);
}
