import { expect, test } from 'bun:test';
import { linesOf, textsOf, visible } from './trust-lines';

test('a text splits at line feeds only, every invisible character written as a marker', () => {
  expect(linesOf('a\r\nb\r\n')).toEqual(['a⟨CR⟩', 'b⟨CR⟩', '']);
  expect(linesOf('a b c')).toEqual(['a⟨LS⟩b⟨PS⟩c']);
  expect(linesOf('x​y z\tw v')).toEqual(['x⟨U+200B⟩y⟨NBSP⟩z\tw v']);
  expect(linesOf(undefined)).toEqual([]);
  // one break for another is a line that changed
  expect(linesOf('a\rb')).not.toEqual(linesOf('a b'));
  expect(visible('.claude/x\ny')).toBe('.claude/x⟨U+000A⟩y');
});

test('commands by name: files by their path, the app by its fields', () => {
  expect(textsOf({ app: { stop: 'kill', keep: 'x' }, claude: { '.mcp.json': { id: '1', text: '{}' } } }, 'app')).toEqual({ stop: 'kill', keep: 'x' });
  expect(textsOf({ claude: { '.mcp.json': { id: '1', text: '{}' } } }, 'claude')).toEqual({ '.mcp.json': '{}' });
  expect(textsOf(undefined, 'codex')).toEqual({});
});
