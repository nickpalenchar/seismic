import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Listbox, type ListboxState } from './listbox';

const box = (active: number): ListboxState => ({ id: 'lb', active, setActive() {}, onPick() {}, onKeyDown: () => false, field: {} as ListboxState['field'] });

test('a listbox marks its active option and wires ids for aria-activedescendant', () => {
  const html = renderToString(
    <Listbox box={box(1)} items={['a', 'b']} label="Results" itemKey={(x) => x}>
      {(x) => x}
    </Listbox>,
  );
  expect(html).toContain('role="listbox"');
  expect(html).toContain('id="lb-1"');
  expect(html).toMatch(/id="lb-1"[^>]*aria-selected="true"/);
  expect(html).toMatch(/id="lb-0"[^>]*aria-selected="false"/);
  expect(html.match(/data-active/g)).toHaveLength(1);
});
