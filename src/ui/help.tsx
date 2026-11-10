// The legend of mouse and keys: a box over the greyed page, opened by `?` or the button in the bar.

import { Fragment } from 'react';
import { t } from './strings';
import { WishLink } from './wish';
import { CloseButton } from './components/button';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';
import { Tooltip } from './components/tooltip';

/** The `?` button in the bar. */
export function HelpButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Tooltip content={t.help.button}>
      <button className={on ? 'pill help on' : 'pill help'} aria-label={t.help.button} onClick={onClick}>
        ?
      </button>
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
      <DialogContent id="help" className="box">
        <CloseButton label={t.close} className="close" onClick={onClose} />
        <DialogTitle asChild>
          <h2>{t.help.title}</h2>
        </DialogTitle>
        <div className="sections">
          {t.help.sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <ul>
                {s.rows.map((r) => (
                  <li key={r.text}>
                    <span>{r.text}</span>
                    <span className="keys">
                      {r.keys.map((combo, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="or">{t.help.or}</span>}
                          {combo.map((k, j) => (
                            <Fragment key={j}>
                              {j > 0 && <span className="plus">+</span>}
                              <kbd>{k}</kbd>
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
        {/* what the owner misses goes to Seismic's makers; the legend closes for the draft */}
        <p className="wish-line">
          <WishLink onOpen={onClose} />
          <span className="w-legend">{t.wish.legend}</span>
        </p>
        {note && <p className="key-note">{note === 'button' ? t.help.keyNote.button : t.help.keyNote.gone}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Set once the owner opened the legend with `?`: the bar's `?` button goes. */
export const HELP_KEY_KNOWN = 'obeya-help-key-known';
