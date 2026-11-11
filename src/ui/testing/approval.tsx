// Browser fixture: mount the real card detail against the test server's card and API.
import { createRoot } from 'react-dom/client';
import type { Item, RepoRef } from '../../core/types';
import { setProject } from '../api';
import { Detail } from '../detail';
import { UiRoot } from '../components/ui';

setProject('c');
const { item, repo }: { item: Item; repo: RepoRef } = await (await fetch('/fixture')).json();
createRoot(document.getElementById('panel')!).render(
  <UiRoot><Detail item={item} all={[item]} repos={[repo]} onEdit={() => {}} flush={async () => {}}
    onDelete={() => {}} onTell={() => {}} onDone={(done, pending) => {
      if (pending) void pending.answered.then(() => { document.body.dataset.approved = 'true'; });
      else if (done.close) document.body.dataset.approved = 'true';
    }} /></UiRoot>,
);
