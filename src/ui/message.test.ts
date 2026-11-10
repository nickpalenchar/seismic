import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Msg } from './message';

test('shared message frames render an explicitly supplied harness and model', () => {
  for (const className of ['q', 'thinking', 'paused', undefined]) {
    const html = renderToStaticMarkup(createElement(Msg, { by: 'worker', who: 'Agent', className, agent: { harness: 'codex', model: 'gpt-6.1-sol' } }, 'Hello'));
    expect(html).toMatch(/class="[^"]*\bagent-model\b[^"]*">Codex · gpt-6.1-sol/);
  }
  const claude = renderToStaticMarkup(createElement(Msg, { by: 'koordinator', who: 'Coordinator', agent: { harness: 'claude', model: 'claude-opus-4-7' } }));
  expect(claude).toContain('Claude Code · claude-opus-4-7');
});

test('unknown historical model identities are not invented from current defaults', () => {
  const unknown = renderToStaticMarkup(createElement(Msg, { by: 'worker', who: 'Agent' }));
  expect(unknown).not.toContain('agent-model');
  const harnessOnly = renderToStaticMarkup(createElement(Msg, { by: 'worker', who: 'Agent', agent: { harness: 'codex' } }));
  expect(harnessOnly).toMatch(/class="[^"]*\bagent-model\b[^"]*">Codex<\/span>/);
});
