import './browserStateMigration';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiRoot } from './components/ui';
import { upgradeAddress } from './address';
import { handOver, restartHeld, snapshotSession, takeHandOver } from './api';
import { takeAppDrops } from './appDrop';
import { pinAboveKeyboard } from './keyboard';
import { loadLanguageAndTheme } from './theme';

upgradeAddress();
await loadLanguageAndTheme();
if (window.seismicApp) {
  window.seismicHandOver = handOver;
  window.seismicRestartHeld = restartHeld;
  window.seismicSnapshotSession = snapshotSession;
}
if (window.seismicApp?.handedOver) await takeHandOver(window.seismicRestoredDrafts);
takeAppDrops();
pinAboveKeyboard();
createRoot(document.getElementById('root')!).render(
  <UiRoot>
    <App />
  </UiRoot>,
);
