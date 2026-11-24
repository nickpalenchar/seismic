import './browserStateMigration';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UiRoot } from './components/ui';
import { upgradeAddress } from './address';
import { handOver, restartHeld, snapshotSession, takeHandOver } from './api';
import { restoreDraftOverflow } from './draftSession';
import { takeAppDrops } from './appDrop';
import { pinAboveKeyboard } from './keyboard';
import { loadLanguageAndTheme } from './theme';

upgradeAddress();
if (window.seismicApp) {
  window.seismicHandOver = handOver;
  window.seismicRestartHeld = restartHeld;
  window.seismicSnapshotSession = snapshotSession;
  if (window.seismicDraftOverflow) {
    restoreDraftOverflow(window.seismicDraftOverflow);
    delete window.seismicDraftOverflow;
    window.seismicDraftsReceived = true;
  }
}
await loadLanguageAndTheme();
if (window.seismicApp?.handedOver) await takeHandOver(window.seismicRestoredDrafts);
takeAppDrops();
pinAboveKeyboard();
createRoot(document.getElementById('root')!).render(
  <UiRoot>
    <App />
  </UiRoot>,
);
