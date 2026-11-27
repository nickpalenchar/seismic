import './browserStateMigration';
import { createRoot } from 'react-dom/client';
import { AttachmentSwitchDialog, attachmentSwitch } from './attachmentSwitch';
import { App } from './App';
import { UiRoot } from './components/ui';
import { upgradeAddress } from './address';
import { followShell } from './desks/shell';
import { handOver, restartHeld, snapshotSession, takeHandOver } from './api';
import { restoreDraftOverflow } from './draftSession';
import { takeAppDrops } from './appDrop';
import { pinAboveKeyboard } from './keyboard';
import { HintsProvider, loadSeenHints } from './hints';
import { loadLanguageAndTheme } from './theme';

upgradeAddress();
if (window.seismicApp) {
  window.seismicAttachmentSwitch = attachmentSwitch;
  window.seismicHandOver = handOver;
  window.seismicRestartHeld = restartHeld;
  window.seismicSnapshotSession = snapshotSession;
  await window.seismicDraftsReady;
  if (window.seismicDraftOverflow) {
    restoreDraftOverflow(window.seismicDraftOverflow);
    delete window.seismicDraftOverflow;
    window.seismicDraftsReceived = true;
  }
  window.seismicConfirmDeparture?.();
  delete window.seismicConfirmDeparture;
}
const [, seenHints] = await Promise.all([loadLanguageAndTheme(), loadSeenHints()]);
if (window.seismicApp?.handedOver) await takeHandOver(window.seismicRestoredDrafts);
takeAppDrops();
pinAboveKeyboard();
followShell();
createRoot(document.getElementById('root')!).render(
  <UiRoot>
    <HintsProvider initial={seenHints}>
      <App />
      {window.seismicApp && <AttachmentSwitchDialog />}
    </HintsProvider>
  </UiRoot>,
);
