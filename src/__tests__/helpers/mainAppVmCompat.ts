import type { VueWrapper } from "@vue/test-utils";
import { isRef } from "vue";

type AnyRecord = Record<PropertyKey, any>;

const MODULE_KEYS = [
  "shell",
  "dialogs",
  "queue",
  "batchCompress",
  "presetsModule",
  "media",
  "preview",
  "dnd",
  "settings",
  "updater",
  "queueContextMenu",
] as const;

function unwrapIfRef(value: unknown) {
  return isRef(value) ? value.value : value;
}

function tryResolveFromContainer(container: AnyRecord | null | undefined, prop: PropertyKey) {
  if (!container) return { found: false as const, value: undefined };
  if (!(prop in container)) return { found: false as const, value: undefined };
  return { found: true as const, value: unwrapIfRef(container[prop]) };
}

function canResolveFromContainer(container: AnyRecord | null | undefined, prop: PropertyKey) {
  return !!container && prop in container;
}

/**
 * Backwards-compatible VM adapter for MainApp refactors.
 *
 * Many older tests access `wrapper.vm.<key>` even after we moved most state into
 * domain-scoped modules under `vm.setup.*`. This proxy resolves missing keys
 * from `vm.setup` and its nested modules, unwrapping refs to match Vue proxy
 * behaviour for top-level setup bindings.
 */
export function withMainAppVmCompat<T extends VueWrapper<any>>(wrapper: T) {
  const rawVm: AnyRecord = wrapper.vm as any;

  return new Proxy(rawVm, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);

      if (prop in target) return Reflect.get(target, prop, receiver);

      const setup = (target as AnyRecord).setup as AnyRecord | undefined;
      const fromSetup = tryResolveFromContainer(setup, prop);
      if (fromSetup.found) return fromSetup.value;

      for (const key of MODULE_KEYS) {
        const fromModule = tryResolveFromContainer(setup?.[key], prop);
        if (fromModule.found) return fromModule.value;
      }

      return undefined;
    },
    has(target, prop) {
      if (typeof prop === "symbol") return prop in target;
      if (prop in target) return true;

      const setup = (target as AnyRecord).setup as AnyRecord | undefined;
      if (canResolveFromContainer(setup, prop)) return true;

      for (const key of MODULE_KEYS) {
        if (canResolveFromContainer(setup?.[key], prop)) return true;
      }

      return false;
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "symbol") return Reflect.set(target, prop, value, receiver);

      if (prop in target) return Reflect.set(target, prop, value, receiver);

      const setup = (target as AnyRecord).setup as AnyRecord | undefined;
      if (setup) {
        const direct = setup[prop];
        if (isRef(direct)) {
          direct.value = value;
          return true;
        }
        if (prop in setup) {
          setup[prop] = value;
          return true;
        }

        for (const key of MODULE_KEYS) {
          const mod = setup[key] as AnyRecord | undefined;
          if (!mod || !(prop in mod)) continue;
          const current = mod[prop];
          if (isRef(current)) {
            current.value = value;
          } else {
            mod[prop] = value;
          }
          return true;
        }
      }

      return Reflect.set(target, prop, value, receiver);
    },
  });
}
