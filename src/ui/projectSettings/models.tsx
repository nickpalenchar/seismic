// The project's own harness, model and effort for a group of its agents, over Configuration's "Agents
// and models": a row of three choices, each quiet while it takes Configuration's. "Agents and models"
// of the settings sheet shows every group, "Code reviews" the reviewer's alone.

import { Fragment } from 'react';
import { AGENT_DEFAULTS, AGENT_EFFORTS, AGENT_ROLES, choosesHarness, harnessChoice, projectAgentSetting, type AgentEffort, type AgentModel, type AgentRole, type CodexModel, type Harness, type ProjectAgents, type ProjectSettingsView } from '../../core/types';
import { catalogDefault, HarnessOptions, ModelOptions } from '../agent-options';
import { agentClass } from '../config';
import { t } from '../strings';
import { Select, SelectItem } from '../components/select';
import { cn } from 'cn';

/** A choice of the agents' harness, model and effort: as wide as its column, quiet while it takes Configuration's. */
const choiceClass = 'min-w-0 w-full';

/** The models of Codex and Antigravity, read once the sheet opens. */
export type Catalogs = Partial<Record<'codex' | 'agy', CodexModel[]>>;

/** Changes the group's own choice; `null` takes it back to Configuration's. */
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
  const effective = projectAgentSetting(role, base, view.settings.agents);
  const harness = effective.harness ?? 'claude';
  const other = harness === 'codex' || harness === 'agy' ? harness : null;
  const inherited = harnessChoice(base);
  const selected = harnessChoice(effective);
  const models = other ? catalogs[other] : undefined;
  const chosenModel = models?.find((m) => selected.model === 'default' ? m.isDefault : m.model === selected.model);
  const efforts = other && chosenModel ? AGENT_EFFORTS.filter((e) => chosenModel.supportedReasoningEfforts.some((x) => x.reasoningEffort === e)) : AGENT_EFFORTS;
  const defaultHarness = base.harness ?? 'claude';
  const accountModel = catalogDefault(models);
  const claudeDefault = base.model === 'default' ? AGENT_DEFAULTS[role].model : base.model;
  const resolve = (model: string) => model === 'default' ? other ? accountModel : claudeDefault : model;
  const model = resolve(selected.model);
  const defaultModel = resolve(other ? base.harness === other ? inherited.model : 'default' : base.model);
  return (
    <div className="cs-choice grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,.9fr))] gap-2">
      <Select className={cn(choiceClass, own.harness ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.harness}`} value={harness} disabled={busy || !choosesHarness(role)} onValueChange={(picked) => {
        const value = picked as Harness;
        return choose(role, { harness: value === defaultHarness ? null : value });
      }}>
        <HarnessOptions defaultHarness={defaultHarness} />
      </Select>
      <Select className={cn(choiceClass, own.model || (other && own[other]?.model) ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.model}`} value={model} disabled={busy || (!!other && !models)} onValueChange={(picked) => {
        if (other) {
          const model = picked === defaultModel ? undefined : picked;
          const next = { ...own[other], model };
          return choose(role, { [other]: model || own[other]?.effort ? next : undefined });
        }
        return choose(role, { harness: own.harness === undefined && defaultHarness !== 'claude' ? 'claude' : own.harness, model: picked === defaultModel ? undefined : picked as AgentModel });
      }}>
        <ModelOptions harness={harness} models={models} value={model} defaultModel={defaultModel} />
      </Select>
      <Select className={cn(choiceClass, own.effort || (other && own[other]?.effort) ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.effort}`} value={other ? own[other]?.effort ?? own.effort ?? '' : own.effort ?? ''} disabled={busy} onValueChange={(picked) => {
        const effort = picked as AgentEffort | '';
        if (other) {
          const next = { ...own[other], effort: effort || undefined };
          return choose(role, { effort: undefined, [other]: own[other]?.model || effort ? next : undefined });
        }
        return choose(role, { effort: effort || undefined });
      }}>
        <SelectItem value="">{a.efforts[other ? base.harness === other ? inherited.effort : base.effort : base.effort]}</SelectItem>
        {efforts.map((x) => <SelectItem key={x} value={x}>{a.efforts[x]}</SelectItem>)}
      </Select>
    </div>
  );
}
