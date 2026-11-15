// The note on a repository's plan directory, beside the plans on the project: the docs there
// that are not plans, each with its reason and "Als Plan aufbereiten", or, while the
// repository has no plan doc yet, where the first one goes (which the owner can hide).

import { useCallback } from 'react';
import { type Bounds, PLAN_DIR_NOTE_W, planDirNoteBox, planDirNoteHeight, unionBounds } from '../core/layout';
import type { Item, PlanDir } from '../core/types';
import { t } from './strings';
import { useStoredState } from './stored';
import { Button, CloseButton, LinkButton } from './components/button';

/** Between the note and the plans below it. */
const NOTE_GAP = 40;

/**
 * Where each note stands: where the owner put it, else side by side above the top left of the
 * plans (of all cards, while there are none), so that a card started from a note, which goes
 * right of everything, leaves it where it was. One that stands above the plans stands on the
 * bottom of its box, which is as tall as the camera takes it for to keep it in sight.
 */
export function planDirBoxes(dirs: PlanDir[], placed: { item: Item; b: Bounds }[]): Bounds[] {
  const top = placed.filter(({ item }) => !item.parent);
  const plans = top.filter(({ item }) => item.kind === 'plan');
  const at = unionBounds((plans.length ? plans : top).map((p) => p.b)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const h = Math.max(...dirs.map(planDirNoteHeight));
  return dirs.map((d, n) => planDirNoteBox(d) ?? { x: at.x + n * (PLAN_DIR_NOTE_W + NOTE_GAP), y: at.y - NOTE_GAP - h, w: PLAN_DIR_NOTE_W, h });
}

/**
 * The empty notes the owner has hidden, per project in this browser: a hidden note stays away while
 * its repository has no plan doc; a directory changed in the settings brings it back.
 */
export function useHiddenEmptyNotes(project: string): [(d: PlanDir) => boolean, (d: PlanDir) => void] {
  const [ids, setIds] = useStoredState<string[]>(`seismic-plan-dir-hidden-${project}`, []);
  const isHidden = useCallback((d: PlanDir) => d.empty && ids.includes(noteId(d)), [ids]);
  const hide = (d: PlanDir) => setIds([...ids, noteId(d)]);
  return [isHidden, hide];
}

const noteId = (d: PlanDir) => `${d.repo}:${d.dir}`;

/** Why a doc is not a plan: quiet under its name, or under the head when one reason holds for all. */
const whyClass = 'pd-why block text-xs text-muted-foreground';

export function PlanDirNote({
  dir,
  b,
  dragging,
  repo,
  onPrepare,
  onOpen,
  onChange,
  onHide,
}: {
  dir: PlanDir;
  b: Bounds;
  dragging: boolean;
  /** The repository's name, when the project has several. */
  repo?: string;
  onPrepare: (dir: PlanDir, file: string) => void;
  onOpen: (cardId: string) => void;
  onChange: () => void;
  onHide: () => void;
}) {
  const where = repo ? `${repo}: ${dir.dir}` : dir.dir;
  const reasons = new Set(dir.others.map((o) => o.reason));
  const one = reasons.size === 1 ? t.planDir.reason[dir.others[0]!.reason] : null;
  return (
    // a press on the note moves it, like a card; one on a button there is no move
    <div
      className={[
        'plan-dir absolute box-border select-none rounded-sm border-[1.5px] border-(--container-line) bg-(--container) px-3.5 py-3 text-sm leading-[1.4] [&_button]:cursor-pointer [&_p]:m-0',
        dir.empty ? 'empty-dir border-dashed text-muted-foreground [&_p]:pr-3.5' : 'text-foreground',
        dir.at ? 'put' : '[transform:translateY(-100%)]',
        dragging ? 'dragging cursor-grabbing [box-shadow:0_8px_24px_--alpha(black/18%)]' : 'cursor-grab',
      ]
        .filter(Boolean)
        .join(' ')}
      data-repo={dir.repo}
      title={t.planDir.move}
      style={{ left: b.x, top: dir.at ? b.y : b.y + b.h, width: b.w }}
      onPointerDown={(e) => (e.target as Element).closest('button') && e.stopPropagation()}
    >
      {dir.empty ? (
        <p>
          <CloseButton label={t.planDir.hide} size="small" className="x absolute top-1 right-1" onClick={onHide} />
          {t.planDir.empty(where)}{' '}
          <LinkButton title={t.planDir.changeHint} onClick={onChange}>
            {t.planDir.change}
          </LinkButton>
        </p>
      ) : (
        <>
          <div className="pd-head font-semibold">{t.planDir.notPlans(where, dir.others.length)}</div>
          {one && <div className={`${whyClass} mt-0.5 mb-1`}>{one}</div>}
          {dir.others.map((o) => (
            <div key={o.file} className="pd-doc flex min-h-[30px] items-center justify-between gap-2.5">
              <span className="pd-file min-w-0 flex-1 py-1" title={o.file}>
                <span className="pd-name block overflow-hidden text-ellipsis whitespace-nowrap [font-family:var(--mono)] text-sm">{o.file.slice(o.file.lastIndexOf('/') + 1)}</span>
                {!one && <span className={whyClass}>{t.planDir.reason[o.reason]}</span>}
              </span>
              {o.preparing ? (
                <LinkButton onClick={() => onOpen(o.preparing!)}>
                  {t.planDir.preparing}
                </LinkButton>
              ) : (
                <Button size="small" title={t.planDir.prepareHint} onClick={() => onPrepare(dir, o.file)}>
                  {t.planDir.prepare}
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
