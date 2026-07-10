import {
  type Builtin,
  type BuiltinGroup,
  pAny,
  pNum,
  pNumOpt,
  pStr,
  pStrOpt,
} from './types';
import { num, str } from './values';
import { T } from '#core';

const functions: Record<string, Builtin> = {
  // ---- Conversion ----
  string: {
    signature: 'string(value: unknown): string',
    doc: 'Converts any value to its string representation (JSON for objects and arrays).',
    example: `label: "Order #" + string(order.id)`,
    category: 'Conversion',
    params: [pAny()],
    result: T.string,
    impl: ([v]) =>
      v === undefined
        ? undefined
        : typeof v === 'string'
          ? v
          : JSON.stringify(v),
  },

  // ---- Inspect ----
  length: {
    signature: 'length(value: string): number',
    doc: 'Number of characters in the string.',
    example: `nameLength: length(user.name)`,
    category: 'Inspect',
    params: [pStr()],
    result: T.number,
    impl: ([v]) => str(v)?.length,
  },
  contains: {
    signature: 'contains(value: string, substring: string): boolean',
    doc: 'True if the string contains the given substring.',
    example: `isWorkEmail: contains(user.email, "@work.")`,
    category: 'Inspect',
    params: [pStr(), pStr('substring')],
    result: T.boolean,
    impl: ([v, sub]) => {
      const s = str(v);
      const c = str(sub);
      return s === undefined || c === undefined ? undefined : s.includes(c);
    },
  },
  matches: {
    signature: 'matches(value: string, pattern: string): boolean',
    doc: 'True if the string matches the regular expression `pattern`.',
    example: `isZip: matches(user.zip, "^[0-9]{5}$")`,
    category: 'Inspect',
    params: [pStr(), pStr('pattern')],
    result: T.boolean,
    impl: ([v, pattern]) => {
      const s = str(v);
      const p = str(pattern);
      return s === undefined || p === undefined
        ? undefined
        : new RegExp(p).test(s);
    },
  },

  // ---- Case & whitespace ----
  upper: {
    signature: 'upper(value: string): string',
    doc: 'Uppercases the string.',
    example: `shout: upper(user.name)`,
    category: 'Case & whitespace',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => str(v)?.toUpperCase(),
  },
  lower: {
    signature: 'lower(value: string): string',
    doc: 'Lowercases the string.',
    example: `handle: lower(user.username)`,
    category: 'Case & whitespace',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => str(v)?.toLowerCase(),
  },
  trim: {
    signature: 'trim(value: string): string',
    doc: 'Removes leading and trailing whitespace.',
    example: `clean: trim(user.rawName)`,
    category: 'Case & whitespace',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => str(v)?.trim(),
  },
  pad: {
    signature: 'pad(value: string, width: number, char?: string): string',
    doc: 'Pads to `width` with `char` (default space); a negative width pads on the left.',
    example: `padded: pad(user.ref, -8, "0")`,
    category: 'Case & whitespace',
    params: [pStr(), pNum('width'), pStrOpt('char')],
    result: T.string,
    impl: ([v, width, char]) => {
      const s = str(v);
      const w = num(width);
      if (s === undefined || w === undefined) return undefined;
      const c = str(char) ?? ' ';
      return w < 0 ? s.padStart(-w, c) : s.padEnd(w, c);
    },
  },

  // ---- Transform ----
  substring: {
    signature:
      'substring(value: string, start: number, length?: number): string',
    doc: 'Extracts `length` characters from `start`; a negative start counts from the end.',
    example: `initials: substring(user.name, 0, 1)`,
    category: 'Transform',
    params: [pStr(), pNum('start'), pNumOpt('length')],
    result: T.string,
    impl: ([v, start, len]) => {
      const s = str(v);
      if (s === undefined) return undefined;
      let from = num(start) ?? 0;
      if (from < 0) from = Math.max(0, s.length + from);
      const l = num(len);
      return l === undefined
        ? s.slice(from)
        : s.slice(from, from + Math.max(0, l));
    },
  },
  split: {
    signature:
      'split(value: string, separator: string, limit?: number): string[]',
    doc: 'Splits on a separator, optionally keeping only the first `limit` parts.',
    example: `domain: split(user.email, "@")[1]`,
    category: 'Transform',
    params: [pStr(), pStr('separator'), pNumOpt('limit')],
    result: T.array(T.string),
    impl: ([v, sep, limit]) => {
      const s = str(v);
      const sp = str(sep);
      if (s === undefined || sp === undefined) return undefined;
      const parts = s.split(sp);
      const l = num(limit);
      return l === undefined ? parts : parts.slice(0, Math.max(0, l));
    },
  },
  replace: {
    signature:
      'replace(value: string, pattern: string, replacement: string): string',
    doc: 'Replaces every occurrence of `pattern` with `replacement`.',
    example: `masked: replace(user.email, "a", "*")`,
    category: 'Transform',
    params: [pStr(), pStr('pattern'), pStr('replacement')],
    result: T.string,
    impl: ([v, pattern, replacement]) => {
      const s = str(v);
      const p = str(pattern);
      const r = str(replacement);
      if (s === undefined || p === undefined || r === undefined)
        return undefined;
      return p === '' ? s : s.split(p).join(r);
    },
  },

  // ---- Encoding ----
  base64encode: {
    signature: 'base64encode(value: string): string',
    doc: 'Encodes the string to Base64 (UTF-8 safe).',
    example: `token: base64encode(user.id + ":" + user.secret)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => {
      const s = str(v);
      return s === undefined
        ? undefined
        : btoa(unescape(encodeURIComponent(s)));
    },
  },
  base64decode: {
    signature: 'base64decode(value: string): string',
    doc: 'Decodes a Base64 string (UTF-8 safe).',
    example: `decoded: base64decode(request.token)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => {
      const s = str(v);
      return s === undefined ? undefined : decodeURIComponent(escape(atob(s)));
    },
  },
  encodeUrl: {
    signature: 'encodeUrl(value: string): string',
    doc: 'Encodes a full URL (`encodeURI`).',
    example: `link: encodeUrl(page.canonicalUrl)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => (str(v) === undefined ? undefined : encodeURI(str(v)!)),
  },
  decodeUrl: {
    signature: 'decodeUrl(value: string): string',
    doc: 'Decodes a full URL (`decodeURI`).',
    example: `link: decodeUrl(request.rawUrl)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) => (str(v) === undefined ? undefined : decodeURI(str(v)!)),
  },
  encodeUrlComponent: {
    signature: 'encodeUrlComponent(value: string): string',
    doc: 'Encodes a URL component (`encodeURIComponent`).',
    example: `query: encodeUrlComponent(search.term)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) =>
      str(v) === undefined ? undefined : encodeURIComponent(str(v)!),
  },
  decodeUrlComponent: {
    signature: 'decodeUrlComponent(value: string): string',
    doc: 'Decodes a URL component (`decodeURIComponent`).',
    example: `term: decodeUrlComponent(request.query)`,
    category: 'Encoding',
    params: [pStr()],
    result: T.string,
    impl: ([v]) =>
      str(v) === undefined ? undefined : decodeURIComponent(str(v)!),
  },
};

/** Strings — see the generated docs section of the same name. */
export const strings: BuiltinGroup = {
  id: 'strings',
  title: 'Strings',
  example: {
    mapping: `input user: { email: string, ref: string }

map {
  local: split(user.email, "@")[0] ?? "",
  domain: split(user.email, "@")[1] ?? "",
  padded: pad(user.ref, -8, "0"),
  isWorkEmail: contains(user.email, "@work."),
  masked: replace(user.email, "a", "*"),
  shout: upper(substring(user.email, 0, 3)),
}`,
    input: `{ "email": "ada@work.dev", "ref": "42" }`,
  },
  functions,
};
