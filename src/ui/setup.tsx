// The setup assistant: what Seismic needs on this machine in one list (Claude Code and its login, git,
// gh and its login, voice, demos), the needed parts apart from those that can wait, installed at a
// click where Seismic can, with the command for the rest and a terminal for the logins. On the first
// start (no project yet) it fills the page and ends with the first project, from a folder or a clone;
// later the settings open it over the project.

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { CLOUD_PRESETS, CLOUD_VOICES, type CloudPreset, type GitSetupPreview, LARGE_FILE, type Language, type MachineItem, type MachineSection, type MachineView, type MobileId, RECOMMENDED_SECTIONS, type SetupItem, type VoiceSetupItem } from '../core/types';
import { LANGUAGES } from '../core/locale';
import { api, reload } from './api';
import { useCopy } from './copy';
import { Sign } from './logo';
import { failText, fileSize, t } from './strings';
import { projectPath } from './address';
import { Button, CloseButton, LinkButton } from './components/button';
import { RadioGroup, RadioOption } from './components/radio';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs';
import { Input } from './components/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/collapsible';
import { Select, SelectItem } from './components/select';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { cn } from 'cn';
import { installClass, installHintClass, pathClass, projectClass, rowClass, setupItemClass, setupListClass, statusClass } from './setupClasses';

const PLATFORMS: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
/** The machine's system and processor, as the owner knows them: "macOS (arm64)". */
export const platformName = (v: { platform: string; arch: string }) => `${PLATFORMS[v.platform] ?? v.platform} (${v.arch})`;

/** A command to run in a terminal, with a button that copies it. */
function Command({ text }: { text: string }) {
  const [copied, copy] = useCopy(1500);
  return (
    <span className="c-cmd inline-flex items-baseline gap-1 max-w-full [&_code]:min-w-0 [&_code]:[overflow-wrap:anywhere]">
      <code>{text}</code>
      <button className="c-copy [border:0] bg-transparent text-muted-foreground text-xs cursor-pointer py-0 px-0.5 underline decoration-dotted [&:hover]:text-foreground" onClick={() => copy(text)} title={t.setup.copy}>
        {copied ? t.setup.copied : t.setup.copy}
      </button>
    </span>
  );
}

/** A setup check's pieces, each missing one with the commands that install it here, and what Seismic does about it at a click. */
export function SetupList<I extends SetupItem | VoiceSetupItem | MachineItem>({
  items,
  name,
  state,
  action,
}: {
  items: I[];
  name: (i: I) => string;
  state: (i: I) => string;
  action?: (i: I) => ReactNode;
}) {
  const s = t.config.setup;
  return (
    <ul className={setupListClass}>
      {items.map((i) => {
        const act = action?.(i);
        // the speech recognition, there but too slow on this machine
        const slow = 'speed' in i && typeof i.speed === 'object' && i.speed.slow && !i.cloud?.used;
        return (
          <li key={i.id} className={cn(i.state, slow && 'slow', setupItemClass)}>
            <span className={cn('c-mark font-bold text-center', slow ? 'text-warning' : { ok: 'text-approved', missing: 'text-destructive', later: 'text-muted-foreground' }[i.state])} aria-hidden>
              {slow ? '!' : { ok: '✓', missing: '✗', later: '…' }[i.state]}
            </span>
            <span className={i.state === 'missing' ? 'c-name font-semibold' : 'c-name'}>{name(i)}</span>
            {/* a speech recognition too slow here says so in the warning colour */}
            <span className={slow ? 'text-warning text-xs m-0 [overflow-wrap:anywhere]' : 'hint'} title={i.found}>
              {state(i)}
            </span>
            {act && <div className="c-act col-[2/-1] flex flex-wrap gap-2 items-center mt-0.5 mb-1 mx-0">{act}</div>}
            {i.state === 'missing' && i.install && (!!i.install.commands.length || i.install.url) && (
              <div className="c-how col-[2/-1] flex flex-wrap gap-x-2 gap-y-1 items-baseline mt-1 mb-1 mx-0 [&_code]:py-0.5 [&_code]:px-1.5 [&_code]:rounded-xs [&_code]:bg-card [&_code]:border [&_code]:border-solid [&_code]:border-border [&_code]:select-all [&_a]:text-xs">
                {!!i.install.commands.length && <span className="hint">{act ? t.setup.byHand : s.install}</span>}
                {i.install.commands.map((c) => (
                  <Command key={c} text={c} />
                ))}
                {i.install.url && (
                  <a href={i.install.url} target="_blank" rel="noreferrer">
                    {s.more}
                  </a>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What the voice check's lines say, here and in the settings sheet. */
export function voiceState(i: VoiceSetupItem | MachineItem) {
  const v = t.config.voice;
  const s = t.config.setup;
  if (i.state === 'later') return (i.waits ? v.waits : v.later)(fileSize((i.mb ?? 0) * 1e6));
  if (i.state === 'missing') return i.found && i.need ? s.needs(i.found, i.need) : s.missing;
  if (i.id === 'recognition') {
    if (i.cloud?.used) return v.cloud.found(i.found ?? '');
    if (i.speed === 'measuring') return `${i.found} · ${v.measuring}`;
    if (i.speed) return i.speed.slow ? v.slow : v.fast(i.found ?? '', v.seconds(i.speed.seconds));
  }
  return (i.found && v.found[i.found]) ?? i.found ?? s.there;
}

/** Under the speech recognition's line: what was measured, the cloud's offer, each on a line of its own. */
const voiceClass = 'c-voice flex flex-col items-start gap-1 w-full';
/** Why the cloud or the measurement failed; in the configuration dialog in that dialog's size for errors. */
const voiceErrorClass = 'text-destructive m-0 text-sm [#config_&]:mt-1.5 [#config_&]:text-sm';
/** A row of the cloud's offer: the service, its address and model, the key's link and the test. */
const cloudRowClass = cn(rowClass, 'gap-1.5');

/**
 * Under the speech recognition's line, in the setup assistant and the configuration dialog alike:
 * how long it took here for a short sentence, measured again at a click, and a cloud service
 * instead (open at once when it was too slow), tested with the same sentence before it is used.
 * `changed`: the view to check again, which this follows while a measurement runs.
 */
export function RecognitionDetail({ item, busy, changed }: { item: VoiceSetupItem | MachineItem; busy?: boolean; changed: () => unknown }) {
  const v = t.config.voice;
  const c = v.cloud;
  const { speed, cloud } = item;
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<CloudPreset>(cloud?.preset ?? 'groq');
  const [baseUrl, setBaseUrl] = useState(cloud?.preset === 'openai' ? cloud.baseUrl : '');
  const [model, setModel] = useState(cloud?.preset === 'openai' ? cloud.model : '');
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState('');
  const measuring = speed === 'measuring';
  useEffect(() => {
    if (!measuring) return;
    // one check at a time: the setup assistant's takes a while
    let timer: ReturnType<typeof setTimeout>;
    let done = false;
    const tick = async () => {
      await changed();
      if (!done) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [measuring]);
  const failed = (e: unknown) => setStatus(failText(e, { detail: ['voiceCloud', 'invalid'] }));
  const act = async (call: () => Promise<unknown>) => {
    setStatus('');
    try {
      await call();
      changed();
    } catch (e) {
      failed(e);
    }
  };
  const test = async () => {
    setTesting(true);
    await act(() => api.useCloudVoice({ preset, ...(preset === 'openai' ? { baseUrl, model } : {}), ...(key.trim() ? { key: key.trim() } : {}) }));
    setKey('');
    setTesting(false);
  };
  if (cloud?.used)
    return (
      <div className={voiceClass}>
        <span className="hint">{c.used(item.found ?? '', v.seconds(cloud.tested?.seconds ?? 0))}</span>
        <LinkButton onClick={() => act(api.useLocalVoice)}>
          {c.back}
        </LinkButton>
        {status && <span className={voiceErrorClass}>{status}</span>}
      </div>
    );
  const slow = typeof speed === 'object' && speed.slow ? speed : null;
  const kept = cloud?.key && cloud.preset === preset;
  return (
    <div className={voiceClass}>
      {slow && <span className="text-warning text-xs m-0 [overflow-wrap:anywhere]">{v.slowDetail(v.seconds(slow.seconds))}</span>}
      {item.state === 'ok' && !measuring && (
        <LinkButton disabled={busy} onClick={() => act(api.measureVoice)}>
          {speed ? v.remeasure : v.measure}
        </LinkButton>
      )}
      {slow || open || cloud ? (
        <div className="c-cloud flex flex-col gap-1 w-full max-w-[460px] box-border py-2 px-2.5 rounded-sm bg-muted text-sm">
          <b>{c.offer}</b>
          <span className={cloudRowClass}>
            <Select className="text-sm py-1 px-1.5 box-border" aria-label={c.service} value={preset} onValueChange={(picked) => setPreset(picked as CloudPreset)}>
              {CLOUD_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>
                  {c.names[p]}
                </SelectItem>
              ))}
            </Select>
          </span>
          <span className="hint">{c.about[preset]}</span>
          {preset === 'openai' && (
            <span className={cloudRowClass}>
              <Input className="text-sm px-1.5 py-1 flex-1 min-w-0 w-full" aria-label={c.baseUrl} spellCheck={false} placeholder={CLOUD_VOICES.openai.baseUrl} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              <Input className="text-sm px-1.5 py-1 flex-1 min-w-0 w-full" aria-label={c.model} spellCheck={false} placeholder={CLOUD_VOICES.openai.model} value={model} onChange={(e) => setModel(e.target.value)} />
            </span>
          )}
          <Input className="flex-1 min-w-0 w-full" type="password" autoComplete="off" spellCheck={false} placeholder={kept ? c.keyKept : c.key} value={key} onChange={(e) => setKey(e.target.value)} />
          <span className={cn(cloudRowClass, 'c-cloud-go justify-between items-center')}>
            <a href={CLOUD_VOICES[preset].keys} target="_blank" rel="noreferrer">
              {c.getKey}
            </a>
            <Button size="small" disabled={testing || (!key.trim() && !kept)} onClick={test}>
              {testing ? c.testing : c.test}
            </Button>
          </span>
        </div>
      ) : (
        <LinkButton onClick={() => setOpen(true)}>
          {c.open}
        </LinkButton>
      )}
      {status && <span className={voiceErrorClass}>{status}</span>}
    </div>
  );
}

/** What the demo check's lines say, here and in the settings sheet. */
export function demoState(i: SetupItem | MachineItem) {
  const s = t.config.setup;
  if (i.state === 'missing') return i.found && i.need ? s.needs(i.found, i.need) : s.missing;
  // a browser by its program's name; the whole path is in the tooltip
  return (i.id === 'browser' ? i.found?.split(/[\\/]/).at(-1) : i.found) ?? s.there;
}

const ready = (section: MachineSection | undefined) => !!section && section.items.every((i) => i.state !== 'missing');

export function Setup({ first, onClose }: { first?: boolean; onClose?: () => void }) {
  const [view, setView] = useState<MachineView | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [terminal, setTerminal] = useState<string | null>(null);
  const [page, setPage] = useState<'required' | 'recommended'>('required');
  const shown = useRef(false);
  shown.current = !!view;
  const failed = (e: unknown) => setStatus(failText(e, { detail: ['invalid', 'config'] }));
  const recheck = () => {
    setChecking(true);
    return api
      .setup()
      // a check that fails (the server starting again) keeps the list it had
      .then(setView, (e) => (shown.current ? console.error(e) : failed(e)))
      .finally(() => setChecking(false));
  };
  useEffect(() => {
    recheck();
    // back from a terminal or an installer: the list checks again
    const back = () => document.visibilityState === 'visible' && recheck();
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  const running = !!view?.job?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => api.setup().then(setView, console.error), 1500);
    return () => clearInterval(timer);
  }, [running]);

  const s = t.setup;
  const act = async (section: MachineSection, i: MachineItem) => {
    setStatus('');
    setTerminal(null);
    try {
      if (i.act === 'install') setView(await api.setupInstall(section.id, i.id));
      else if (i.act === 'login' || i.act === 'terminal') {
        const { opened } = await api.setupLogin(section.id, i.id);
        setTerminal(opened ? i.id : null);
        if (!opened) setStatus(s.noTerminal);
      }
    } catch (e) {
      failed(e);
    }
  };
  const action = (section: MachineSection) => (i: MachineItem) => {
    const job = view?.job;
    if (job?.kind === 'install' && job.section === section.id && job.id === i.id) {
      if (job.running)
        return (
          <span className={cn('hint', installClass, 'm-0 min-w-0')}>
            <span className="c-step">{s.installing}</span> <code>{job.line}</code>
          </span>
        );
      if (job.error) return <span className="text-destructive m-0 text-sm">{s.failed(job.error.split('\n').at(-1) ?? '')}</span>;
    }
    if (i.act === 'identity') return <Identity onSaved={setView} onError={failed} />;
    const detail = section.id === 'voice' && i.id === 'recognition' && <RecognitionDetail item={i} busy={running} changed={recheck} />;
    if (!i.act) return detail || null;
    if (i.act === 'login' || i.act === 'terminal')
      return (
        <>
          <Button size="small" onClick={() => act(section, i)}>
            {i.act === 'terminal' ? s.mobile.enable : s.login}
          </Button>
          {terminal === i.id && <span className="hint">{i.act === 'terminal' ? s.mobile.enableOpen : s.terminalOpen}</span>}
        </>
      );
    return (
      <>
        <Button size="small" disabled={running} onClick={() => act(section, i)}>
          {i.mb ? s.installSized(fileSize(i.mb * 1e6)) : i.id === 'xcode' ? s.mobile.installApp : s.install}
        </Button>
        {detail}
      </>
    );
  };
  const name = (section: MachineSection) => (i: MachineItem) =>
    section.id === 'mobile' ? s.mobile.names[i.id as MobileId] : section.id === 'voice' ? t.config.voice.names[i.id as VoiceSetupItem['id']] : section.id === 'demos' ? t.config.setup.names[i.id as SetupItem['id']] : s.names[i.id as keyof typeof s.names];
  const state = (section: MachineSection) => (i: MachineItem) => {
    if (section.id === 'voice') return voiceState(i);
    if (section.id === 'demos') return demoState(i);
    if (section.id === 'mobile') return i.state === 'ok' ? (i.found ?? t.config.setup.there) : i.id === 'simulator' && !i.install ? s.mobile.xcodeFirst : t.config.setup.missing;
    if (i.state === 'ok') return i.id === 'claudeLogin' || i.id === 'ghLogin' || i.id === 'agyLogin' ? (i.found ? s.loggedInAs(i.found) : s.loggedIn) : (i.found ?? t.config.setup.there);
    if (i.id === 'claudeLogin' && !i.act) return s.claudeFirst;
    if (i.id === 'ghLogin' && !i.act) return s.ghFirst;
    if (i.id === 'agyLogin' && !i.act) return s.agyFirst;
    if (i.id === 'claudeLogin' || i.id === 'ghLogin' || i.id === 'agyLogin') return s.loggedOut;
    if (i.id === 'gitUser') return s.noIdentity;
    return t.config.setup.missing;
  };

  const needed = view?.sections.find((x) => x.id === 'needed');
  const claude = needed?.items.find((i) => i.id === 'claude');
  const recommended = view?.sections.some((x) => RECOMMENDED_SECTIONS.includes(x.id)) ?? false;
  const shownPage = recommended ? page : 'required';
  return (
    <SetupShell first={first} onClose={onClose}>
        <header className={cn('setup-head flex items-center gap-3.5', !first && 'flex-none pr-7')}>
          {first && <Sign size={34} />}
          <div>
            <div className="p-kind">{s.kind}</div>
            {first ? <h2 className={headingClass}>{s.titleFirst}</h2> : <DialogTitle asChild><h2 className={headingClass}>{s.title}</h2></DialogTitle>}
          </div>
          {first && <LanguagePick />}
          {onClose && (
            <CloseButton label={s.close} variant="ghost" className="setup-close ml-auto" onClick={onClose} />
          )}
        </header>
        {/* over the project the dialog stays within the window: its head stays, the rest scrolls inside */}
        <div className={cn('setup-body', !first && 'flex-[1_1_auto] min-h-0 overflow-y-auto pt-0 pr-7 pb-6 pl-0')}>
          <p className="setup-intro text-muted-foreground text-sm leading-normal mt-3.5 mb-1 mx-0">{first ? s.introFirst : s.intro}</p>
          {!view ? (
            <p className="hint">{checking ? t.config.setup.checking : status}</p>
          ) : (
            <>
              <p className="hint">{s.platform(platformName(view))}</p>
              <Tabs value={shownPage} onValueChange={(p) => setPage(p as typeof shownPage)}>
              {recommended && (
                  <TabsList variant="pill" className="setup-pages mt-1 mb-2.5 mx-0">
                    {(['required', 'recommended'] as const).map((p) => (
                      <TabsTrigger key={p} value={p}>
                        {s.pages[p]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
              )}
              <TabsContent value={shownPage}>
              {view.sections.filter((x) => RECOMMENDED_SECTIONS.includes(x.id) === (shownPage === 'recommended')).map((section) => (
                <section key={section.id} className={cn(projectClass, 'c-setup', `setup-${section.id}`, '[&>.hint]:mt-0.5 [&>.hint]:mb-1.5 [&>.hint]:mx-0')}>
                  <div className={sectionHeadClass}>
                    <b>{s.sections[section.id].title}</b>
                    <span className={cn('setup-tag text-2xs py-px px-2 rounded-xs', section.id === 'needed' ? 'needed bg-foreground text-background' : 'bg-muted text-muted-foreground')}>{section.id === 'needed' ? s.needed : s.optional}</span>
                    {section.mb > 0 && <span className="hint">{s.size(fileSize(section.mb * 1e6))}</span>}
                    <span className={cn('setup-ok ml-auto text-xs', ready(section) ? 'on text-approved' : 'text-destructive')}>
                      {!ready(section) ? s.open(section.items.filter((i) => i.state === 'missing').length) : section.items.some((i) => i.state === 'later') ? s.readyLater : s.ready}
                    </span>
                  </div>
                  <p className="hint">{s.sections[section.id].hint}</p>
                  <SetupList items={section.items} name={name(section)} state={state(section)} action={action(section)} />
                  {section.id === 'mobile' && <p className="hint">{s.mobile.simulatorSafari}</p>}
                  {section.id === 'needed' && claude?.state === 'ok' && claude.found && !claude.found.startsWith(view.checkedClaude) && (
                    <p className="hint">{s.checkedWith(view.checkedClaude)}</p>
                  )}
                </section>
              ))}
              </TabsContent>
              </Tabs>
              {status && <p className={`hint ${statusClass}`}>{status}</p>}
              <Button size="small" disabled={checking || running} onClick={recheck}>
                {checking ? t.config.setup.checking : t.config.setup.recheck}
              </Button>
              {first && shownPage === 'required' && <FirstProject view={view} ready={ready(needed)} onView={setView} />}
            </>
          )}
        </div>
    </SetupShell>
  );
}

/** The assistant's pane: frost's glass, its commands in the page's mono. */
const pageClass = 'setup-page frost-pane max-w-[720px] pt-6 px-7 pb-6 [&_code]:font-mono text-xs';
/** Its title, close under the kind above it. */
const headingClass = 'mt-0.5 mb-0 mx-0';
/** A block's head: its title, whether it is needed, its size and how much of it is still open. */
const sectionHeadClass = 'setup-sh flex items-baseline gap-2 mb-0.5';

/** The whole page on the first start; over the project from the settings, a dialog within the window. */
function SetupShell({ first, onClose, children }: { first?: boolean; onClose?: () => void; children: ReactNode }) {
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (first) return <div className="setup first fixed inset-0 overflow-y-auto z-80 bg-background"><div className={cn(pageClass, 'mx-auto mt-14 mb-12')}>{children}</div></div>;
  return <Dialog open onOpenChange={(open) => !open && onClose?.()}>
    <DialogContent layerClassName="setup over z-80 overflow-hidden py-12 px-6 bg-scrim" glass className={cn(pageClass, 'w-full my-0 mx-auto flex flex-col pr-0 pb-0')} onCloseAutoFocus={(e) => {
      e.preventDefault();
      opener?.focus();
    }}>{children}</DialogContent>
  </Dialog>;
}

/** git's name and e-mail for the agents' commits, set globally. */
function Identity({ onSaved, onError }: { onSaved: (v: MachineView) => void; onError: (e: unknown) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const s = t.setup;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.setupIdentity(name, email));
    } catch (e) {
      onError(e);
    }
    setBusy(false);
  };
  return (
    <span className={cn(rowClass, 'setup-identity')}>
      <Input className="w-[170px]" placeholder={s.yourName} value={name} onChange={(e) => setName(e.target.value)} />
      <Input className="w-[170px]" placeholder={s.yourEmail} value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button size="small" disabled={busy || !name.trim() || !email.trim()} onClick={save}>
        {s.saveIdentity}
      </Button>
    </span>
  );
}

/** The language of the page before there is a project whose settings could change it. */
function LanguagePick() {
  const [chosen, setChosen] = useState<Language | null>(null);
  useEffect(() => {
    api.language().then((l) => setChosen(l.language), console.error);
  }, []);
  if (!chosen || LANGUAGES.length < 2) return null;
  return (
    <Select
      className="setup-lang ml-auto text-sm py-1 px-2 rounded-xs border-border hover:border-border bg-card focus:bg-card text-foreground"
      aria-label={t.config.language.title}
      value={chosen}
      onValueChange={(picked) => api.saveLanguage(picked as Language).then(() => reload(), console.error)}
    >
      {LANGUAGES.map((l) => (
        <SelectItem key={l} value={l}>
          {t.config.language.names[l]}
        </SelectItem>
      ))}
    </Select>
  );
}

/** A field of the first project: its name above it, small. */
const fieldClass = 'block my-1.5 mx-0';
const fieldLabelClass = 'block text-muted-foreground text-xs mb-0.5';
const firstPathClass = 'w-full py-2 px-2';
/** What went wrong with the first project, in a block of the assistant. */
const firstErrorClass = 'text-destructive mt-1 mb-0 mx-0 text-sm';
/** The buttons that go on. */
const actionsClass = 'c-actions flex gap-2 mt-4';

/** The first project: a repository's folder on this machine, or a clone of one. Seismic then starts again with it, and the page opens it. */
function FirstProject({ view, ready, onView }: { view: MachineView; ready: boolean; onView: (v: MachineView) => void }) {
  const [mode, setMode] = useState<'folder' | 'clone'>('folder');
  const [path, setPath] = useState('');
  const [clone, setClone] = useState('');
  const [into, setInto] = useState(view.cloneInto);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [saved, setSaved] = useState<{ project: string; branch?: string; opens: boolean } | null>(null);
  // the main branch of the folder named, once Seismic looked at it; or that it is a folder without git
  const found = useFolder(mode === 'folder' ? path.trim() : '');
  const s = t.setup;
  const failed = (e: unknown) => setStatus(failText(e, { detail: ['invalid', 'config'] }));
  const job = view.job?.kind === 'clone' ? view.job : undefined;
  // a clone that ended as the first project
  useEffect(() => {
    if (job && !job.running && job.project) setSaved({ project: job.project, branch: job.branch, opens: !!job.opens });
  }, [job?.running, job?.project]);
  const branch = saved?.branch ?? found?.branch;
  const noGit = !!found?.noGit;
  // once Seismic runs with the project (by itself, or started again by the owner), the page opens it
  const opened = useRef(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setInterval(
      () =>
        api.projects().then((list) => {
          if (opened.current || !list.some((c) => c.id === saved.project)) return;
          opened.current = true;
          location.href = projectPath(saved.project);
        }, () => {}),
      1000,
    );
    return () => clearInterval(timer);
  }, [saved]);

  const pick = async () => {
    setStatus('');
    try {
      const { path } = await api.setupPick(s.pickPrompt);
      if (path) setPath(path);
    } catch (e) {
      failed(e);
    }
  };
  /** `withoutGit`: the folder stays without git, its cards working in it directly. */
  const create = async (withoutGit = false) => {
    setBusy(true);
    setStatus('');
    try {
      const out = await api.setupProject(mode === 'folder' ? { path, ...(withoutGit ? { git: false as const } : {}) } : { clone, into });
      if ('project' in out) setSaved(out);
      else onView(out);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const can = mode === 'folder' ? !!path.trim() : !!clone.trim();
  return (
    <section className={cn(projectClass, 'setup-first border-2')}>
      <div className={sectionHeadClass}>
        <b>{s.first.title}</b>
      </div>
      <p className="hint">{s.first.hint}</p>
      {!ready && <p className="text-warning text-xs">{s.first.notReady}</p>}
      {saved ? (
        <p className="setup-saved text-sm text-foreground">
          {branch && `${s.first.branch(branch)} `}{saved.opens ? s.first.opens : s.first.startAgain}</p>
      ) : (
        <>
          {/* where the project is: two cards with a radio button each, the fields for the one chosen below */}
          <RadioGroup className="setup-where grid grid-cols-2 gap-2.5 mt-3 mb-2.5 mx-0 [&>b]:col-span-full" labelledBy="setup-where" value={mode} onValueChange={(m) => setMode(m as typeof mode)}>
            <b id="setup-where">{s.first.where}</b>
            {(['folder', 'clone'] as const).map((m) => (
              <RadioOption key={m} value={m} className={cn('setup-choice grid grid-cols-[auto_1fr] [align-content:start] items-center gap-x-2.5 gap-y-0.5 m-0 border rounded-lg cursor-pointer [&_.hint]:col-start-2', mode === m ? 'on border-2 border-foreground py-3 px-3' : 'border-border py-3 px-3.5 [&:hover]:border-foreground')}>
                <b>{s.first.modes[m].title}</b>
                <span className="hint">{s.first.modes[m].hint}</span>
              </RadioOption>
            ))}
          </RadioGroup>
          {mode === 'folder' ? (
            <>
              <label className={fieldClass}>
                <span className={fieldLabelClass}>{s.first.folder}</span>
                <span className={rowClass}>
                  <Input className={cn(pathClass, firstPathClass)} spellCheck={false} placeholder={s.first.pathPlaceholder} value={path} onChange={(e) => setPath(e.target.value)} />
                  {view.picker && (
                    <Button size="small" className="setup-pick mt-0! flex-none" onClick={pick}>
                      {s.first.pick}
                    </Button>
                  )}
                </span>
              </label>
              {branch && <p className="hint setup-branch">{s.first.branch(branch)}</p>}
              {noGit && <GitSetup key={path.trim()} path={path.trim()} confirm={s.git.confirmProject} onDone={() => create()} onFolder={() => create(true)} />}
            </>
          ) : (
            <>
              <label className={fieldClass}>
                <span className={fieldLabelClass}>{s.first.repo}</span>
                <Input className={cn(pathClass, firstPathClass)} spellCheck={false} placeholder={s.first.repoPlaceholder} value={clone} onChange={(e) => setClone(e.target.value)} />
              </label>
              <label className={fieldClass}>
                <span className={fieldLabelClass}>{s.first.into}</span>
                <Input className={cn(pathClass, firstPathClass)} spellCheck={false} value={into} onChange={(e) => setInto(e.target.value)} />
              </label>
            </>
          )}
          {noGit ? null : job?.running ? (
            <p className={installHintClass}>
              <span className="c-step">{s.first.cloning}</span> <code>{job.line}</code>
            </p>
          ) : (
            <div className={actionsClass}>
              <Button variant="primary" disabled={!can || busy} onClick={() => create()}>
                {mode === 'folder' ? s.first.create : s.first.cloneCreate}
              </Button>
            </div>
          )}
          {job?.error && !job.running && <p className={firstErrorClass}>{s.first.cloneFailed(job.error)}</p>}
        </>
      )}
      {status && <p className={firstErrorClass}>{status}</p>}
    </section>
  );
}

/** What Seismic found at the folder `path` once it stopped changing for a moment: its main branch, or that it has no git; null until then. */
function useFolder(path: string): { branch?: string; noGit?: boolean } | null {
  const [found, setFound] = useState<{ path: string; branch?: string; noGit?: boolean } | null>(null);
  useEffect(() => {
    if (!path) return;
    const timer = setTimeout(() => api.setupFolder(path).then((f) => setFound({ path, branch: f.branch, noGit: f.folder }), () => setFound(null)), 300);
    return () => clearTimeout(timer);
  }, [path]);
  return found?.path === path ? found : null;
}

/** The path, once Seismic found a folder without git there (where git can be set up); else empty. */
export const useFolderWithoutGit = (path: string) => (useFolder(path)?.noGit ? path : '');

/** A line of text in the offer to set up git. */
const gitLineClass = 'hint my-1 mx-0';
/** A choice of the offer: a frame with its title and what it means. */
const gitChoiceClass = 'git-choice grid gap-1 [align-content:start] text-left bg-transparent py-2.5 px-3 border border-border rounded-lg cursor-pointer [&:hover:not(:disabled)]:border-foreground';
/** What the first commit holds, in two columns where there is room. */
const gitEntriesClass = 'git-entries list-none my-1.5 mx-0 p-0 max-w-[640px] [columns:2_260px] gap-x-6';

// what stays out, listed up to this many
const IGNORED_SHOWN = 12;

/**
 * A folder that has no git: the two ways on, each with what it means. Using it without git
 * (`onFolder`), or setting up git there: what the first commit holds (the folder's entries with
 * their sizes, large files marked, what stays out, the `.gitignore` Seismic writes), and only once the
 * owner confirms, the repository with its first commit. The first project and "+ Repository" in the
 * configuration both show it.
 */
export function GitSetup({ path, confirm, onDone, onFolder }: { path: string; confirm: string; onDone: (branch: string) => void; onFolder: () => void }) {
  const [preview, setPreview] = useState<GitSetupPreview | null>(null);
  const [busy, setBusy] = useState<'looking' | 'working' | null>(null);
  const [error, setError] = useState('');
  const s = t.setup.git;
  const failed = (e: unknown) => setError(failText(e, { detail: ['gitSetup', 'invalid'] }));
  const look = async () => {
    setBusy('looking');
    setError('');
    try {
      setPreview(await api.setupGitPreview(path));
    } catch (e) {
      failed(e);
    }
    setBusy(null);
  };
  const go = async () => {
    setBusy('working');
    setError('');
    try {
      const { branch } = await api.setupGit(path);
      onDone(branch);
    } catch (e) {
      failed(e);
    }
    setBusy(null);
  };
  const p = preview;
  return (
    <div className="git-setup my-2 mx-0 [&_code]:bg-transparent [&_code]:[border:0] [&_code]:p-0">
      {!p ? (
        <>
          <p className={gitLineClass}>{s.none}</p>
          {/* use the folder as it is, or set up git there; each with what it means */}
          <div className="git-choices grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5 max-w-[720px] my-1.5 mx-0">
            <button className={gitChoiceClass} disabled={!!busy} onClick={onFolder}>
              <b>{s.folder}</b>
              <span className="text-muted-foreground text-xs">{s.folderHint}</span>
            </button>
            <button className={gitChoiceClass} disabled={!!busy} onClick={look}>
              <b>{busy === 'looking' ? s.looking : s.offer}</b>
              <span className="text-muted-foreground text-xs">{s.offerHint}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <b className="block mt-1">{s.title}</b>
          <p className={gitLineClass}>{s.summary(p.files, fileSize(p.bytes), p.branch)}</p>
          <ul className={gitEntriesClass}>
            {p.entries.map((e) => (
              <GitEntry key={e.path} path={e.path} large={!e.dir && e.bytes >= LARGE_FILE} size={e.dir ? `${s.files(e.files)} · ${fileSize(e.bytes)}` : fileSize(e.bytes)} />
            ))}
          </ul>
          {p.large.length > 0 && (
            <div className="git-large my-2 mx-0">
              <b>{s.large}</b> <span className="hint">{s.largeHint}</span>
              <ul className={gitEntriesClass}>
                {p.large.map((f) => (
                  <GitEntry key={f.path} path={f.path} large size={fileSize(f.bytes)} />
                ))}
              </ul>
            </div>
          )}
          {p.ignored.length > 0 && (
            <p className="git-ignored my-1 mx-0">
              <b>{s.ignored}:</b> {p.ignored.slice(0, IGNORED_SHOWN).map((f, i) => (
                <Fragment key={f}>
                  {i > 0 && ', '}
                  <code>{f}</code>
                </Fragment>
              ))}
              {p.ignored.length > IGNORED_SHOWN && ` ${s.more(p.ignored.length - IGNORED_SHOWN)}`}
            </p>
          )}
          {p.gitignore !== undefined && (
            <Collapsible className="git-ignore-file">
              <CollapsibleTrigger className="hint">
                {s.gitignore} <u>{s.gitignoreShow}</u>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="font-mono text-xs my-1.5 mx-0 py-2 px-2.5 bg-card border border-border rounded-sm">{p.gitignore}</pre>
              </CollapsibleContent>
            </Collapsible>
          )}
          <p className={gitLineClass}>{s.change}</p>
          <div className={actionsClass}>
            <Button variant="primary" disabled={!!busy} onClick={go}>
              {busy === 'working' ? s.working : confirm}
            </Button>
            <Button size="small" disabled={!!busy} onClick={look}>
              {s.again}
            </Button>
            <Button size="small" disabled={!!busy} onClick={() => setPreview(null)}>
              {s.cancel}
            </Button>
          </div>
        </>
      )}
      {error && <p className={cn(firstErrorClass, '[#config_&]:mt-1.5 [#config_&]:text-sm')}>{error}</p>}
    </div>
  );
}

/** One of what the first commit holds: its path, its size on the right; a large file in the warning colour. */
function GitEntry({ path, large, size }: { path: string; large?: boolean; size: string }) {
  return (
    <li className={cn('flex justify-between gap-3 py-0.5 px-0 break-inside-avoid', large && 'large text-warning')}>
      <code className="[overflow-wrap:anywhere]">{path}</code>
      <span className={large ? 'flex-none text-xs' : 'hint flex-none'}>{size}</span>
    </li>
  );
}
