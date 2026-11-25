


import { cn } from 'cn';
import { type OutdatedBy, PAGE_CHANGES, THEME_CHANGED } from '../core/page-changes';
import { shortDay, t } from './strings';

export function PageChangeList({ changes, className }: { changes: { id: OutdatedBy; pages?: number }[]; className?: string }) {
  return (
    <ul className={cn('page-changes list-none mt-1 mb-0 p-0 grid gap-1 text-xs text-foreground', className)}>
      {changes.map(({ id, pages }) => {
        const kinds = PAGE_CHANGES.find((c) => c.id === id)?.kinds ?? [];
        return (
          <li key={id} className="flex gap-2 items-baseline">
            { }
            {id !== THEME_CHANGED && <span className="when flex-none min-w-12 text-muted-foreground tabular-nums">{shortDay(`${id.slice(0, 10)}T12:00`)}</span>}
            <span>
              {kinds.length === 1 && <b>{t.pageChanges.only[kinds[0]!]}: </b>}
              {t.pageChanges.text[id]}
              {pages !== undefined && <span className="text-muted-foreground"> ({t.pageChanges.pages(pages)})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
