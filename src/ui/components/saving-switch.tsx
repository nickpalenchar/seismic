// A switch with its label whose change is saved at once: it shows the new position right away, with a
// spinner beside it and no further change, until `save` settles; the saved value then shows through
// `checked`. A refusal is the caller's to show, where `save` catches it.

import { type ReactNode, useState } from 'react';
import { CheckLabel } from './check-label';
import { Spinner } from './spinner';
import { Switch } from './switch';

export function SavingSwitch({ checked, save, disabled, children }: { checked: boolean; save: (on: boolean) => Promise<void>; disabled?: boolean; children: ReactNode }) {
  // what the owner switched to, until the save settles
  const [pending, setPending] = useState<boolean | null>(null);
  const change = (on: boolean) => {
    setPending(on);
    void save(on).finally(() => setPending(null));
  };
  return (
    <span className="flex items-center gap-2">
      <CheckLabel>
        <Switch checked={pending ?? checked} disabled={disabled || pending !== null} onCheckedChange={change} />
        {children}
      </CheckLabel>
      {pending !== null && <Spinner />}
    </span>
  );
}
