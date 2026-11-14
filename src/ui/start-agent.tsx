import { cn } from 'cn';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, projectAgentSetting, type AgentEffort, type AgentModel, type AgentSetting, type CodexModel, type Harness } from '../core/types';
import { ApiError, api } from './api';
import { updateDraft, useDraft } from './draft';
import { failText, t } from './strings';
import { Button, type ButtonVariant, LinkButton } from './components/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './components/popover';
import { Tooltip } from './components/tooltip';
import { Select, SelectItem } from './components/select';

/** The start button's two lines, its label over the agent it starts with; Approve takes them while a review is at work. */
export const startAgentMain = 'start-agent-main flex flex-col items-center justify-center gap-0 py-1 leading-[1.15]';
export const startAgentModel = 'start-agent-model text-[9.5px] font-normal opacity-85 whitespace-nowrap';

/** What a worker on the shown project starts with: its own models over Configuration's. */
const workerDefault = () => api.shownProjectSettings().then((v) => projectAgentSetting('worker', v.agents.worker, v.settings.agents));

export const describeAgent = (s: AgentSetting, short = false) => {
    const a = t.config.agents;
    const harness = short ? a.harnessesShort : a.harnesses, efforts = short ? a.effortsShort : a.efforts;
    const o = s.harness === 'codex' || s.harness === 'agy' ? s.harness : null;
    return o ? `${harness[o]} · ${s[o]?.model ?? (o === 'agy' ? a.agyDefault : a.codexDefault)} · ${efforts[s[o]?.effort ?? 'high']}` : `${harness.claude} · ${a.models[s.model]} · ${efforts[s.effort]}`;
  };

/** Whether a Codex or Antigravity choice stands in the catalog the harness offers now: its model, and the effort that model supports. */
const stands = (models: CodexModel[], c: { model: string; effort: AgentEffort }) => {
  const m = models.find((x) => c.model === 'default' ? x.isDefault : x.model === c.model);
  return !!m?.supportedReasoningEfforts.some((x) => x.reasoningEffort === c.effort);
};

/** A choice for this start only. The ordinary button continues to use the current default. */
export function StartAgent({ label, disabled, title, codexAllowed = true, selectionOnly = false, hint, draft, saved, variant = 'primary', suggested = false, onStart }: { variant?: ButtonVariant; suggested?: boolean; label: string; disabled?: boolean; title?: string; codexAllowed?: boolean; selectionOnly?: boolean; hint?: string; draft?: string; saved?: AgentSetting; onStart: (setting?: AgentSetting) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [setting, setSetting] = useState<AgentSetting | null>(null);
  const [models, setModels] = useState<CodexModel[] | null>(null);
  // which harness the catalog in `models` belongs to: after a switch the old one stands until the new one has loaded
  const [modelsOf, setModelsOf] = useState<Harness | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initial, setInitial] = useState<AgentSetting | null>(null);
  const [currentDefault, setCurrentDefault] = useState<AgentSetting | null>(null);
  // the choice made in the menu for this card: it stays after the menu closes, shows in the button's small text and is what the button starts with.
  // Kept in the card's draft where there is one, so it outlives closing the card.
  const [local, setLocal] = useState<AgentSetting | null>(null);
  const kept = useDraft(draft ?? '').agent ?? null;
  // what a queued card was started with stands until another is chosen: it is checked and started like a choice made here
  const picked = (draft ? kept : local) ?? saved ?? null;
  const setPicked = (s: AgentSetting | null) => draft ? updateDraft(draft, { agent: s ?? undefined }) : setLocal(s);
  // a saved Codex or Antigravity choice is checked against the harness's catalog as it stands: on its own, when it is saved, and again as the button starts with it.
  // One the harness no longer offers stays shown and saved until the owner changes it, and the button does not start it.
  const pickedOther = picked?.harness === 'codex' || picked?.harness === 'agy' ? picked.harness : null;
  const pickedKey = JSON.stringify(picked);
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
  const standsNow = async (s: AgentSetting & { harness: 'codex' | 'agy' }) =>
    (s.harness === 'agy' ? api.agyModels() : api.codexModels()).then((m) => stands(m, s[s.harness] ?? { model: 'default', effort: 'high' as const }));
  useEffect(() => {
    if (!picked || !pickedOther || !codexAllowed) return;
    let active = true;
    const ticket = ++validation.current;
    standsNow({ ...picked, harness: pickedOther }).then(
      (ok) => { if (active && ticket === validation.current) setChecked({ key: pickedKey, ok }); },
      (e) => { if (active && ticket === validation.current) setChecked({ key: pickedKey, ok: null, error: e instanceof ApiError ? e.message : failText(e) }); },
    );
    return () => { active = false; };
  }, [pickedKey, codexAllowed]);
  const checking = !!pickedOther && codexAllowed && checked?.key !== pickedKey;
  const gone = !!pickedOther && (!codexAllowed || (checked?.key === pickedKey && checked.ok === false));
  const [startError, setStartError] = useState('');
  // one start at a time, from the main button or the menu: the exact model and effort are checked against a fresh catalog first.
  // `key` names the saved choice the start records its check under. A start is dropped if the saved choice, the harness's availability or the parent's disabled state changed since the click.
  const start = async (choice: AgentSetting | undefined, key: string | null) => {
    const other = choice?.harness === 'codex' || choice?.harness === 'agy' ? choice.harness : null;
    if (startLock.current || latestDisabled.current || (other && !codexAllowed)) return;
    startLock.current = true;
    setStarting(true);
    setOpen(false);
    setStartError('');
    const ticket = ++validation.current;
    const stale = () => latestKey.current !== pickedKey || (!!other && !latestAllowed.current) || latestDisabled.current;
    try {
      if (choice && other) {
        const ok = await standsNow({ ...choice, harness: other });
        if (stale()) return;
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
  const choose = (s: AgentSetting) => { touched.current = true; setSetting(s); };
  // the newest model request: an older one that answers late is dropped
  const request = useRef(0);
  const loadModels = async () => {
    setLoading(true); setError('');
    const harness = setting?.harness === 'agy' ? 'agy' : 'codex';
    const ticket = ++request.current;
    try {
      const list = await (harness === 'agy' ? api.agyModels() : api.codexModels());
      if (ticket !== request.current) return;
      setModels(list); setModelsOf(harness);
      if (picked && pickedOther === harness && latestKey.current === pickedKey) {
        ++validation.current;
        setChecked({ key: pickedKey, ok: stands(list, picked[harness] ?? { model: 'default', effort: 'high' }) });
      }
    } catch (e) { if (ticket !== request.current) return; setError(e instanceof ApiError ? e.message : failText(e)); }
    setLoading(false);
  };
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    workerDefault().then((v) => { if (active) setCurrentDefault(v); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    touched.current = false;
    ++request.current; setLoading(false);
    setSetting(null); setInitial(null); setError(''); setModels(null); setModelsOf(null);
    workerDefault().then((v) => { if (active) { setSetting(picked ?? v); setInitial(v); } }).catch((e) => { if (active) setError(e instanceof ApiError ? e.message : failText(e)); });
    return () => { active = false; };
  }, [open, attempt]);
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
  const choice = (other && setting?.[other]) || { model: 'default', effort: 'high' as const };
  const current = modelsOf === other ? models : null;
  const selected = current?.find((m) => choice.model === 'default' ? m.isDefault : m.model === choice.model);
  const efforts = AGENT_EFFORTS.filter((e) => selected?.supportedReasoningEfforts.some((x) => x.reasoningEffort === e));
  const valid = !!setting && (!codex || (codexAllowed && !!selected && efforts.includes(choice.effort)));

  // only a choice that can start is kept, so the main button never starts one the menu would refuse
  useEffect(() => { if (touched.current && setting && valid && (!codex || !loading)) setPicked(setting); }, [setting, valid, loading]);

  const main = <Button variant={selectionOnly ? 'code-review' : variant} className={selectionOnly ? undefined : cn(startAgentMain, 'rounded-l-[6px] rounded-r-none')} disabled={disabled || starting || (!selectionOnly && (checking || gone))} title={gone ? a.unavailableChoice : title} onClick={selectionOnly ? undefined : () => void startPicked()}>
    <span>{label}</span>
    {!selectionOnly && (picked ?? currentDefault) && <span className={startAgentModel}>{describeAgent((picked ?? currentDefault)!, true)}</span>}
  </Button>;
  return <Popover open={open} onOpenChange={setOpen}><div className="start-agent">
    <PopoverAnchor asChild><div className={cn('start-agent-buttons flex items-stretch', suggested && 'suggested rounded-[6px] shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--idea)]')}>
      {selectionOnly ? <PopoverTrigger asChild>{main}</PopoverTrigger> : main}
      {!selectionOnly && <Tooltip content={a.chooseStart}><PopoverTrigger asChild><Button type="button" variant={variant} className="start-agent-chevron rounded-l-none rounded-r-[6px] border-l border-l-[var(--background)] min-w-9" disabled={disabled || starting} aria-label={a.chooseStart}>
        <ChevronDown size={14} strokeWidth={2.5} aria-hidden />
      </Button></PopoverTrigger></Tooltip>}
    </div></PopoverAnchor>
    {!open && (startError || (checked?.key === pickedKey && checked.error)) && <p className="p-error" role="status">{startError || checked?.error}</p>}
    <PopoverContent side="top" align="start" aria-label={a.chooseStart} className="w-[min(380px,calc(100vw-16px))] max-h-[min(var(--radix-popover-content-available-height),600px)] p-4 text-sm [&_label]:my-2.5 [&_label]:flex [&_label]:items-center [&_label]:justify-between [&_label]:gap-3 [&_p]:m-0 [&_p]:mb-2.5 [&_[data-slot=select-trigger]]:max-w-[65%] [&_[data-slot=select-trigger]]:min-w-0">
      {initial && <p className="hint">{a.currentDefault}: {describeAgent(initial)}</p>}
      {setting && <>
        <label>{a.harness}<Select triggerRef={first} value={setting.harness ?? 'claude'} onValueChange={(picked) => choose({ ...setting, harness: picked as Harness, ...(picked !== 'claude' ? { [picked]: setting[picked as 'codex' | 'agy'] ?? { model: 'default', effort: choice.effort } } : {}) })}>
          <SelectItem value="claude">{a.harnesses.claude}</SelectItem><SelectItem value="codex" disabled={!codexAllowed}>{a.harnesses.codex}{!codexAllowed ? ` (${a.unavailable})` : ''}</SelectItem><SelectItem value="agy" disabled={!codexAllowed}>{a.harnesses.agy}{!codexAllowed ? ` (${a.unavailable})` : ''}</SelectItem>
        </Select></label>
        {!codexAllowed && <p className="hint">{a.codexUnavailableHere}</p>}
        <label>{a.model}<Select value={codex ? choice.model : setting.model} disabled={codex && (!current || loading)} onValueChange={(picked) => {
          if (!codex) return choose({ ...setting, model: picked as AgentModel });
          const model = current?.find((m) => picked === 'default' ? m.isDefault : m.model === picked);
          const supported = AGENT_EFFORTS.filter((x) => model?.supportedReasoningEfforts.some((y) => y.reasoningEffort === x));
          choose({ ...setting, [other!]: { model: picked, effort: supported.includes(choice.effort) ? choice.effort : supported[0] ?? choice.effort } });
        }}>
          {codex ? <><SelectItem value="default">{other === 'agy' ? a.agyDefault : a.codexDefault}</SelectItem>{choice.model !== 'default' && !current?.some((m) => m.model === choice.model) && <SelectItem value={choice.model}>{choice.model} ({a.unavailable})</SelectItem>}{current?.map((m) => <SelectItem key={m.model} value={m.model}>{m.model}</SelectItem>)}</> : AGENT_MODELS.map((m) => <SelectItem key={m} value={m}>{a.models[m]}</SelectItem>)}
        </Select></label>
        <label>{a.effort}<Select value={codex ? choice.effort : setting.effort} disabled={codex && (!current || loading)} onValueChange={(picked) => choose(codex ? { ...setting, [other!]: { ...choice, effort: picked as AgentEffort } } : { ...setting, effort: picked as AgentEffort })}>
          {codex && !efforts.includes(choice.effort) && <SelectItem value={choice.effort}>{a.efforts[choice.effort]} ({a.unavailable})</SelectItem>}
          {(codex ? efforts : AGENT_EFFORTS).map((e) => <SelectItem key={e} value={e}>{a.efforts[e]}</SelectItem>)}
        </Select></label>
        {other === 'agy' && <p className="hint">{a.agyScope}</p>}
      </>}
      {(error || loading) && <p className="p-error" role="status">{loading ? a.loadingModels : error} {error && (setting ? codex && <LinkButton onClick={loadModels}>{a.reloadModels}</LinkButton> : <LinkButton onClick={() => setAttempt(attempt + 1)}>{a.reloadModels}</LinkButton>)}</p>}
      {codex && current && !loading && !valid && <p className="p-error" role="status">{a.unavailableChoice}</p>}
      {hint && <p className="hint start-agent-warning flex items-start gap-1.5 [&_svg]:flex-none [&_svg]:mt-0.5"><CircleAlert size={15} aria-hidden /> {hint}</p>}
      <Button variant={selectionOnly ? 'code-review' : 'primary'} disabled={!valid || loading || starting || disabled} onClick={() => { if (setting) void start(setting, null); }}>{a.startWith}</Button>
    </PopoverContent>
  </div></Popover>;
}
