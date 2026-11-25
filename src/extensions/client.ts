
import type { ComponentType } from 'react';
import type { Item } from '../core/types';
import type { Language } from '../core/locale';
import { enabled } from './index';

export interface ClientExtension {
  slots?: { topBar?: ComponentType; cardActions?: ComponentType<{ item: Item }>; detail?: ComponentType<{ item: Item }> };
  strings?: Record<Language, Record<string, unknown>>;
}


const implementations: Record<string, ClientExtension> = {};
export const clientExtensions: readonly ClientExtension[] = enabled.flatMap((name) => implementations[name] ? [implementations[name]!] : []);
