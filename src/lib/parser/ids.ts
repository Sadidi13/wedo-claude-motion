/**
 * Layer id generation: `${tagSlug}-${6 random lowercase alphanumerics}`,
 * e.g. "sprite-k3f9x2", "div-7hq2za". The random part uses nanoid's
 * `customAlphabet`, which is isomorphic (WebCrypto in the browser, node:crypto
 * on the server through nanoid's own conditional exports).
 */
import { customAlphabet } from "nanoid";

const randomSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

/**
 * Lower-case, alphanumeric slug of a JSX tag name. Member and namespaced
 * names keep only their last segment ("Motion.Sprite" → "sprite",
 * "svg:path" → "path"); names with no usable characters fall back to "el".
 */
export function tagSlug(tag: string): string {
  const last = tag.split(/[.:]/).pop() ?? tag;
  const slug = last.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug || "el";
}

/**
 * Generate an id for `tag` that is not in `taken`, and record it in `taken`
 * so subsequent calls in the same operation never collide.
 */
export function generateLayerId(tag: string, taken: Set<string>): string {
  const slug = tagSlug(tag);
  for (;;) {
    const id = `${slug}-${randomSuffix()}`;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}
