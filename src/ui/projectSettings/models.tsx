



import { Fragment } from 'react';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_ROLES, agyBaseChoice, catalogModel, modelEffort, modelEfforts, harnessChoice, projectAgentSetting, type AgentEffort, type AgentModel, type AgentRole, type ModelInfo, type Harness, type HarnessAvailability, type ProjectAgents, type ProjectSettingsView } from '../../core/types';
import { catalogDefault, DefaultEffort, HarnessOptions, ModelOptions } from '../agentOptions';
import { agentClass } from '../config';
import { t } from '../strings';
import { Select, SelectItem } from '../components/select';
import { cn } from 'cn';


const choiceClass = 'min-w-0 w-full';


export type Catalogs = Partial<Record<'codex' | 'agy', ModelInfo[]>> & { connected?: HarnessAvailability };


export type Choose = (role: AgentRole, change: Partial<ProjectAgents[AgentRole]> | null) => void;

/** The project's own agents with `change` for `role`; a group left with nothing of its own goes. */
export function chosen(agents: ProjectAgents, role: AgentRole, change: Partial<ProjectAgents[AgentRole]> | null): ProjectAgents {
  const own: ProjectAgents = { ...agents };
  if (change === null) delete own[role];
  else {
    const next = { ...own[role], ...change };
    if (!Object.values(next).some(Boolean)) delete own[role];
    else own[role] = next;
  }
  return own;
}

/** Every group of the project's agents, each its name over its three choices. */
export function AgentModels({ view, catalogs, busy, choose }: { view: ProjectSettingsView; catalogs: Catalogs; busy: boolean; choose: Choose }) {
  return (
    <div className="cs-agents flex flex-col">
      {AGENT_ROLES.map((role) => {
        const a = t.config.agents;
        return (
          <Fragment key={role}>
            <div className={agentClass}>
              {a.roles[role].name}
              <span className="hint">{a.roles[role].hint}</span>
            </div>
            <AgentChoice role={role} view={view} catalogs={catalogs} busy={busy} choose={choose} />
          </Fragment>
        );
      })}
    </div>
  );
}

/** The harness, model and effort of one group of the project's agents. */
export function AgentChoice({ role, view, catalogs, busy, choose }: { role: AgentRole; view: ProjectSettingsView; catalogs: Catalogs; busy: boolean; choose: Choose }) {
  const a = t.config.agents;
  const base = view.agents[role];
  const own = view.settings.agents[role] ?? {};
  const effective = projectAgentSetting(role, base, view.settings.agents, view.harnesses);
  if (view.harnesses?.length === 0) return <p className="hint">{t.config.harnesses.empty}</p>;
  const harness = effective.harness ?? 'claude';
  const other = harness === 'codex' || harness === 'agy' ? harness : null;
  const models = other ? catalogs[other] : undefined;
  const inherited = base.harness === other ? harnessChoice(base) : { model: 'default', effort: base.effort };
  const inheritedAgy = agyBaseChoice(base.harness === 'agy' ? base.agy ?? { model: 'default' } : { model: 'default' }, models);
  const selectedAgy = agyBaseChoice(effective.agy ?? { model: 'default' }, models);
  const selected = other === 'agy' ? selectedAgy : harnessChoice(effective);
  const chosenModel = catalogModel(models, selected.model);
  const efforts = chosenModel ? modelEfforts(chosenModel) : AGENT_EFFORTS;
  const effortless = !!chosenModel && !efforts.length;
  const defaultHarness = base.harness ?? 'claude';
  const accountModel = catalogDefault(models);
  const claudeDefault = base.model === 'default' ? AGENT_DEFAULTS[role].model : base.model;
  const resolve = (model: string) => model === 'default' ? other ? accountModel : claudeDefault : model;
  const model = resolve(selected.model);
  const inheritedModel = other === 'agy' ? inheritedAgy.model : other ? inherited.model : base.model;
  const defaultModel = resolve(inheritedModel);
  const inheritedEffort = other === 'agy' ? inheritedAgy.effort ?? modelEffort(chosenModel) : other ? inherited.effort : base.effort;
  const ownEffort = other === 'agy' && own.agy?.model && selectedAgy.model !== own.agy.model
    ? selectedAgy.effort : (other ? own[other]?.effort : undefined) ?? own.effort;
  const canInheritEffort = !!inheritedEffort && efforts.includes(inheritedEffort);
  const effortValue = ownEffort ?? (canInheritEffort ? '' : modelEffort(chosenModel) ?? '');
  const effortLabel = `${a.roles[role].name}: ${a.effort}`;
  return (
    <div className="cs-choice grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,.9fr))] gap-2">
      <Select className={cn(choiceClass, own.harness ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.harness}`} value={harness} disabled={busy} onValueChange={(picked) => {
        const value = picked as Harness;
        return choose(role, { harness: value === defaultHarness ? null : value });
      }}>
        <HarnessOptions defaultHarness={defaultHarness} connected={catalogs.connected} />
      </Select>
      <Select className={cn(choiceClass, own.model || (other && own[other]?.model) ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.model}`} value={model} disabled={busy || (!!other && !models)} onValueChange={(picked) => {
        if (other) {
          const model = picked === defaultModel ? undefined : picked;
          const target = catalogModel(models, picked);
          const effort = modelEffort(target, selected.effort);
          const snapped = selected.effort && effort !== selected.effort ? effort : undefined;
          const next = { ...own[other], model, ...(snapped ? { effort: snapped } : {}) };
          return choose(role, { [other]: model || next.effort ? next : undefined });
        }
        return choose(role, { harness: own.harness === undefined && defaultHarness !== 'claude' ? 'claude' : own.harness, model: picked === defaultModel ? undefined : picked as AgentModel });
      }}>
        <ModelOptions harness={harness} models={models} value={model} defaultModel={defaultModel} />
      </Select>
      {effortless ? <DefaultEffort className={cn(choiceClass, 'text-muted-foreground')} label={effortLabel} />
        : <Select className={cn(choiceClass, ownEffort ? 'own' : 'text-muted-foreground')} aria-label={effortLabel} value={effortValue} disabled={busy || (!!other && !chosenModel)} onValueChange={(picked) => {
        const effort = picked as AgentEffort | '';
        if (other) {
          
          const model = other === 'agy' && (own.agy?.model || (effort && inheritedAgy.model !== inherited.model))
            ? selectedAgy.model : own[other]?.model;
          const next = { model, effort: effort || undefined };
          return choose(role, { effort: undefined, [other]: model || effort ? next : undefined });
        }
        return choose(role, { effort: effort || undefined });
      }}>
        {canInheritEffort && <SelectItem value="">{a.efforts[inheritedEffort]}</SelectItem>}
        {ownEffort && !efforts.includes(ownEffort) && <SelectItem value={ownEffort} disabled>{a.efforts[ownEffort]} ({a.unavailable})</SelectItem>}
        {efforts.map((x) => <SelectItem key={x} value={x}>{a.efforts[x]}</SelectItem>)}
      </Select>}
    </div>
  );
}
