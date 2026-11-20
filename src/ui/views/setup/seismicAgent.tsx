/**
 * The setup step that confirms Seismic's own agent (the `koordinator` role): the harness, model and
 * effort that coordinate the work of every other agent. Only the harnesses picked in the first step are
 * offered. Confirming saves the shown choice explicitly, so the owner's decision is on record.
 */

import { useEffect, useState } from 'react';
import { agyBaseChoice, AGENT_DEFAULTS, AGENT_EFFORTS, catalogModel, harnessChoice, modelEffort, modelEfforts, type AgentEffort, type AgentModel, type AgentSetting, type AgentsView, type CodexModel, type Harness } from '../../../core/types';
import { catalogDefault, DefaultEffort, ModelOptions } from '../../agent-options';
import { api } from '../../api';
import { Button } from '../../components/button';
import { Select, SelectItem } from '../../components/select';
import { failText, t } from '../../strings';

const ROLE = 'koordinator';

export function SeismicAgentStep({ harnesses, onConfirm, onBack }: { harnesses: readonly Harness[]; onConfirm: () => void; onBack: () => void }) {
  const [view, setView] = useState<AgentsView | null>(null);
  const [models, setModels] = useState<CodexModel[] | undefined>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const a = t.config.agents;
  const s = t.setup.seismic;
  useEffect(() => {
    api.agents().then(setView, (e) => setStatus(failText(e)));
  }, []);
  const setting: AgentSetting | undefined = view?.agents[ROLE];
  // a role whose harness was not picked here takes the first picked one, as the first project does
  const harness: Harness = setting && harnesses.includes(setting.harness ?? 'claude') ? setting.harness ?? 'claude' : harnesses[0] ?? 'claude';
  const other = harness === 'codex' || harness === 'agy' ? harness : null;
  useEffect(() => {
    setModels(undefined);
    if (!other) return;
    let live = true;
    (other === 'agy' ? api.agyModels() : api.codexModels()).then(
      (list) => { if (live) setModels(list); },
      (e) => { if (live) setStatus(failText(e)); },
    );
    return () => { live = false; };
  }, [other]);
  if (!setting) return status ? <p className="hint text-destructive">{status}</p> : null;

  const choice = other === 'agy' ? agyBaseChoice(setting.agy ?? { model: 'default' }, models) : harnessChoice({ ...setting, harness });
  const defaultModel = other ? catalogDefault(models) : AGENT_DEFAULTS[ROLE].model;
  const model = other ? (choice.model === 'default' ? defaultModel : choice.model) : setting.model === 'default' ? defaultModel : setting.model;
  const selected = catalogModel(models, model);
  const efforts = selected ? modelEfforts(selected) : AGENT_EFFORTS;
  const effort = other ? choice.effort ?? modelEffort(selected) : setting.effort;
  const effortLabel = `${a.roles[ROLE].name}: ${a.effort}`;
  const save = async (change: Partial<AgentSetting>) => {
    setBusy(true);
    setStatus('');
    try {
      setView(await api.saveAgents(ROLE, change));
      return true;
    } catch (e) {
      setStatus(failText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    // saves the harness shown, whether or not the owner touched it
    const own = other === 'agy' ? { agy: { model: choice.model, effort: choice.effort } } : other ? { codex: { model: choice.model, effort: choice.effort ?? 'high' } } : { model: setting.model, effort: setting.effort };
    if (await save({ harness, ...own })) onConfirm();
  };

  return (
    <>
      <h3 className="text-base font-semibold mt-5 mb-1">{s.title}</h3>
      <p className="text-muted-foreground text-sm leading-normal mt-0 mb-3">{s.hint}</p>
      <div className="cs-choice grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,.9fr))] gap-2 max-w-[640px] max-[600px]:grid-cols-1">
        <Select className="min-w-0" aria-label={`${a.roles[ROLE].name}: ${a.harness}`} value={harness} disabled={busy} onValueChange={(picked) => void save({ harness: picked as Harness })}>
          {harnesses.map((h) => <SelectItem key={h} value={h}>{a.harnesses[h]}</SelectItem>)}
        </Select>
        <Select className="min-w-0" aria-label={`${a.roles[ROLE].name}: ${a.model}`} value={model} disabled={busy || (!!other && !models)} onValueChange={(picked) => {
          if (!other) return void save({ harness, model: picked as AgentModel });
          const next = catalogModel(models, picked);
          const id = picked === defaultModel ? 'default' : picked;
          const nextEffort = other === 'agy' && id === 'default' ? undefined : modelEffort(next, effort);
          return void save(other === 'agy' ? { harness, agy: { model: id, effort: nextEffort } } : { harness, codex: { model: id, effort: nextEffort ?? choice.effort ?? 'high' } });
        }}>
          <ModelOptions harness={harness} models={models} value={model} defaultModel={defaultModel} />
        </Select>
        {selected && !efforts.length ? <DefaultEffort className="min-w-0" label={effortLabel} /> : (
          <Select className="min-w-0" aria-label={effortLabel} value={effort ?? ''} disabled={busy || (!!other && !selected)} onValueChange={(picked) => {
            const next = picked as AgentEffort;
            return void save(other ? { harness, [other]: { ...choice, effort: next } } : { harness, effort: next });
          }}>
            {efforts.map((x) => <SelectItem key={x} value={x}>{a.efforts[x]}</SelectItem>)}
          </Select>
        )}
      </div>
      {status && <p className="hint text-destructive">{status}</p>}
      <div className="flex gap-2 mt-4">
        <Button size="small" onClick={onBack}>{t.setup.back}</Button>
        <Button variant="primary" disabled={busy || (!!other && !models)} onClick={() => void confirm()}>{s.confirm}</Button>
      </div>
    </>
  );
}
