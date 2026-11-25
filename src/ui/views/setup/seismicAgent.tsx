





import { useEffect, useRef, useState } from 'react';
import { agyBaseChoice, AGENT_DEFAULTS, AGENT_EFFORTS, catalogModel, harnessChoice, modelEffort, modelEfforts, type AgentEffort, type AgentModel, type AgentSetting, type ModelInfo, type Harness } from '../../../core/types';
import { catalogDefault, DefaultEffort, ModelOptions } from '../../agent-options';
import { api } from '../../api';
import { getSetting, saveSetting } from '../../clients/seismic';
import { Button } from '../../components/button';
import { ExitSetup } from './how';
import { Select, SelectItem } from '../../components/select';
import { failText, t } from '../../strings';

const ROLE = 'koordinator';

export function SeismicAgentStep({ harnesses, onConfirm, onBack }: { harnesses: readonly Harness[]; onConfirm: () => void; onBack: () => void }) {
  const [saved, setSaved] = useState<AgentSetting>();
  const [draft, setDraft] = useState<Partial<AgentSetting>>({});
  const [settingsError, setSettingsError] = useState('');
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<{ key: string; models?: ModelInfo[]; error?: string }>();
  const mounted = useRef(false);
  const a = t.config.agents;
  const s = t.setup.seismic;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let live = true;
    getSetting('agents').then(
      (view) => { if (live) setSaved(view.agents[ROLE]); },
      (error) => { if (live) setSettingsError(failText(error)); },
    );
    return () => { live = false; };
  }, [settingsAttempt]);
  const setting = { ...(saved ?? AGENT_DEFAULTS[ROLE]), ...draft };
  
  const harness: Harness = harnesses.includes(setting.harness ?? 'claude') ? setting.harness ?? 'claude' : harnesses[0] ?? 'claude';
  const other = saved && (harness === 'codex' || harness === 'agy') ? harness : null;
  const catalogKey = `${other}:${attempt}`;
  const loaded = catalog?.key === catalogKey ? catalog : undefined;
  const models = loaded?.models;
  useEffect(() => {
    if (!other) return;
    let live = true;
    (other === 'agy' ? api.agyModels() : api.codexModels()).then(
      (list) => { if (live) setCatalog({ key: catalogKey, models: other === 'codex' ? list.filter((m) => modelEfforts(m).length > 0) : list }); },
      (e) => { if (live) setCatalog({ key: catalogKey, error: failText(e) }); },
    );
    return () => { live = false; };
  }, [other, catalogKey]);
  const choice = other === 'agy' ? agyBaseChoice(setting.agy ?? { model: 'default' }, models) : harnessChoice({ ...setting, harness });
  const defaultModel = other ? catalogDefault(models) : AGENT_DEFAULTS[ROLE].model;
  const model = other ? (choice.model === 'default' ? defaultModel : choice.model) : setting.model === 'default' ? defaultModel : setting.model;
  const selected = catalogModel(models, model);
  const efforts = selected ? modelEfforts(selected) : AGENT_EFFORTS;
  const effort = other ? modelEffort(selected, choice.effort) : setting.effort;
  const canConfirm = !!saved && harnesses.includes(harness) && (!other || (!!selected && (other === 'agy' || !!effort)));
  const loadError = loaded?.error ?? (models?.length === 0 ? s.noModels : '');
  const effortLabel = `${a.roles[ROLE].name}: ${a.effort}`;
  const changeDraft = (change: Partial<AgentSetting>) => {
    setDraft((before) => ({ ...before, ...change }));
    setStatus('');
  };
  const confirm = async () => {
    if (busy || !canConfirm) return;
    
    let own: Partial<AgentSetting> = { model: setting.model, effort: setting.effort };
    if (other === 'agy') own = { agy: { model: choice.model, effort: choice.effort === undefined ? undefined : effort } };
    if (other === 'codex' && effort) own = { codex: { model: choice.model, effort } };
    setBusy(true);
    setStatus('');
    try {
      await saveSetting('agents', { [ROLE]: { harness, ...own } });
      if (mounted.current) onConfirm();
    } catch (e) {
      if (mounted.current) setStatus(failText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <>
      <h3 className="text-base font-semibold mt-5 mb-1">{s.title}</h3>
      <p className="text-muted-foreground text-sm leading-normal mt-0 mb-3">{s.hint}</p>
      {saved && <div className="cs-choice grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,.9fr))] gap-2 max-w-[640px] max-[600px]:grid-cols-1">
        <Select className="min-w-0" aria-label={`${a.roles[ROLE].name}: ${a.harness}`} value={harness} disabled={busy} onValueChange={(picked) => changeDraft({ harness: picked as Harness })}>
          {harnesses.map((h) => <SelectItem key={h} value={h}>{a.harnesses[h]}</SelectItem>)}
        </Select>
        <Select className="min-w-0" aria-label={`${a.roles[ROLE].name}: ${a.model}`} value={model} disabled={busy || (!!other && !models)} onValueChange={(picked) => {
          if (!other) return changeDraft({ model: picked as AgentModel });
          const next = catalogModel(models, picked);
          const id = picked === defaultModel ? 'default' : picked;
          const nextEffort = modelEffort(next, effort ?? choice.effort);
          if (other === 'agy') return changeDraft({ agy: { model: id, effort: id === 'default' ? undefined : nextEffort } });
          if (nextEffort) changeDraft({ codex: { model: id, effort: nextEffort } });
        }}>
          <ModelOptions harness={harness} models={models} value={model} defaultModel={defaultModel} />
        </Select>
        {selected && !efforts.length ? <DefaultEffort className="min-w-0" label={effortLabel} /> : (
          <Select className="min-w-0" aria-label={effortLabel} value={effort ?? ''} disabled={busy || (!!other && !selected)} onValueChange={(picked) => {
            const next = picked as AgentEffort;
            changeDraft(other ? { [other]: { ...choice, effort: next } } : { effort: next });
          }}>
            {efforts.map((x) => <SelectItem key={x} value={x}>{a.efforts[x]}</SelectItem>)}
          </Select>
        )}
      </div>}
      {!saved && !settingsError && <p className="hint" role="status">{s.loadingSettings}</p>}
      {settingsError && (
        <p className="hint text-destructive" role="alert">
          {settingsError} <Button size="small" onClick={() => {
            setSettingsError('');
            setSettingsAttempt((n) => n + 1);
          }}>{s.retrySettings}</Button>
        </p>
      )}
      {status && <p className="hint text-destructive" role="alert">{status}</p>}
      {loadError && (
        <p className="hint text-destructive">
          {loadError} <Button size="small" onClick={() => setAttempt((n) => n + 1)}>{a.reloadModels}</Button>
        </p>
      )}
      <div className="flex gap-2 mt-4">
        <ExitSetup />
        <Button size="small" disabled={busy} onClick={onBack}>{t.setup.back}</Button>
        <Button variant="primary" disabled={busy || !canConfirm} onClick={() => void confirm()}>{s.confirm}</Button>
      </div>
    </>
  );
}
