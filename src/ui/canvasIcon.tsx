// What shows a canvas (`Canvas.icon`): its emoji, its Lucide icon, or the first letter of its name
// where it has none; and the icons the picker offers.

import { ArchiveIcon, AwardIcon, BanknoteIcon, BellIcon, BookOpenIcon, BookmarkIcon, BoxIcon, BriefcaseIcon, BugIcon, CalendarIcon, CameraIcon, ChartBarIcon, CircleCheckIcon, ClipboardListIcon, CloudIcon, CodeIcon, CogIcon, CompassIcon, CpuIcon, DatabaseIcon, FileTextIcon, FlagIcon, FlameIcon, FlaskConicalIcon, FolderIcon, GiftIcon, GitBranchIcon, GlobeIcon, GraduationCapIcon, HammerIcon, HeartIcon, HouseIcon, ImageIcon, InboxIcon, KeyIcon, LayersIcon, LayoutDashboardIcon, LeafIcon, LightbulbIcon, LinkIcon, LockIcon, MailIcon, MapIcon, MegaphoneIcon, MessageCircleIcon, MoonIcon, MusicIcon, PackageIcon, PaletteIcon, PaintbrushIcon, PenToolIcon, PuzzleIcon, RocketIcon, RouteIcon, ServerIcon, ShieldIcon, ShoppingCartIcon, SmartphoneIcon, SparklesIcon, StarIcon, SunIcon, TagIcon, TargetIcon, TerminalIcon, TestTubeIcon, TrophyIcon, TruckIcon, UsersIcon, WalletIcon, WrenchIcon, ZapIcon, type LucideIcon } from 'lucide-react';
import { CANVAS_LUCIDE_ICONS } from '../core/canvas-icons';
import type { Canvas } from '../core/types';

type CanvasLucideIcon = (typeof CANVAS_LUCIDE_ICONS)[number];

const LUCIDE: Record<CanvasLucideIcon, LucideIcon> = {
  'archive': ArchiveIcon,
  'award': AwardIcon,
  'banknote': BanknoteIcon,
  'bell': BellIcon,
  'book-open': BookOpenIcon,
  'bookmark': BookmarkIcon,
  'box': BoxIcon,
  'briefcase': BriefcaseIcon,
  'bug': BugIcon,
  'calendar': CalendarIcon,
  'camera': CameraIcon,
  'chart-bar': ChartBarIcon,
  'circle-check': CircleCheckIcon,
  'clipboard-list': ClipboardListIcon,
  'cloud': CloudIcon,
  'code': CodeIcon,
  'cog': CogIcon,
  'compass': CompassIcon,
  'cpu': CpuIcon,
  'database': DatabaseIcon,
  'file-text': FileTextIcon,
  'flag': FlagIcon,
  'flame': FlameIcon,
  'flask-conical': FlaskConicalIcon,
  'folder': FolderIcon,
  'gift': GiftIcon,
  'git-branch': GitBranchIcon,
  'globe': GlobeIcon,
  'graduation-cap': GraduationCapIcon,
  'hammer': HammerIcon,
  'heart': HeartIcon,
  'house': HouseIcon,
  'image': ImageIcon,
  'inbox': InboxIcon,
  'key': KeyIcon,
  'layers': LayersIcon,
  'layout-dashboard': LayoutDashboardIcon,
  'leaf': LeafIcon,
  'lightbulb': LightbulbIcon,
  'link': LinkIcon,
  'lock': LockIcon,
  'mail': MailIcon,
  'map': MapIcon,
  'megaphone': MegaphoneIcon,
  'message-circle': MessageCircleIcon,
  'moon': MoonIcon,
  'music': MusicIcon,
  'package': PackageIcon,
  'palette': PaletteIcon,
  'paintbrush': PaintbrushIcon,
  'pen-tool': PenToolIcon,
  'puzzle': PuzzleIcon,
  'rocket': RocketIcon,
  'route': RouteIcon,
  'server': ServerIcon,
  'shield': ShieldIcon,
  'shopping-cart': ShoppingCartIcon,
  'smartphone': SmartphoneIcon,
  'sparkles': SparklesIcon,
  'star': StarIcon,
  'sun': SunIcon,
  'tag': TagIcon,
  'target': TargetIcon,
  'terminal': TerminalIcon,
  'test-tube': TestTubeIcon,
  'trophy': TrophyIcon,
  'truck': TruckIcon,
  'users': UsersIcon,
  'wallet': WalletIcon,
  'wrench': WrenchIcon,
  'zap': ZapIcon,
};

/** The emojis the picker offers; any other single emoji is taken too (by an agent, say). */
export const CANVAS_EMOJIS = [
  '🏠', '🚀', '💡', '🎯', '🧪', '🐛', '🛠️', '⚙️', '📦', '📚', '📝', '📊', '📈', '💰', '💶', '🛒',
  '🎨', '🎵', '🎬', '📱', '💻', '🌐', '🔒', '🔑', '⭐', '❤️', '🔥', '⚡', '🌱', '🌍', '☀️', '🌙',
  '✅', '🚧', '📣', '💬', '📅', '🧭', '🗺️', '🧩', '🏆', '🎁', '🐳', '🤖', '👥', '🧹', '🏗️', '✨',
];

/** The Lucide icon an icon names (`lucide:<name>`), if it names one of the curated set. */
export const lucideOf = (icon: string | undefined): LucideIcon | undefined =>
  icon?.startsWith('lucide:') ? LUCIDE[icon.slice('lucide:'.length) as CanvasLucideIcon] : undefined;

/** A canvas's mark: its icon, else its name's first letter. */
export function CanvasIcon({ canvas, size = 14 }: { canvas: Pick<Canvas, 'name' | 'icon'>; size?: number }) {
  const L = lucideOf(canvas.icon);
  if (L) return <L className="canvas-icon" size={size} strokeWidth={2} aria-hidden />;
  if (canvas.icon) return <span className="canvas-icon emoji" style={{ fontSize: size }} aria-hidden>{canvas.icon}</span>;
  return <span className="canvas-icon letter" style={{ fontSize: size * 0.8, width: size, height: size }} aria-hidden>{[...canvas.name][0]?.toUpperCase()}</span>;
}

/** A canvas as text in a sentence: its emoji and name (a Lucide icon has no text). */
export const canvasText = (c: Pick<Canvas, 'name' | 'icon'>) => (c.icon && !c.icon.startsWith('lucide:') ? `${c.icon} ${c.name}` : c.name);
