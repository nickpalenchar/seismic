// The canvas's own settings, a docked sheet on the right like the inbox, opened from the gear in the
// bar: models per group of agents over Configuration's, code reviews, the demo site, the labels Seismic
// suggests, how cards go into the archive, project tags.
// Each change saves at once into the configuration; the rest of the canvas (name, repositories) is
// in the Configuration dialog, which the sheet's foot opens at this canvas.

import { Fragment, useEffect, useState } from 'react';
import { AGENT_EFFORTS, AGENT_MODELS, AGENT_ROLES, choosesHarness, harnessChoice, type AgentEffort, type AgentModel, type AgentRole, type CanvasAgents, type CanvasSettings, type CanvasSettingsView, type CodexModel, type Harness } from '../core/types';
import { api } from './api';
import { CanvasSiteField, CardArchiveField, CodeReviewField, Head, ProjectBaselineField, SuggestField } from './config';
import { Docked } from './docked';
import { failText, t } from './strings';

/** The sheet of the canvas `canvas`; read afresh each time it opens or the Configuration over it closes. */
export function CanvasSettingsSheet({ canvas, name, homePath, on, covered, problems, onConfig, onAddSite }: { canvas: string; name: string; /** The canvas's home repository, which proposing the demo site's tags reads. */ homePath?: string | undefined; /** Opens Configuration at the page that adds a demo site. */ onAddSite: () => void; on: boolean; /** The Configuration dialog is open over it: read afresh once it closes, as models may have changed there. */ covered: boolean; /** The configuration's problems, counted on the gear too. */ problems: number; onConfig: () => void }) {
  const [view, setView] = useState<CanvasSettingsView | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogs, setCatalogs] = useState<Partial<Record<'codex' | 'agy', CodexModel[]>>>({});
  useEffect(() => {
    if (!on || covered) return;
    setStatus('');
    api.canvasSettings(canvas).then(setView, (e) => setStatus(failText(e)));
  }, [on, covered, canvas]);
  useEffect(() => {
    if (!on) return;
    void Promise.all([api.codexModels(), api.agyModels()]).then(([codex, agy]) => setCatalogs({ codex, agy }), console.error);
  }, [on]);
  const l = t.canvasSettings;
  const a = t.config.agents;
  const save = async (s: CanvasSettings) => {
    // shown at once; the server's answer, or the view before on a refusal, follows
    const before = view;
    setView((v) => v && { ...v, settings: { ...v.settings, ...s } as CanvasSettingsView['settings'] });
    setBusy(true);
    setStatus('');
    try {
      setView(await api.saveCanvasSettings(canvas, s));
    } catch (e) {
      setView(before);
      setStatus(failText(e));
    }
    setBusy(false);
  };
  const choose = (role: AgentRole, change: Partial<CanvasAgents[AgentRole]> | null) => {
    const own: CanvasAgents = { ...view!.settings.agents };
    if (change === null) delete own[role];
    else {
      const next = { ...own[role], ...change };
      if (!Object.values(next).some(Boolean)) delete own[role];
      else own[role] = next;
    }
    return save({ agents: own });
  };
  return (
    <Docked id="canvas-settings" on={on} label={l.title}>
      <p className="cs-canvas">{name}</p>
      <h2>{l.title}</h2>
      <p className="hint">{l.hint}</p>
      {view && (
        <>
          <Head title={l.models} hint={l.modelsHint} />
          <div className="cs-agents">
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
                  <div className="cfg-agent">
                    {a.roles[role].name}
                    <span className="hint">{a.roles[role].hint}</span>
                  </div>
                  <div className="cs-choice">
                    <select className={own.harness ? 'own' : undefined} aria-label={`${a.roles[role].name}: ${a.harness}`} value={own.harness ?? ''} disabled={busy || !choosesHarness(role)} onChange={(e) => {
                      const value = e.target.value as Harness | '';
                      if (!value) return choose(role, null);
                      return choose(role, { harness: value, model: undefined, effort: undefined });
                    }}>
                      <option value="">{a.harnesses[base.harness ?? 'claude']}</option>
                      <option value="claude">{a.harnesses.claude}</option>
                      <option value="codex">{a.harnesses.codex}</option>
                      <option value="agy">{a.harnesses.agy}</option>
                    </select>
                    <select className={own.model || (other && own[other]?.model) ? 'own' : undefined} aria-label={`${a.roles[role].name}: ${a.model}`} value={other ? own[other]?.model ?? '' : own.model ?? ''} disabled={busy} onChange={(e) => {
                      const model = e.target.value;
                      if (other) return choose(role, { harness: other, [other]: { ...selected, model: model || (base.harness === other ? inherited.model : 'default') } });
                      return choose(role, { harness: own.harness ?? 'claude', model: model as AgentModel || undefined });
                    }}>
                      <option value="">{other ? (base.harness === other && inherited.model !== 'default' ? inherited.model : l.accountDefault) : baseModel}</option>
                      {other ? <>
                        <option value="default">{l.accountDefault}</option>
                        {selected.model !== 'default' && !models?.some((m) => m.model === selected.model) && <option value={selected.model}>{selected.model}</option>}
                        {models?.map((m) => <option key={m.model} value={m.model}>{m.model}</option>)}
                      </> : AGENT_MODELS.map((m) => <option key={m} value={m}>{a.models[m]}</option>)}
                    </select>
                    <select className={own.effort || (other && own[other]?.effort) ? 'own' : undefined} aria-label={`${a.roles[role].name}: ${a.effort}`} value={other ? own[other]?.effort ?? (own.harness ? '' : own.effort ?? '') : own.effort ?? ''} disabled={busy} onChange={(e) => {
                      const effort = e.target.value as AgentEffort | '';
                      if (other) return choose(role, { harness: other, [other]: { ...selected, effort: effort || (base.harness === other ? inherited.effort : base.effort) } });
                      return choose(role, { harness: own.harness ?? 'claude', effort: effort || undefined });
                    }}>
                      <option value="">{a.efforts[other ? base.harness === other ? inherited.effort : base.effort : base.effort]}</option>
                      {efforts.map((x) => <option key={x} value={x}>{a.efforts[x]}</option>)}
                    </select>
                  </div>
                </Fragment>
              );
            })}
          </div>
          <Head title={l.reviews} hint={t.config.codeReviews.hint} />
          <CodeReviewField bare value={view.settings.codeReviews} onChange={(codeReviews) => save({ codeReviews })} />
          <Head title={l.site} hint={t.config.canvasSite.hint} />
          <CanvasSiteField bare canvas={canvas} value={view.settings.demoSite} {...(homePath ? { homePath } : {})} language={null} onAddSite={onAddSite} onChange={(demoSite) => save({ demoSite })} />
          <Head title={l.cards} />
          <CardArchiveField value={view.settings.archive} onChange={(archive) => save({ archive })} />
          <Head title={l.labels} />
          <SuggestField value={view.settings.suggest} onChange={(suggest) => save({ suggest })} />
          <Head title={l.projects} />
          <ProjectBaselineField value={view.settings.projectBaselines} onChange={(projectBaselines) => save({ projectBaselines })} />
        </>
      )}
      {status && <p className="hint c-status">{status}</p>}
      <div className="cs-more">
        <span className="hint">{l.more}</span>
        <button type="button" className="link" onClick={onConfig}>
          {l.toConfig}
        </button>
        {problems > 0 && <span className="n err">{t.config.problemCount(problems)}</span>}
      </div>
    </Docked>
  );
}
