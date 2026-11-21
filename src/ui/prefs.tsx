// The preferences dialog (language, theme, motion, what is running), from the left menu's Settings
// (nav.tsx), in the style of the configuration (config.tsx), which keeps what sets up the work.

import { useEffect, useState } from 'react';
import type { ConfigView, Preference, RepoRef } from '../core/types';
import { getConfiguration } from './clients/seismic';
import { NewPreference, PreferenceRow } from './koordinator';
import { prefsClass } from './prefsClasses';
import { Head, LanguageBlock, MotionBlock, ServerBlock, ThemeBlock } from './config';
import { t } from './strings';
import { WishLink } from './wish';
import { Button, CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { cn } from 'cn';
import * as K from './configClasses';

/** The dialog's sections, in the order its list shows them. */
type PrefsSection = 'appearance' | 'rules' | 'about';
const SECTIONS: PrefsSection[] = ['appearance', 'rules', 'about'];
// the section shown, per tab: a new language reloads the page, and the dialog comes back at it
const SECTION_KEY = 'seismic-prefs-section';

const showPrefsSection = (s: PrefsSection) => sessionStorage.setItem(SECTION_KEY, s);

const keptSection = (): PrefsSection | null => {
  const s = sessionStorage.getItem(SECTION_KEY) as PrefsSection | null;
  return s && SECTIONS.includes(s) ? s : null;
};

/** The app-wide preferences, a dialog over the page as the configuration is; each setting saves on its own. */
export function PrefsDialog({ on, onClose, onConfig, preferences, repos }: { on: boolean; onClose: () => void; onConfig: () => void; preferences: Preference[]; repos: RepoRef[] }) {
  const [section, setSectionState] = useState<PrefsSection>(() => keptSection() ?? 'appearance');
  const setSection = (s: PrefsSection) => {
    showPrefsSection(s);
    setSectionState(s);
  };
  const [server, setServer] = useState<ConfigView['server'] | null>(null);
  useEffect(() => {
    if (!on) return;
    const s = keptSection();
    if (s) setSectionState(s);
  }, [on]);
  useEffect(() => {
    if (on && section === 'about' && !server) getConfiguration().then((v) => setServer(v.server), console.error);
  }, [on, section]);
  const p = t.prefs;
  return (
    <Dialog open={on} onOpenChange={(open) => !open && onClose()}>
      <Tabs asChild orientation="vertical" value={section} onValueChange={(s) => setSection(s as PrefsSection)}>
      <DialogContent id="prefs" glass keepMounted className={K.cfgBoxClass} layerClassName={K.cfgLayerClass}>
        <nav className={K.cfgNavClass}>
          <div className={K.cfgKindClass}>{p.kind}</div>
          <DialogTitle asChild>
            <h2 className={K.cfgTitleClass}>{p.title}</h2>
          </DialogTitle>
          <div className={K.cfgAskClass}>
            <p className={cn('hint', K.cfgAskHintClass)}>{p.hint}</p>
            <Button size="small" onClick={onConfig}>
              {p.toConfig}
            </Button>
          </div>
          <TabsList asChild aria-label={p.title}>
            <ul className={K.cfgNavListClass}>
              {SECTIONS.map((s) => (
                <li key={s} role="presentation">
                  <TabsTrigger value={s} className={K.cfgNavEntryClass()}>{p.sections[s]}</TabsTrigger>
                </li>
              ))}
            </ul>
          </TabsList>
          <div className={K.cfgNavFootClass}>
            <WishLink onOpen={onClose} />
          </div>
        </nav>
        <CloseButton label={t.close} className={K.cfgCloseClass} onClick={onClose} />
        <div className={K.cfgMainClass}>
          <TabsContent value="appearance" forceMount asChild>
          <section className={K.cfgSecClass} hidden={section !== 'appearance'}>
            <Head title={p.sections.appearance} />
            <LanguageBlock on={on} />
            <ThemeBlock on={on} />
            <MotionBlock on={on} />
          </section>
          </TabsContent>
          <TabsContent value="rules" forceMount asChild>
          <section className={K.cfgSecClass} hidden={section !== 'rules'}>
            <Head title={p.sections.rules} />
            <p className="hint">{t.koordinator.preferencesHint}</p>
            <ul className={prefsClass}>{preferences.filter((p) => p.state === 'active').map((p) => <PreferenceRow key={p.id} p={p} />)}</ul>
            <NewPreference repos={repos} />
          </section>
          </TabsContent>
          <TabsContent value="about" forceMount asChild>
          <section className={K.cfgSecClass} hidden={section !== 'about'}>
            <Head title={p.sections.about} />
            {server && <ServerBlock server={server} />}
          </section>
          </TabsContent>
        </div>
      </DialogContent>
      </Tabs>
    </Dialog>
  );
}
