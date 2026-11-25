import { expect, test } from 'bun:test';
import { linesOf, textsOf, visible } from './trust-lines';

test('a text splits at line feeds only, every invisible character written as a marker', () => {
  expect(linesOf('a\r\nb\r\n')).toEqual({ lines: ['a⟨CR⟩', 'b⟨CR⟩'], ends: true });
  expect(linesOf('a\u2028b\u2029c')).toEqual({ lines: ['a⟨LS⟩b⟨PS⟩c'], ends: false });
  expect(linesOf('x\u200by\u00a0z\tw v').lines).toEqual(['x⟨U+200B⟩y⟨NBSP⟩z\tw v']);
  expect(linesOf(undefined)).toEqual({ lines: [], ends: true });
  
  expect(linesOf('a\rb').lines).not.toEqual(linesOf('a\u2028b').lines);
  
  expect(linesOf('a⟨CR⟩').lines).not.toEqual(linesOf('a\r').lines);
  expect(visible('.claude/x\ny')).toBe('.claude/x⟨U+000A⟩y');
});

test('commands by name: files by their path, the app by its fields', () => {
  expect(textsOf({ app: { stop: 'kill', keep: 'x' }, claude: { '.mcp.json': { id: '1', text: '{}' } } }, 'app')).toEqual({ stop: 'kill', keep: 'x' });
  expect(textsOf({ claude: { '.mcp.json': { id: '1', text: '{}' } } }, 'claude')).toEqual({ '.mcp.json': '{}' });
  expect(textsOf(undefined, 'codex')).toEqual({});
});
