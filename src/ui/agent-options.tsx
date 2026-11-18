import { AGENT_MODELS, type CodexModel, type Harness } from '../core/types';
import { Badge } from './components/badge';
import { SelectItem } from './components/select';
import { t } from './strings';

export function catalogDefault(models?: readonly CodexModel[] | null) {
  return models?.find((model) => model.isDefault)?.model ?? 'default';
}

export function modelLabel(model: string, harness: Harness) {
  if (model === 'default') return t.config.agents.modelUnavailable;
  return harness === 'claude' ? t.config.agents.models[model as keyof typeof t.config.agents.models] ?? model : model;
}

function AgentOption({ value, label, isDefault, disabled }: { value: string; label: string; isDefault: boolean; disabled?: boolean }) {
  return <SelectItem value={value} textValue={label} disabled={disabled}>
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle [.cs-choice_[data-slot=select-trigger]_&]:flex-col [.cs-choice_[data-slot=select-trigger]_&]:items-start [.cs-choice_[data-slot=select-trigger]_&]:gap-0">
      <span className="min-w-0 max-w-full truncate">{label}</span>
      {isDefault && value !== 'default' && <Badge variant="secondary" className="px-1.5 py-0 text-2xs">{t.config.agents.defaultBadge}</Badge>}
    </span>
  </SelectItem>;
}

export function HarnessOptions({ defaultHarness, portable = true }: { defaultHarness: Harness; portable?: boolean }) {
  const a = t.config.agents;
  return (Object.keys(a.harnesses) as Harness[]).map((harness) => {
    const disabled = !portable && harness !== 'claude';
    return <AgentOption key={harness} value={harness} label={a.harnesses[harness] + (disabled ? ` (${a.unavailable})` : '')} isDefault={harness === defaultHarness} disabled={disabled} />;
  });
}

export function ModelOptions({ harness, models, value, defaultModel }: {
  harness: Harness;
  models?: readonly CodexModel[] | null;
  value: string;
  defaultModel: string;
}) {
  const offered = harness === 'claude' ? AGENT_MODELS.filter((model) => model !== 'default') : models?.map((model) => model.model) ?? [];
  return [...new Set([...offered, defaultModel, value])].filter((model) => model !== 'default' || model === value).map((model) => {
    const unavailable = models && model !== 'default' && !offered.includes(model);
    const label = modelLabel(model, harness) + (unavailable ? ` (${t.config.agents.unavailable})` : '');
    return <AgentOption key={model} value={model} label={label} isDefault={model === defaultModel} disabled={!!unavailable} />;
  });
}
