
import { mock } from 'bun:test';
import { fileURLToPath } from 'node:url';
mock.module(fileURLToPath(new URL('../server.ts', import.meta.url)), () => ({ serverExtensions: [], extensionSettings: () => ({}) }));
mock.module(fileURLToPath(new URL('../client.ts', import.meta.url)), () => ({ clientExtensions: [] }));
