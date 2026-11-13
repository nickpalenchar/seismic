// The phone's menu: the desktop's left menu trimmed to what a phone has a use for, as a sheet over
// everything, the floating bar included. Needs you (with its count across every project) and the
// projects, a tap on one switching the view to it, each with its agents' pause; the canvases, the
// queue, the settings and the configuration stay on the desktop.

import { Check, Inbox, X } from 'lucide-react';
import type { ProjectInfo } from '../core/types';
import { cn } from 'cn';
import { Badge } from './components/badge';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from './components/sheet';
import { Sign } from './logo';
import { ProjectAgents } from './parts';
import { t } from './strings';

const rowClass = 'box-border flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-transparent px-3 py-2 text-left text-[17px] text-foreground active:bg-muted';

export function PhoneMenu({ open, onOpenChange, projects, project, needsYou, onProject, onNeedsYou }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectInfo[];
  /** The project in view. */
  project: string;
  needsYou: number;
  onProject: (id: string) => void;
  onNeedsYou: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" showCloseButton={false} className="ph-menu w-full max-w-none gap-0 overflow-y-auto border-0 px-[max(14px,env(safe-area-inset-left))] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none" aria-describedby={undefined}>
        <SheetDescription className="sr-only">{t.phone.next.menuTitle}</SheetDescription>
        <div className="flex min-h-14 items-center gap-2.5">
          <Sign size={26} />
          <SheetTitle className="min-w-0 flex-1 text-[19px]">{t.phone.next.menuTitle}</SheetTitle>
          <SheetClose className="inline-grid size-10 shrink-0 place-items-center rounded-full border-0 bg-muted p-0 text-foreground cursor-pointer" aria-label={t.phone.next.closeMenu}>
            <X size={20} strokeWidth={2.25} aria-hidden="true" />
          </SheetClose>
        </div>
        <button className={cn(rowClass, 'mt-2')} onClick={onNeedsYou}>
          <Inbox size={20} strokeWidth={2} className="text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t.phone.next.needsYou}</span>
          {needsYou > 0 && (
            <Badge variant="count" tone="waiting" title={t.phone.next.needsYouCount(needsYou)}>
              {needsYou}
            </Badge>
          )}
        </button>
        <h3 className="mx-3 mt-5 mb-1.5 text-[12px] font-semibold tracking-[.04em] text-muted-foreground uppercase">{t.phone.next.projects}</h3>
        <ul className="m-0 list-none p-0">
          {projects.map((c) => (
            <li key={c.id} className="group/project relative">
              <button className={cn(rowClass, c.id === project && 'bg-muted font-semibold', c.agents && 'pr-14')} aria-current={c.id === project ? 'true' : undefined} onClick={() => onProject(c.id)}>
                <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{c.name}</span>
                {c.id === project && <Check size={18} strokeWidth={2.25} aria-hidden="true" />}
              </button>
              <ProjectAgents project={c} />
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
