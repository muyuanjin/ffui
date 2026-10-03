import { inject, onScopeDispose, provide, type InjectionKey } from "vue";
import { useEventListener } from "@vueuse/core";

type RegisterSelect = (isOpen: () => boolean) => () => void;
const nestedSelectKey: InjectionKey<RegisterSelect> = Symbol("dialog-nested-select");

export function provideNestedSelectDismissal() {
  const selects = new Set<() => boolean>();
  const ownedEvents = new WeakSet<Event>();
  provide(nestedSelectKey, (isOpen) => {
    selects.add(isOpen);
    return () => selects.delete(isOpen);
  });

  const capture = (event: Event) => {
    if (Array.from(selects).some((isOpen) => isOpen())) ownedEvents.add(event);
  };
  useEventListener("pointerdown", capture, { capture: true });
  useEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") capture(event);
    },
    { capture: true },
  );

  return (event: Event) => ownedEvents.has(event);
}

export function registerNestedSelect(isOpen: () => boolean) {
  const register = inject(nestedSelectKey, undefined);
  if (register) onScopeDispose(register(isOpen));
}
