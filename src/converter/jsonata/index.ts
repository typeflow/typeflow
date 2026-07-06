/**
 * JSONata → Typeflow converter: takes a JSONata mapping expression and emits
 * equivalent Typeflow source, formatted canonically — including an `input`
 * declaration whose type is inferred from the expression itself (or from a
 * sample JSON value when provided). Constructs outside the supported subset
 * are reported in `errors`; semantic caveats in `notes`.
 */
import { ConvertError, parseJsonata } from './parser';
import { emit, type EmitContext, emitObjectBody, stubFn } from './emit';
import { format } from '../../formatter';
import { inferInputType } from './infer';
import { typeFromSample } from './sample-type';

export { typeFromSample } from './sample-type';

export interface ConvertJsonataOptions {
  /** Name of the Typeflow input binding used for root-relative paths (default: "data"). */
  inputName?: string;
  /**
   * How to produce the `input` declaration:
   * - `'infer'` (default): infer a structural type from the JSONata usage;
   * - `'none'`: emit only the `map` block;
   * - a sample JSON value: derive the type from it (most precise).
   */
  input?: 'infer' | 'none' | { sample: unknown };
}

export interface ConvertJsonataResult {
  ok: boolean;
  /** Generated Typeflow source (canonically formatted when `ok`). */
  typeflow: string;
  /** Semantic caveats worth reviewing after conversion. */
  notes: string[];
  /** Unsupported constructs; when non-empty, `ok` is false. */
  errors: string[];
}

export function convertJsonata(
  source: string,
  options: ConvertJsonataOptions = {},
): ConvertJsonataResult {
  const notes: string[] = [];
  const inputName = options.inputName ?? 'data';
  const inputMode = options.input ?? 'infer';
  const ctx: EmitContext = {
    inputName,
    relative: false,
    stubs: new Map(),
    notes,
  };

  let body: string;
  try {
    const ast = parseJsonata(source);
    // Emit the map first: this populates `ctx.stubs` with any unknown functions.
    let mapBlock: string;
    if (ast.kind === 'object') {
      mapBlock = `map ${emitObjectBody(ast, ctx)}`;
    } else if (ast.kind === 'block' && ast.result.kind === 'object') {
      // `( $x := ...; { ... } )` becomes a `map` block with `let` bindings.
      mapBlock = `map ${emit(ast, ctx)}`;
    } else {
      notes.push(
        'The JSONata expression is not an object constructor; its value was wrapped in a `value` field.',
      );
      mapBlock = `map { value: ${emit(ast, ctx)} }`;
    }
    // Assemble: input declaration, then stub `fn` mocks, then the map block.
    const parts: string[] = [];
    if (inputMode !== 'none') {
      const type =
        inputMode === 'infer'
          ? inferInputType(ast)
          : typeFromSample(inputMode.sample);
      parts.push(`input ${inputName}: ${type}`);
      if (inputMode === 'infer') {
        notes.push(
          'The input type was inferred from the expression — refine the `unknown` leaves.',
        );
      }
    }
    for (const [name, arity] of ctx.stubs) parts.push(stubFn(name, arity));
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
