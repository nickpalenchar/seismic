import { createRoot } from 'react-dom/client';
import { App } from './App';
import { upgradeAddress } from './address';
import { handOver, takeHandOver } from './api';
import { takeAppDrops } from './appDrop';
import { pinAboveKeyboard } from './keyboard';
import { loadLanguageAndTheme } from './theme';

upgradeAddress();
await loadLanguageAndTheme();
if (window.obeyaApp) window.obeyaHandOver = handOver;
if (window.obeyaApp?.handedOver) await takeHandOver();
takeAppDrops();
pinAboveKeyboard();
createRoot(document.getElementById('root')!).render(<App />);
