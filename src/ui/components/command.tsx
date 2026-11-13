// Command (shadcn/ui's, on cmdk): a search field with the list of what fits it, the arrow keys moving
// the active item and Enter picking it, with focus staying in the field. Where the caller filters the
// list itself (`shouldFilter={false}`), cmdk only moves the selection: the card finder and the merge
// picker. The composer's skill and card-link menus sit in a textarea / contentEditable that cmdk
// cannot own, and stay on `Listbox`.
//
// `Command` is the root and holds the field, the list, and any popover that carries the list, since
// cmdk shares its state through context. `CommandInput` is the field (`icon={false}` where the caller
// draws its own, `wrapperClassName` styles what holds it), `CommandList` the scrolling list,
// `CommandItem` an option (`value` is its id, `onSelect` picks it; the active one is
// `[data-selected=true]`).

import { cn } from 'cn';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { inputFieldClassName } from './input';

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive data-slot="command" className={cn('flex w-full flex-col text-foreground', className)} {...props} />;
}

function CommandInput({ className, wrapperClassName, icon = true, ...props }: ComponentProps<typeof CommandPrimitive.Input> & { wrapperClassName?: string; icon?: boolean }) {
  return (
    <div data-slot="command-input-wrapper" className={cn('relative flex items-center', wrapperClassName)}>
      {icon && <SearchIcon className="pointer-events-none absolute left-3 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <CommandPrimitive.Input
        {...props}
        data-slot="command-input"
        className={cn(inputFieldClassName, 'w-full', icon && 'pl-9', className)}
      />
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn('min-h-0 overflow-x-hidden overflow-y-auto', className)} {...props} />;
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cn('py-6 text-center text-sm text-muted-foreground', className)} {...props} />;
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn('overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground', className)}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator data-slot="command-separator" className={cn('h-px bg-border', className)} {...props} />;
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      // a press keeps the focus in the field
      onMouseDown={(e) => e.preventDefault()}
      className={cn('relative flex cursor-pointer items-center gap-2 rounded-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0', className)}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="command-shortcut" className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />;
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator };
