/**
 * jq -> Typeflow converter: takes a jq mapping expression and emits equivalent
 * Typeflow source for the supported jq subset.
 */
import { format } from '../../formatter';
import { emit, emitObjectBody, type EmitContext } from './emit';
import { inferInputType } from './infer';
import { ConvertError, parseJq } from './parser';
import { typeFromSample } from '../jsonata/sample-type';

export { typeFromSample } from '../jsonata/sample-type';

export interface ConvertJqOptions {
  /** Name of the Typeflow input binding used for root-relative paths (default: "data"). */
  inputName?: string;
  /**
   * How to produce the `input` declaration:
   * - `'infer'` (default): infer a structural type from jq usage;
   * - `'none'`: emit only the `map` block;
   * - a sample JSON value: derive the type from it.
   */
  input?: 'infer' | 'none' | { sample: unknown };
}

export interface ConvertJqResult {
  ok: boolean;
  typeflow: string;
  notes: string[];
  errors: string[];
}

export function convertJq(
  source: string,
  options: ConvertJqOptions = {},
): ConvertJqResult {
  const notes: string[] = [];
  const inputName = options.inputName ?? 'data';
  const inputMode = options.input ?? 'infer';
  const ctx: EmitContext = {
    inputName,
    current: inputName,
    relative: false,
    notes,
  };

  let body: string;
  try {
    const ast = parseJq(source);
    const mapBlock =
      ast.kind === 'object'
        ? `map ${emitObjectBody(ast, ctx)}`
        : `map { value: ${emit(ast, ctx)} }`;

    if (ast.kind !== 'object') {
      notes.push(
        'The jq expression is not an object constructor; its value was wrapped in a `value` field.',
      );
    }

    const parts: string[] = [];
    if (inputMode !== 'none') {
      const type =
        inputMode === 'infer'
          ? inferInputType(ast)
          : typeFromSample(inputMode.sample);
      parts.push(`input ${inputName}: ${type}`);
      if (inputMode === 'infer') {
        notes.push(
          'The input type was inferred from the expression - refine the `unknown` leaves.',
        );
      }
    }
    parts.push(mapBlock);
    body = parts.join('\n\n');
  } catch (e) {
    if (e instanceof ConvertError) {
      return { ok: false, typeflow: '', notes, errors: [e.message] };
    }
    throw e;
  }

  const formatted = format(body);
  if (!formatted.ok) {
    return {
      ok: false,
      typeflow: body,
      notes,
      errors: [
        `Internal converter error: the generated Typeflow does not parse (${formatted.diagnostics[0]?.message ?? 'unknown'}).`,
      ],
    };
  }
  return {
    ok: true,
    typeflow: formatted.formatted,
    notes: [...new Set(notes)],
    errors: [],
  };
}
