import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '../../project';
import { serve } from '../../server';
import { Store } from '../../store';
import { asOwner, FakeRuntime, gitRepo, noForge } from './testing';

export interface ChatServer {
  shop: () => ProjectRuntime;
  website: () => ProjectRuntime;
  send: (method: string, path: string, body?: unknown) => Promise<Response>;
}

/** Registers the hooks of a server with two projects, `shop` and `website`, and answers how to reach them. */
export function useChatServer(): ChatServer {
  let dir = '';
  let shop: ProjectRuntime;
  let website: ProjectRuntime;
  let server: ReturnType<typeof serve>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'seismic-chat-route-'));
    const store = new Store(':memory:');
    const project = (name: string) => {
      const repo = join(dir, name);
      gitRepo(repo, { 'README.md': 'hi\n' });
      return new ProjectRuntime({ repos: [{ path: repo }] }, { store, home: dir, runtime: new FakeRuntime(), forge: noForge });
    };
    [shop, website] = [project('shop'), project('website')] as [ProjectRuntime, ProjectRuntime];
    server = serve([shop, website], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }), warm: () => {} } }, 0);
  });
  afterEach(() => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const { fetch } = asOwner(() => server);
  return {
    shop: () => shop,
    website: () => website,
    send: (method, path, body) => fetch(new URL(path, server.url), { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
  };
}
