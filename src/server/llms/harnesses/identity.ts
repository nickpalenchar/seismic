


import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentIdentity } from '../../../core/types';

export const agentIdentity = new AsyncLocalStorage<AgentIdentity | undefined>();
export function currentAgent(): AgentIdentity | undefined {
  const agent = agentIdentity.getStore();
  return agent ? { ...agent } : undefined;
}
