



import { type ReactNode, useState } from 'react';
import { CheckLabel } from './check-label';
import { Spinner } from './spinner';
import { Switch } from './switch';

export function SavingSwitch({ checked, save, disabled, children }: { checked: boolean; save: (on: boolean) => Promise<void>; disabled?: boolean; children: ReactNode }) {
  
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
