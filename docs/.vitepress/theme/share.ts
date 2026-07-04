/**
 * Playground deep links: the (mapping, input) pair travels in the URL hash
 * as `#code=<base64url(UTF-8 JSON)>`, so any example can be opened in the
 * full playground and any playground state can be shared as a plain URL.
 */

export function encodePlaygroundState(mapping: string, input: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify([mapping, input]));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePlaygroundState(
  hash: string,
): { mapping: string; input: string } | null {
  const m = /[#&]code=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !Array.isArray(parsed) ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    ) {
      return null;
    }
    return { mapping: parsed[0], input: parsed[1] };
  } catch {
    return null;
  }
}
