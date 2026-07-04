/**
 * Demo implementations for `use` declarations in playground examples.
 * The docs can demonstrate external TS functions without module loading:
 * any example that declares `use slugify(...)` or `use capitalize(...)`
 * gets these implementations at runtime.
 */
export const DEMO_FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  slugify: (v) =>
    String(v)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
  capitalize: (v) => {
    const s = String(v);
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};
