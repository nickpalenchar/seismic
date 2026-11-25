






import { Toaster as Sonner, type ToasterProps } from 'sonner';






const stack = {
  desktop: 'absolute! top-auto! bottom-[calc(100%+6px)]! left-auto! right-0! w-0! transform-none!',
  phone: 'absolute! top-auto! bottom-[calc(100%+6px)]! left-0! right-0! w-auto! transform-none!',
};
const toast = {
  desktop: 'w-max! max-w-[inherit]! left-auto! right-0! pointer-events-none!',
  phone: 'w-full! max-w-[inherit]! left-0! right-0! pointer-events-none!',
};
const centred = 'flex justify-center w-full';

export function Toaster({ phone = false, ...props }: ToasterProps & { phone?: boolean }) {
  const at = phone ? 'phone' : 'desktop';
  return (
    <Sonner
      className={`toaster ${stack[at]}`}
      expand
      visibleToasts={99}
      gap={6}
      hotkey={[]}
      position="bottom-right"
      toastOptions={{ duration: Infinity, className: toast[at], ...(phone ? { classNames: { content: centred, title: centred } } : {}) }}
      {...props}
    />
  );
}
