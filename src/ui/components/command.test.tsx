import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { Command, CommandInput, CommandItem, CommandList } from './command';

test('command input renders as a native field with the list in the same command', () => {
  const html = renderToString(
    <Command shouldFilter={false} label="Cards">
      <CommandInput aria-label="Search cards" placeholder="Find a card" />
      <CommandList>
        <CommandItem value="card-1">First card</CommandItem>
      </CommandList>
    </Command>,
  );

  expect(html).toContain('cmdk-input=""');
  expect(html).toContain('aria-label="Search cards"');
  expect(html).toContain('cmdk-list=""');
});
