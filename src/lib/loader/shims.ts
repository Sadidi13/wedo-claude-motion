/**
 * Host-provided modules handed to project code by `require()`.
 *
 * sucrase's CommonJS interop (`_interopRequireDefault` / `_interopRequireWildcard`)
 * treats an object with `__esModule: true` as an ES module and reads `.default`
 * for default imports, so every builtin is wrapped by `asEsModule`.
 */

import type { ReactNode } from "react";

/** Expose a host module (ESM namespace or CommonJS object) with a `default` export. */
export function asEsModule(mod: object, defaultExport: unknown = mod): Record<string, unknown> {
  return { ...mod, default: defaultExport, __esModule: true };
}

/**
 * `react-dom` / `react-dom/client` replacement: nothing is rendered, the element
 * passed to `createRoot(el).render(node)`, `hydrateRoot(el, node)` or
 * `render(node, el)` is captured so the loader can mount it itself.
 */
export function createReactDomShim(capture: (node: ReactNode) => void): Record<string, unknown> {
  const root = {
    render: (node: ReactNode) => capture(node),
    unmount: () => {},
  };
  const shim = {
    createRoot: () => root,
    hydrateRoot: (_container: unknown, node?: ReactNode) => {
      if (node !== undefined) capture(node);
      return root;
    },
    render: (node: ReactNode) => capture(node),
  };
  return asEsModule(shim);
}
