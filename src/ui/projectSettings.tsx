// The project's own settings, a docked sheet on the right like the inbox, opened from the sliders in the
// bar: models per group of agents over Configuration's, code reviews, the demo site, the labels Seismic
// suggests, how cards go into the archive, what a right click on a card does, plan tags.
// Each change saves at once into the configuration; the rest of the project (name, repositories) is
// in the Configuration dialog, which the sheet's foot opens at this project.

import { Fragment, useEffect, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, choosesHarness, harnessChoice, type AgentEffort, type AgentModel, type AgentRole, type ProjectAgents, type ProjectSettings, type ProjectSettingsView, type CodexModel, type Harness } from '../core/types';
import { api } from './api';
import { agentClass, ProjectSiteField, CardArchiveField, RightClickField, CodeReviewField, Head, PlanBaselineField, SuggestField } from './config';
import { settingsSheetClass } from './configClasses';
import { Docked, sheetTitleClass } from './docked';
import { failText, t } from './strings';
import { LinkButton } from './components/button';
import { Badge } from './components/badge';
import { Select, SelectItem } from './components/select';
import { statusClass } from './setupClasses';
import { cn } from 'cn';

/** A choice of the agents' harness, model and effort: as wide as its column, quiet while it takes Configuration's. */
const choiceClass = 'min-w-0 w-full';

/** The sheet of the project `project`; read afresh each time it opens or the Configuration over it closes. */
export function ProjectSettingsSheet({ project, name, homePath, on, covered, problems, onConfig, onAddSite }: { project: string; name: string; /** The project's home repository, which proposing the demo site's tags reads. */ homePath?: string | undefined; /** Opens Configuration at the page that adds a demo site. */ onAddSite: () => void; on: boolean; /** The Configuration dialog is open over it: read afresh once it closes, as models may have changed there. */ covered: boolean; /** The configuration's problems, counted on the gear too. */ problems: number; onConfig: () => void }) {
  const [view, setView] = useState<ProjectSettingsView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogs, setCatalogs] = useState<Partial<Record<'codex' | 'agy', CodexModel[]>>>({});
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    api.projectSettings(project).then(setView, (e) => setStatus(failText(e)));
  }, [on, covered, project]);
  useEffect(() => {
    if (!on) return;
    void Promise.all([api.codexModels(), api.agyModels()]).then(([codex, agy]) => setCatalogs({ codex, agy }), console.error);
  }, [on]);
  const l = t.projectSettings;
  const a = t.config.agents;
  const save = async (s: ProjectSettings) => {
    // shown at once; the server's answer, or the view before on a refusal, follows
    const before = view;
    setView((v) => v && { ...v, settings: { ...v.settings, ...s } as ProjectSettingsView['settings'] });
    setBusy(true);
    setStatus('');
    try {
      setView(await api.saveProjectSettings(project, s));
    } catch (e) {
      setView(before);
      setStatus(failText(e));
    }
    setBusy(false);
  };
  const choose = (role: AgentRole, change: Partial<ProjectAgents[AgentRole]> | null) => {
    const own: ProjectAgents = { ...view!.settings.agents };
    if (change === null) delete own[role];
    else {
      const next = { ...own[role], ...change };
      if (!Object.values(next).some(Boolean)) delete own[role];
      else own[role] = next;
    }
    return save({ agents: own });
  };
  return (
    <Docked id="project-settings" on={on} label={l.title} className={settingsSheetClass}>
      <p className="cs-project mt-0 mr-10 mb-0.5 ml-0 text-xs text-muted-foreground">{name}</p>
      <h2 className={sheetTitleClass}>{l.title}</h2>
      <p className="text-muted-foreground text-sm leading-[1.45] mt-0 mx-0 mb-1.5">{l.hint}</p>
      {view && (
        <>
          <Head title={l.models} hint={l.modelsHint} />
          <div className="cs-agents flex flex-col">
            {AGENT_ROLES.map((role) => {
              const base = view.agents[role];
              const own = view.settings.agents[role] ?? {};
              const harness = own.harness ?? (own.model ? 'claude' : base.harness) ?? 'claude';
              const other = harness === 'codex' || harness === 'agy' ? harness : null;
              const inherited = harnessChoice(base);
              const selected = other ? own[other] ?? (base.harness === other ? { ...inherited, effort: own.effort ?? inherited.effort } : { model: 'default', effort: base.effort }) : { model: own.model ?? base.model, effort: own.effort ?? base.effort };
              const models = other ? catalogs[other] : undefined;
              const chosenModel = models?.find((m) => selected.model === 'default' ? m.isDefault : m.model === selected.model);
              const efforts = other && chosenModel ? AGENT_EFFORTS.filter((e) => chosenModel.supportedReasoningEfforts.some((x) => x.reasoningEffort === e)) : AGENT_EFFORTS;
              const baseModel = base.harness && base.harness !== 'claude' ? inherited.model === 'default' ? l.accountDefault : inherited.model : a.models[base.model];
              return (
                <Fragment key={role}>
                  <div className={agentClass}>
                    {a.roles[role].name}
                    <span className="hint">{a.roles[role].hint}</span>
                  </div>
                  <div className="cs-choice grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,.9fr))] gap-2">
                    <Select className={cn(choiceClass, own.harness ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.harness}`} value={own.harness ?? ''} disabled={busy || !choosesHarness(role)} onValueChange={(picked) => {
                      const value = picked as Harness | '';
                      if (!value) return choose(role, null);
                      return choose(role, { harness: value, model: undefined, effort: undefined });
                    }}>
                      <SelectItem value="">{a.harnesses[base.harness ?? 'claude']}</SelectItem>
                      <SelectItem value="claude">{a.harnesses.claude}</SelectItem>
                      <SelectItem value="codex">{a.harnesses.codex}</SelectItem>
                      <SelectItem value="agy">{a.harnesses.agy}</SelectItem>
                    </Select>
                    <Select className={cn(choiceClass, own.model || (other && own[other]?.model) ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.model}`} value={other ? own[other]?.model ?? '' : own.model ?? ''} disabled={busy} onValueChange={(picked) => {
                      const model = picked;
                      if (other) return choose(role, { harness: other, [other]: { ...selected, model: model || (base.harness === other ? inherited.model : 'default') } });
                      return choose(role, { harness: own.harness ?? 'claude', model: model as AgentModel || undefined });
                    }}>
                      <SelectItem value="">{other ? (base.harness === other && inherited.model !== 'default' ? inherited.model : l.accountDefault) : baseModel}</SelectItem>
                      {other ? <>
                        <SelectItem value="default">{l.accountDefault}</SelectItem>
                        {selected.model !== 'default' && !models?.some((m) => m.model === selected.model) && <SelectItem value={selected.model}>{selected.model}</SelectItem>}
                        {models?.map((m) => <SelectItem key={m.model} value={m.model}>{m.model}</SelectItem>)}
                      </> : AGENT_MODELS.map((m) => <SelectItem key={m} value={m}>{a.models[m]}</SelectItem>)}
                    </Select>
                    <Select className={cn(choiceClass, own.effort || (other && own[other]?.effort) ? 'own' : 'text-muted-foreground')} aria-label={`${a.roles[role].name}: ${a.effort}`} value={other ? own[other]?.effort ?? (own.harness ? '' : own.effort ?? '') : own.effort ?? ''} disabled={busy} onValueChange={(picked) => {
                      const effort = picked as AgentEffort | '';
                      if (other) return choose(role, { harness: other, [other]: { ...selected, effort: effort || (base.harness === other ? inherited.effort : base.effort) } });
                      return choose(role, { harness: own.harness ?? 'claude', effort: effort || undefined });
                    }}>
                      <SelectItem value="">{a.efforts[other ? base.harness === other ? inherited.effort : base.effort : base.effort]}</SelectItem>
                      {efforts.map((x) => <SelectItem key={x} value={x}>{a.efforts[x]}</SelectItem>)}
                    </Select>
                  </div>
                </Fragment>
              );
            })}
          </div>
          <Head title={l.reviews} hint={t.config.codeReviews.hint} />
          <CodeReviewField bare value={view.settings.codeReviews} onChange={(codeReviews) => save({ codeReviews })} />
          <Head title={l.site} hint={t.config.projectSite.hint} />
          <ProjectSiteField bare project={project} value={view.settings.demoSite} {...(homePath ? { homePath } : {})} language={null} onAddSite={onAddSite} onChange={(demoSite) => save({ demoSite })} />
          <Head title={l.cards} />
          <CardArchiveField value={view.settings.archive} onChange={(archive) => save({ archive })} />
          <RightClickField value={view.settings.rightClick} onChange={(rightClick) => save({ rightClick })} />
          <Head title={l.labels} />
          <SuggestField value={view.settings.suggest} onChange={(suggest) => save({ suggest })} />
          <Head title={l.plans} />
          <PlanBaselineField value={view.settings.planBaselines} onChange={(planBaselines) => save({ planBaselines })} />
        </>
      )}
      {status && <p className={`hint ${statusClass}`}>{status}</p>}
      <div className="cs-more mt-6 pt-3.5 border-t border-t-border flex flex-col items-start gap-1 text-sm">
        <span className="text-muted-foreground text-sm">{l.more}</span>
        <LinkButton type="button" onClick={onConfig}>
          {l.toConfig}
        </LinkButton>
        {problems > 0 && <Badge variant="count" className="bg-transparent p-0 text-warning text-sm">{t.config.problemCount(problems)}</Badge>}
      </div>
    </Docked>
  );
}
