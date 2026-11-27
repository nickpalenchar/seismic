import type { Preference, RepoRef } from '../core/types';
import { NewPreference, PreferenceRow } from './koordinator';
import { prefsClass } from './prefsClasses';
import { t } from './strings';
import { CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import * as K from './configClasses';
import { cn } from 'cn';

/** The rules every agent follows, from "Configure agents": a dialog over the page as the configuration is; each rule saves on its own. */
export function RulesDialog({ on, onClose, preferences, repos }: { on: boolean; onClose: () => void; preferences: Preference[]; repos: RepoRef[] }) {
  const r = t.rules;
  return (
    <Dialog open={on} onOpenChange={(open) => !open && onClose()}>
      <DialogContent id="rules" glass keepMounted className="relative flex min-w-0 flex-1" layerClassName={K.cfgLayerClass}>
        <CloseButton label={t.close} className={K.cfgCloseClass} onClick={onClose} />
        <div className={cn(K.cfgMainClass, 'flex-1')}>
          <section className={K.cfgSecClass}>
            <div className={cn(K.cfgKindClass, 'px-0')}>{r.kind}</div>
            <DialogTitle asChild>
              <h2 className={cn(K.cfgTitleClass, 'px-0')}>{r.title}</h2>
            </DialogTitle>
            <p className={K.cfgHeadHintClass}>{t.koordinator.preferencesHint}</p>
            <ul className={prefsClass}>{preferences.filter((p) => p.state === 'active').map((p) => <PreferenceRow key={p.id} p={p} />)}</ul>
            <NewPreference repos={repos} />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
