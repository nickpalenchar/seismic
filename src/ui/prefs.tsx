// Seismic-the-app, behind its logo in the bar: a menu of the views about no one canvas (the agents'
// performance, the feedback log), the preferences and help; and the preferences dialog (language,
// theme, motion, what is running), in the style of the configuration (config.tsx), which keeps what sets
// up the work.

import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { ConfigView, Preference, RepoRef } from '../core/types';
import { api } from './api';
import { NewPreference, PreferenceRow } from './koordinator';
import { Head, LanguageBlock, MotionBlock, ServerBlock, ThemeBlock } from './config';
import { Sign, Wordmark } from './logo';
import { useMenuClose } from './queue';
import { t } from './strings';
import { openWish, WishLink } from './wish';

/** The dialog's sections, in the order its list shows them. */
type PrefsSection = 'appearance' | 'rules' | 'about';
const SECTIONS: PrefsSection[] = ['appearance', 'rules', 'about'];
// the section shown, per tab: a new language reloads the page, and the dialog comes back at it
const SECTION_KEY = 'obeya-prefs-section';

const showPrefsSection = (s: PrefsSection) => sessionStorage.setItem(SECTION_KEY, s);

const keptSection = (): PrefsSection | null => {
  const s = sessionStorage.getItem(SECTION_KEY) as PrefsSection | null;
  return s && SECTIONS.includes(s) ? s : null;
};

/** What the logo's menu opens; each closes the menu first. */
export interface AppMenuActions {
  onPerformance: () => void;
  onFeedbackLog: () => void;
  onPrefs: () => void;
  /** The configuration: every canvas, its repositories, Seismic's agents, voice, demos. */
  onConfig: () => void;
  onHelp: () => void;
}

/**
 * The logo in the bar with a chevron, so it reads as a button: a click lists what is about Seismic
 * as a whole. Narrow, the bar shows the sign alone in it (barFit.ts).
 */
export function AppMenu({ onPerformance, onFeedbackLog, onPrefs, onConfig, onHelp }: AppMenuActions) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  const m = t.appMenu;
  const item = (label: ReactNode, run: () => void) => (
    <li>
      <button
        role="menuitem"
        onClick={() => {
          setOpen(false);
          run();
        }}
      >
        {label}
      </button>
    </li>
  );
  return (
    <div className="menu-pill app-menu" ref={box}>
      <button className={open ? 'app-logo on' : 'app-logo'} title={m.button} aria-label={m.button} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="bar-word">
          <Wordmark height={22} />
        </span>
        <span className="bar-sign">
          <Sign size={24} />
        </span>
        <ChevronDown className="chev" size={10} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <ul className="bar-menu app-menu-list" role="menu">
          {item(m.performance, onPerformance)}
          {item(m.feedbackLog, onFeedbackLog)}
          <li className="sep" role="separator" />
          {item(m.prefs, onPrefs)}
          {item(m.config, onConfig)}
          <li className="sep" role="separator" />
          {item(m.help, onHelp)}
          {item(t.wish.link, () => openWish())}
        </ul>
      )}
    </div>
  );
}

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
    if (on && section === 'about' && !server) api.config().then((v) => setServer(v.server), console.error);
  }, [on, section]);
  const p = t.prefs;
  return (
    <div id="prefs" className={on ? 'cfg-overlay on' : 'cfg-overlay'} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cfg-box" role="dialog" aria-modal="true" aria-label={p.title}>
        <nav className="cfg-nav">
          <div className="p-kind">{p.kind}</div>
          <h2>{p.title}</h2>
          <div className="cfg-ask">
            <p className="hint">{p.hint}</p>
            <button className="btn small" onClick={onConfig}>
              {p.toConfig}
            </button>
          </div>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s}>
                <button className={s === section ? 'on' : undefined} aria-current={s === section || undefined} onClick={() => setSection(s)}>
                  {p.sections[s]}
                </button>
              </li>
            ))}
          </ul>
          <div className="cfg-nav-foot">
            <WishLink onOpen={onClose} />
          </div>
        </nav>
        <button className="cfg-close" title={t.close} onClick={onClose}>
          ✕
        </button>
        <div className="cfg-main">
          <section className="cfg-sec" hidden={section !== 'appearance'}>
            <Head title={p.sections.appearance} />
            <LanguageBlock on={on} />
            <ThemeBlock on={on} />
            <MotionBlock on={on} />
          </section>
          <section className="cfg-sec" hidden={section !== 'rules'}>
            <Head title={p.sections.rules} />
            <p className="hint">{t.koordinator.preferencesHint}</p>
            <ul className="prefs">{preferences.filter((p) => p.state === 'active').map((p) => <PreferenceRow key={p.id} p={p} />)}</ul>
            <NewPreference repos={repos} />
          </section>
          <section className="cfg-sec" hidden={section !== 'about'}>
            <Head title={p.sections.about} />
            {server && <ServerBlock server={server} />}
          </section>
        </div>
      </div>
    </div>
  );
}
