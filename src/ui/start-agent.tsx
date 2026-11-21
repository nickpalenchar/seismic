import { cn } from 'cn';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_DEFAULTS, AGENT_EFFORTS, catalogModel, modelEffort, modelEfforts, harnessChoice, projectAgentSetting, withAgyBase, type AgentEffort, type AgentModel, type AgentIdentity, type AgentRole, type AgentSetting, type ModelInfo, type Harness } from '../core/types';
import { catalogDefault, DefaultEffort, HarnessOptions, modelLabel, ModelOptions, useConnectedHarnesses } from './agent-options';
import { ApiError, api, onAgentSettingsChange } from './api';
import { updateDraft, useDraft, type StartAgentChoice } from './draft';
import { failText, t } from './strings';
import { Button, type ButtonVariant, LinkButton } from './components/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './components/popover';
import { Tooltip } from './components/tooltip';
import { Select, SelectItem } from './components/select';

/** The start button's two lines, its label over the agent it starts with; Approve takes them while a review is at work. */
export const startAgentMain = 'start-agent-main flex flex-col items-center justify-center gap-0 py-1 leading-[1.15]';
export const startAgentModel = 'start-agent-model text-2xs font-normal opacity-85 whitespace-nowrap';

/** What the role starts with on the shown project. */
const projectDefault = (role: AgentRole) => api.shownProjectSettings().then((v) => ({
  setting: projectAgentSetting(role, v.agents[role], v.settings.agents, v.harnesses),
  harnesses: v.harnesses,
}));

/** The configured Claude model is available even when the role normally uses another harness. */
function defaultModelFor(role: AgentRole, harness: Harness, inherited: AgentSetting) {
  if (harness === 'claude') return inherited.model === 'default' ? AGENT_DEFAULTS[role].model : inherited.model;
  return harness === inherited.harness ? harnessChoice(inherited).model : 'default';
}

function resolveStartChoice(role: AgentRole, choice: StartAgentChoice, inherited: AgentSetting, models?: ModelInfo[] | null): AgentSetting {
  const { followProjectModel, ...setting } = withAgyBase(choice, models);
  if (!followProjectModel) return setting.harness === 'agy' && !setting.agy ? { ...setting, agy: { model: 'default' } } : setting;
  const harness = setting.harness ?? 'claude';
  const model = defaultModelFor(role, harness, withAgyBase(inherited, models));
  if (harness === 'agy') return { ...setting, agy: { model, effort: setting.agy?.effort } };
  return harness === 'claude' ? { ...setting, model: model as AgentModel }
    : { ...setting, [harness]: { ...harnessChoice(setting), model } };
}

export const describeAgent = (s: AgentSetting, short = false, models?: ModelInfo[] | null) => {
    const a = t.config.agents;
    const harness = short ? a.harnessesShort : a.harnesses, efforts = short ? a.effortsShort : a.efforts;
    const setting = withAgyBase(s, s.harness === 'agy' ? models : null);
    const choice = harnessChoice(setting);
    const name = s.harness ?? 'claude';
    const model = choice.model === 'default' && name !== 'claude' ? catalogDefault(models) : choice.model;
    const selected = catalogModel(models, model);
    const effort = name === 'agy' ? setting.agy?.effort ?? modelEffort(selected) : choice.effort;
    return [harness[name], modelLabel(model, name), selected?.supportedReasoningEfforts.length === 0 || !effort ? '' : efforts[effort]].filter(Boolean).join(' · ');
  };

/** The harness and model an agent runs on, as a callout names it ("Claude · Opus", "Codex · gpt-5.5"); null where the model is not known. */
export const modelName = (a: AgentSetting | AgentIdentity | undefined): string | null => {
  if (!a) return null;
  const c = t.config.agents;
  const harness = a.harness ?? 'claude';
  const model = 'effort' in a ? harnessChoice(a).model : a.model;
  if (!model || model === 'default') return null;
  return `${c.harnessesShort[harness]} · ${modelLabel(model, harness)}`;
};

/** Whether a Codex or Antigravity choice stands in the catalog the harness offers now: its model, and the effort that model supports (any, for a model without efforts). */
const stands = (models: ModelInfo[], setting: AgentSetting) => {
  const normalized = withAgyBase(setting, setting.harness === 'agy' ? models : null);
  const choice = normalized.harness === 'agy' ? normalized.agy ?? { model: 'default' } : harnessChoice(normalized);
  const m = catalogModel(models, choice.model);
  return !!m && (!choice.effort || !m.supportedReasoningEfforts.length || modelEfforts(m).includes(choice.effort));
};

const catalogFor = (harness: 'codex' | 'agy') => harness === 'agy' ? api.agyModels() : api.codexModels();

/** A choice for this start only. The ordinary button continues to use the current default. */
export function StartAgent({ label, disabled, title, codexAllowed = true, selectionOnly = false, hint, draft, saved, role = 'worker', variant = 'primary', suggested = false, onStart }: { variant?: ButtonVariant; role?: AgentRole; suggested?: boolean; label: string; disabled?: boolean; title?: string; codexAllowed?: boolean; selectionOnly?: boolean; hint?: string; draft?: string; saved?: AgentSetting; onStart: (setting?: AgentSetting) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const connected = useConnectedHarnesses(open);
  const [setting, setSetting] = useState<StartAgentChoice | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  // which harness the catalog in `models` belongs to: after a switch the old one stands until the new one has loaded
  const [modelsOf, setModelsOf] = useState<Harness | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState<AgentSetting | null>(null);
  const [currentDefault, setCurrentDefault] = useState<AgentSetting | null>(null);
  const [configured, setConfigured] = useState<Harness[]>();
  // the choice made in the menu for this card: it stays after the menu closes, shows in the button's small text and is what the button starts with.
  // Kept in the card's draft where there is one, so it outlives closing the card.
  const [local, setLocal] = useState<StartAgentChoice | null>(null);
  const kept = useDraft(draft ?? '').agent ?? null;
  // what a queued card was started with stands until another is chosen: it is checked and started like a choice made here
  const picked: StartAgentChoice | null = (draft ? kept : local) ?? saved ?? null;
  const setPicked = (s: StartAgentChoice | null) => draft ? updateDraft(draft, { agent: s ?? undefined }) : setLocal(s);
  // a saved Codex or Antigravity choice is checked against the harness's catalog as it stands: on its own, when it is saved, and again as the button starts with it.
  // One the harness no longer offers stays shown and saved until the owner changes it, and the button does not start it.
  const pickedOther = picked?.harness === 'codex' || picked?.harness === 'agy' ? picked.harness : null;
  const disconnected = !!picked && configured?.includes(picked.harness ?? 'claude') === false;
  const noHarness = configured?.length === 0;
  const pickedKey = JSON.stringify([picked, picked?.followProjectModel ? currentDefault : null]);
  const [checked, setChecked] = useState<{ key: string; ok: boolean | null; error?: string } | null>(null);
  const validation = useRef(0);
  const [starting, setStarting] = useState(false);
  const startLock = useRef(false);
  const a = t.config.agents;
  const latestKey = useRef(pickedKey);
  latestKey.current = pickedKey;
  const latestAllowed = useRef(codexAllowed);
  latestAllowed.current = codexAllowed;
  const latestDisabled = useRef(!!disabled);
  latestDisabled.current = !!disabled;
  useEffect(() => {
    if (!picked || !pickedOther || disconnected || !codexAllowed || (picked.followProjectModel && !currentDefault)) return;
    let active = true;
    const ticket = ++validation.current;
    catalogFor(pickedOther).then(
      (models) => {
        const resolved = resolveStartChoice(role, picked, currentDefault ?? picked, pickedOther === 'agy' ? models : null);
        if (active && ticket === validation.current) setChecked({ key: pickedKey, ok: stands(models, resolved) });
      },
      (e) => { if (active && ticket === validation.current) setChecked({ key: pickedKey, ok: null, error: e instanceof ApiError ? e.message : failText(e) }); },
    );
    return () => { active = false; };
  }, [pickedKey, disconnected, codexAllowed, role]);
  const checking = !!pickedOther && !disconnected && codexAllowed && checked?.key !== pickedKey;
  const gone = disconnected || (!!pickedOther && (!codexAllowed || (checked?.key === pickedKey && checked.ok === false)));
  const [startError, setStartError] = useState('');
  // one start at a time, from the main button or the menu: the exact model and effort are checked against a fresh catalog first.
  // `key` names the saved choice the start records its check under. A start is dropped if the saved choice, the harness's availability or the parent's disabled state changed since the click.
  const start = async (stored: StartAgentChoice | undefined, key: string | null) => {
    let choice: AgentSetting | undefined = stored;
    const other = choice?.harness === 'codex' || choice?.harness === 'agy' ? choice.harness : null;
    if (startLock.current || latestDisabled.current || noHarness || (stored && configured?.includes(stored.harness ?? 'claude') === false) || (other && !codexAllowed)) return;
    startLock.current = true;
    setStarting(true);
    setOpen(false);
    setStartError('');
    const ticket = ++validation.current;
    const stale = () => latestKey.current !== pickedKey || (!!other && !latestAllowed.current) || latestDisabled.current;
    try {
      const inherited = stored?.followProjectModel ? (await projectDefault(role)).setting : undefined;
      if (stale()) return;
      if (stored) {
        const models = other ? await catalogFor(other) : null;
        if (stale()) return;
        choice = resolveStartChoice(role, stored, inherited ?? stored, other === 'agy' ? models : null);
        const ok = !models || stands(models, choice);
        if (key !== null && ticket === validation.current) setChecked({ key, ok });
        if (!ok) { setStartError(a.unavailableChoice); return; }
      }
      if (stale()) return;
      await onStart(choice);
    } catch (e) {
      if (!stale() && ticket === validation.current) {
        const text = e instanceof ApiError ? e.message : failText(e);
        if (key !== null) setChecked({ key, ok: null, error: text }); else setStartError(text);
      }
    } finally {
      startLock.current = false;
      setStarting(false);
    }
  };
  useEffect(() => setStartError(''), [pickedKey]);
  const startPicked = () => start(picked ?? undefined, pickedKey);
  const touched = useRef(false);
  const choose = (s: StartAgentChoice) => { touched.current = true; setSetting(s); };
  // the newest model request: an older one that answers late is dropped
  const request = useRef(0);
  const loadModels = async () => {
    setLoading(true); setError('');
    const harness = setting?.harness === 'agy' ? 'agy' : 'codex';
    const ticket = ++request.current;
    try {
      const list = await catalogFor(harness);
      if (ticket !== request.current) return;
      setModels(list); setModelsOf(harness);
    } catch (e) {
      if (ticket !== request.current) return;
      setModels(null);
      setModelsOf(harness);
      setError(e instanceof ApiError ? e.message : failText(e));
    }
    setLoading(false);
  };
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (open) {
      touched.current = false;
      ++request.current; setLoading(false);
      setSetting(null); setInitial(null); setError(''); setModels(null); setModelsOf(null);
    }
    let revision = 0;
    const refresh = () => {
      const ticket = ++revision;
      projectDefault(role).then(({ setting: value, harnesses }) => {
        if (ticket !== revision) return;
        setCurrentDefault(value);
        setConfigured(harnesses);
        if (open) {
          setSetting((existing) => {
            if (harnesses?.length === 0) return null;
            const previous = existing ?? picked;
            return previous && harnesses?.includes(previous.harness ?? 'claude') !== false ? previous : { ...value, followProjectModel: true };
          });
          setInitial(value);
        }
      }).catch((e) => {
        if (open && ticket === revision) setError(e instanceof ApiError ? e.message : failText(e));
      });
    };
    const unsubscribe = onAgentSettingsChange(refresh);
    refresh();
    return () => { ++revision; unsubscribe(); };
  }, [open, attempt, role]);
  // the keyboard lands in the menu once it has its choices (Radix returns it to the button that opened it)
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open && setting) first.current?.focus({ preventScroll: true }); }, [open, !!setting]);
  // a Claude choice needs no catalog: a request still pending for another harness is dropped, so it neither blocks the save nor answers later
  useEffect(() => {
    if (!open || !setting?.harness) return;
    if (setting.harness === 'claude') { ++request.current; setLoading(false); setError(''); } else void loadModels();
  }, [open, setting?.harness]);
  const other = setting?.harness === 'codex' || setting?.harness === 'agy' ? setting.harness : null;
  const codex = !!other;
  const current = modelsOf === other ? models : null;
  const harness = setting?.harness ?? 'claude';
  const defaultHarness = initial?.harness ?? 'claude';
  const accountModel = catalogDefault(current);
  const agyModels = other === 'agy' ? current : null;
  const baseline = initial ? defaultModelFor(role, harness, withAgyBase(initial, agyModels)) : 'default';
  const defaultModel = baseline === 'default' ? other ? accountModel : AGENT_DEFAULTS[role].model : baseline;
  const resolved = setting && resolveStartChoice(role, setting, initial ?? setting, agyModels);
  const choice = other === 'agy' ? resolved?.agy ?? { model: 'default' } : resolved ? harnessChoice(resolved) : { model: 'default', effort: 'high' as const };
  const model = choice.model === 'default' ? other ? accountModel : defaultModel : choice.model;
  const selected = catalogModel(current, model);
  const summary = noHarness || disconnected ? null : picked ?? currentDefault;
  const summaryHarness = summary?.harness;
  const [summaryModels, setSummaryModels] = useState<{ harness: Harness; models: ModelInfo[] } | null>(null);
  const needsCatalog = summary && (summaryHarness === 'agy' || harnessChoice(summary).model === 'default');
  useEffect(() => {
    if (!needsCatalog || (summaryHarness !== 'codex' && summaryHarness !== 'agy')) return;
    let active = true;
    catalogFor(summaryHarness).then((models) => {
      if (active) setSummaryModels({ harness: summaryHarness, models });
    }).catch(() => {});
    return () => { active = false; };
  }, [needsCatalog, summaryHarness]);
  const summaryCatalog = modelsOf === summaryHarness ? models : summaryModels?.harness === summaryHarness ? summaryModels?.models : null;
  const resolvedSummary = summary && summary === picked
    ? resolveStartChoice(role, picked, currentDefault ?? picked, summaryHarness === 'agy' ? summaryCatalog : null)
    : summary;
  const efforts = modelEfforts(selected);
  const effortless = !!selected && !efforts.length;
  const effort = choice.effort ?? modelEffort(selected);
  const valid = !!setting && (!codex || (codexAllowed && !!selected && (effortless || (!!effort && efforts.includes(effort)))));

  // Only a choice that can start is kept, so the main button never starts one the menu would refuse.
  useEffect(() => { if (touched.current && setting && valid && (!codex || !loading)) setPicked(setting); }, [setting, valid, loading]);

  const main = <Button variant={selectionOnly ? 'code-review' : variant} className={selectionOnly ? undefined : cn(startAgentMain, 'rounded-l-sm rounded-r-none')} disabled={disabled || starting || (!selectionOnly && (noHarness || checking || gone || (!!picked?.followProjectModel && !currentDefault)))} title={noHarness ? t.config.harnesses.empty : gone ? a.unavailableChoice : title} onClick={selectionOnly ? undefined : () => void startPicked()}>
    <span>{label}</span>
    {!selectionOnly && resolvedSummary && <span className={startAgentModel}>{describeAgent(resolvedSummary, true, summaryCatalog)}</span>}
  </Button>;
  return <Popover open={open} onOpenChange={setOpen}><div className="start-agent">
    <PopoverAnchor asChild><div className={cn('start-agent-buttons flex items-stretch', suggested && 'suggested rounded-sm shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--idea)]')}>
      {selectionOnly ? <PopoverTrigger asChild>{main}</PopoverTrigger> : main}
      {!selectionOnly && <Tooltip content={a.chooseStart}><PopoverTrigger asChild><Button type="button" variant={variant} className="start-agent-chevron rounded-l-none rounded-r-sm border-l border-l-[var(--background)] min-w-9" disabled={disabled || starting} aria-label={a.chooseStart}>
        <ChevronDown size={14} strokeWidth={2.5} aria-hidden />
      </Button></PopoverTrigger></Tooltip>}
    </div></PopoverAnchor>
    {!open && (startError || (checked?.key === pickedKey && checked.error)) && <p className="p-error" role="status">{startError || checked?.error}</p>}
    <PopoverContent side="top" align="start" aria-label={a.chooseStart} className="w-[min(380px,calc(100vw-16px))] max-h-[min(var(--radix-popover-content-available-height),600px)] p-4 text-sm [&_label]:my-2.5 [&_label]:flex [&_label]:items-center [&_label]:justify-between [&_label]:gap-3 [&_p]:m-0 [&_p]:mb-2.5 [&_[data-slot=select-trigger]]:max-w-[65%] [&_[data-slot=select-trigger]]:min-w-0">
      {noHarness && <p className="hint">{t.config.harnesses.empty}</p>}
      {initial && !noHarness && <p className="hint">{a.currentDefault}: {describeAgent(initial, false, modelsOf === initial.harness ? models : summaryModels?.harness === initial.harness ? summaryModels?.models : null)}</p>}
      {setting && <>
        <label>{a.harness}<Select triggerRef={first} value={setting.harness ?? 'claude'} onValueChange={(picked) => {
          const previous = picked === 'claude' ? setting.model : setting[picked as 'codex' | 'agy'];
          const follow = picked === defaultHarness || !previous || (picked === 'claude' && previous === initial?.model);
          choose({ ...setting, harness: picked as Harness, followProjectModel: follow ? true : undefined,
            ...(picked !== 'claude' ? { [picked]: previous ?? (picked === 'agy' ? { model: 'default' } : { model: 'default', effort: effort ?? 'high' }) } : {}),
          });
        }}>
          <HarnessOptions defaultHarness={defaultHarness} portable={codexAllowed} connected={connected} />
        </Select></label>
        {!codexAllowed && <p className="hint">{a.codexUnavailableHere}</p>}
        <label>{a.model}<Select value={model} disabled={codex && (!current || loading)} onValueChange={(picked) => {
          const followProjectModel = picked === defaultModel ? true : undefined;
          if (!codex) return choose({ ...setting, followProjectModel, model: picked as AgentModel });
          const next = catalogModel(current, picked);
          const model = other === 'agy' && picked === accountModel && baseline === 'default' ? 'default' : picked;
          const nextEffort = other === 'agy' && model === 'default' ? undefined : modelEffort(next, effort);
          choose({ ...setting, followProjectModel, ...(other === 'agy' ? { agy: { model, effort: nextEffort } } : { codex: { model, effort: nextEffort ?? choice.effort ?? 'high' } }) });
        }}>
          <ModelOptions harness={harness} models={current} value={model} defaultModel={defaultModel} />
        </Select></label>
        <label>{a.effort}{effortless ? <DefaultEffort label={a.effort} /> : <Select value={effort ?? ''} disabled={codex && (!selected || loading)} onValueChange={(picked) => choose(other ? { ...setting, [other]: { ...choice, effort: picked as AgentEffort } } : { ...setting, effort: picked as AgentEffort })}>
          {codex && effort && !efforts.includes(effort) && <SelectItem disabled value={effort}>{a.efforts[effort]} ({a.unavailable})</SelectItem>}
          {(codex ? efforts : AGENT_EFFORTS).map((e) => <SelectItem key={e} value={e}>{a.efforts[e]}</SelectItem>)}
        </Select>}</label>
        {other === 'agy' && <p className="hint">{a.agyScope}</p>}
      </>}
      {(error || loading) && <p className="p-error" role="status">{loading ? a.loadingModels : error} {error && (setting ? codex && <LinkButton onClick={loadModels}>{a.reloadModels}</LinkButton> : <LinkButton onClick={() => setAttempt(attempt + 1)}>{a.reloadModels}</LinkButton>)}</p>}
      {codex && current && !loading && !valid && <p className="p-error" role="status">{a.unavailableChoice}</p>}
      {hint && <p className="hint start-agent-warning flex items-start gap-1.5 [&_svg]:flex-none [&_svg]:mt-0.5"><CircleAlert size={15} aria-hidden /> {hint}</p>}
      <Button variant={selectionOnly ? 'code-review' : 'primary'} disabled={!valid || loading || starting || disabled} onClick={() => { if (setting) void start(setting, null); }}>{a.startWith}</Button>
    </PopoverContent>
  </div></Popover>;
}
