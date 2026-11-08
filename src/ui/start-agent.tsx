import { ChevronDown, CircleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, projectAgentSetting, type AgentEffort, type AgentModel, type AgentSetting, type CodexModel, type Harness } from '../core/types';
import { ApiError, api } from './api';
import { useMenuClose } from './queue';
import { updateDraft, useDraft } from './draft';
import { failText, t } from './strings';

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
export function StartAgent({ label, disabled, title, codexAllowed = true, selectionOnly = false, hint, draft, saved, tone = 'btn primary', suggested = false, onStart }: { tone?: string; suggested?: boolean; label: string; disabled?: boolean; title?: string; codexAllowed?: boolean; selectionOnly?: boolean; hint?: string; draft?: string; saved?: AgentSetting; onStart: (setting?: AgentSetting) => void | Promise<void> }) {
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
  const box = useRef<HTMLDivElement>(null);
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
  // the keyboard lands in the menu once it has its choices, and back on the chevron when it closes
  const chevron = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (open && setting) first.current?.focus({ preventScroll: true }); }, [open, !!setting]);
  const close = () => { setOpen(false); chevron.current?.focus(); };
  useMenuClose(open, box, () => (setOpen(false), chevron.current?.focus()), true);
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

  return <div className="start-agent" ref={box}>
    <div className={suggested ? 'start-agent-buttons suggested' : 'start-agent-buttons'}>
      <button className={selectionOnly ? "btn code-review" : `${tone} start-agent-main`} disabled={disabled || starting || (!selectionOnly && (checking || gone))} title={gone ? a.unavailableChoice : title} aria-haspopup={selectionOnly ? "true" : undefined} aria-expanded={selectionOnly ? open : undefined} onClick={() => { if (selectionOnly) return setOpen(!open); void startPicked(); }}>
        <span>{label}</span>
        {!selectionOnly && (picked ?? currentDefault) && <span className="start-agent-model">{describeAgent((picked ?? currentDefault)!, true)}</span>}
      </button>
      {!selectionOnly && <button type="button" ref={chevron} className={`${tone} start-agent-chevron`} disabled={disabled || starting} aria-label={a.chooseStart} aria-haspopup="true" aria-expanded={open} title={a.chooseStart} onClick={() => (open ? close() : setOpen(true))}>
        <ChevronDown size={14} strokeWidth={2.5} aria-hidden />
      </button>}
    </div>
    {!open && (startError || (checked?.key === pickedKey && checked.error)) && <p className="p-error" role="status">{startError || checked?.error}</p>}
    {open && <div className="start-agent-menu" role="group" aria-label={a.chooseStart}>
      {initial && <p className="hint">{a.currentDefault}: {describeAgent(initial)}</p>}
      <p className="hint">{a.choiceHint}</p>
      {setting && <>
        <label>{a.harness}<select ref={first} value={setting.harness ?? 'claude'} onChange={(e) => choose({ ...setting, harness: e.target.value as Harness, ...(e.target.value !== 'claude' ? { [e.target.value]: setting[e.target.value as 'codex' | 'agy'] ?? { model: 'default', effort: choice.effort } } : {}) })}>
          <option value="claude">{a.harnesses.claude}</option><option value="codex" disabled={!codexAllowed}>{a.harnesses.codex}{!codexAllowed ? ` (${a.unavailable})` : ''}</option><option value="agy" disabled={!codexAllowed}>{a.harnesses.agy}{!codexAllowed ? ` (${a.unavailable})` : ''}</option>
        </select></label>
        {!codexAllowed && <p className="hint">{a.codexUnavailableHere}</p>}
        <label>{a.model}<select value={codex ? choice.model : setting.model} disabled={codex && (!current || loading)} onChange={(e) => {
          if (!codex) return choose({ ...setting, model: e.target.value as AgentModel });
          const model = current?.find((m) => e.target.value === 'default' ? m.isDefault : m.model === e.target.value);
          const supported = AGENT_EFFORTS.filter((x) => model?.supportedReasoningEfforts.some((y) => y.reasoningEffort === x));
          choose({ ...setting, [other!]: { model: e.target.value, effort: supported.includes(choice.effort) ? choice.effort : supported[0] ?? choice.effort } });
        }}>
          {codex ? <><option value="default">{other === 'agy' ? a.agyDefault : a.codexDefault}</option>{choice.model !== 'default' && !current?.some((m) => m.model === choice.model) && <option value={choice.model}>{choice.model} ({a.unavailable})</option>}{current?.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}</> : AGENT_MODELS.map((m) => <option key={m} value={m}>{a.models[m]}</option>)}
        </select></label>
        <label>{a.effort}<select value={codex ? choice.effort : setting.effort} disabled={codex && (!current || loading)} onChange={(e) => choose(codex ? { ...setting, [other!]: { ...choice, effort: e.target.value as AgentEffort } } : { ...setting, effort: e.target.value as AgentEffort })}>
          {codex && !efforts.includes(choice.effort) && <option value={choice.effort}>{a.efforts[choice.effort]} ({a.unavailable})</option>}
          {(codex ? efforts : AGENT_EFFORTS).map((e) => <option key={e} value={e}>{a.efforts[e]}</option>)}
        </select></label>
        {codex && <p className="hint">{other === 'agy' ? a.agyScope : a.codexScope}</p>}
      </>}
      {(error || loading) && <p className="p-error" role="status">{loading ? a.loadingModels : error} {error && (setting ? codex && <button className="link" onClick={loadModels}>{a.reloadModels}</button> : <button className="link" onClick={() => setAttempt(attempt + 1)}>{a.reloadModels}</button>)}</p>}
      {codex && current && !loading && !valid && <p className="p-error" role="status">{a.unavailableChoice}</p>}
      {hint && <p className="hint start-agent-warning"><CircleAlert size={15} aria-hidden /> {hint}</p>}
      <button className={selectionOnly ? "btn code-review" : "btn primary"} disabled={!valid || loading || starting || disabled} onClick={() => { if (setting) void start(setting, null); }}>{a.startWith}</button>
    </div>}
  </div>;
}
