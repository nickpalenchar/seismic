

import { Fragment } from 'react';
import { t } from './strings';
import { WishLink } from './wish';
import { CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { PillButton } from './components/pill';
import { Tooltip } from './components/tooltip';

/** The `?` button in the bar. */
export function HelpButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Tooltip content={t.help.button}>
      { }
      <PillButton
        size="bar"
        on={on}
        className="w-[34px] justify-center p-0 text-base font-bold text-muted-foreground hover:text-foreground data-[on]:bg-card data-[on]:text-foreground group-data-[fit~='2']/bar:hidden"
        aria-label={t.help.button}
        onClick={onClick}
      >
        ?
      </PillButton>
    </Tooltip>
  );
}

/**
 * The legend, with the link to the draft for Seismic's makers at its foot; a click beside it, Esc or `?` closes it. `note` is its foot while the bar still has the
 * button: opened by the button it says the key goes away with the button, opened by the key for the
 * first time it says the button has gone.
 */
export function Help({ onClose, note }: { onClose: () => void; note?: 'button' | 'gone' }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent id="help" glass className="w-[860px] overflow-auto px-6 pt-6 pb-6">
        <CloseButton label={t.close} className="close absolute top-3 right-3.5" onClick={onClose} />
        <DialogTitle asChild>
          <h2 className="m-0 mb-3.5 text-2xl">{t.help.title}</h2>
        </DialogTitle>
        <div className="[columns:2_340px] gap-x-9">
          {t.help.sections.map((s) => (
            <section key={s.title} className="mb-4 break-inside-avoid last:mb-0">
              <h3 className="m-0 mb-1 text-xs font-semibold tracking-[.05em] text-muted-foreground uppercase">{s.title}</h3>
              <ul className="m-0 list-none p-0 text-sm">
                {s.rows.map((r) => (
                  <li key={r.text} className="flex items-center justify-between gap-3.5 border-b border-b-border py-1.5 last:border-b-0">
                    <span>{r.text}</span>
                    <span className="flex flex-wrap items-center justify-end gap-1">
                      {r.keys.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className={quiet}>{t.help.or}</span>}
                          {combo.map((k, j) => (
                            <Fragment key={j}>
                              {j > 0 && <span className={quiet}>+</span>}
                              <kbd className="rounded-xs border border-border bg-muted px-2 py-0.5 [font-family:inherit] text-xs font-medium whitespace-nowrap shadow-[0_1px_0_var(--border)]">{k}</kbd>
                            </Fragment>
                          ))}
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        { }
        <p className="m-0 mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-t-border pt-3">
          <WishLink className="text-sm" onOpen={onClose} />
          <span className="text-xs text-muted-foreground">{t.wish.legend}</span>
        </p>
        {note && <p className="m-0 mt-4 border-t border-t-border pt-3 text-sm text-muted-foreground">{note === 'button' ? t.help.keyNote.button : t.help.keyNote.gone}</p>}
      </DialogContent>
    </Dialog>
  );
}


const quiet = 'text-xs text-muted-foreground';


export const HELP_KEY_KNOWN = 'seismic-help-key-known';
