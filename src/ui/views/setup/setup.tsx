/**
 * The setup assistant, in steps: the agents the owner works with (Claude Code, Codex, Antigravity,
 * picked as several options), each with what it needs on this machine and git beside them; then the
 * features that can wait (pull requests, voice, demos, mobile development); on the first start (no
 * project yet) it fills the page and ends with the first project, from a folder or a clone. Each piece
 * is installed at a click where Seismic can, with the command for the rest and a terminal for the
 * logins. Later the settings open it over the project, without the last step.
 */

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { type AgentSetting, CLOUD_PRESETS, CLOUD_VOICES, type CloudPreset, firstProjectHarness, type GitSetupPreview, needsGit, LARGE_FILE, type Language, type MachineItem, type MachineSection, type MachineSectionId, type MachineView, type MobileId, RECOMMENDED_SECTIONS, type SetupItem, type SetupRepoCheck, type VoiceSetupItem } from '../../../core/types';
import { LANGUAGES } from '../../../core/locale';
import { api, reload } from '../../api';
import { useCopy } from '../../copy';
import { Sign } from '../../logo';
import { failText, fileSize, t } from '../../strings';
import { projectPath } from '../../address';
import { Button, CloseButton, LinkButton } from '../../components/button';
import { RadioGroup, RadioOption } from '../../components/radio';
import { Checkbox } from '../../components/checkbox';
import { CheckLabel } from '../../components/check-label';
import { Badge } from '../../components/badge';
import { Spinner } from '../../components/spinner';
import { Callout, CalloutDescription, type CalloutKind, CalloutTitle } from '../../components/callout';
import { Check, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Input } from '../../components/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/collapsible';
import { Select, SelectItem } from '../../components/select';
import { Dialog, DialogContent, DialogTitle } from '../../components/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/popover';
import { cn } from 'cn';
import { installClass, installHintClass, pathClass, projectClass, rowClass, setupItemClass, setupListClass, statusClass } from '../../setupClasses';

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

const ready = (items: MachineItem[] | undefined) => !!items?.length && items.every((i) => i.state !== 'missing');

/** The agents the first step offers, in its order; Pi is not there yet. */
const AGENTS = ['claude', 'codex', 'agy', 'pi'] as const;
type Agent = (typeof AGENTS)[number];
/** The section that checks each agent; Claude Code's shares the needed one with git. */
const AGENT_SECTION: Record<Exclude<Agent, 'pi'>, MachineSectionId> = { claude: 'needed', codex: 'codex', agy: 'agents' };
const GIT_ITEMS: readonly MachineItem['id'][] = ['git', 'gitUser'];
/** How often the list checks again while a login it waits for is missing. */
const LOGIN_POLL_MS = 15000;
/** The assistant's steps: the agents, the features that can wait, and on the first start the first project. */
type Step = 'agents' | 'recommended' | 'first';

/** The steps as a bar of segments, one per step, filled up to the current one; a step reached before is a click away. */
function Steps({ steps, at, furthest, onPick }: { steps: readonly Step[]; at: Step; furthest: number; onPick: (s: Step) => void }) {
  const s = t.setup;
  const now = steps.indexOf(at);
  return (
    <ol aria-label={s.step(now + 1, steps.length)} className={cn('setup-steps grid gap-3 mt-4 mb-1 mx-0 p-0 list-none', steps.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {steps.map((step, i) => (
        <li key={step}>
          <button
            type="button"
            disabled={i > furthest || i === now}
            aria-current={i === now ? 'step' : undefined}
            onClick={() => onPick(step)}
            className="grid w-full gap-1.5 text-left bg-transparent [border:0] p-0 text-foreground cursor-pointer disabled:cursor-default [&:hover:not(:disabled)_.c-label]:underline"
          >
            <span className={cn('block h-1.5 rounded-full transition-colors duration-300', i <= now ? 'bg-primary' : 'bg-muted')} aria-hidden />
            <span className={cn('c-label text-xs', i === now ? 'font-semibold' : 'text-muted-foreground')}>
              {i + 1}. {s.steps[step]}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** "Check again", disabled with a spinner while a check runs. */
function CheckAgain({ checking, disabled, variant, onClick }: { checking: boolean; disabled?: boolean; variant?: 'ghost'; onClick: () => void }) {
  return (
    <Button size="small" variant={variant} disabled={checking || disabled} onClick={onClick}>
      {checking && <Spinner className="size-3.5" aria-hidden />}
      {checking ? t.config.setup.checking : t.config.setup.recheck}
    </Button>
  );
}

export function Setup({ first, onClose }: { first?: boolean; onClose?: () => void }) {
  const [view, setView] = useState<MachineView | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  const [terminal, setTerminal] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('agents');
  const [furthest, setFurthest] = useState(0);
  // the agents the owner picked; until then those already there, or Claude Code
  const [picked, setPicked] = useState<Agent[] | null>(null);
  const shown = useRef(false);
  shown.current = !!view;
  const failed = (e: unknown) => setStatus(failText(e, { detail: ['invalid', 'config'] }));
  // One check at a time: one asked for while another runs follows it, so the list ends on what the
  // machine looks like after the last ask. `version` counts the lists set from elsewhere (an install, the
  // identity, the first project), so a check that started before one of them does not overwrite it.
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef<Promise<void> | null>(null);
  const version = useRef(0);
  const update = (v: MachineView) => {
    version.current++;
    setView(v);
  };
  /** Settles once a check that started after this call has ended. */
  const recheck = (): Promise<void> => {
    if (inFlight.current) return (again.current ??= inFlight.current.then(() => ((again.current = null), check())));
    return check();
  };
  const check = (): Promise<void> => {
    setChecking(true);
    const at = version.current;
    const run = api
      .setup()
      .then(
        (v) => void (at === version.current && setView(v)),
        // a check that fails (the server starting again) keeps the list it had
        (e) => void (shown.current ? console.error(e) : failed(e)),
      )
      .finally(() => {
        inFlight.current = null;
        if (!again.current) setChecking(false);
      });
    inFlight.current = run;
    return run;
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
    const timer = setInterval(recheck, 1500);
    return () => clearInterval(timer);
  }, [running]);

  const s = t.setup;
  const act = async (section: MachineSection, i: MachineItem) => {
    setStatus('');
    setTerminal(null);
    try {
      if (i.act === 'install') update(await api.setupInstall(section.id, i.id));
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
    if (i.act === 'identity') return <Identity onSaved={update} onError={failed} />;
    const detail = section.id === 'voice' && i.id === 'recognition' && <RecognitionDetail item={i} busy={running} changed={recheck} />;
    if (!i.act) return detail || null;
    if (i.act === 'login' || i.act === 'terminal')
      return (
        <>
          <Button size="small" onClick={() => act(section, i)}>
            {i.act === 'terminal' ? s.mobile.enable : s.login}
          </Button>
          <CheckAgain variant="ghost" checking={checking} onClick={recheck} />
          {terminal === i.id ? <span className="hint">{i.act === 'terminal' ? s.mobile.enableOpen : s.terminalOpen}</span> : awaitsLogin(i) && <span className="hint">{s.checksItself}</span>}
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
    const login = i.id === 'claudeLogin' || i.id === 'ghLogin' || i.id === 'agyLogin' || i.id === 'codexLogin';
    if (i.state === 'ok') return login ? (i.found ? s.loggedInAs(i.found) : s.loggedIn) : (i.found ?? t.config.setup.there);
    if (login && !i.act) return { claudeLogin: s.claudeFirst, ghLogin: s.ghFirst, agyLogin: s.agyFirst, codexLogin: s.codexFirst }[i.id as 'claudeLogin'];
    if (login) return s.loggedOut;
    if (i.id === 'gitUser') return s.noIdentity;
    return t.config.setup.missing;
  };

  const sectionOf = (id: MachineSectionId) => view?.sections.find((x) => x.id === id);
  const needed = sectionOf('needed');
  const claude = needed?.items.find((i) => i.id === 'claude');
  const gitItems = needed?.items.filter((i) => GIT_ITEMS.includes(i.id)) ?? [];
  /** An agent's own pieces, without the git it shares with the others. */
  const agentItems = (a: Agent) => (a === 'pi' ? [] : (sectionOf(AGENT_SECTION[a])?.items.filter((i) => !GIT_ITEMS.includes(i.id)) ?? []));
  const chosen = picked ?? (view ? (() => {
    const there = AGENTS.filter((a) => ready(agentItems(a)));
    return there.length ? there : (['claude'] as Agent[]);
  })() : []);
  // an agent is configured once its own pieces and git are there: its Ready badge, the count and the steps after the first all go by this
  const isConfigured = (a: Agent) => ready(agentItems(a)) && ready(gitItems);
  const configured = chosen.filter(isConfigured);
  // without a configured agent only the first step is open, however far the owner got before
  const gated = !!view && !configured.length;
  const recommended = view?.sections.filter((x) => RECOMMENDED_SECTIONS.includes(x.id)) ?? [];
  const open = recommended.filter((x) => !ready(x.items));
  const steps: Step[] = first ? ['agents', 'recommended', 'first'] : ['agents', 'recommended'];
  const top = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const go = (to: Step) => {
    if (gated && to !== 'agents') return;
    setStep(to);
    // a new step starts at its top: over the project the body scrolls, on the first start the page
    requestAnimationFrame(() => {
      if (body.current) body.current.scrollTop = 0;
      if (first) top.current?.scrollIntoView({ block: 'start' });
    });
    setFurthest((f) => Math.max(f, steps.indexOf(to)));
  };
  // an agent that stops being configured (logged out, unpicked) takes the owner back to the first step
  useEffect(() => {
    if (gated && step !== 'agents') go('agents');
  }, [gated, step]);
  // A login done in a shell of its own (over SSH, say) brings no focus back to this page: while a login
  // on the step shown is missing (those of the picked agents first, then the recommended ones), the list
  // checks again by itself, whether or not Seismic could open a terminal for it.
  const awaitsLogin = (i: MachineItem) => i.state === 'missing' && (i.act === 'login' || i.act === 'terminal');
  const shownItems = step === 'agents' ? chosen.flatMap(agentItems) : step === 'recommended' ? recommended.flatMap((x) => x.items) : [];
  const polling = shownItems.some(awaitsLogin);
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => document.visibilityState === 'visible' && !inFlight.current && recheck(), LOGIN_POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);
  const toggle = (a: Agent, on: boolean) => setPicked(on ? AGENTS.filter((x) => x === a || chosen.includes(x)) : chosen.filter((x) => x !== a));

  /** A block of the list: its title, how much of it is still open, its pieces. `canWait`: tagged as one that can wait. */
  const block = (key: string, section: MachineSection, items: MachineItem[], title: string, hint: string, canWait = false, after?: ReactNode) => (
    <section key={key} className={cn(projectClass, 'c-setup', `setup-${key}`, '[&>.hint]:mt-0.5 [&>.hint]:mb-1.5 [&>.hint]:mx-0')}>
      <div className={sectionHeadClass}>
        <b>{title}</b>
        {canWait && <span className="setup-tag text-2xs py-px px-2 rounded-xs bg-muted text-muted-foreground">{s.optional}</span>}
        {section.mb > 0 && <span className="hint">{s.size(fileSize(section.mb * 1e6))}</span>}
        <span className={cn('setup-ok ml-auto text-xs', ready(items) ? 'on text-approved' : 'text-destructive')}>
          {!ready(items) ? s.open(items.filter((i) => i.state === 'missing').length) : items.some((i) => i.state === 'later') ? s.readyLater : s.ready}
        </span>
      </div>
      <p className="hint">{hint}</p>
      <SetupList items={items} name={name(section)} state={state(section)} action={action(section)} />
      {after}
    </section>
  );
  const recheckButton = (
    <CheckAgain checking={checking} disabled={running} onClick={recheck} />
  );

  return (
    <SetupShell first={first} onClose={onClose}>
        <header ref={top} className={cn('setup-head scroll-mt-14 flex items-center gap-3.5', !first && 'flex-none pr-7')}>
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
        <div ref={body} className={cn('setup-body', !first && 'flex-[1_1_auto] min-h-0 overflow-y-auto pt-0 pr-7 pb-6 pl-0')}>
          <Steps steps={steps} at={step} furthest={gated ? 0 : furthest} onPick={go} />
          <p className="setup-intro text-muted-foreground text-sm leading-normal mt-3.5 mb-1 mx-0">{first ? s.introFirst : s.intro}</p>
          {!view ? (
            <p className="hint">{checking ? t.config.setup.checking : status}</p>
          ) : (
            <>
              {step !== 'first' && <p className="hint">{s.platform(platformName(view))}</p>}
              {step === 'agents' && (
                <>
                  <section className={cn(projectClass, 'setup-pick')}>
                    <div className={sectionHeadClass}>
                      <b id="setup-pick">{s.pick.title}</b>
                    </div>
                    <p className="hint mt-0.5 mb-2">{s.pick.hint}</p>
                    <div role="group" aria-labelledby="setup-pick" className="grid grid-cols-2 gap-2.5">
                      {AGENTS.map((a) => {
                        const soon = a === 'pi';
                        const on = chosen.includes(a);
                        return (
                          <CheckLabel
                            key={a}
                            className={cn(
                              'setup-agent items-start gap-3 rounded-lg border border-solid py-3 px-3.5 transition-colors',
                              soon ? 'border-border opacity-60 cursor-default' : on ? 'on border-primary bg-primary/5' : 'border-border [&:hover]:border-foreground',
                            )}
                          >
                            <Checkbox className="mt-0.5" checked={on} disabled={soon} onCheckedChange={(c) => toggle(a, c === true)} />
                            <span className="grid gap-0.5 min-w-0">
                              <span className="flex items-center gap-2">
                                <b>{s.agentNames[a]}</b>
                                {!soon && isConfigured(a) && (
                                  <Badge variant="secondary" className="text-approved">
                                    <Check aria-hidden />
                                    {s.agentReady}
                                  </Badge>
                                )}
                              </span>
                              <span className="hint">{s.agentHints[a]}</span>
                            </span>
                          </CheckLabel>
                        );
                      })}
                    </div>
                  </section>
                  {needed &&
                    chosen.map((a) => {
                      if (a === 'pi') return null;
                      const section = sectionOf(AGENT_SECTION[a]);
                      if (!section) return null;
                      const hint = a === 'claude' ? s.sections.needed.hint : s.sections[section.id].hint;
                      return block(
                        a,
                        section,
                        agentItems(a),
                        s.agentNames[a],
                        hint,
                        false,
                        a === 'claude' && claude?.state === 'ok' && claude.found && !claude.found.startsWith(view.checkedClaude) && <p className="hint">{s.checkedWith(view.checkedClaude)}</p>,
                      );
                    })}
                  {needed && chosen.length > 0 && block('git', needed, gitItems, s.gitBlock.title, s.gitBlock.hint)}
                  {status && <p className={`hint ${statusClass}`}>{status}</p>}
                  {recheckButton}
                  <StepFooter
                    callout={configured.length ? 'success' : 'info'}
                    text={!configured.length ? s.proceed.none : configured.length === 1 ? s.proceed.one(s.agentNames[configured[0]!]) : s.proceed.many(configured.length)}
                  >
                    <Button variant="primary" disabled={!configured.length} onClick={() => go('recommended')}>
                      {s.next}
                    </Button>
                  </StepFooter>
                </>
              )}
              {step === 'recommended' && (
                <>
                  {recommended.map((section) =>
                    block(section.id, section, section.items, s.sections[section.id].title, s.sections[section.id].hint, true, section.id === 'mobile' && <p className="hint">{s.mobile.simulatorSafari}</p>),
                  )}
                  {status && <p className={`hint ${statusClass}`}>{status}</p>}
                  {recheckButton}
                  <StepFooter
                    callout={open.length ? 'warn' : undefined}
                    text={open.length === 1 ? s.skip.one(s.sections[open[0]!.id].title) : s.skip.many(open.length)}
                  >
                    <Button size="small" onClick={() => go('agents')}>
                      {s.back}
                    </Button>
                    {first ? (
                      <Button variant="primary" disabled={gated} onClick={() => go('first')}>
                        {s.next}
                      </Button>
                    ) : (
                      onClose && (
                        <Button variant="primary" onClick={onClose}>
                          {s.done}
                        </Button>
                      )
                    )}
                  </StepFooter>
                </>
              )}
              {step === 'first' && first && (
                <>
                  <FirstProject view={view} ready={configured.length > 0} agents={configured} onView={update} />
                  <div className={actionsClass}>
                    <Button size="small" onClick={() => go('recommended')}>
                      {s.back}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
    </SetupShell>
  );
}

/** The end of a step: what going on means as a callout (`callout`: its kind; none, no callout), and the buttons. */
function StepFooter({ callout, text, children }: { callout?: CalloutKind; text: string; children: ReactNode }) {
  return (
    <div className="setup-footer mt-5 grid gap-3">
      {callout && (
        <Callout kind={callout} className="setup-callout">
          {callout === 'success' ? <CircleCheck aria-hidden /> : callout === 'warn' ? <TriangleAlert aria-hidden /> : <Info aria-hidden />}
          <CalloutTitle>{text}</CalloutTitle>
        </Callout>
      )}
      <div className="c-actions flex gap-2 justify-end">{children}</div>
    </div>
  );
}

/** The assistant's pane: frost's glass, its commands in the page's mono. */
const pageClass = 'setup-page frost-pane max-w-[720px] pt-6 px-7 pb-6 [&_code]:font-mono [&_code]:text-xs';
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
function FirstProject({ view, ready, agents, onView }: { view: MachineView; ready: boolean; agents: Agent[]; onView: (v: MachineView) => void }) {
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
  // the harness the project's workers will run in: one set before stays, else the first project's from the agents configured
  const worker = useWorkerSetting();
  const harness = worker ? (worker.harness ?? firstProjectHarness(agents)) : undefined;
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
      const out = await api.setupProject({ ...(mode === 'folder' ? { path, ...(withoutGit ? { git: false as const } : {}) } : { clone, into }), agents });
      if ('project' in out) setSaved(out);
      else onView(out);
    } catch (e) {
      failed(e);
    }
    setBusy(false);
  };
  const repo = useRepoCheck(view);
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
              {noGit && <GitSetup key={path.trim()} path={path.trim()} confirm={s.git.confirmProject} gitOnly={needsGit(harness) ? harness : undefined} onDone={() => create()} onFolder={() => create(true)} />}
            </>
          ) : (
            <>
              <label className={fieldClass}>
                <span className={fieldLabelClass}>{s.first.repo}</span>
                <Input className={cn(pathClass, firstPathClass)} spellCheck={false} placeholder={s.first.repoPlaceholder} value={clone} onChange={(e) => setClone(e.target.value)} onBlur={() => repo.left(clone)} />
              </label>
              {repo.line(clone)}
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

/** A repository that could not be read and that gh's login may open: GitHub's, with gh logged out. */
const awaitsLogin = (r: SetupRepoCheck) => !r.readable && r.github && !r.ghLogin;

/**
 * Whether Seismic can read the repository named for a clone: read when the owner leaves the field with
 * another name in it than the one read last, a spinner below it meanwhile, then the result. Where GitHub
 * may hide a private repository from a stranger, the line offers gh's login, and reads it again once
 * the list sees the login (back from the terminal, the page checks the machine again).
 */
function useRepoCheck(view: MachineView) {
  const [checked, setChecked] = useState<{ spec: string; result: SetupRepoCheck | 'checking' } | null>(null);
  const [terminal, setTerminal] = useState<'open' | 'none' | null>(null);
  const asked = useRef(0);
  const s = t.setup;
  // the read under way, if any: a quiet one waits for it rather than superseding it
  const pending = useRef<Promise<unknown> | null>(null);
  /**
   * `quiet`: a read again while the login is awaited, which keeps the line as it is until the answer
   * differs, and is left out while another read runs (the newest read wins, so polls that each
   * superseded the one before would never let an answer through when a read takes longer than a poll).
   */
  const read = (spec: string, quiet = false): Promise<unknown> => {
    if (quiet && pending.current) return pending.current;
    const n = ++asked.current;
    if (!quiet) {
      setTerminal(null);
      setChecked(spec ? { spec, result: 'checking' } : null);
    }
    if (!spec) return (pending.current = null), Promise.resolve();
    const run = api.setupRepo(spec).then(
      (result) => {
        if (n !== asked.current) return;
        if (!quiet || result.readable || !awaitsLogin(result)) setTerminal(null);
        setChecked({ spec, result });
      },
      (e) => n === asked.current && !quiet && setChecked({ spec, result: { readable: false, error: failText(e), github: false, ghLogin: true } }),
    ).finally(() => {
      if (pending.current === run) pending.current = null;
    });
    pending.current = run;
    return run;
  };
  const ghLogin = view.sections.find((x) => x.id === 'pr')?.items.find((i) => i.id === 'ghLogin');
  const loggedIn = ghLogin?.state === 'ok';
  const result = checked?.result;
  const awaiting = !!result && result !== 'checking' && awaitsLogin(result);
  useEffect(() => {
    if (loggedIn && awaiting) read(checked!.spec);
  }, [loggedIn]);
  // A login done in a terminal of its own (over SSH, say) brings no focus back to this page, and the
  // step lists no login that the page's own polling would wait for: while the line offers the login,
  // it reads the repository again by itself, as the logins of the steps before check themselves.
  // The next poll is set only once the one before has settled, so polls never pile up behind a slow read.
  useEffect(() => {
    if (!awaiting) return;
    const spec = checked!.spec;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const next = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await read(spec, true).catch(() => {});
        if (!stopped) next();
      }, LOGIN_POLL_MS);
    };
    next();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [awaiting, checked?.spec]);
  const login = async () => {
    try {
      const { opened } = await api.setupLogin('pr', 'ghLogin');
      setTerminal(opened ? 'open' : 'none');
    } catch {
      setTerminal('none');
    }
  };
  /** The line under the field, for what it holds now; nothing once it differs from what was read. */
  const line = (value: string) => {
    if (!checked || checked.spec !== value.trim()) return null;
    const r = checked.result;
    if (r === 'checking')
      return (
        <p className="setup-repo hint flex items-center gap-1.5 mt-0.5 mb-1.5">
          <Spinner className="size-3.5" aria-hidden />
          {s.first.repoChecking}
        </p>
      );
    if (r.readable)
      return (
        <p className="setup-repo hint flex items-center gap-1.5 mt-0.5 mb-1.5 text-approved">
          <Check className="size-3.5" aria-hidden />
          {s.first.repoReadable}
        </p>
      );
    const canLogin = awaitsLogin(r);
    return (
      <div className="setup-repo mt-0.5 mb-1.5">
        {r.needsPassword ? (
          <div className="flex items-center gap-1 text-warning text-xs">
            <span role="status">{s.first.repoNeedsPassword}</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" className="size-6 p-0 text-warning" aria-label={s.first.repoPasswordInfo}>
                  <Info aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="z-90" aria-label={s.first.repoPasswordInfo}>{s.first.repoPasswordDetail}</PopoverContent>
            </Popover>
          </div>
        ) : (
          <p role="alert" className={cn(firstErrorClass, 'mt-0')}>{s.first.repoUnreadable(r.error)}</p>
        )}
        {canLogin && ghLogin?.act === 'login' && (
          <>
            <p className="hint mt-1 mb-1">{s.first.repoLogin}</p>
            <span className={rowClass}>
              <Button size="small" onClick={login}>
                {s.first.repoLoginButton}
              </Button>
              <Button size="small" variant="ghost" onClick={() => read(checked.spec)}>
                {s.first.repoAgain}
              </Button>
              <span className="hint">{terminal === 'open' ? s.terminalOpen : terminal === 'none' ? s.noTerminal : s.first.repoChecksItself}</span>
            </span>
          </>
        )}
        {canLogin && ghLogin?.act !== 'login' && <p className="hint mt-1 mb-0">{s.first.repoNoGh}</p>}
      </div>
    );
  };
  return { left: (value: string) => value.trim() !== checked?.spec && read(value.trim()), line };
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

/** Configuration's setting for workers ("Agents and models"), as saved; null until it has loaded. */
export function useWorkerSetting(): AgentSetting | null {
  const [setting, setSetting] = useState<AgentSetting | null>(null);
  useEffect(() => {
    api.agents().then((v) => setSetting(v.agents.worker), () => {});
  }, []);
  return setting;
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
 * configuration both show it. Where the workers run in a harness that needs git (`gitOnly`), only setting it up is offered, and why.
 */
export function GitSetup({ path, confirm, gitOnly, onDone, onFolder }: { path: string; confirm: string; gitOnly?: 'codex' | 'agy' | undefined; onDone: (branch: string) => void; onFolder: () => void }) {
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
          {gitOnly ? (
            <Callout kind="info" className="git-only max-w-[720px] my-1.5">
              <Info aria-hidden />
              <CalloutTitle>{s.gitOnly.title(t.setup.agentNames[gitOnly])}</CalloutTitle>
              <CalloutDescription>{s.gitOnly.text(t.setup.agentNames[gitOnly])}</CalloutDescription>
            </Callout>
          ) : (
            <p className={gitLineClass}>{s.none}</p>
          )}
          {/* use the folder as it is, or set up git there; each with what it means */}
          <div className="git-choices grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5 max-w-[720px] my-1.5 mx-0">
            {!gitOnly && (
              <button className={gitChoiceClass} disabled={!!busy} onClick={onFolder}>
                <b>{s.folder}</b>
                <span className="text-muted-foreground text-xs">{s.folderHint}</span>
              </button>
            )}
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
