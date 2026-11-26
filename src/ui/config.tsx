import { parkClones, restoreClones } from './workstationDraft';






import { Info as InfoIcon, Trash2 } from 'lucide-react';
import { forwardRef, Fragment, lazy, type ReactNode, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { OpenPerformance } from './performance';
import { allowsDemo, HANDOVER_ARTIFACTS } from '../../plugin/skills/demo/lib/artifacts.ts';
import { DEFAULT_STYLE, QWEN3_SPEAKER, QWEN3_SPEAKERS, qwen3IsClone, qwen3Speaker, STYLED_VOICES } from '../../plugin/skills/demo/lib/voice-choices.ts';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_ROLES, agyBaseChoice, modelEffort, modelEfforts, harnessChoice, needsGit, projectAgentSetting, CARD_ARCHIVING, type CardArchiving, RIGHT_CLICK, type RightClick, CODE_REVIEW_MODES, type CodeReviewSetting, type AgentEffort, type AgentModel, type AgentRole, type AgentSetting, type ModelInfo, type Harness, type AgentsView, type ProjectDefaults, type ProjectDefaultsView, type ProjectSettings, type ConfigChecked, type DeveloperView, type ConfigProblem, type ConfigProblemCode, type ConfigView, type DemoSettings, type HandoverArtifact, type DemoSettingsView, type DemoSpaceView, type DemoVoiceCheck, type ProjectDemoSite, type ProjectDemoSiteState, type DemoSitesView, type TagProposalJob, type Language, type HostConfig, type LanguageView, type NarrationLanguage, type RepoConfig, type RepoSettings, type RepoTrust, type TrustGroup, type RepoValues, type ResolvedProject, type SettingsShared, type SettingValue, layerSettings, SHARED_FIELDS, NESTED_SETTINGS, type NestedSetting, isNested, type PageTags, type SetupCheck, START_FAILED, type Theme, THEMES, type ThemeView, type Motion, MOTIONS, type MotionView, type UsageMeterView, type FeedbackPromptView, type NotificationsView, type VoiceKind, type VoiceSetupView } from '../core/types';
import { catalogDefault, DefaultEffort, HarnessOptions, ModelOptions, useConnectedHarnesses } from './agent-options';
import { patchOf } from '../core/diff';
import { extension, linesOf, textsOf, visible } from './trust-lines';
import { parseTagLines, tagLines } from '../core/page-tags';
import { LANGUAGES } from '../core/locale';
import { SUGGEST_TOGGLES, type SuggestSettings, type SuggestToggle, suggestToggles } from '../core/labels';
import { AccessSection } from './access';
import { type AddSiteInput, api, onAgentSettingsChange, reload, type SiteHow } from './api';
import { draftSession, onHandOverEntries } from './draftSession';
import { configDraftKey, keepConfigDraft, keptConfigDraft } from './configDraft';
import { keep } from './keep';
import { plain } from './markdown';
import { demoState, GitSetup, platformName, RecognitionDetail, Setup, SetupList, useFolderWithoutGit, useWorkerConfiguration, voiceState } from './views/setup';
import { Harnesses } from './views/setup/harnesses';
import type { Usage } from '../core/types';
import { Spinner } from './components/spinner';
import { idClass, installClass, installHintClass, jsonClass, pathClass, problemClass, removeClass, rowClass, statusClass, trustClass, trustGroupClass } from './setupClasses';
import { useFitHeight } from './fitHeight';
import { useCopy } from './copy';
import { failText, fileSize, snoozeWhen, t } from './strings';
import { applyTheme } from './theme';
import { applyMotion } from './motion';
import { canNotify, notificationsChanged, type Permission, permission, requestPermission } from './desktopNotify';
import { WishLink } from './wish';
import { projectPath } from './address';
import { scrollBehavior } from './motion';
import { Badge } from './components/badge';
import { Button, CloseButton, IconButton, LinkButton } from './components/button';
import { focusSettingsSheet } from './projectSettings/focus';
import { ConfirmDialog, Dialog, DialogContent, DialogTitle } from './components/dialog';
import { Checkbox } from './components/checkbox';
import { CheckLabel } from './components/check-label';
import { SavingSwitch } from './components/saving-switch';
import { getAgentModels, getSetting, saveSetting } from './clients/seismic';
import { Switch } from './components/switch';
import { RadioGroup, RadioOption } from './components/radio';
import { SegmentedControl } from './components/segmented';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Tooltip } from './components/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './components/popover';
import { ProjectIcon } from './canvasIcon';
import { IconPicker, type IconPickerView } from './iconPicker';
import { Input, Textarea } from './components/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { Select, SelectGroup, SelectItem, SelectLabel } from './components/select';
import { type GithubAdd, GithubSetup, PublishMode } from './githubSite';
import { cn } from 'cn';
import * as K from './configClasses';
import type { EntryDraft } from './projectSettings/entry';

declare global {
  interface Window {
    



    seismicApp?: { version: string; platform: string; built?: string | null; handedOver?: boolean };
    
    seismicHandOver?: (token: string, signal?: AbortSignal) => Promise<void>;
    seismicAttachmentSwitch?: typeof import('./attachmentSwitch').attachmentSwitch;
    seismicRestartHeld?: () => boolean;
    seismicSnapshotSession?: () => string[][];
    seismicRestoredDrafts?: Set<string>;
    seismicDraftOverflow?: [string, string][];
    seismicDraftsReceived?: boolean;
    seismicDraftsReady?: Promise<void>;
    seismicConfirmDeparture?: () => void;
  }
}


type Ask = (text: string, project?: string) => void;


type Section = 'defaults' | 'agents' | 'harnesses' | 'voice' | 'demos' | 'notices' | 'devices' | 'advanced' | 'developer';
/** A field of prose in a setting (a voice's style, its sample text): the page's font, not a path's. */
const proseFieldClass = (hook: string) => `${hook} block w-full max-w-[420px] resize-y text-sm leading-[1.45] py-1.5 px-2`;

const SECTIONS: Section[] = ['defaults', 'agents', 'harnesses', 'voice', 'demos', 'notices', 'devices', 'advanced', 'developer'];

const SECTION_KEY = 'seismic-config-section';

/** Opens the dialog at the demos next time, scrolled to this machine's demo sites. */
export const showDemosSection = () => {
  sessionStorage.setItem(SECTION_KEY, 'demos');
  sessionStorage.setItem(SITES_SHOW_KEY, '1');
};

const SITES_SHOW_KEY = 'seismic-config-sites';

const ADD_SITE_KEY = 'seismic-config-add-site';
const ADD_SITE_EVENT = 'seismic-add-site';
/** Opens the page that adds a demo site: at once where the dialog is open, else the next time it opens. */
export const showAddSite = () => {
  sessionStorage.setItem(SECTION_KEY, 'demos');
  sessionStorage.setItem(ADD_SITE_KEY, '1');
  window.dispatchEvent(new Event(ADD_SITE_EVENT));
};

/** Opens the dialog at "Other devices" next time, as from "Connect a phone". */
export const showDevicesSection = () => sessionStorage.setItem(SECTION_KEY, 'devices');

/** The section this tab showed last, if any. */
const keptSection = () => {
  const s = sessionStorage.getItem(SECTION_KEY) as Section | null;
  return s && SECTIONS.includes(s) ? s : null;
};

/**
 * Seismic's configuration: what holds for every project and this machine. A project's own entry (its
 * name, repositories) and settings are in its settings sheet; "+ New project" adds one.
 */
export function ConfigDialog({ on, usage, onClose, onTalk, onConnect, onProjectSettings }: { on: boolean; usage: Usage[]; onClose: () => void; onTalk: () => void; onConnect: () => void;  onProjectSettings: () => void }) {
  const [setupOn, setSetupOn] = useState(false);
  
  const toSheet = useRef(false);
  
  const [defaults, setDefaults] = useState<ProjectDefaultsView | null>(null);
  const [problems, setProblems] = useState<ConfigProblem[]>([]);
  const [section, setSectionState] = useState<Section>(() => keptSection() ?? 'defaults');
  
  const [addingSite, setAddingSiteState] = useState(() => !!sessionStorage.getItem(ADD_SITE_KEY));
  const setAddingSite = (on: boolean) => {
    if (on) sessionStorage.setItem(ADD_SITE_KEY, '1');
    else sessionStorage.removeItem(ADD_SITE_KEY);
    
    if (!on) sessionStorage.removeItem(ADD_MODE_KEY);
    setAddingSiteState(on);
  };
  const setSection = (s: Section) => {
    sessionStorage.setItem(SECTION_KEY, s);
    setSectionState(s);
    setAddingSite(false);
  };
  useEffect(() => {
    const open = () => {
      setSectionState('demos');
      setAddingSiteState(true);
    };
    window.addEventListener(ADD_SITE_EVENT, open);
    return () => window.removeEventListener(ADD_SITE_EVENT, open);
  }, []);
  
  useEffect(() => {
    if (!on) return;
    const s = keptSection();
    if (s) setSectionState(s);
    setAddingSiteState(!!sessionStorage.getItem(ADD_SITE_KEY));
    getSetting('projectDefaults').then(setDefaults, console.error);
    let active = true;
    setProblems([]);
    void api.configCheck().then(
      (checked) => { if (active) setProblems(checked.problems.filter((p) => p.project === undefined)); },
      console.error,
    );
    return () => { active = false; };
  }, [on]);

  const c = t.config;
  return (
    
    <Dialog open={on} onOpenChange={(open) => !open && onClose()}>
      <Tabs asChild orientation="vertical" value={section} onValueChange={(v) => setSection(v as Section)}>
      <DialogContent id="config" glass keepMounted className={K.cfgBoxClass} layerClassName={K.cfgLayerClass} onCloseAutoFocus={(e) => {
        if (!toSheet.current) return;
        toSheet.current = false;
        e.preventDefault();
        focusSettingsSheet();
      }}>
        <nav className={K.cfgNavClass}>
          <div className={K.cfgKindClass}>{c.kind}</div>
          <DialogTitle asChild>
            <h2 className={K.cfgTitleClass}>{c.title}</h2>
          </DialogTitle>
          <div className={K.cfgAskClass}>
            <p className={cn('hint', K.cfgAskHintClass)}>{c.koordinator}</p>
            <Button size="small" onClick={onTalk}>
              {c.askSeismic}
            </Button>
          </div>
          <TabsList asChild aria-label={c.title}>
          <ul className={K.cfgNavListClass}>
            {SECTIONS.map((s) => (
                <li key={s} role="presentation">
                  <TabsTrigger value={s} aria-controls={`cfg-sec-${s}`} className={K.cfgNavEntryClass()} onClick={() => s === section && setSection(s)}>
                    {c.sections[s]}
                  </TabsTrigger>
                </li>
            ))}
          </ul>
          </TabsList>
          <div className={K.cfgNavFootClass}>
            <WishLink onOpen={onClose} />
          </div>
        </nav>
        { }
        <CloseButton label={t.close} className={K.cfgCloseClass} onClick={onClose} />
        <div className={K.cfgMainClass}>
          <ConfigurationProblems problems={problems} />
          <section id="cfg-sec-defaults" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'defaults'}>
            <ProjectDefaultsBlock view={defaults} onSaved={setDefaults} onProjectSettings={() => { toSheet.current = true; onProjectSettings(); }} />
          </section>
          <section id="cfg-sec-agents" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'agents'}>
            <AgentsBlock on={on && section === 'agents'} />
          </section>
          <section id="cfg-sec-harnesses" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'harnesses'}>
            {on && section === 'harnesses' && <Harnesses usage={usage} />}
          </section>
          <section id="cfg-sec-voice" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'voice'}>
            <VoiceBlock on={on} />
          </section>
          <section id="cfg-sec-demos" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'demos' || addingSite}>
            <DemoBlock on={on} />
            <DemoSitesBlock on={on && section === 'demos' && !addingSite} onAdd={() => setAddingSite(true)} />
          </section>
          <section className={K.cfgSecClass} hidden={section !== 'demos' || !addingSite}>
            {addingSite && <AddSitePage on={on} onBack={() => setAddingSite(false)} />}
          </section>
          <section id="cfg-sec-notices" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'notices'}>
            <Head title={c.sections.notices} />
            <NotificationsBlock on={on} />
            <UsageBlock on={on} />
            <FeedbackBlock on={on} />
          </section>
          <section id="cfg-sec-devices" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'devices'}>
            <AccessSection on={on && section === 'devices'} onConnect={onConnect} />
          </section>
          <section id="cfg-sec-advanced" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'advanced'}>
            <Head title={c.sections.advanced} />
            <section className="mb-6" aria-labelledby="cfg-reconfigure-setup">
              <h3 id="cfg-reconfigure-setup">{c.reconfigureSetup.title}</h3>
              <p className="hint">{c.reconfigureSetup.hint}</p>
              <Button size="small" onClick={() => setSetupOn(true)}>{c.reconfigureSetup.relaunch}</Button>
            </section>
            <ProjectExport on={on && section === 'advanced'} />
          </section>
          <section id="cfg-sec-developer" role="tabpanel" className={K.cfgSecClass} hidden={section !== 'developer'}>
            <DeveloperBlock on={on && section === 'developer'} />
          </section>
        </div>
        {setupOn && <Setup onClose={() => setSetupOn(false)} />}
      </DialogContent>
      </Tabs>
    </Dialog>
  );
}

function ProjectExport({ on }: { on: boolean }) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [names, setNames] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    setNames([]);
    if (!on) return;
    setError('');
    let active = true;
    void api.projects().then(
      (ps) => {
        if (active) setNames(ps.map((p) => ({ id: p.id, name: p.name || p.id })));
      },
      (e) => {
        if (active) setError(failText(e));
      },
    );
    return () => { active = false; };
  }, [on]);
  const ids = selected === null ? names.map((project) => project.id) : selected.filter((id) => names.some((project) => project.id === id));
  const exportAs = async (as: 'csv' | 'json') => {
    setError('');
    
    try { await api.exportProjects(selected === null ? [] : ids, as); } catch (e) { setError(failText(e)); }
  };
  return <>
    <h3>{t.config.dataExport.title}</h3>
    <p className="hint">{t.config.dataExport.hint}</p>
    <CheckLabel><Checkbox checked={selected === null} onCheckedChange={() => setSelected(null)} />{t.config.dataExport.all}</CheckLabel>
    {names.map((project) => <CheckLabel key={project.id}><Checkbox checked={selected === null || selected.includes(project.id)} onCheckedChange={(on) => setSelected(on === true ? [...(selected ?? []), project.id] : (selected ?? names.map((n) => n.id)).filter((id) => id !== project.id))} />{project.name}</CheckLabel>)}
    <p className="cfg-export-actions flex gap-1.5 mt-4 mx-0 mb-0"><Button size="small" disabled={!ids.length} onClick={() => exportAs('csv')}>{t.config.dataExport.csv}</Button><Button size="small" disabled={!ids.length} onClick={() => exportAs('json')}>{t.config.dataExport.json}</Button></p>
    {error && <p role="alert">{error}</p>}
  </>;
}

/** Restarting Seismic, or rebuilding it (its dependencies installed again) and restarting, for work on Seismic itself. */
function DeveloperBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<DeveloperView | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) api.developer().then(setView, console.error);
  }, [on]);
  const l = t.config.developer;
  const ask = async (what: 'restart' | 'rebuild') => {
    setStatus('');
    try {
      await api.developerRestart(what);
      setStatus(l.asked);
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head title={t.config.sections.developer} hint={l.hint} />
      {view && (
        <>
          <Field label={l.restart} hint={view.why ? l.why[view.why] : l.restartHint}>
            <Button size="small" disabled={!view.restart} onClick={() => ask('restart')}>
              {l.restartButton}
            </Button>
          </Field>
          <Field label={l.rebuild} hint={view.why ? l.why[view.why] : view.rebuildWhy ? l.why[view.rebuildWhy] : l.rebuildHint}>
            <Button size="small" disabled={!view.rebuild} onClick={() => ask('rebuild')}>
              {l.rebuildButton}
            </Button>
          </Field>
        </>
      )}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** A section's title, what it is about, and the file it is saved in; `sub` for a part of a section. */
export function Head({ title, hint, file, sub }: { title: string; hint?: ReactNode; file?: string; sub?: boolean }) {
  return (
    <header className={K.cfgHeadClass(sub)}>
      {sub ? <h4 className={K.cfgHeadSubTitleClass}>{title}</h4> : <h3 className={K.cfgHeadTitleClass}>{title}</h3>}
      {hint && <p className={K.cfgHeadHintClass}>{hint}</p>}
      {file && (
        <p className={K.cfgHeadFileClass}>
          {t.config.fromFile} <code>{file}</code>
        </p>
      )}
    </header>
  );
}

/** One setting: what it is on the left (an info icon there shows while the pointer is on the row), the control with what to know about it on the right. */
export function Field({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn(K.cfgFieldClass, 'cfg-has-info', className)}>
      <div className={K.cfgLabelClass}>{label}</div>
      <div className={K.cfgControlClass}>
        {children}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * What to know about a field, behind a small icon: the icon shows while the pointer is on the field or its
 * label (the nearest `.cfg-has-info` around it) or the field has the focus, so the page stays calm; the text
 * shows on hover, on focus and on a click or tap, kept inside the window.
 */
export function Info({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip content={text} side="bottom" align="start" open={open} onOpenChange={setOpen} delayDuration={0}>
      <button
            type="button"
            className={cn(K.cfgInfoClass, open && 'on')}
            aria-label={t.config.info}
            
          onClick={(e) => (e.preventDefault(), setTimeout(() => setOpen(true)))}
      >
        <InfoIcon size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** The server's own settings, from its command line: shown, not changed here. */
export function ServerBlock({ server }: { server: ConfigView['server'] }) {
  const c = t.config;
  return (
    <>
      <Head sub title={c.server} />
      <Field label={c.version}>
        {server.version}
        {server.commit && <> · {c.checkout(server.commit.slice(0, 7))}</>}
      </Field>
      <Field label={c.port}>{server.port}</Field>
      <Field label={c.dataDir}>
        <code>{server.home}</code>
      </Field>
      <Field label={c.permissionMode}>
        <code>{server.permissionMode}</code>
      </Field>
      <Field label={c.restarts}>{!server.restarts ? c.no : server.commit ? c.yes : c.noCheckout}</Field>
      { }
      {server.commit && !window.seismicApp && (
        <Field label={c.asApp} hint={c.asAppHint}>
          <code>bun run app install</code>
        </Field>
      )}
      {window.seismicApp?.built && (
        <Field label={c.app} hint={c.appBuiltHint}>
          {c.checkout(window.seismicApp.built.slice(0, 7))}
        </Field>
      )}
      { }
      {window.seismicApp && (
        <Button size="small" title={c.openInBrowserHint} onClick={() => window.open(location.href, '_blank')}>
          {c.openInBrowser}
        </Button>
      )}
    </>
  );
}


const VOICE_GROUPS: { group: 'local' | 'service' | 'own'; voices: VoiceKind[] }[] = [
  { group: 'local', voices: ['piper', 'qwen3', 'say'] },
  { group: 'service', voices: ['gemini', 'openai', 'elevenlabs', 'azure'] },
  { group: 'own', voices: ['command', 'http'] },
];

const VOICE_FIELDS: Record<VoiceKind, ('voiceName' | 'command' | 'url' | 'keyFile')[]> = {
  piper: ['voiceName'],
  qwen3: ['voiceName'],
  say: ['voiceName'],
  command: ['command'],
  http: ['url', 'keyFile'],
  gemini: ['voiceName', 'keyFile'],
  openai: ['voiceName', 'url', 'keyFile'],
  elevenlabs: ['voiceName', 'keyFile'],
  azure: ['url', 'voiceName', 'keyFile'],
};

const SAMPLE_TEXT_KEY = 'seismic-demo-sample-text';

const STOCK_ONLY: VoiceKind[] = ['piper', 'say'];

const DEFAULT_DEMO_DIRECTORY = '~/demos';

/**
 * The interface language, saved on its own, the page loading again in it; and the conversation
 * language, which agents write the owner in, saved on its own and taking effect with their next words.
 */
export function LanguageBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<LanguageView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (on) getSetting('language').then(setView, console.error);
  }, [on]);
  if (!view || LANGUAGES.length < 2) return null;
  const l = t.config.language;
  const choose = async (language: Language | null) => {
    setBusy(true);
    setStatus('');
    try {
      const v = await saveSetting('language', { language });
      setView(v);
      
      reload();
    } catch (e) {
      setStatus(failText(e));
      setBusy(false);
    }
  };
  const converse = async (conversation: Language | null) => {
    setStatus('');
    try {
      setView(await saveSetting('language', { conversation }));
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.heading} file={view.file} />
      <Field label={l.title} hint={l.hint}>
        <Select aria-label={l.title} value={view.chosen ?? ''} disabled={busy} onValueChange={(picked) => choose((picked || null) as Language | null)}>
          <SelectItem value="">{l.system(l.names[view.system])}</SelectItem>
          {LANGUAGES.map((x) => (
            <SelectItem key={x} value={x}>
              {l.names[x]}
            </SelectItem>
          ))}
        </Select>
      </Field>
      <Field label={l.conversation} hint={l.conversationHint}>
        <Select aria-label={l.conversation} value={view.conversationChosen ?? ''} disabled={busy} onValueChange={(picked) => converse((picked || null) as Language | null)}>
          <SelectItem value="">{l.asInterface(l.names[view.language])}</SelectItem>
          {LANGUAGES.map((x) => (
            <SelectItem key={x} value={x}>
              {l.names[x]}
            </SelectItem>
          ))}
        </Select>
      </Field>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** Light or dark, or as the system: saved on its own, and the page takes it at once. */
export function ThemeBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<ThemeView | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) getSetting('theme').then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.config.theme;
  const choose = async (theme: Theme | null) => {
    const before = view;
    setView({ ...view, chosen: theme });
    applyTheme(theme);
    setStatus('');
    try {
      setView(await saveSetting('theme', { theme }));
    } catch (e) {
      setView(before);
      applyTheme(before.chosen);
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <SegmentedControl
          label={l.title}
          value={view.chosen ?? SYSTEM}
          onValueChange={(x) => choose(x === SYSTEM ? null : (x as Theme))}
          options={[SYSTEM, ...THEMES].map((x) => ({ value: x, label: x === SYSTEM ? l.system : l.names[x as Theme] }))}
        />
      </Field>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** Full or reduced motion, or as the system: saved on its own, and the page takes it at once. */
export function MotionBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<MotionView | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) getSetting('motion').then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.config.motion;
  const choose = async (motion: Motion | null) => {
    const before = view;
    setView({ ...view, chosen: motion });
    applyMotion(motion);
    setStatus('');
    try {
      setView(await saveSetting('motion', { motion }));
    } catch (e) {
      setView(before);
      applyMotion(before.chosen);
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <SegmentedControl
          label={l.title}
          value={view.chosen ?? SYSTEM}
          onValueChange={(x) => choose(x === SYSTEM ? null : (x as Motion))}
          options={[SYSTEM, ...MOTIONS].map((x) => ({ value: x, label: x === SYSTEM ? l.system : l.names[x as Motion] }))}
        />
      </Field>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** Whether the bar shows the plan's usage limits: saved on its own, and the bar follows at once. */
function UsageBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<UsageMeterView | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) getSetting('usageMeter').then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.usage.setting;
  const choose = async (shown: boolean) => {
    setStatus('');
    try {
      setView(await saveSetting('usageMeter', { on: shown }));
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <SavingSwitch checked={view.on} save={choose}>
          {l.label}
        </SavingSwitch>
      </Field>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** Whether this machine's pages notify on the desktop when a card needs the owner: saved on its own; turning on asks the system for its permission. */
function NotificationsBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<NotificationsView | null>(null);
  const [perm, setPerm] = useState<Permission>('granted');
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!on) return;
    getSetting('notifications').then(setView, console.error);
    permission().then(setPerm, console.error);
  }, [on]);
  if (!view || !canNotify()) return null;
  const l = t.notifications;
  const choose = async (wanted: boolean) => {
    setStatus('');
    try {
      const p = wanted && perm !== 'granted' ? await requestPermission() : perm;
      setPerm(p);
      setView(await saveSetting('notifications', { on: wanted }));
      notificationsChanged();
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <SavingSwitch checked={view.on === true} save={choose}>
          {l.label}
        </SavingSwitch>
      </Field>
      {view.on === true && perm !== 'granted' && <p className={`hint ${statusClass}`}>{perm === 'denied' ? l.denied : l.notGranted}</p>}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** Whether approving work asks for feedback on it: saved on its own, and every open page follows at once. */
function FeedbackBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<FeedbackPromptView | null>(null);
  const openPerformance = useContext(OpenPerformance);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (on) getSetting('feedbackPrompt').then(setView, console.error);
  }, [on]);
  if (!view) return null;
  const l = t.feedback.setting;
  const choose = async (asks: boolean) => {
    setStatus('');
    try {
      setView(await saveSetting('feedbackPrompt', { on: asks }));
    } catch (e) {
      setStatus(failText(e));
    }
  };
  return (
    <>
      <Head sub title={l.title} hint={l.hint} file={view.file} />
      <Field label={l.title}>
        <SavingSwitch checked={view.on} save={choose}>
          {l.label}
          <Badge variant="secondary">{l.preview}</Badge>
        </SavingSwitch>
        {openPerformance && (
          <Button size="small" className="cfg-perf [:is(#config,#prefs,#project-settings)_&]:mt-2.5" title={t.performance.openHint} onClick={openPerformance}>
            {t.performance.open}
          </Button>
        )}
      </Field>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** The toggles "Seismic suggests": on a project's page, and as Project defaults. */
export function SuggestField({ value, onChange }: { value: SuggestSettings | undefined; onChange: (s: Record<SuggestToggle, boolean>) => void }) {
  const l = t.config.suggest;
  const on = suggestToggles(value);
  return (
    <Field label={<>{l.title} <Info text={l.hint} /></>}>
      {SUGGEST_TOGGLES.map((k) => (
        <CheckLabel key={k}>
          <Checkbox checked={on[k]} onCheckedChange={(v) => onChange({ ...on, [k]: v === true })} />
          {l[k]}
        </CheckLabel>
      ))}
    </Field>
  );
}

/** "Suggest new cards" or "Suggest card merges": on a project's page and settings sheet, and in Project defaults; on where left out. */
export function SuggestionField({ which, value, onChange }: { which: 'labels' | 'cards' | 'merges'; value: boolean | undefined; onChange: (on: boolean) => void }) {
  const l = t.config.suggestions[which];
  return (
    <Field label={l.title} hint={l.hint}>
      <CheckLabel>
        <Switch checked={value !== false} aria-label={l.title} onCheckedChange={onChange} />
        {l.on}
      </CheckLabel>
    </Field>
  );
}

/** Plan tagging uses the same control on a project and in Project defaults. */
export function PlanBaselineField({ value, onChange }: { value: boolean | undefined; onChange: (on: boolean) => void }) {
  return (
    <Field label={t.config.planBaselines} hint={t.config.planBaselinesHint}>
      <CheckLabel>
        <Switch checked={value !== false} onCheckedChange={onChange} />
        {t.config.planBaselinesOn}
      </CheckLabel>
    </Field>
  );
}

/** How finished cards go into the archive ("Cards archive"): on a project's settings sheet and page, and in Project defaults. */
export function CardArchiveField({ value, onChange }: { value: CardArchiving | undefined; onChange: (v: CardArchiving) => void }) {
  const l = t.config.archive;
  const now = value ?? 'manual';
  return (
    <Field label={<>{l.title} <Info text={l.hint} /></>}>
      <RadioGroup className="cr-field" label={l.title} value={now} onValueChange={(mode) => onChange(mode as typeof now)}>
        {CARD_ARCHIVING.map((mode) => (
          <RadioOption key={mode} value={mode}>
            {l[mode]}
          </RadioOption>
        ))}
      </RadioGroup>
    </Field>
  );
}

/** What a right click on a card opens ("Right click on a card"): on a project's settings sheet and page, and in Project defaults. */
export function RightClickField({ value, onChange }: { value: RightClick | undefined; onChange: (v: RightClick) => void }) {
  const l = t.config.rightClick;
  const now = value ?? 'groups';
  return (
    <Field label={<>{l.title} <Info text={l.hint} /></>}>
      <RadioGroup className="cr-field" label={l.title} value={now} onValueChange={(mode) => onChange(mode as typeof now)}>
        {RIGHT_CLICK.map((mode) => (
          <RadioOption key={mode} value={mode}>
            {l[mode]}
          </RadioOption>
        ))}
      </RadioGroup>
    </Field>
  );
}

/**
 * Whether a separate agent reviews work that lands on main, and when ("Reviews happen"): the same
 * controls for a new project's draft and for Project defaults.
 */
export function CodeReviewField({ value, onChange, bare }: { value: Partial<CodeReviewSetting> | undefined; onChange: (v: CodeReviewSetting) => void;  bare?: boolean }) {
  const l = t.config.codeReviews;
  const now: CodeReviewSetting = { on: value?.on === true, mode: value?.mode === 'manual' ? 'manual' : 'auto' };
  const controls = (
    <>
      <CheckLabel>
        <Switch checked={now.on} onCheckedChange={(on) => onChange({ ...now, on })} />
        {l.on}
      </CheckLabel>
      {now.on && (
        <RadioGroup className="cr-when mt-3 [&>p.hint]:mt-2 [&>p.hint]:mb-0 [&>p.hint]:mx-0" label={l.when} value={now.mode} onValueChange={(mode) => onChange({ ...now, mode: mode as typeof now.mode })}>
          <span className="block text-muted-foreground text-sm">{l.when}</span>
          {CODE_REVIEW_MODES.map((mode) => (
            <RadioOption key={mode} value={mode}>
              {l[mode]}
            </RadioOption>
          ))}
          <p className="hint">{l.scope}</p>
        </RadioGroup>
      )}
    </>
  );
  return bare ? <div className="cr-field">{controls}</div> : <Field label={<>{l.title} <Info text={l.hint} /></>}>{controls}</Field>;
}

/**
 * Project defaults: what a project created from now on starts with, a value for every project setting
 * (`PROJECT_SETTINGS` on the server). Saved on each change; existing projects keep their own.
 */
function ProjectDefaultsBlock({ view, onSaved, onProjectSettings }: { view: ProjectDefaultsView | null; onSaved: (v: ProjectDefaultsView) => void; onProjectSettings: () => void }) {
  const [status, setStatus] = useState('');
  const c = t.config;
  
  const link = <LinkButton className="mb-4" onClick={onProjectSettings}>{c.defaults.openProjectSettings}</LinkButton>;
  if (!view) return (
    <>
      <Head title={c.sections.defaults} />
      {link}
    </>
  );
  const save = async (d: ProjectSettings) => {
    setStatus('');
    try {
      onSaved(await saveSetting('projectDefaults', d));
    } catch (e) {
      setStatus(failText(e));
    }
  };
  
  const fields: { [K in keyof ProjectDefaults]: ReactNode } = {
    suggest: <SuggestField value={view.defaults.suggest} onChange={(suggest) => save({ suggest })} />,
    suggestLabels: <SuggestionField which="labels" value={view.defaults.suggestLabels} onChange={(suggestLabels) => save({ suggestLabels })} />,
    suggestCards: <SuggestionField which="cards" value={view.defaults.suggestCards} onChange={(suggestCards) => save({ suggestCards })} />,
    suggestMerges: <SuggestionField which="merges" value={view.defaults.suggestMerges} onChange={(suggestMerges) => save({ suggestMerges })} />,
    planBaselines: <PlanBaselineField value={view.defaults.planBaselines} onChange={(planBaselines) => save({ planBaselines })} />,
    archive: <CardArchiveField value={view.defaults.archive} onChange={(archive) => save({ archive })} />,
    rightClick: <RightClickField value={view.defaults.rightClick} onChange={(rightClick) => save({ rightClick })} />,
    
    agents: <Field label={c.defaults.agents}>{c.defaults.agentsValue}</Field>,
    codeReviews: <CodeReviewField value={view.defaults.codeReviews} onChange={(codeReviews) => save({ codeReviews })} />,
    
    demoSite: <Field label={t.config.projectSite.label}>{t.config.projectSite.defaults}</Field>,
  };
  return (
    <>
      <Head title={c.sections.defaults} hint={c.defaults.hint} file={view.file} />
      {link}
      {Object.entries(fields).map(([k, field]) => (
        <Fragment key={k}>{field}</Fragment>
      ))}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}


const agentsHeadClass = 'text-muted-foreground text-xs pb-1';


export const agentClass = 'cfg-agent flex flex-col py-2 px-0 text-base max-[900px]:col-span-full max-[900px]:pb-0.5 [.cs-agents_&]:pt-2.5 [.cs-agents_&]:pb-1';

/** The model and effort of each group of agents: saved on each change, taken by the next agent that starts. */
function AgentsBlock({ on }: { on: boolean }) {
  const connected = useConnectedHarnesses(on);
  const [view, setView] = useState<AgentsView | null>(null);
  const [catalogs, setCatalogs] = useState<Partial<Record<'codex' | 'agy', ModelInfo[]>>>({});
  const [catalogError, setCatalogError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadModels = async () => {
    setLoading(true); setCatalogError('');
    const wanted = (['codex', 'agy'] as const).filter((h) => AGENT_ROLES.some((r) => view?.agents[r].harness === h));
    const lists = await Promise.allSettled(wanted.map((h) => getAgentModels(h, { fresh: true })));
    setCatalogs(Object.fromEntries(lists.flatMap((result, i) => result.status === 'fulfilled' ? [[wanted[i], result.value]] : [])));
    setCatalogError(lists.flatMap((result) => result.status === 'rejected' ? [failText(result.reason)] : []).join(' · '));
    setLoading(false);
  };
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!on) return;
    let revision = 0;
    const refresh = () => {
      const at = ++revision;
      getSetting('agents').then((saved) => { if (at === revision) setView(saved); }, console.error);
    };
    refresh();
    const stop = onAgentSettingsChange(refresh);
    return () => { ++revision; stop(); };
  }, [on]);
  const codexOn = !!view && AGENT_ROLES.some((r) => view.agents[r].harness === 'codex');
  const agyOn = !!view && AGENT_ROLES.some((r) => view.agents[r].harness === 'agy');
  useEffect(() => { if (on && (codexOn || agyOn)) void loadModels(); }, [on, codexOn, agyOn]);
  if (!view) return null;
  const a = t.config.agents;
  if (connected?.configured.length === 0) {
    return <Head title={a.title} hint={t.config.harnesses.empty} file={view.file} />;
  }
  const save = async (saving: () => Promise<AgentsView>) => {
    setBusy(true);
    setStatus('');
    try {
      setView(await saving());
    } catch (e) {
      setStatus(failText(e));
    }
    setBusy(false);
  };
  const choose = (role: AgentRole, choice: Partial<AgentSetting>) => save(() => saveSetting('agents', { [role]: choice }));
  return (
    <>
      <Head title={a.title} hint={a.hint} file={view.file} />
      {codexOn && <p className="hint">{a.codexScope}</p>}
      {view.agents.worker.harness === 'codex' && (
        <>
          <SavingSwitch checked={view.codexAutoReview} disabled={busy} save={(on) => save(() => saveSetting('codexAutoReview', { on }))}>
            {a.codexAutoReview}
          </SavingSwitch>
          <p className="hint">{a.codexAutoReviewHint}</p>
        </>
      )}
      {agyOn && <p className="hint">{a.agyScope}</p>}
      {(codexOn || agyOn) && (loading || catalogError) && <p className={`hint ${statusClass}`}>{loading ? a.loadingModels : catalogError} {!loading && <button type="button" onClick={loadModels}>{a.reloadModels}</button>}</p>}
      <div className="cfg-agents grid grid-cols-[minmax(0,1.4fr)_minmax(130px,.85fr)_minmax(160px,1fr)_minmax(100px,.65fr)] gap-y-0 gap-x-3.5 items-center max-w-[1000px] max-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)]">
        <span className="max-[900px]:hidden" />
        <span className={agentsHeadClass}>{a.harness}</span>
        <span className={agentsHeadClass}>{a.model}</span>
        <span className={agentsHeadClass}>{a.effort}</span>
        {AGENT_ROLES.map((role) => {
          const setting = view.agents[role];
          const other = (setting.harness === 'codex' || setting.harness === 'agy') ? setting.harness : null;
          const codex = !!other;
          const models = other ? catalogs[other] : undefined;
          const choice = other === 'agy' ? agyBaseChoice(setting.agy ?? { model: 'default' }, models)
            : harnessChoice(setting);
          const defaultModel = codex ? catalogDefault(models) : AGENT_DEFAULTS[role].model;
          const model = codex ? choice.model === 'default' ? defaultModel : choice.model : setting.model === 'default' ? defaultModel : setting.model;
          const selected = models?.find((m) => m.model === model);
          const efforts = selected ? modelEfforts(selected) : AGENT_EFFORTS;
          const effort = codex ? choice.effort ?? modelEffort(selected) : setting.effort;
          const effortLabel = `${a.roles[role].name}: ${a.effort}`;
          return (
            <Fragment key={role}>
              <div className={agentClass}>
                {a.roles[role].name}
                <span className="hint">{a.roles[role].hint}</span>
              </div>
              <Select className="min-w-0" aria-label={`${a.roles[role].name}: ${a.harness}`} value={setting.harness ?? 'claude'} disabled={busy} onValueChange={(picked) => choose(role, { harness: picked as Harness })}>
                <HarnessOptions defaultHarness="claude" connected={connected} />
              </Select>
              <Select className="min-w-0" aria-label={`${a.roles[role].name}: ${a.model}`} value={model} disabled={busy || (codex && (loading || !models))} onValueChange={(picked) => {
                if (!codex) return choose(role, { model: picked as AgentModel });
                const next = models?.find((m) => m.model === picked);
                const model = picked === defaultModel ? 'default' : picked;
                const nextEffort = other === 'agy' && model === 'default' ? undefined : modelEffort(next, effort);
                return choose(role, other === 'agy' ? { agy: { model, effort: nextEffort } } : { codex: { model, effort: nextEffort ?? choice.effort ?? 'high' } });
              }}>
                <ModelOptions harness={other ?? 'claude'} models={models} value={model} defaultModel={defaultModel} />
              </Select>
              {selected && !efforts.length ? <DefaultEffort className="min-w-0" label={effortLabel} /> : <Select className="min-w-0" aria-label={effortLabel} value={effort ?? ''} disabled={busy || (codex && (loading || !selected))} onValueChange={(picked) => {
                const effort = picked as AgentEffort;
                return choose(role, other ? { [other]: { ...choice, effort } } : { effort });
              }}>
                {codex && effort && !efforts.includes(effort) && <SelectItem value={effort} disabled>{a.efforts[effort]} ({a.unavailable})</SelectItem>}
                {efforts.map((x) => (
                  <SelectItem key={x} value={x}>
                    {a.efforts[x]}
                  </SelectItem>
                ))}
              </Select>}
            </Fragment>
          );
        })}
      </div>
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
    </>
  );
}

/** The checkboxes for what a handover may bring; the last of video and HTML stays on, since every handover brings a demo. */
function ArtifactChecks({ value, onChange }: { value: HandoverArtifact[]; onChange: (v: HandoverArtifact[]) => void }) {
  const names = t.config.demo.artifactNames;
  return (
    <div>
      {HANDOVER_ARTIFACTS.map((a) => (
        <CheckLabel key={a}>
          <Checkbox
            checked={value.includes(a)}
            disabled={a !== 'schema' && value.includes(a) && !allowsDemo(value.filter((x) => x !== a))}
            onCheckedChange={(v) => onChange(HANDOVER_ARTIFACTS.filter((x) => (x === a ? v === true : value.includes(x))))}
          />
          {names[a]}
        </CheckLabel>
      ))}
    </div>
  );
}

/** How demos are narrated: saved on their own, read by the next render, so nothing restarts. */
function DemoBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<DemoSettingsView | null>(null);
  const [draft, setDraft] = useState<DemoSettings | null>(null);
  const [check, setCheck] = useState<DemoVoiceCheck | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [sampling, setSampling] = useState(false);
  
  const [sampleText, setSampleText] = useState(() => sessionStorage.getItem(SAMPLE_TEXT_KEY) ?? '');
  const keepSampleText = (text: string) => {
    setSampleText(text);
    if (text) sessionStorage.setItem(SAMPLE_TEXT_KEY, text);
    else sessionStorage.removeItem(SAMPLE_TEXT_KEY);
  };
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!on) return;
    getSetting('demo').then((v) => {
      setView(v);
      setDraft(keptConfigDraft<DemoSettings>(draftSession, 'demo', v.settings) ?? v.settings);
      setStatus('');
    }, console.error);
  }, [on]);
  
  useEffect(() => {
    if (view && draft) keepConfigDraft(draftSession, 'demo', draft, view.settings);
  }, [draft, view]);
  useEffect(() => {
    if (!on || !view) return;
    return onHandOverEntries((keys) => {
      if (!keys.has(configDraftKey('demo'))) return;
      const kept = keptConfigDraft<DemoSettings>(draftSession, 'demo', view.settings);
      if (kept) setDraft(kept);
    });
  }, [on, view]);
  const installing = !!view?.job?.running;
  
  useEffect(() => {
    if (!draft) return;
    let live = true;
    api.checkDemoVoice(draft).then((c) => live && setCheck(c), console.error);
    return () => {
      live = false;
    };
  }, [draft, installing]);
  
  const counting = !!view?.space?.busy;
  useEffect(() => {
    if (!on || !(installing || counting)) return;
    const timer = setInterval(() => getSetting('demo').then(setView, console.error), 1500);
    return () => clearInterval(timer);
  }, [on, installing, counting]);
  useEffect(() => () => audio.current?.pause(), []);
  if (!view || !draft) return null;
  const d = t.config.demo;
  const changed = JSON.stringify(draft) !== JSON.stringify(view.settings);
  const set = <K extends keyof DemoSettings>(k: K, v: DemoSettings[K]) => setDraft({ ...draft, [k]: v });
  const shown = check ?? view.check;
  const job = view.job?.voice === draft.voice ? view.job : undefined;
  const failed = (e: unknown) => setStatus(failText(e, { detail: ['voiceSample'] }));
  const save = async () => {
    setBusy(true);
    try {
      const v = await saveSetting('demo', draft);
      setView(v);
      setDraft(v.settings);
      setStatus(d.saved);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const install = async () => {
    setStatus('');
    try {
      setView(await api.installDemoVoice(draft));
    } catch (e) {
      failed(e);
    }
  };
  const listen = async () => {
    setSampling(true);
    setStatus('');
    try {
      const wav = await api.demoVoiceSample(draft, sampleText.trim() || undefined);
      audio.current?.pause();
      audio.current = new Audio(URL.createObjectURL(wav));
      await audio.current.play();
    } catch (e) {
      failed(e);
    }
    setSampling(false);
  };
  
  const speakerField = () => {
    const name = draft.voiceName;
    const known = name ? qwen3Speaker(name) : QWEN3_SPEAKER;
    return (
      <Field key="voiceName" label={d.field.voiceName('qwen3')} hint={d.speakerHint}>
        <Select aria-label={d.field.voiceName('qwen3')} value={known ?? name ?? ''} onValueChange={(picked) => set('voiceName', picked === QWEN3_SPEAKER ? undefined : picked)}>
          {!known && name && <SelectItem value={name}>{d.speakerUnknown(name)}</SelectItem>}
          {QWEN3_SPEAKERS.map((s) => (
            <SelectItem key={s} value={s}>
              {d.speakers[s]}
            </SelectItem>
          ))}
        </Select>
        {shown.problems.includes('unknownSpeaker') && <p className="p-error">{d.problem.unknownSpeaker}</p>}
      </Field>
    );
  };
  const field = (k: (typeof VOICE_FIELDS)[VoiceKind][number]) => (
    <Field key={k} label={d.field[k](draft.voice)}>
      <Input
        className={pathClass}
        aria-label={d.field[k](draft.voice)}
        spellCheck={false}
        placeholder={d.placeholder[k](draft.voice)}
        value={draft[k] ?? ''}
        onChange={(e) => set(k, e.target.value || undefined)}
      />
    </Field>
  );
  return (
    <>
      <Head title={d.title} hint={d.hint} file={view.file} />
      <div className={K.cfgColsClass}>
        <div>
          <Field label={d.directory} hint={d.directoryHint(shown.directory)}>
            <Input
              className={pathClass}
              aria-label={d.directory}
              spellCheck={false}
              placeholder={DEFAULT_DEMO_DIRECTORY}
              value={draft.directory ?? ''}
              onChange={(e) => set('directory', e.target.value || undefined)}
            />
            {shown.directoryRelative && <p className="p-error">{d.directoryRelative}</p>}
          </Field>
          {view.space && <KeepFrames space={view.space} value={draft.keepFrames} onChange={(v) => set('keepFrames', v)} />}
          {LANGUAGES.length > 1 && <Field label={d.language} hint={d.languageHint}>
            <Select aria-label={d.language} value={draft.language} onValueChange={(picked) => set('language', picked as NarrationLanguage)}>
              {(Object.keys(d.languages) as NarrationLanguage[]).map((l) => (
                <SelectItem key={l} value={l}>
                  {d.languages[l]}
                </SelectItem>
              ))}
            </Select>
          </Field>}
          <Field label={d.artifactsLabel} hint={d.artifactsHint}>
            <ArtifactChecks value={draft.artifacts ?? [...HANDOVER_ARTIFACTS]} onChange={(v) => set('artifacts', v.length === HANDOVER_ARTIFACTS.length ? undefined : v)} />
          </Field>
          <Field label={d.voice} hint={d.about[draft.voice]}>
            <Select
              aria-label={d.voice}
              value={draft.voice}
              
              onValueChange={(picked) =>
                setDraft({ language: draft.language, voice: picked as VoiceKind, ...(draft.directory ? { directory: draft.directory } : {}), ...(draft.keepFrames ? { keepFrames: draft.keepFrames } : {}), ...(draft.artifacts ? { artifacts: draft.artifacts } : {}) })
              }
            >
              {VOICE_GROUPS.map(({ group, voices }) => (
                <SelectGroup key={group}>
                  <SelectLabel>{d.groups[group]}</SelectLabel>
                  {voices
                    .filter((v) => v !== 'say' || view.platform === 'darwin' || draft.voice === 'say')
                    .map((v) => (
                      <SelectItem key={v} value={v}>
                        {d.voices[v]}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </Select>
          </Field>
          {VOICE_FIELDS[draft.voice].map((k) => (k === 'voiceName' && draft.voice === 'qwen3' ? speakerField() : field(k)))}
          {(STYLED_VOICES as readonly VoiceKind[]).includes(draft.voice) && !(draft.voice === 'qwen3' && qwen3IsClone(draft)) && (
            <Field label={d.style} hint={d.styleHint}>
              <Textarea
                className={proseFieldClass('c-style')}
                rows={4}
                aria-label={d.style}
                placeholder={DEFAULT_STYLE}
                value={draft.style ?? ''}
                onChange={(e) => set('style', e.target.value || undefined)}
              />
            </Field>
          )}
          {draft.voice === 'qwen3' && qwen3IsClone(draft) && <p className="hint">{d.styleClone}</p>}
          {draft.voice === 'qwen3' &&
            LANGUAGES.map((l) => (
              <Field key={l} label={d.field.reference(d.languages[l])}>
                <Input
                  className={pathClass}
                  aria-label={d.field.reference(d.languages[l])}
                  spellCheck={false}
                  placeholder={d.placeholder.reference()}
                  value={draft.references?.[l] ?? ''}
                  onChange={(e) => {
                    const { [l]: _, ...others } = draft.references ?? {};
                    const references = { ...others, ...(e.target.value ? { [l]: e.target.value } : {}) };
                    set('references', Object.keys(references).length ? references : undefined);
                  }}
                />
                {shown.clips[l] && <p className="p-error">{d.clip[shown.clips[l]]}</p>}
              </Field>
            ))}
          <Field label="" hint={d.person[shown.person]}>
            {!STOCK_ONLY.includes(draft.voice) && (
              <CheckLabel>
                <Switch checked={!!draft.ownVoice} onCheckedChange={(on) => set('ownVoice', on || undefined)} />
                {d.ownVoice}
              </CheckLabel>
            )}
          </Field>
          <Field label={d.sampleText}>
            <Textarea className={proseFieldClass('c-sample')} rows={2} aria-label={d.sampleText} placeholder={d.sampleTextPlaceholder} value={sampleText} onChange={(e) => keepSampleText(e.target.value)} />
          </Field>
          <Field label="">
            {job?.running ? (
              <p className={installHintClass}>
                <span className="c-step">{d.installing}</span> <code>{job.line}</code>
              </p>
            ) : (
              !shown.install.installed && (
                <div className={installClass}>
                  <p className="hint">{d.notInstalled(shown.install.missing.join(', '), fileSize(shown.install.mb * 1e6))}</p>
                  <Button size="small" disabled={installing} onClick={install}>
                    {d.install(fileSize(shown.install.mb * 1e6))}
                  </Button>
                </div>
              )
            )}
            {job?.error && !job.running && <p className="p-error">{d.installFailed(job.error.split('\n').at(-1) ?? '')}</p>}
            {shown.problems.filter((p) => p !== 'unknownSpeaker').map((p) => (
              <p key={p} className="p-error">
                {d.problem[p]}
              </p>
            ))}
            <Button size="small" disabled={sampling || !shown.install.installed || !!shown.problems.length || !!shown.clips[draft.language]} onClick={listen}>
              {sampling ? d.sampling : d.listen}
            </Button>
          </Field>
          <div className={K.cfgActionsClass}>
            <Button variant="primary" disabled={!changed || busy} onClick={save}>
              {d.save}
            </Button>
            {changed && (
              <Button disabled={busy} onClick={() => setDraft(view.settings)}>
                {t.config.reset}
              </Button>
            )}
            {status && <span className={`hint ${statusClass}`}>{status}</span>}
          </div>
        </div>
        <SetupBlock draft={draft} installing={installing} />
      </div>
    </>
  );
}


interface CloudflareWay {
  account: string;
  token: string;
  accountId: string;
}

/** The choice as the server takes it. */
const cloudflareHow = (w: CloudflareWay): SiteHow => (w.account === 'token' ? { token: w.token, ...(w.accountId.trim() ? { accountId: w.accountId.trim() } : {}) } : w.account ? { account: w.account } : {});


const CLOUDFLARE_TOKENS = 'https://dash.cloudflare.com/profile/api-tokens';

/**
 * The Cloudflare account a new site goes into: that of a site this machine deploys to already
 * (`accounts`, by site), this machine's own login (logging in in the browser where there is none),
 * or another account, by an API token pasted here, which leaves the machine's login as it is.
 */
function CloudflareAccount({ accounts, way, onChange, disabled }: { accounts: string[]; way: CloudflareWay; onChange: (way: CloudflareWay) => void; disabled?: boolean }) {
  const a = t.config.sites;
  return (
    <div className="site-account grid gap-1.5 mt-0.5 mx-0 mb-2.5 max-w-[520px] [&_label]:flex [&_label]:flex-col [&_label]:gap-1 [&_label:first-child]:flex-row [&_label:first-child]:items-center [&_label:first-child]:gap-2">
      <label>
        <span className="hint">{a.account}</span>
        <Select className="text-sm" aria-label={a.account} value={way.account} disabled={disabled} onValueChange={(picked) => onChange({ ...way, account: picked })}>
          {accounts.map((x) => (
            <SelectItem key={x} value={x}>
              {a.accountOf(x)}
            </SelectItem>
          ))}
          <SelectItem value="">{a.accountLogin}</SelectItem>
          <SelectItem value="token">{a.accountToken}</SelectItem>
        </Select>
      </label>
      {way.account === 'token' && (
        <>
          <label>
            <span className="hint">
              {a.tokenLabel}{' '}
              <a href={CLOUDFLARE_TOKENS} target="_blank" rel="noreferrer">
                {a.tokenLink}
              </a>
            </span>
            <Input className={pathClass} type="password" autoComplete="off" spellCheck={false} aria-label={a.tokenLabel} value={way.token} disabled={disabled} onChange={(e) => onChange({ ...way, token: e.target.value })} />
          </label>
          <label>
            <span className="hint">{a.accountIdLabel}</span>
            <Input className={pathClass} spellCheck={false} aria-label={a.accountIdLabel} value={way.accountId} disabled={disabled} onChange={(e) => onChange({ ...way, accountId: e.target.value })} />
          </label>
        </>
      )}
    </div>
  );
}


const MIB = 1024 * 1024;


type AddHost = 'github' | 'cloudflare' | 'manual';

const SYSTEM = 'system';
const ADD_HOSTS: AddHost[] = ['github', 'cloudflare', 'manual'];


const ADD_HOST_KEY = 'seismic-site-host';
const ADD_MANUAL_KEY = 'seismic-site-manual';
const ADD_CODE_KEY = 'seismic-site-code';

const ADD_CLOUDFLARE_KEY = 'seismic-site-cloudflare';




const ADD_MINE_KEY = 'seismic-site-adding';
const ADD_MODE_KEY = 'seismic-site-mode-for';

/** The Cloudflare account and listing kept for the form, as it was left. */
const keptCloudflare = (): { way: CloudflareWay | null; unlisted: boolean } => {
  try {
    const k = JSON.parse(sessionStorage.getItem(ADD_CLOUDFLARE_KEY) ?? '{}') as { account?: unknown; accountId?: unknown; unlisted?: unknown };
    return { way: typeof k.account === 'string' ? { account: k.account, token: '', accountId: typeof k.accountId === 'string' ? k.accountId : '' } : null, unlisted: k.unlisted !== false };
  } catch {
    return { way: null, unlisted: true };
  }
};


let sitesNow: DemoSitesView | null = null;
const sitesListeners = new Set<(v: DemoSitesView) => void>();
const showSites = (v: DemoSitesView) => {
  sitesNow = v;
  for (const l of sitesListeners) l(v);
};
const loadSites = () => api.demoSites().then(showSites, console.error);

/** This machine's demo sites, kept current while a block shows them; a site being added is followed until it is on the list. */
function useDemoSites(on: boolean): [DemoSitesView | null, (v: DemoSitesView) => void] {
  const [view, setView] = useState<DemoSitesView | null>(sitesNow);
  useEffect(() => {
    sitesListeners.add(setView);
    if (on) void loadSites();
    return () => void sitesListeners.delete(setView);
  }, [on]);
  const running = !!view?.job?.running;
  useEffect(() => {
    if (!on || !running) return;
    const timer = setInterval(loadSites, 1000);
    return () => clearInterval(timer);
  }, [on, running]);
  return [view, showSites];
}

/**
 * "Add a demo site": set up at GitHub Pages or Cloudflare Pages with one button, another host
 * entered by hand, or a site another machine has, by its connection code. The site goes on the list
 * once Seismic published to it; `onAdded` gets its address.
 */
function AddSite({ view, onView, onAdded, onCancel }: { view: DemoSitesView; onView: (v: DemoSitesView) => void; onAdded?: (url: string) => void; onCancel?: () => void }) {
  const p = t.config.sites;
  const c = t.config.settings;
  const [host, setHost] = useState<AddHost>(() => ADD_HOSTS.find((h) => h === sessionStorage.getItem(ADD_HOST_KEY)) ?? ADD_HOSTS[0]!);
  const [way, setWay] = useState<CloudflareWay | null>(() => keptCloudflare().way);
  const [unlisted, setUnlisted] = useState(() => keptCloudflare().unlisted);
  const [manual, setManual] = useState<{ url: string; deploy: string; env: string; maxFile: string }>(() => {
    try {
      return { url: '', deploy: '', env: '', maxFile: '', ...JSON.parse(sessionStorage.getItem(ADD_MANUAL_KEY) ?? '{}') };
    } catch {
      return { url: '', deploy: '', env: '', maxFile: '' };
    }
  });
  const [code, setCode] = useState(() => sessionStorage.getItem(ADD_CODE_KEY) ?? '');
  const [connecting, setConnecting] = useState(() => !!sessionStorage.getItem(ADD_CODE_KEY));
  const [status, setStatus] = useState('');
  
  const [mine, setMineState] = useState(() => sessionStorage.getItem(ADD_MINE_KEY));
  const setMine = (id: string | null) => {
    if (id) sessionStorage.setItem(ADD_MINE_KEY, id);
    else sessionStorage.removeItem(ADD_MINE_KEY);
    setMineState(id);
  };
  
  const [modeFor, setModeForState] = useState<string | null>(() => sessionStorage.getItem(ADD_MODE_KEY));
  const setModeFor = (url: string | null) => {
    if (url) sessionStorage.setItem(ADD_MODE_KEY, url);
    else sessionStorage.removeItem(ADD_MODE_KEY);
    setModeForState(url);
  };
  useEffect(() => sessionStorage.setItem(ADD_HOST_KEY, host), [host]);
  useEffect(() => sessionStorage.setItem(ADD_CLOUDFLARE_KEY, JSON.stringify({ ...(way ? { account: way.account, accountId: way.accountId } : {}), unlisted })), [way?.account, way?.accountId, unlisted]);
  useEffect(() => sessionStorage.setItem(ADD_MANUAL_KEY, JSON.stringify(manual)), [manual]);
  useEffect(() => (code ? sessionStorage.setItem(ADD_CODE_KEY, code) : sessionStorage.removeItem(ADD_CODE_KEY)), [code]);
  const job = view.job;
  const running = !!job?.running;
  useEffect(() => {
    if (!mine || (job?.id === mine && job.running)) return;
    setMine(null);
    
    if (job?.id === mine && job.site) {
      if (view.sites.find((x) => x.url === job.site)?.git) setModeFor(job.site);
      else onAdded?.(job.site);
      sessionStorage.removeItem(ADD_MANUAL_KEY);
      void api.demoSitesSeen().then(onView, console.error);
    }
  }, [mine, job?.id, job?.running, job?.site]);
  
  useEffect(() => {
    if (modeFor && !view.sites.some((x) => x.url === modeFor)) setModeFor(null);
  }, [modeFor, view.sites]);
  const act = async (fn: () => Promise<DemoSitesView>) => {
    setStatus('');
    try {
      const v = await fn();
      onView(v);
      return v;
    } catch (e) {
      setStatus(failText(e));
      return null;
    }
  };
  
  const chosen: CloudflareWay = way ?? { account: view.cloudflareAccounts[0] ?? '', token: '', accountId: '' };
  const add = async (h: AddHost) => {
    setHost(h);
    const how: AddSiteInput =
      h === 'manual'
        ? { manual: { url: manual.url.trim(), deploy: manual.deploy.trim(), ...(manual.env.trim() ? { env: manual.env.trim() } : {}), ...(Number(manual.maxFile) > 0 ? { maxFile: Math.round(Number(manual.maxFile) * MIB) } : {}) } }
        : h === 'cloudflare'
          ? { host: 'cloudflare', ...cloudflareHow(chosen), ...(unlisted ? {} : { unlisted: false }) }
          : { host: 'github', public: true };
    const v = await act(() => api.addDemoSite(how));
    if (v?.job) setMine(v.job.id);
  };
  const addGithub = async (how: GithubAdd) => {
    const input: AddSiteInput = 'create' in how ? { host: 'github', name: how.create.name, ...(how.create.private ? {} : { public: true as const }) } : { host: 'github', ...how };
    const v = await act(() => api.addDemoSite(input));
    if (v?.job) setMine(v.job.id);
  };
  const added = modeFor ? view.sites.find((x) => x.url === modeFor) : undefined;
  if (added?.git && added.project) {
    const g = p.github;
    return (
      <div className="add-site flex flex-col items-stretch gap-2 mt-2.5">
        <p className="m-0">
          {p.at(p.hostNames.github, g.folderOf(added.project, added.git.folder))}:{' '}
          <a className="text-primary underline underline-offset-[.18em]" href={`${added.url}/`} target="_blank" rel="noreferrer">
            {siteLabel(added.url)}
          </a>
        </p>
        <p className="hint m-0">{g.modeHint}</p>
        <PublishMode url={added.url} repo={added.project} git={added.git} onChanged={onView} />
        <div className={K.cfgPersonalActionsClass}>
          <Button
            variant="primary"
            onClick={() => {
              setModeFor(null);
              onAdded?.(added.url);
            }}
          >
            {g.done}
          </Button>
        </div>
      </div>
    );
  }
  const ready = host !== 'manual' ? !(host === 'cloudflare' && chosen.account === 'token' && !chosen.token.trim()) : !!(manual.url.trim() && manual.deploy.trim());
  
  const sub = (label: string, control: ReactNode) => (
    <label className="wide">
      <span className={K.cfgSubHintClass}>{label}</span>
      {control}
    </label>
  );
  return (
    <div className="add-site flex flex-col items-stretch gap-2 mt-2.5 [&>[data-slot=toggle-group]]:self-start [&>.hint]:m-0 [&>.c-install]:m-0 [&>[data-slot=check-label]]:text-sm">
      <SegmentedControl label={p.add} value={host} disabled={running} onValueChange={setHost} options={ADD_HOSTS.map((h) => ({ value: h, label: p.hosts[h] }))} />
      <p className="hint">{p.notes[host]}</p>
      {host === 'github' && (
        <GithubSetup
          running={running}
          onAdd={(how) => void addGithub(how)}
          cancel={
            onCancel && !running ? (
              <Button onClick={onCancel}>
                {p.cancel}
              </Button>
            ) : undefined
          }
        />
      )}
      {host === 'cloudflare' && (
        <>
          <CloudflareAccount accounts={view.cloudflareAccounts} way={chosen} onChange={setWay} disabled={running} />
          <CheckLabel>
            <Switch checked={unlisted} disabled={running} onCheckedChange={setUnlisted} />
            {p.unlisted}
          </CheckLabel>
        </>
      )}
      {host === 'manual' && (
        <div className={K.cfgSubClass}>
          {sub(c.siteUrl, <Input className={pathClass} aria-label={c.siteUrl} placeholder="https://demos.example.com" spellCheck={false} value={manual.url} disabled={running} onChange={(e) => setManual({ ...manual, url: e.target.value })} />)}
          {sub(c.siteDeploy, <Input className={pathClass} aria-label={c.siteDeploy} placeholder="bunx wrangler@4 pages deploy {dir} --project-name demos" spellCheck={false} value={manual.deploy} disabled={running} onChange={(e) => setManual({ ...manual, deploy: e.target.value })} />)}
          {sub(c.siteEnv, <Input className={pathClass} aria-label={c.siteEnv} placeholder="sites/demos/deploy.env" spellCheck={false} value={manual.env} disabled={running} onChange={(e) => setManual({ ...manual, env: e.target.value })} />)}
          {sub(c.siteMaxFile, <Input className={pathClass} type="number" min={1} aria-label={c.siteMaxFile} placeholder="25" value={manual.maxFile} disabled={running} onChange={(e) => setManual({ ...manual, maxFile: e.target.value })} />)}
        </div>
      )}
      {host === 'cloudflare' && unlisted && <p className="hint">{p.unlistedNote}</p>}
      {host !== 'github' && (
        <>
          <p className="hint">{p.checkNote}</p>
          <div className={K.cfgPersonalActionsClass}>
            <Button variant="primary" disabled={running || !ready} onClick={() => void add(host)}>
              {running ? p.adding : p.addGo}
            </Button>
            {onCancel && !running && (
              <Button onClick={onCancel}>
                {p.cancel}
              </Button>
            )}
          </div>
        </>
      )}
      {job && job.running && job.lines.length > 0 && <p className={installHintClass}>{job.lines.at(-1)}</p>}
      {job?.error && !job.running && (
        <p className="p-error">
          {p.failed} {job.error}
        </p>
      )}
      {job?.error && !job.running && job.offer === 'cloudflare' && (
        <Button size="small" onClick={() => void add('cloudflare')}>
          {p.tryCloudflare}
        </Button>
      )}
      {!connecting ? (
        <p className="hint personal-connect">
          <LinkButton onClick={() => setConnecting(true)}>
            {p.connect}
          </LinkButton>{' '}
          · {p.connectIntro}
        </p>
      ) : (
        <Field label={p.connect} hint={p.connectHint}>
          <Textarea mono className={pathClass} rows={3} spellCheck={false} placeholder="seismic-site:…" aria-label={p.connect} value={code} onChange={(e) => setCode(e.target.value)} />
          <div className={K.cfgPersonalActionsClass}>
            <Button
              disabled={!code.trim()}
              onClick={async () => {
                const before = new Set(view.sites.map((x) => x.url));
                let added: string | undefined;
                if (
                  await act(async () => {
                    const v = await api.connectDemoSite(code);
                    added = v.sites.find((x) => !before.has(x.url))?.url;
                    return v;
                  })
                ) {
                  setCode('');
                  setConnecting(false);
                  if (added) onAdded?.(added);
                }
              }}
            >
              {p.connectGo}
            </Button>
          </div>
        </Field>
      )}
      {status && <p className="p-error">{status}</p>}
    </div>
  );
}

/**
 * "Configure publishing site": adding a demo site as a page of its own, in place of the Demos
 * section, with the way back to it; back there once the site is on the list.
 */
function AddSitePage({ on, onBack: back }: { on: boolean; onBack: () => void }) {
  const [view, setView] = useDemoSites(on);
  const p = t.config.sites;
  
  const onBack = () => {
    sessionStorage.setItem(SITES_SHOW_KEY, '1');
    back();
  };
  return (
    <div className="add-site-page">
      <LinkButton type="button" className="add-site-back inline-block m-0 mb-3 text-sm" onClick={onBack}>
        ← {p.back}
      </LinkButton>
      <Head title={p.add} hint={p.addHint} />
      {view && (
        <div className={narrowClass}>
          <AddSite view={view} onView={setView} onAdded={onBack} onCancel={onBack} />
        </div>
      )}
    </div>
  );
}


const narrowClass = 'cfg-narrow max-w-[620px] [&>.hint]:my-1.5 [&>.hint]:mx-0';

/** A site's address as the owner reads it. */
const siteLabel = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/**
 * Configuration → Demos: the demo sites this machine publishes to, each with its host, whether it
 * is listed, the projects' paths on it, the code for another machine and removing it from this
 * machine; and "Add a demo site".
 */
function DemoSitesBlock({ on, onAdd }: { on: boolean;  onAdd: () => void }) {
  const [view, setView] = useDemoSites(on);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copied, copy] = useCopy(1500);
  const [copiedUrl, setCopiedUrl] = useState('');
  
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const p = t.config.sites;
  const box = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!on || !view || !sessionStorage.getItem(SITES_SHOW_KEY)) return;
    sessionStorage.removeItem(SITES_SHOW_KEY);
    
    const at = setTimeout(() => box.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }), 400);
    return () => clearTimeout(at);
  }, [on, !!view]);
  
  
  const job = view?.job;
  useEffect(() => {
    const mine = sessionStorage.getItem(ADD_MINE_KEY);
    if (!on || !view || !mine || (job?.id === mine && job.running)) return;
    const ours = job?.id === mine ? job.site : undefined;
    if (ours && view.sites.find((x) => x.url === ours)?.git) {
      onAdd();
      return;
    }
    sessionStorage.removeItem(ADD_MINE_KEY);
    if (ours) void api.demoSitesSeen().then(setView, console.error);
  }, [on, !!view, job?.id, job?.running, job?.site]);
  const urls = view?.sites.map((x) => x.url).join(' ') ?? '';
  useEffect(() => {
    for (const x of view?.sites ?? []) if (!codes[x.url]) api.demoSiteCode(x.url).then((r) => setCodes((now) => ({ ...now, [x.url]: r.code })), console.error);
  }, [urls]);
  if (!view) return null;
  return (
    <div className="personal-site mt-8" ref={box}>
      <Head title={p.title} hint={p.hint} />
      <div className={narrowClass}>
        {view.sites.map((x) => (
          <div key={x.url} className="demo-site py-2.5 px-0 border-b border-b-border first-of-type:pt-0 [&>.hint]:my-0.5 [&>.hint]:mx-0">
            <p className="personal-url text-base m-0 mb-1.5">
              <a className={K.cfgLinkClass} href={x.url} target="_blank" rel="noreferrer">
                {siteLabel(x.url)}
              </a>
              <span className="hint">
                {' '}
                · {x.host && x.project ? p.at(p.hostNames[x.host], x.git ? p.github.folderOf(x.project, x.git.folder) : x.project) : p.byHand} · {x.listed ? p.listed : p.unlistedShort}
              </span>
            </p>
            {x.git && x.project && <PublishMode url={x.url} repo={x.project} git={x.git} onChanged={setView} />}
            {x.paths.length > 0 && <p className="hint">{p.usedBy(x.paths.map((path) => (path ? `/${path}` : p.root)).join(', '))}</p>}
            {x.needs && <p className="p-error">{p.needs(x.needs)}</p>}
            <div className={K.cfgPersonalActionsClass}>
              <Button
                size="small"
                title={p.codeHint}
                disabled={!codes[x.url]}
                onClick={() => {
                  copy(codes[x.url]!);
                  setCopiedUrl(x.url);
                }}
              >
                {copied && copiedUrl === x.url ? p.copied : p.code}
              </Button>
              {removing !== x.url ? (
                <Button size="small" title={p.removeHint} onClick={() => setRemoving(x.url)}>
                  {p.remove}
                </Button>
              ) : (
                <>
                  <Button
                    variant="danger" size="small"
                    onClick={async () => {
                      setRemoving(null);
                      setStatus('');
                      try {
                        setView(await api.removeDemoSite(x.url));
                      } catch (e) {
                        setStatus(failText(e));
                      }
                    }}
                  >
                    {p.removeConfirm}
                  </Button>
                  <Button size="small" onClick={() => setRemoving(null)}>
                    {t.config.reset}
                  </Button>
                </>
              )}
            </div>
            {removing === x.url && <p className="hint">{p.removeWarning}</p>}
          </div>
        ))}
        {!view.sites.length && <p className="hint">{p.none}</p>}
        <Button className="[.demo-site+&]:mt-3" onClick={onAdd}>
          {view.job?.running ? p.adding : p.add}
        </Button>
        {status && <p className="p-error">{status}</p>}
      </div>
    </div>
  );
}


const siteInitHintClass = cn(K.cfgSubHintClass, 'my-1 mx-0');

/** Whether a path is one a project may have on a site: lower-case parts with hyphens, `/` between up to three; '' for the root. */
const sitePathOk = (path: string) => path === '' || /^[a-z0-9][a-z0-9-]{0,40}(\/[a-z0-9][a-z0-9-]{0,40}){0,2}$/.test(path);

/** A path as typed, as it is kept: without slashes at either end. */
const tidyPath = (path: string) => path.trim().replace(/^\/+|\/+$/g, '');

/**
 * A project's demo site, under Demos in Project settings: one of this machine's sites, its path
 * there, "Initialize" until the path is on the site ("Creating demo site" in the status bar
 * meanwhile), the vocabulary of tags and when a demo goes on the site. `project`: the
 * project's id where it runs (Initialize needs it). Path and tags take effect when the field is left.
 */
export function ProjectSiteField({ project, value, onChange, homePath, language, bare, onAddSite = showAddSite }: { project: string | undefined; value: ProjectDemoSite | null | undefined; onChange: (v: ProjectDemoSite | null) => void;  homePath?: string; language: NarrationLanguage | null;  bare?: boolean;  onAddSite?: () => void }) {
  const [view] = useDemoSites(true);
  const [path, setPath] = useState(value?.path ?? '');
  const [init, setInit] = useState<ProjectDemoSiteState | null>(null);
  const [status, setStatus] = useState('');
  const l = t.config.projectSite;
  const c = t.config.settings;
  useEffect(() => setPath(value?.path ?? ''), [value?.url, value?.path]);
  
  const running = !!init?.init?.running;
  useEffect(() => {
    if (!project) return;
    const look = () =>
      api.projectSite(project).then((s) => {
        setInit(s);
        if (!s?.init?.running) void loadSites();
      }, console.error);
    void look();
    if (!running) return;
    const timer = setInterval(look, 1000);
    return () => clearInterval(timer);
  }, [project, running]);
  const url = value?.url ?? '';
  const site = view?.sites.find((x) => x.url === url);
  const typed = tidyPath(path);
  const pathOk = sitePathOk(typed);
  const ready = !!site && site.paths.includes(typed);
  const commitPath = () => {
    if (value && pathOk && typed !== (value.path ?? '')) {
      const { path: _, ...rest } = value;
      onChange(typed ? { ...rest, path: typed } : rest);
    }
  };
  const failed = init?.url === url && init.path === typed && !init.init?.running ? init.init?.error : undefined;
  const where = site ? `${siteLabel(site.url)}/${typed ? `${typed}/` : ''}` : '';
  const controls = (
    <div className={cn(K.cfgSubClass, 'project-site')}>
      <label className="wide">
        {!bare && <span className={K.cfgSubHintClass}>{l.label}</span>}
        <Select
          className="[#project-settings_&]:text-muted-foreground"
          aria-label={l.label}
          value={url}
          disabled={running}
          onValueChange={(picked) => {
            setStatus('');
            if (picked === '+') return onAddSite();
            onChange(picked ? { url: picked, ...(value?.publish ? { publish: value.publish } : {}), ...(value?.tags ? { tags: value.tags } : {}), ...(typed ? { path: typed } : {}) } : null);
          }}
        >
          <SelectItem value="">{l.none}</SelectItem>
          {view?.sites.map((x) => (
            <SelectItem key={x.url} value={x.url}>
              {siteLabel(x.url)}
            </SelectItem>
          ))}
          {url && !site && view && <SelectItem value={url}>{siteLabel(url)}</SelectItem>}
          <SelectItem value="+">{l.addNew}</SelectItem>
        </Select>
      </label>
      {url && view && !site && <p className="p-error wide">{l.missing}</p>}
      {url && site && (
        <>
          <label className="wide">
            <span className={K.cfgSubHintClass}>{l.path}</span>
            <Input
              className={pathClass}
              aria-label={l.path}
              placeholder={l.pathPlaceholder}
              spellCheck={false}
              value={path}
              disabled={running}
              onChange={(e) => setPath(e.target.value)}
              onBlur={commitPath}
              onKeyDown={(e) => e.key === 'Enter' && commitPath()}
            />
          </label>
          {!pathOk && <p className="p-error wide">{l.pathBad}</p>}
          {pathOk && (
            <div className="wide site-init">
              {ready ? (
                <p className={siteInitHintClass}>
                  {l.ready}{' '}
                  <a className={K.cfgLinkClass} href={`${site.url}/${typed ? `${typed}/` : ''}`} target="_blank" rel="noreferrer">
                    {where}
                  </a>
                </p>
              ) : (
                <>
                  <p className="p-error">{l.needsSetup}</p>
                  <div className="personal-actions flex gap-2 items-center mt-1.5 mx-0 mb-0.5">
                    <Button
                      variant="primary"
                      title={l.initHint(where)}
                      disabled={running || !project || !!site.needs}
                      onClick={async () => {
                        setStatus('');
                        commitPath();
                        try {
                          setInit(await api.initProjectSite(project!, url, typed));
                        } catch (e) {
                          setStatus(failText(e));
                        }
                      }}
                    >
                      {running ? l.initializing : l.initialize}
                    </Button>
                  </div>
                  {!project && <p className={siteInitHintClass}>{l.saveFirst}</p>}
                  {site.needs && <p className="p-error">{t.config.sites.needs(site.needs)}</p>}
                </>
              )}
              {failed && (
                <p className="p-error">
                  {l.failed} {failed}
                </p>
              )}
            </div>
          )}
          { }
          {ready && (
            <>
          <label className="wide">
            <span className={K.cfgSubHintClass}>{c.siteTags}</span>
            <TagLines tags={value?.tags} placeholder={c.siteTagsPlaceholder} label={c.siteTags} onChange={(tags) => value && onChange(tags ? { ...value, tags } : (({ tags: _, ...rest }) => rest)(value))} />
          </label>
          {homePath && <TagProposal path={homePath} current={value?.tags} language={language} onTags={(tags) => value && onChange(tags ? { ...value, tags } : (({ tags: _, ...rest }) => rest)(value))} />}
          { }
          <div className="wide">
            <span className={K.cfgSubHintClass}>{c.sitePublish}</span>
            <SegmentedControl
              label={c.sitePublish}
              value={value?.publish ?? 'click'}
              onValueChange={(x) => value && onChange(x === 'approved' ? { ...value, publish: x } : (({ publish: _, ...rest }) => rest)(value))}
              options={(['click', 'approved'] as const).map((x) => ({ value: x, label: c.sitePublishes[x] }))}
            />
          </div>
            </>
          )}
        </>
      )}
      {status && <p className="p-error wide">{status}</p>}
    </div>
  );
  if (bare) return controls;
  return (
    <Field label={l.label} hint={l.hint}>
      {controls}
    </Field>
  );
}


const KEEP_CHOICES = [7, 14, 30, 90, 'always'] as const;

/**
 * How long a demo's frames stay after its last render, and what the demos take on disk: counted on the
 * server, which the section follows while it counts. Choosing what applies anyway names nothing.
 */
function KeepFrames({ space, value, onChange }: { space: DemoSpaceView; value: DemoSettings['keepFrames']; onChange: (v: DemoSettings['keepFrames']) => void }) {
  const d = t.config.demo;
  const fallback = space.defaultDays ?? 'always';
  const shown = value ?? fallback;
  const choices = KEEP_CHOICES.some((c) => c === shown) ? KEEP_CHOICES : [...KEEP_CHOICES.slice(0, -1), shown, 'always' as const].sort((a, b) => (a === 'always' ? 1 : b === 'always' ? -1 : a - b));
  const label = (c: number | 'always') => (c === fallback ? d.keepDefault(d.keepFor(c)) : d.keepFor(c));
  const { used, freed, busy } = space;
  return (
    <Field label={<>{d.keepFrames} <Info text={d.keepFramesInfo} /></>}>
      <Select
        aria-label={d.keepFrames}
        value={String(shown)}
        onValueChange={(picked) => {
          const v = picked === 'always' ? 'always' : Number(picked);
          onChange(v === fallback ? undefined : v);
        }}
      >
        {choices.map((c) => (
          <SelectItem key={c} value={String(c)}>
            {label(c)}
          </SelectItem>
        ))}
      </Select>
      <p className="hint">
        {used ? d.used(fileSize(used.bytes), fileSize(used.work)) : d.counting}
        {used && busy && ` ${d.recounting}`}
      </p>
      {freed && <p className="hint">{d.freed(snoozeWhen(freed.at), freed.demos, fileSize(freed.bytes))}</p>}
    </Field>
  );
}

/**
 * What a render needs on this machine besides the voice (that has its own lines above), each
 * missing piece with how to install it here. Checked again after an installation, and on request.
 */
function SetupBlock({ draft, installing }: { draft: DemoSettings; installing: boolean }) {
  const [setup, setSetup] = useState<SetupCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const s = t.config.setup;
  const recheck = () => {
    setChecking(true);
    return api
      .demoSetup(draft)
      .then(setSetup, console.error)
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    if (!installing) recheck();
  }, [installing]);
  if (!setup) return null;
  const items = setup.items.filter((i) => i.id !== 'voice');
  return (
    <div className="c-setup">
      <Head sub title={s.title} hint={s.hint(platformName(setup))} />
      <SetupList items={items} name={(i) => s.names[i.id]} state={demoState} />
      {!items.some((i) => i.state === 'missing') && <p className="hint">{s.ready}</p>}
      <p className="hint">
        {s.guide} <code>docs/demo-setup.md</code>
      </p>
      <Button size="small" disabled={checking} onClick={recheck}>
        {checking ? s.checking : s.recheck}
      </Button>
    </div>
  );
}

/**
 * What the owner's voice input needs on this machine, with one button that loads the speech
 * recognition (fetching it the first time) and measures it, and a cloud service instead. Follows
 * an installation until it ends.
 */
function VoiceBlock({ on }: { on: boolean }) {
  const [view, setView] = useState<VoiceSetupView | null>(null);
  const [status, setStatus] = useState('');
  const [checking, setChecking] = useState(false);
  const recheck = () => {
    setChecking(true);
    return api
      .voiceSetup()
      .then(setView, console.error)
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    if (on) recheck();
  }, [on]);
  const running = !!view?.job?.running;
  useEffect(() => {
    if (!on || !running) return;
    const timer = setInterval(() => api.voiceSetup().then(setView, console.error), 1500);
    return () => clearInterval(timer);
  }, [on, running]);
  if (!view) return null;
  const v = t.config.voice;
  const s = t.config.setup;
  const install = async () => {
    setStatus('');
    try {
      setView(await api.installVoice());
    } catch (e) {
      setStatus(failText(e));
    }
  };
  const blocked = view.items.some((i) => i.state === 'missing');
  return (
    <div className="c-setup">
      <Head title={v.title} hint={v.hint(platformName(view))} />
      <SetupList items={view.items} name={(i) => v.names[i.id]} state={voiceState} action={(i) => i.id === 'recognition' && <RecognitionDetail item={i} busy={running} changed={recheck} />} />
      {view.listen === 'faster' && <p className="hint">{v.faster}</p>}
      {view.job?.running ? (
        <p className={installHintClass}>
          <span className="c-step">{v.step[view.job.step]}</span>
        </p>
      ) : view.fetch.mb ? (
        <div className={installClass}>
          <Button size="small" disabled={blocked} onClick={install}>
            {v.install(fileSize(view.fetch.mb * 1e6))}
          </Button>
        </div>
      ) : (
        !blocked && <p className="hint">{v.ready}</p>
      )}
      {view.job?.error && !view.job.running && <p className="p-error">{v.failed(view.job.error.split('\n').at(-1) ?? '')}</p>}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
      <Button size="small" disabled={checking || running} onClick={recheck}>
        {checking ? s.checking : s.recheck}
      </Button>
    </div>
  );
}

interface ProjectProps {
  n: number;
  
  showProject: (n: number) => (() => void) | undefined;
  project: EntryDraft;
  
  configure?: boolean | undefined;
  
  checking: boolean;
  resolved: ConfigChecked['resolved'][number];
  running: string[];
  
  pin?: string;
  problems: ConfigProblem[];
  
  ask?: Ask;
  onRecheck: () => Promise<void>;
  onChange: (c: EntryDraft) => void;
}

/**
 * The project's icon beside its name: a button that shows it (the branch while it has none) and opens
 * the picker in a pane under it, the curated icons first, then the emoji.
 */
function ProjectIconField({ icon, onChange }: { icon: string | undefined; onChange: (icon: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<IconPickerView>({});
  return (
    
    <Popover modal open={open} onOpenChange={setOpen}>
      <Tooltip content={t.config.projectIcon}>
        <PopoverTrigger asChild>
          <Button type="button" className="cfg-project-icon size-9 flex-none p-0" aria-label={t.config.projectIcon}>
            <ProjectIcon icon={icon} size={18} />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      { }
      <PopoverContent align="start" className="flex w-[min(460px,calc(100vw-16px))] flex-col !overflow-hidden px-4 pt-3.5 pb-3">
        <IconPicker
          className="min-h-0 flex-[0_1_auto]"
          icon={icon ?? null}
          view={view}
          panelClassName="!flex-[0_1_340px]"
          onChange={({ icon: picked, ...v }) => {
            setView((was) => ({ ...was, ...v }));
            if (picked !== undefined) onChange(picked);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A project's entry in the configuration: its name and icon, old names, then its repositories with
 * their paths. "Configuration" in its settings sheet edits it, and "+ New project" a new one.
 */
export function ProjectBlock({ n, project, configure, checking, resolved, running, pin, problems, ask, onRecheck, onChange, showProject }: ProjectProps) {
  const fresh = resolved && !running.includes(resolved.id);
  
  const askHere = ask && ((text: string) => ask(text, resolved && running.includes(resolved.id) ? resolved.id : undefined));
  const here = t.config.project(n + 1);
  const setRepo = (i: number, r: RepoConfig | null) => onChange({
    ...project,
    repos: r ? project.repos.map((x, j) => j === i ? { ...r, originalPath: x.originalPath } : x) : project.repos.filter((_, j) => j !== i),
  });
  
  const [tab, setAt] = useState(0);
  const at = Math.min(tab, project.repos.length - 1);
  const repo = project.repos[at];
  
  const worker = useWorkerConfiguration();
  const harness = worker ? projectAgentSetting('worker', worker.agents.worker, project.agents, worker.harnesses).harness : undefined;
  const gitOnly = needsGit(harness) ? harness : undefined;
  return (
    <div className="cfg-project pb-2">
      {resolved && fresh && <p className={cn(idClass(true), 'mt-0')}>{projectPath(resolved.id)} · {t.config.fresh}</p>}
      {checking && <p className="hint">{t.config.checking}</p>}
      <Field label={t.config.name} hint={fresh ? t.config.freshHint : undefined}>
        <div className="flex max-w-[420px] items-center gap-2">
        <ProjectIconField
          icon={project.icon}
          onChange={(icon) => {
            const { icon: _, ...rest } = project;
            const kept = pin && !rest.id ? { ...rest, id: pin } : rest;
            onChange(icon ? { ...kept, icon } : kept);
          }}
        />
        <Input
          className="cfg-name min-w-0 flex-1"
          aria-label={t.config.name}
          value={project.name ?? ''}
          placeholder={resolved && !project.name ? t.config.nameAuto(resolved.name) : t.config.name}
          onChange={(e) => {
            const { name: _, ...rest } = project;
            const kept = pin && !rest.id ? { ...rest, id: pin } : rest;
            onChange(e.target.value ? { ...kept, name: e.target.value } : kept);
          }}
        />
        </div>
        {problems
          .filter((p) => NAME_PROBLEMS.includes(p.code))
          .map((p, k) => (
            <Problem key={k} problem={p} where={here} onShow={p.ofProject === undefined ? undefined : showProject(p.ofProject)} />
          ))}
      </Field>
      {!!project.oldNames?.length && (
        <OldNames
          names={project.oldNames}
          onDelete={(name) => {
            const { oldNames: _, ...rest } = project;
            const left = project.oldNames!.filter((n) => n !== name);
            onChange(left.length ? { ...rest, oldNames: left } : rest);
          }}
        />
      )}
      {problems
        .filter((p) => p.repo === undefined && !NAME_PROBLEMS.includes(p.code))
        .map((p, k) => (
          <Problem key={k} problem={p} where={here} ask={askHere} retried={askHere && onRecheck} />
        ))}
      {configure && <CodeReviewField value={project.codeReviews} onChange={(codeReviews) => onChange({ ...project, codeReviews })} />}
      { }
      <Tabs value={String(at)} onValueChange={(v) => setAt(Number(v))}>
      <Field label={t.config.repos}>
        <div className="cfg-repo-tabs flex flex-wrap items-center gap-y-2 gap-x-3">
            <TabsList variant="segmented" aria-label={t.config.repos}>
              {project.repos.map((r, i) => {
                const k = problems.filter((p) => p.repo === i).length;
                return (
                  <TabsTrigger key={i} value={String(i)}>
                    {repoName(r, resolved?.repos[i])}
                    {k > 0 && <Badge variant="count" tone="destructive" className="ml-1.5">{k}</Badge>}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          <Button
            size="small"
            onClick={() => {
              onChange({ ...project, repos: [...project.repos, { path: '', originalPath: null }] });
              setAt(project.repos.length);
            }}
          >
            {t.config.addRepo}
          </Button>
        </div>
      </Field>
      {repo && (
        <TabsContent value={String(at)}>
        <RepoRow
          key={at}
          repo={repo}
          configure={configure}
          gitOnly={gitOnly}
          home={at === 0}
          resolved={resolved?.repos[at]}
          problems={problems.filter((p) => p.repo === at)}
          where={`${here}, ${t.config.repoAt(repo.path)}`}
          ask={askHere}
          onRecheck={onRecheck}
          onChange={(x) => {
            setRepo(at, x);
            if (!x) setAt(Math.max(0, at - 1));
          }}
        />
        </TabsContent>
      )}
      </Tabs>
    </div>
  );
}

interface RepoProps {
  repo: RepoConfig;
  configure?: boolean | undefined;
  
  gitOnly?: 'codex' | 'agy' | undefined;
  home: boolean;
  resolved?: ResolvedProject['repos'][number];
  problems: ConfigProblem[];
  
  where: string;
  ask?: (text: string) => void;
  
  onRecheck: () => Promise<void>;
  onChange: (r: RepoConfig | null) => void;
}

/** A repository's name on its tab: its id once checked, else its folder's name. */
export const repoName = (repo: RepoConfig, resolved: ResolvedProject['repos'][number] | undefined) => resolved?.id ?? (repo.path.trim().split(/[\\/]/).filter(Boolean).pop() || t.config.newRepo);


export interface Takeover {
  saved: boolean;
  
  onReload: () => Promise<void>;
  
  prepare?: () => Promise<boolean>;
}

/** `repo` with its field `k` set to `v`, or without it where `v` is undefined. */
function withField<K extends keyof RepoConfig>(repo: RepoConfig, k: K, v: RepoConfig[K] | undefined): RepoConfig {
  const next = { ...repo };
  if (v === undefined) delete next[k];
  else next[k] = v;
  return next;
}

function RepoRow({ repo, configure, gitOnly, home, resolved, problems, where, ask, onRecheck, onChange }: RepoProps) {
  
  const folder = repo.git === false;
  
  return (
    <section className="cfg-repo mt-2 pt-2.5 border-t border-t-border [&>.c-row]:mt-1.5 [&>.c-row]:mb-1 [&>.c-row]:max-w-[900px]">
      <Field label={t.config.path} hint={home || folder ? [...(home ? [t.config.home] : []), ...(folder ? [t.config.folderMode] : [])].join(' · ') : undefined}>
        <div className="cfg-repo-path flex items-center gap-3 max-w-[664px] [&>.c-del]:ml-0">
          <Input className={pathClass} aria-label={t.config.path} value={repo.path} placeholder={t.config.path} spellCheck={false} onChange={(e) => {
              
              const { git: _, ...rest } = repo;
              onChange({ ...rest, path: e.target.value });
            }} />
          <RemoveButton label={t.config.removeRepo} onClick={() => onChange(null)} />
        </div>
      </Field>
      <RepoProblems repo={repo} resolved={resolved} problems={problems} where={where} ask={ask} onRecheck={onRecheck} gitOnly={gitOnly} onFolder={() => onChange({ path: repo.path, git: false, ...(repo.settings ? { settings: repo.settings } : {}) })} />
      {configure && resolved && !folder && (
        <>
          <div className={K.cfgGroupClass()}>
            <h5 className={K.cfgGroupHeadClass}>{t.config.groups.landing}</h5>
            <RepoSettingRows
              at={repoSettingsAt(repo.settings, resolved.values, (settings) => onChange(withField(repo, 'settings', settings)))}
              keys={REPO_SETTING_GROUPS.landing.filter((key) => key !== 'softPaths')}
            />
          </div>
          <Workstations repo={repo} resolved={resolved} onChange={onChange} />
        </>
      )}
    </section>
  );
}

/**
 * What is wrong with a repository, each problem with what fixes it where it can be fixed here:
 * setting up git in a folder without it, trusting the repository's commands.
 */
export function RepoProblems({ repo, resolved, problems, where, ask, onRecheck, gitOnly, onFolder }: { repo: RepoConfig; resolved: ResolvedProject['repos'][number] | undefined; problems: ConfigProblem[]; where: string; ask?: ((text: string) => void) | undefined; onRecheck: () => Promise<void>;  gitOnly?: 'codex' | 'agy' | undefined;  onFolder?: () => void }) {
  
  const noGit = useFolderWithoutGit(problems.some((p) => p.code === 'notRepo') ? repo.path.trim() : '');
  return (
    <>
      {problems.map((p, k) => (
        <div key={k} className="cfg-repo-problem mt-0.5 mx-0 mb-2">
          <Problem problem={p} where={where} ask={ask} retried={ask && onRecheck} />
          {p.code === 'notRepo' && noGit && onFolder && <GitSetup key={noGit} path={noGit} confirm={t.setup.git.confirm} gitOnly={gitOnly} onDone={onRecheck} onFolder={onFolder} />}
          {p.code === 'untrusted' && resolved?.trust && <TrustCommands path={repo.path} trust={resolved.trust} onDone={onRecheck} />}
        </div>
      ))}
    </>
  );
}

/** Where a repository's agents work as its entry has it (`workIn`), and what that rests on. */
export function workPlace(repo: RepoConfig, resolved: ResolvedProject['repos'][number] | undefined) {
  
  const landsHere = (repo.settings?.land ?? resolved?.values.land.value) === 'main';
  const itself = (w: string) => landsHere && w.trim().replace(/\/+$/, '') === repo.path.trim().replace(/\/+$/, '');
  
  const named = !!repo.clones || (repo.workstations ?? []).some((w) => w.trim() && !itself(w)) || !!repo.hosts?.length;
  const base = resolved?.values.workstations;
  
  const known = base && base.source !== 'clones' ? base.value : undefined;
  const own = repo.settings?.workstations;
  const workIn: 'clones' | 'worktrees' = named ? 'clones' : (own ?? known ?? resolved?.workstations ?? 'worktrees');
  return { itself, named, base, known, own, workIn };
}






export const Workstations = forwardRef<HTMLDivElement, { repo: RepoConfig; resolved: ResolvedProject['repos'][number] | undefined; flash?: boolean; onChange: (r: RepoConfig) => void }>(function Workstations({ repo, resolved, flash = false, onChange }, ref) {
  const folder = repo.git === false;
  const { itself, named, base, known, own, workIn } = workPlace(repo, resolved);
  const clones = !folder && workIn === 'clones';
  const existing = useRef<HTMLTextAreaElement>(null);
  const existingText = (repo.workstations ?? []).join('\n');
  useFitHeight(existing, existingText, clones);
  
  const setWorkIn = (mode: 'clones' | 'worktrees') => {
    if (mode === workIn) return;
    const { workstations: _, ...others } = repo.settings ?? {};
    const settings = known === mode ? others : { ...others, workstations: mode };
    let next = withField(repo, 'settings', Object.keys(settings).length ? settings : undefined);
    next = mode === 'worktrees' ? parkClones(next) : restoreClones(next);
    onChange(next);
  };
  if (folder || (!resolved && !clones)) return null;
  const source = named ? t.config.settings.source.clones : own !== undefined ? t.config.settings.source.machine : base ? t.config.settings.source[base.source] : undefined;
  const listed = (repo.workstations ?? []).filter((w) => w.trim() && !itself(w)).length;
  
  const leaving = resolved?.leaving?.length ? <p className="hint cfg-clone-leaving">{t.config.cloneLeaving(resolved.leaving.map((c) => (c.card ? { ...c, card: plain(c.card) } : c)))}</p> : null;
  const slots = (hint: string, placeholder: string) => (
    <Field className="cfg-slots" label={<>{t.config.slots} <Info text={hint} /></>}>
      <Input className="w-20" type="number" min={0} max={20} aria-label={t.config.slots} placeholder={placeholder} value={repo.slots ?? ''} onChange={(e) => onChange(withField(repo, 'slots', slotsOf(e.target.value)))} />
      {leaving}
    </Field>
  );
  return (
    <div ref={ref} className={K.cfgGroupClass(flash)}>
      <h5 className={K.cfgGroupHeadClass}>{t.config.groups.workstations}</h5>
      <div className={cn(K.cfgSettingClass, 'cfg-has-info')}>
        <div className={K.cfgSettingLabelClass}>
          {t.config.settings.workstations}
          {source && <span className={K.cfgSourceClass(source === t.config.settings.source.machine)}>{source}</span>}
          <Info text={t.config.settings.workstationsHint} />
        </div>
        <div className={K.cfgControlClass}>
          <SegmentedControl
            label={t.config.settings.workstations}
            value={workIn}
            onValueChange={setWorkIn}
            options={(['worktrees', 'clones'] as const).map((x) => ({ value: x, label: t.config.settings.workIn[x] }))}
          />
        </div>
      </div>
      {clones ? (
        <>
          <Field label={t.config.workstations}>
            <Textarea mono
              ref={existing}
              className="cfg-existing w-full max-w-[640px] resize-none overflow-y-hidden"
              rows={2}
              spellCheck={false}
              aria-label={t.config.workstations}
              value={existingText}
              onChange={(e) => {
                const list = e.target.value.split('\n');
                onChange(withField(repo, 'workstations', list.some((w) => w.trim()) ? list : undefined));
              }}
            />
            {(repo.workstations ?? []).some(itself) && <p className="hint">{t.config.cloneIsRepo}</p>}
          </Field>
          <Field className="cfg-clone-count" label={<>{t.config.clones} <Info text={t.config.clonesHint} /></>}>
            <Input className="w-20" type="number" min={0} max={20} aria-label={t.config.clones} placeholder="0" value={repo.clones ?? ''} onChange={(e) => onChange(withField(repo, 'clones', Number(e.target.value) || undefined))} />
            {listed + (repo.clones ?? 0) + (repo.hosts ?? []).reduce((n, h) => n + h.clones, 0) === 0 ? (
              <p className="hint warn">{t.config.noClones}</p>
            ) : (
              <p className="hint">{t.config.cloneTotal(listed, repo.clones ?? 0)}</p>
            )}
          </Field>
          {slots(t.config.slotsHint, t.config.slotsAll)}
          <Field className="cfg-wide [&>.cfg-control]:max-w-[900px]" label={<>{t.config.hosts} <Info text={t.config.hostsHint} /></>}>
            <Hosts hosts={repo.hosts ?? []} onChange={(hosts) => onChange(withField(repo, 'hosts', hosts.length ? hosts : undefined))} />
          </Field>
        </>
      ) : (
        slots(t.config.slotsWorktreesHint, t.config.slotsAny)
      )}
    </div>
  );
});





export type SettingKey = Exclude<keyof RepoSettings, NestedSetting> | 'run' | 'stop' | 'keep' | 'demoLanguage' | 'artifacts';

/** The setting of `app` or `demo` that holds `k`, and its field there, if one does. */
function nestedOf(k: SettingKey): [NestedSetting, string] | undefined {
  if (k === 'demoLanguage') return ['demo', 'language'];
  if (k === 'artifacts') return ['demo', 'artifacts'];
  if (k === 'language') return undefined;
  const n = (Object.keys(NESTED_SETTINGS) as NestedSetting[]).find((n) => (NESTED_SETTINGS[n] as readonly string[]).includes(k));
  return n && [n, k];
}


export const REPO_SETTING_GROUPS = {
  landing: ['branch', 'land', 'direct', 'autoMerge', 'prNoise', 'softPaths'],
  app: ['setup', 'checks', 'run', 'stop', 'keep'],
  plans: ['planDocs', 'language'],
  demos: ['demoLanguage', 'artifacts'],
} as const satisfies Record<string, readonly SettingKey[]>;






export interface RepoSettingsAt {
  
  value: <T>(k: SettingKey) => T;
  
  own: (k: SettingKey) => unknown;
  
  set: (k: SettingKey, v: unknown) => void;
  base: Record<SettingKey, SettingValue<unknown>>;
  
  shown?: string | null;
}

export function repoSettingsAt(settings: RepoSettings | undefined, values: RepoValues, onChange: (s: RepoSettings | undefined) => void, shown?: string | null): RepoSettingsAt {
  const s = settings ?? {};
  const { app: _, demo: __, ...flat } = values;
  const base: Record<SettingKey, SettingValue<unknown>> = { ...flat, ...values.app, demoLanguage: values.demo.language, artifacts: values.demo.artifacts };
  const own = (k: SettingKey): unknown => {
    const n = nestedOf(k);
    return n ? (s[n[0]] as Record<string, unknown> | undefined)?.[n[1]] : s[k as keyof RepoSettings];
  };
  const value = <T,>(k: SettingKey) => (own(k) ?? base[k].value) as T;
  const set = (k: SettingKey, v: unknown) => {
    const next: Record<string, unknown> = { ...s };
    const n = nestedOf(k);
    const at: Record<string, unknown> = n ? { ...s[n[0]] } : next;
    const field = n?.[1] ?? k;
    if (v === undefined) delete at[field];
    else at[field] = v;
    if (n) {
      if (Object.keys(at).length) next[n[0]] = at;
      else delete next[n[0]];
    }
    onChange(Object.keys(next).length ? (next as RepoSettings) : undefined);
  };
  return { value, own, set, base, shown: shown ?? null };
}

/** Repository settings in the order given, each where it applies (landing's options while work goes out as a pull request, say). */
export function RepoSettingRows({ at, keys }: { at: RepoSettingsAt; keys: readonly SettingKey[] }) {
  return <>{keys.map((k) => <RepoSettingRow key={k} k={k} at={at} />)}</>;
}

/**
 * One setting of a repository: its label with where its value comes from (and "Reset" where it is
 * set here), its control and what to know about it; nothing where it does not apply.
 */
export function RepoSettingRow({ k, at }: { k: SettingKey; at: RepoSettingsAt }) {
  const c = t.config.settings;
  const { value, set } = at;
  const lines = (k: SettingKey) => value<string[]>(k).join('\n');
  const control = ((): [string, ReactNode, string?] | null => {
    switch (k) {
      case 'branch':
        return [c.branch, <Input className={pathClass} aria-label={c.branch} spellCheck={false} value={value<string>('branch')} onChange={(e) => set('branch', e.target.value)} />, c.branchHint];
      case 'land':
        return [c.land, <SegmentedControl label={c.land} value={value<'main' | 'pr'>('land') ?? 'main'} onValueChange={(x) => set('land', x)} options={(['main', 'pr'] as const).map((x) => ({ value: x, label: c.lands[x] }))} />, c.landHint];
      case 'direct':
        return value('land') !== 'pr' ? null : [c.direct, <CheckLabel><Switch checked={value<boolean>('direct')} onCheckedChange={(on) => set('direct', on)} />{c.directLabel}</CheckLabel>];
      case 'autoMerge':
        return value('land') !== 'pr' ? null : [c.autoMerge, <CheckLabel><Switch checked={value<boolean>('autoMerge')} onCheckedChange={(on) => set('autoMerge', on)} />{c.autoMergeLabel}</CheckLabel>, c.autoMergeHint];
      case 'prNoise':
        return value('land') !== 'pr' ? null : [c.prNoise, <Textarea mono rows={2} spellCheck={false} aria-label={c.prNoise} value={lines('prNoise')} onChange={(e) => set('prNoise', e.target.value.split('\n'))} />, c.prNoiseHint];
      case 'softPaths':
        return [c.softPaths, <Textarea mono rows={Math.max(2, value<string[]>('softPaths').length + 1)} spellCheck={false} aria-label={c.softPaths} value={lines('softPaths')} onChange={(e) => set('softPaths', e.target.value.split('\n'))} />, c.softPathsHint];
      case 'setup':
        return [c.setup, <Input className={pathClass} aria-label={c.setup} spellCheck={false} value={value<string>('setup')} onChange={(e) => set('setup', e.target.value)} />, c.setupHint];
      case 'checks':
        return [c.checks, <Textarea mono rows={Math.max(2, value<string[]>('checks').length + 1)} spellCheck={false} aria-label={c.checks} value={lines('checks')} onChange={(e) => set('checks', e.target.value.split('\n'))} />, c.checksHint];
      case 'run':
        return [c.run, <Textarea mono rows={Math.max(6, Math.ceil(value<string>('run').length / 70) + 1)} aria-label={c.run} placeholder={c.runPlaceholder} value={value<string>('run')} onChange={(e) => set('run', e.target.value)} />, c.runHint];
      case 'stop':
        return [c.stop, <Input className={pathClass} aria-label={c.stop} placeholder="docker compose down" spellCheck={false} value={value<string>('stop')} onChange={(e) => set('stop', e.target.value)} />, c.stopHint];
      case 'keep':
        return !value<string>('stop').trim() ? null : [c.keep, <Input className={pathClass} aria-label={c.keep} placeholder="grep -q PERSIST=1 .env" spellCheck={false} value={value<string>('keep')} onChange={(e) => set('keep', e.target.value)} />, c.keepHint];
      case 'planDocs': {
        const planDocs = value<{ dir: string; exclude: string[] }>('planDocs');
        return [
          c.planDocs,
          <div className="cfg-plan grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 max-w-[640px]">
            <Input className={pathClass} aria-label={c.planDir} placeholder={c.planDir} spellCheck={false} value={planDocs.dir} onChange={(e) => set('planDocs', { ...planDocs, dir: e.target.value })} />
            <Input className={pathClass} aria-label={c.planExclude} placeholder={c.planExclude} spellCheck={false} value={planDocs.exclude.join(', ')} onChange={(e) => set('planDocs', { ...planDocs, exclude: e.target.value.split(/,\s*/) })} />
          </div>,
          c.planDocsHint,
        ];
      }
      case 'language':
        return LANGUAGES.length < 2 ? null : [c.language, <SegmentedControl label={c.language} value={value<Language>('language')} onValueChange={(x) => set('language', x)} options={LANGUAGES.map((x) => ({ value: x, label: c.languages[x] }))} />, c.languageHint];
      case 'demoLanguage':
        return LANGUAGES.length < 2 ? null : [c.demoLanguage, <SegmentedControl label={c.demoLanguage} value={value<NarrationLanguage | null>('demoLanguage') ?? ''} onValueChange={(x) => set('demoLanguage', x)} options={LANGUAGES.map((x) => ({ value: x, label: c.languages[x] }))} />, c.demoLanguageHint];
      case 'artifacts':
        return [c.artifacts, <ArtifactChecks value={value<HandoverArtifact[]>('artifacts')} onChange={(v) => set('artifacts', v)} />, c.artifactsHint];
      default:
        return null;
    }
  })();
  if (!control) return null;
  const [label, field, hint] = control;
  const here = at.own(k) !== undefined;
  const from = at.base[k].held ? c.held : c.source[at.base[k].source];
  return (
    <div className={cn(K.cfgSettingClass, at.shown === k && 'flash')} data-setting={k}>
      <div className={K.cfgSettingLabelClass}>
        {label}
        <span className={K.cfgSourceClass(here)}>{here ? c.source.machine : from}</span>
        {here && (
          <button type="button" className="cfg-reset p-0 [border:0] bg-transparent text-muted-foreground text-xs underline cursor-pointer hover:text-foreground" title={c.resetHint} onClick={() => at.set(k, undefined)}>
            {c.reset}
          </button>
        )}
      </div>
      <div className={K.cfgControlClass}>
        {field}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );
}

/** Whether the repository has settings for everyone (its settings file): then it is set up. */
export const fromRepository = (v: RepoValues) => SHARED_FIELDS.some((k) => (isNested(k) ? Object.values(v[k]).some((f) => f.source === 'repository') : v[k].source === 'repository'));

/**
 * The site's vocabulary of tags, a dimension per line (`Area: Billing, Reports`): the text stays as
 * typed while the owner writes (a trailing comma, an empty line), and what it says goes to the setting.
 */
function TagLines({ tags, placeholder, label, onChange }: { tags: PageTags | undefined; placeholder: string; label: string; onChange: (tags: PageTags | undefined) => void }) {
  const [text, setText] = useState(() => tagLines(tags));
  
  useEffect(() => {
    if (JSON.stringify(parseTagLines(text)) !== JSON.stringify(tags)) setText(tagLines(tags));
  }, [JSON.stringify(tags)]);
  return (
    <Textarea mono
      rows={Math.max(2, text.split('\n').length + 1)}
      spellCheck={false}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseTagLines(e.target.value));
      }}
    />
  );
}

/**
 * "Have an agent propose the tags" under the site's tags: a read-only agent reads the
 * repository and its cards with their demos and proposes a vocabulary, which goes into the field
 * for the owner to change and save; the tags before can be had back. Offered where the repository
 * runs on a project; a proposal that finished while the dialog was closed is taken in when it opens again.
 */
function TagProposal({ path, current, language, onTags }: { path: string; current: PageTags | undefined; language: NarrationLanguage | null; onTags: (tags: PageTags | undefined) => void }) {
  const [job, setJob] = useState<TagProposalJob | null>(null);
  const [available, setAvailable] = useState(false);
  const [taken, setTaken] = useState<{ why: string; before: PageTags | undefined } | null>(null);
  const [status, setStatus] = useState('');
  const c = t.config.settings;
  
  const now = useRef({ current, onTags });
  now.current = { current, onTags };
  const take = (j: TagProposalJob | null) => {
    setJob(j);
    if (!j || j.running) return;
    if (j.tags) {
      setTaken({ why: j.why ?? '', before: now.current.current });
      now.current.onTags(j.tags);
    }
    void api.tagProposalTaken(path).catch(console.error);
  };
  const poll = () =>
    api.tagProposal(path).then((r) => {
      setAvailable(r.available);
      take(r.job);
    }, console.error);
  useEffect(() => {
    if (path.trim()) void poll();
  }, [path]);
  const running = !!job?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [running, path]);
  if (!available && !running) return null;
  return (
    <div className="wide tag-propose [.cfg-sub>&]:items-start [.cfg-sub>&]:gap-1.5">
      <Button
        type="button"
        size="small"
        title={c.siteTagsProposeHint}
        disabled={running}
        onClick={async () => {
          setStatus('');
          setTaken(null);
          try {
            take((await api.proposeTags(path, current, language)).job);
          } catch (e) {
            setStatus(failText(e));
          }
        }}
      >
        {running ? c.siteTagsProposing : c.siteTagsPropose}
      </Button>
      {running && <p className={cn(K.cfgSubHintClass, 'm-0')}>{c.siteTagsProposeHint}</p>}
      {taken && (
        <p className={cn(K.cfgSubHintClass, 'm-0')}>
          {c.siteTagsProposed} {taken.why}{' '}
          {taken.before && (
            <LinkButton
              type="button"
              onClick={() => {
                onTags(taken.before);
                setTaken(null);
              }}
            >
              {c.siteTagsBefore}
            </LinkButton>
          )}
        </p>
      )}
      {job?.error && !running && (
        <p className="p-error">
          {c.siteTagsProposeFailed} {job.error}
        </p>
      )}
      {status && <p className="p-error">{status}</p>}
    </div>
  );
}

/** The repository's settings file as the dialog shows it: what the file holds now (`values` from the repository) with this machine's settings in front, but the main branch. */
export function sharedPreview(repo: RepoConfig, values: RepoValues): Record<string, unknown> {
  const file: Record<string, unknown> = {};
  for (const k of SHARED_FIELDS) {
    if (isNested(k)) {
      const fields = Object.entries(values[k] as Record<string, SettingValue<unknown>>).filter(([, f]) => f.source === 'repository');
      if (fields.length) file[k] = Object.fromEntries(fields.map(([f, v]) => [f, v.value]));
    } else if (values[k].source === 'repository') file[k] = values[k].value;
  }
  const extras = Object.entries(values as unknown as Record<string, SettingValue<unknown>>).filter(([k, v]) => k !== 'branch' && !(SHARED_FIELDS as readonly string[]).includes(k) && v?.source === 'repository');
  for (const [key, value] of extras) file[key] = value.value;
  const { branch: _, ...mine } = repo.settings ?? {};
  const merged = layerSettings<Record<string, unknown>>(file, mine as Record<string, unknown>) ?? {};
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
}


const shareHint = 'text-muted-foreground text-sm leading-[1.45] max-w-[76ch] mt-1 mx-0 mb-0';
const shareOk = cn(shareHint, 'text-foreground');
const shareConfirmHint = 'hint mt-1 mx-0 mb-0 max-w-[76ch]';

/**
 * "Take over into the repository for everyone" under a repository's settings: this machine's values (but
 * the main branch) go into its settings file (`settingsFile`), so that everyone who clones it gets them.
 * It first shows the file as it would be and where it goes (a commit on the main branch, or a pull
 * request), then does it at the owner's word. Only for the configuration as saved.
 */
export function ShareSettings({ repo, values, branch, shareTo, shareDirect, settingsFile, takeover }: { repo: RepoConfig; values: RepoValues; branch: string; shareTo: 'main' | 'pr'; shareDirect: boolean; settingsFile: string; takeover: Takeover }) {
  const c = t.config.settings.share;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SettingsShared | null>(null);
  const [error, setError] = useState('');
  const { branch: _, ...mine } = repo.settings ?? {};
  const count = Object.keys(mine).length + (mine.demo ? Object.keys(mine.demo).length - 1 : 0);
  const { saved, onReload, prepare } = takeover;
  const go = async (direct = false) => {
    setBusy(true);
    setError('');
    try {
      
      if (!saved && !(await prepare?.())) return setBusy(false);
      const r = await api.shareSettings(repo.path, direct);
      setDone(r);
      setConfirming(false);
      if ('committed' in r) await onReload();
    } catch (e) {
      setError(failText(e, { detail: ['settingsShare'] }));
    }
    setBusy(false);
  };
  return (
    <div className={cn(K.cfgSettingClass, 'cfg-share-settings mt-1.5 pt-2 border-t border-t-border')}>
      <div className={K.cfgSettingLabelClass}>{c.label}</div>
      <div className={K.cfgControlClass}>
        {done && 'committed' in done && <p className={shareOk}>{c.committed(done.branch, done.committed.slice(0, 7))}</p>}
        {done && 'pr' in done && (
          <p className={shareOk}>
            {c.opened}{' '}
            <a href={done.pr} target="_blank" rel="noreferrer">
              {done.pr}
            </a>
            {c.openedAfter}
          </p>
        )}
        {!done && !count && <p className={shareHint}>{c.none}</p>}
        {!done && count > 0 && !confirming && (
          <>
            <Button type="button" size="small" disabled={!saved && !prepare} onClick={() => setConfirming(true)}>
              {c.button(count)}
            </Button>
            <p className={shareHint}>{saved || prepare ? `${c.hint(settingsFile)}${repo.settings?.branch ? ` ${c.hintBranch}` : ''}` : c.saveFirst}</p>
          </>
        )}
        {confirming && (
          <div className="cfg-share-confirm max-w-[640px]">
            {!saved && <p className={shareConfirmHint}>{c.savesFirst}</p>}
            <p className={shareConfirmHint}>{shareTo === 'main' ? c.toMain(branch) : shareDirect ? c.toPrOrDirect(branch) : c.toPr(branch)}</p>
            <pre className={cn(jsonClass, 'mt-1.5 mb-2 whitespace-pre-wrap')}>
              <span className={shareConfirmHint}>{settingsFile}</span>
              {'\n'}
              {JSON.stringify(sharedPreview(repo, values), null, 2)}
            </pre>
            <div className="cfg-share-actions flex gap-2">
              <Button type="button" variant="primary" size="small" disabled={busy} onClick={() => go()}>
                {shareTo === 'main' ? c.commit : c.openPr}
              </Button>
              {shareTo === 'pr' && shareDirect && (
                <Button type="button" size="small" disabled={busy} onClick={() => go(true)}>
                  {c.pushDirect(branch)}
                </Button>
              )}
              <Button type="button" size="small" disabled={busy} onClick={() => setConfirming(false)}>
                {c.cancel}
              </Button>
            </div>
          </div>
        )}
        {error && <p className={cn(shareHint, 'text-warning')}>{error}</p>}
      </div>
    </div>
  );
}

/** A slot count as typed: empty is none set (as many as there are clones, any number in worktrees), 0 takes no new cards. */
function slotsOf(value: string): number | undefined {
  return value.trim() === '' || !Number.isFinite(Number(value)) ? undefined : Math.max(0, Math.round(Number(value)));
}









export const SHEET_PROBLEMS: ConfigProblemCode[] = ['untrusted', 'adapterGone', 'repoSettings'];


const NAME_PROBLEMS: ConfigProblemCode[] = ['nameTaken', 'oldNameTaken'];

/**
 * A project's old names: their addresses lead to it. Each can be deleted, after a warning of what
 * that does; three or more fold under their count.
 */
function OldNames({ names, onDelete }: { names: string[]; onDelete: (name: string) => void }) {
  const c = t.config;
  const [asking, setAsking] = useState<string | null>(null);
  const rows = (
    <ul className="cfg-old-names m-0 p-0 list-none max-w-[420px] [&>li>.c-del]:ml-0">
      {names.map((n) => (
        <li key={n} className="flex items-center gap-2.5 min-h-[30px]">
          <span>{n}</span>
          <RemoveButton label={c.deleteOldName(n)} onClick={() => setAsking(n)} />
        </li>
      ))}
    </ul>
  );
  return (
    <Field label={<>{c.oldNames} <Info text={c.oldNamesHint} /></>}>
      {names.length >= 3 ? (
        <Collapsible className="cfg-old-names-fold">
          <CollapsibleTrigger className="leading-[30px]">{c.oldNamesCount(names.length)}</CollapsibleTrigger>
          <CollapsibleContent>{rows}</CollapsibleContent>
        </Collapsible>
      ) : (
        rows
      )}
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
        title={c.deleteOldNameTitle(asking ?? '')}
        confirm={{ label: c.deleteOldNameConfirm, variant: 'default', className: 'delete-old-name', onClick: () => asking !== null && onDelete(asking) }}
        cancel={c.deleteOldNameBack}
      >
        <p className="old-name-warning py-2 px-3 rounded-sm text-destructive bg-destructive/10 font-semibold [[data-slot=confirm-dialog]_&]:mt-0 [[data-slot=confirm-dialog]_&]:mx-0 [[data-slot=confirm-dialog]_&]:mb-3">{c.deleteOldNameWarning}</p>
        <ul className="old-name-effects mt-0 mx-0 mb-3 pl-5 leading-normal">
          <li>{c.deleteOldNameCards}</li>
          <li>{c.deleteOldNameReuse}</li>
        </ul>
        <p className="hint [[data-slot=confirm-dialog]_&]:mt-0 [[data-slot=confirm-dialog]_&]:mx-0 [[data-slot=confirm-dialog]_&]:mb-4">{c.deleteOldNameSave}</p>
      </ConfirmDialog>
    </Field>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton icon={<Trash2 size={15} strokeWidth={1.8} aria-hidden />} label={label} size="small" variant="danger" className={removeClass} onClick={onClick} />
  );
}

/** The machines over SSH a repository's workers also run on: a table, one row each. */
function Hosts({ hosts, onChange }: { hosts: HostConfig[]; onChange: (hosts: HostConfig[]) => void }) {
  const set = (i: number, h: HostConfig | null) => onChange(h ? hosts.map((x, k) => (k === i ? h : x)) : hosts.filter((_, k) => k !== i));
  return (
    <div className="cfg-hosts">
      {hosts.length > 0 && (
        <div className="cfg-host-rows grid grid-cols-[minmax(0,.8fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_auto_auto_24px] gap-y-1.5 gap-x-2.5 items-center [&_input]:min-w-0 [&_input:not([type=number])]:w-full">
          {hosts.map((h, i) => (
            <div key={i} className="cfg-host contents">
              <Input aria-label={t.config.hostName} value={h.name} placeholder={t.config.hostName} spellCheck={false} onChange={(e) => set(i, { ...h, name: e.target.value })} />
              <Input className={pathClass} aria-label={t.config.hostSsh} value={h.ssh} placeholder={t.config.hostSsh} spellCheck={false} onChange={(e) => set(i, { ...h, ssh: e.target.value })} />
              <Input className={pathClass} aria-label={t.config.hostRoot} value={h.root} placeholder={t.config.hostRoot} spellCheck={false} onChange={(e) => set(i, { ...h, root: e.target.value })} />
              <label className="cfg-host-clones flex items-center gap-1.5">
                <span className={K.cfgSubHintClass}>{t.config.hostClones}</span>
                <Input className="w-16" type="number" min={0} max={20} value={h.clones} onChange={(e) => set(i, { ...h, clones: Number(e.target.value) || 0 })} />
              </label>
              <label className="cfg-host-clones cfg-has-info flex items-center gap-1.5">
                <span className={K.cfgSubHintClass}>
                  {t.config.hostSlots} <Info text={t.config.slotsHint} />
                </span>
                <Input
                  className="w-16"
                  type="number"
                  min={0}
                  max={20}
                  aria-label={t.config.hostSlots}
                  placeholder={t.config.slotsAll}
                  value={h.slots ?? ''}
                  onChange={(e) => {
                    const { slots: _, ...rest } = h;
                    const slots = slotsOf(e.target.value);
                    set(i, slots === undefined ? rest : { ...rest, slots });
                  }}
                />
              </label>
              <RemoveButton label={t.config.removeHost} onClick={() => set(i, null)} />
            </div>
          ))}
        </div>
      )}
      <Button size="small" className="[.cfg-host-rows+&]:mt-1.5" onClick={() => onChange([...hosts, { name: '', ssh: '', root: '', clones: 2 }])}>
        {t.config.addHost}
      </Button>
    </div>
  );
}


const DETAILED: ConfigProblem['code'][] = ['invalid', 'adapterGone', 'repoSettings', 'hostName', ...START_FAILED];

export function ConfigurationProblems({ problems, retried }: { problems: ConfigProblem[]; retried?: () => void }) {
  if (!problems.length) return null;
  return (
    <section className="cfg-machine-problems mb-5" aria-label={t.config.configurationProblems}>
      <h3 className="mt-0 mb-1 text-base">{t.config.configurationProblems}</h3>
      {problems.map((problem, i) => (
        <Problem key={i} problem={problem} where="" {...(retried ? { retried } : {})} />
      ))}
    </section>
  );
}

/**
 * A problem of the configuration: what is wrong, the technical detail folded away where it says
 * what to fix, and a button that has the Koordinator create a task that fixes it (with the detail, which it reads).
 * What did not start as saved tries again with "Try again", where `retried` is given (called after it).
 */
export function Problem({ problem, where, ask, retried, onShow }: { problem: ConfigProblem; where: string; ask?: (text: string) => void; retried?: () => void;  onShow?: (() => void) | undefined }) {
  const [asked, setAsked] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const text = problem.of && (problem.code === 'nameTaken' || problem.code === 'oldNameTaken') ? t.config[problem.code](problem.of) : t.config.problem[problem.code];
  
  const named = problem.of && problem.ofProject !== undefined && onShow && (problem.code === 'nameTaken' || problem.code === 'oldNameTaken') ? t.config[problem.code]('\0').split('\0') : null;
  const retry = async () => {
    setRetrying(true);
    setError('');
    try {
      await api.retryStart();
      retried?.();
    } catch (e) {
      setError(failText(e));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className={problemClass}>
      {named ? (
        <>
          {named[0]}
          <LinkButton type="button" onClick={onShow}>
            {problem.of}
          </LinkButton>
          {named[1]}
        </>
      ) : (
        text
      )}
      {DETAILED.includes(problem.code) && (
        <Collapsible className="mt-1">
          <CollapsibleTrigger className="text-muted-foreground">{t.config.details}</CollapsibleTrigger>
          <CollapsibleContent>
            <code>{problem.detail}</code>
          </CollapsibleContent>
        </Collapsible>
      )}
      {retried && (problem.code === 'invalid' || START_FAILED.includes(problem.code)) && (
        <Button size="small" disabled={retrying} onClick={() => void retry()}>
          {t.config.retry}
        </Button>
      )}
      {error && <p>{error}</p>}
      { }
      {ask && problem.code !== 'untrusted' && (
        <Button
          size="small"
          disabled={asked}
          onClick={() => {
            setAsked(true);
            ask(t.config.fixRequest(where, text, problem.detail));
          }}
        >
          {t.config.askFix}
        </Button>
      )}
    </div>
  );
}

const CodeDiff = lazy(() => import('./diff-code'));

/**
 * The commands of a repository that wait for the owner's trust (problem `untrusted`): each group
 * with what it does and its lines as last trusted against those on the main branch now, and the
 * button that trusts them; the dialog checks again after it.
 */
export function TrustCommands({ path, trust, onDone }: { path: string; trust: RepoTrust; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const c = t.config.trust;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await api.trustCommands(path, trust);
      await onDone();
    } catch (e) {
      setError(failText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={trustClass}>
      {trust.held.map((g) => (
        <div key={g} className={trustGroupClass}>
          <p className="hint">{c[g]}</p>
          <TrustDiff trust={trust} group={g} />
          {(g === 'claude' || g === 'codex') && blankOnly(trust, g).length > 0 && <p className="hint">{c.blankOnly(blankOnly(trust, g).join(', '))}</p>}
        </div>
      ))}
      <Button size="small" disabled={busy} onClick={go}>
        {busy && <Spinner className="size-3" />}
        {busy ? c.trusting : c.trust}
      </Button>
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

/**
 * A group's commands as last trusted against those now, each file or command under its name and
 * diffed on its own, so a change is never matched against another's lines nor shown without its
 * name: the changes with a few lines around them, the unchanged ones between expandable. A change
 * the lines cannot show (one invisible character for another that the markers write alike) is said
 * below them.
 */
function TrustDiff({ trust, group }: { trust: RepoTrust; group: TrustGroup }) {
  const parts = useMemo(() => {
    const was = textsOf(trust.before, group);
    const now = textsOf(trust.now, group);
    return [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((name) => was[name] !== now[name])
      .map((name, i) => {
        const [old, neu] = [linesOf(was[name]), linesOf(now[name])];
        const versions = { old: old.lines, new: neu.lines };
        const part = patchOf(`${group}-${i}${extension(name)}`, versions.old, versions.new, { ends: { old: old.ends, new: neu.ends } });
        const status = !(name in was) ? t.diff.status.added : !(name in now) ? t.diff.status.deleted : '';
        return { name: group === 'app' ? `app.${name}` : name, part, versions, status, unseen: !part.lines.some((l) => l.startsWith('@@')) };
      });
  }, [trust, group]);
  const unseen = parts.filter((p) => p.unseen).map((p) => p.name);
  return (
    <>
      {parts.map(({ name, part, versions, status }) => (
        <div key={part.file}>
          <h6 className="m-0 flex gap-3 items-baseline py-1 px-2.5 bg-muted border border-border rounded-t-xs text-xs font-medium">
            <span className="font-mono break-all">{visible(name)}</span>
            <span className="hint">{status}</span>
          </h6>
          <Suspense fallback={<p className="hint">{t.diff.loading}</p>}>
            <CodeDiff part={part} card="" style="unified" versions={versions} />
          </Suspense>
        </div>
      ))}
      {unseen.length > 0 && <p className="hint">{t.config.trust.unseen(unseen.map(visible).join(', '))}</p>}
    </>
  );
}

/** The files of the Claude Code or Codex configuration whose change the diff cannot show: other contents, the same text but for space at its start or end. */
const blankOnly = (trust: RepoTrust, g: 'claude' | 'codex') =>
  Object.entries(trust.now[g] ?? {}).flatMap(([file, f]) => {
    const was = trust.before?.[g]?.[file];
    return was && was.id !== f.id && was.text === f.text ? [file] : [];
  });

/**
 * Creates the card that writes the repository's settings for everyone, and opens it on its project;
 * the dialog's changes are saved first, so the project runs with the repository on it.
 */
export function AdapterSetup({ project, repo, takeover, label = t.config.adapterSetup, hint = t.config.adapterSetupHint, icon, stacked }: { project: string; repo: string; takeover: Takeover; label?: string; hint?: string; icon?: ReactNode;  stacked?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { saved, prepare } = takeover;
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      if (!saved && !(await prepare?.())) return setBusy(false);
      const card = await api.adapterSetup(project, repo);
      
      keep(draftSession, project, { at: Date.now(), card: card.id, scroll: [], drafts: [] });
      location.assign(projectPath(project));
    } catch (e) {
      setError(failText(e));
      setBusy(false);
    }
  };
  return (
    <div className={stacked ? 'cfg-adapter-setup flex flex-col gap-1.5 py-2 [&_.hint]:text-sm' : `${rowClass} [&_.hint]:min-w-0 [&_.hint]:text-xs!`}>
      {!stacked && <AdapterSetupHint hint={hint} saved={saved} prepare={!!prepare} />}
      <Button size="small" className={cn(stacked && 'w-full')} disabled={busy || (!saved && !prepare)} onClick={go}>
        {icon}
        {label}
      </Button>
      {stacked && <AdapterSetupHint hint={hint} saved={saved} prepare={!!prepare} />}
      {error && <p className="p-error">{error}</p>}
    </div>
  );
}

function AdapterSetupHint({ hint, saved, prepare }: { hint: string; saved: boolean; prepare: boolean }) {
  return (
    <span className="hint">
      {hint}
      {!saved && <> {prepare ? t.config.adapterSetupSaves : t.config.adapterSetupSaveFirst}</>}
    </span>
  );
}
