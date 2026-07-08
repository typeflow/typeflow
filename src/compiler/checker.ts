import {
  type Builtin,
  BUILTINS,
  isBooleanish,
  isNumberish,
  isStringish,
} from '../builtins';
import {
  containsNullish,
  containsUndefined,
  type Diagnostic,
  type Expr,
  type FilterExpr,
  type IdentExpr,
  type IdentRes,
  type IndexExpr,
  makeUnion,
  nonNullishParts,
  type ObjectExpr,
  type ObjectField,
  parentChainDepth,
  type Span,
  stripNullish,
  stripUndefined,
  suggestName,
  T,
  type Type,
  typeToString,
} from '../core/index';

interface Scope {
  vars: Map<string, Type>;
  /** Element type for filter predicates and `->` projections; fields resolve as bare identifiers. */
  element?: Type;
  /** Input type, set on the root scope; reachable from anywhere as `$root`. */
  rootType?: Type;
  /**
   * Index scopes: the runtime env exists (hop counts stay aligned) but its
   * element is `undefined`, so bare identifiers never resolve to element
   * fields there at runtime.
   */
  noRuntimeElement?: boolean;
  /**
   * Bracket scopes only: identifiers whose static resolution landed on this
   * scope's element. If the bracket turns out to be an `index`, they are
   * re-marked dynamic (see `noRuntimeElement`).
   */
  bracketIdents?: IdentExpr[];
  parent?: Scope;
}

export class Checker {
  constructor(
    private diagnostics: Diagnostic[],
    private functions: Record<string, Builtin> = BUILTINS,
  ) {}

  private error(
    code: string,
    message: string,
    span: Span,
    hint?: string,
  ): void {
    this.diagnostics.push({ code, message, span, severity: 'error', hint });
  }

  private warn(code: string, message: string, span: Span, hint?: string): void {
    this.diagnostics.push({ code, message, span, severity: 'warning', hint });
  }

  checkMapping(map: ObjectExpr, inputName: string, inputType: Type): Type {
    const root: Scope = {
      vars: new Map([[inputName, inputType]]),
      rootType: inputType,
    };
    return this.checkExpr(map, root);
  }

  /** Type-check a `fn` body: only its parameters are in scope (pure function). */
  checkFunctionBody(body: Expr, params: Map<string, Type>): Type {
    return this.checkExpr(body, { vars: params });
  }

  /** The input type, set on the root scope; `$root` reaches it through any nesting. */
  private resolveRootType(scope: Scope): Type | undefined {
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.rootType !== undefined) return s.rootType;
    }
    return undefined;
  }

  /**
   * The element type `n` levels up (`$parent` = 1, `$parent.$parent` = 2, …),
   * or the input if the chain climbs past every enclosing element.
   */
  private nthParentType(scope: Scope, n: number): Type | undefined {
    let count = 0;
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.element !== undefined) {
        count++;
        if (count === n + 1) return s.element;
      }
    }
    return this.resolveRootType(scope);
  }

  /**
   * Resolve an identifier and, when the resolution is runtime-stable, say
   * where it lands (`res`) so the runtime can read it directly instead of
   * walking the env chain.
   *
   * A static resolution is only claimed when every element scope CROSSED on
   * the way is a concrete object type without the name (any other element
   * kind could still own the property at runtime and shadow the outer
   * resolution), and the landing field is non-optional. `$root` / `$parent` /
   * `$` stay special-cased in the runtime and get no annotation.
   */
  private resolveIdentRes(
    name: string,
    scope: Scope,
  ): { type: Type | undefined; res?: IdentRes; landing?: Scope } {
    if (name === '$root') return { type: this.resolveRootType(scope) };
    if (name === '$parent') return { type: this.nthParentType(scope, 1) };
    let hops = 0;
    let unsafeCross = false;
    for (let s: Scope | undefined = scope; s; s = s.parent, hops++) {
      if (s.element) {
        if (name === '$') return { type: s.element };
        if (!s.noRuntimeElement) {
          if (s.element.kind === 'any' || s.element.kind === 'unknown') {
            return { type: T.any, res: { kind: 'dyn' } };
          }
          if (s.element.kind === 'object') {
            const field = s.element.fields.find((f) => f.name === name);
            if (field) {
              const type = field.optional
                ? makeUnion([field.type, T.undefined])
                : field.type;
              // Optional fields may be absent at runtime, where the dynamic
              // lookup falls through to outer scopes — keep them dynamic.
              const res: IdentRes =
                field.optional || unsafeCross
                  ? { kind: 'dyn' }
                  : { kind: 'field', hops };
              return { type, res, landing: s };
            }
          } else {
            // Union/array/primitive element: the runtime hasOwn check could
            // still match — crossing it statically would change scoping.
            unsafeCross = true;
          }
        }
      }
      const v = s.vars.get(name);
      if (v) {
        return {
          type: v,
          res: unsafeCross ? { kind: 'dyn' } : { kind: 'var', hops },
          landing: s,
        };
      }
    }
    return { type: undefined };
  }

  private visibleNames(scope: Scope): string[] {
    const names: string[] = [];
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.element?.kind === 'object')
        names.push(...s.element.fields.map((f) => f.name));
      names.push(...s.vars.keys());
    }
    return names;
  }

  private checkExpr(expr: Expr, scope: Scope): Type {
    switch (expr.kind) {
      case 'lit':
        if (expr.value === null) return T.null;
        return T.literal(expr.value);

      case 'ident': {
        const { type: t, res, landing } = this.resolveIdentRes(expr.name, scope);
        if (t === undefined) {
          const suggestion = suggestName(expr.name, this.visibleNames(scope));
          this.error(
            'TF2001',
            `Cannot find name '${expr.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
            expr.span,
          );
          return T.any;
        }
        // Annotate the node; bodies re-checked against several union parts
        // may resolve differently per part — a conflict degrades to dynamic.
        if (res) {
          if (expr.res === undefined) {
            expr.res = res;
          } else if (
            expr.res.kind !== res.kind ||
            (expr.res.kind !== 'dyn' &&
              res.kind !== 'dyn' &&
              expr.res.hops !== res.hops)
          ) {
            expr.res = { kind: 'dyn' };
          }
          if (expr.res.kind === 'field' && landing?.bracketIdents) {
            landing.bracketIdents.push(expr);
          }
        }
        return t;
      }

      case 'member': {
        // `$parent.$parent…` climbs enclosing elements; a trailing `.field`
        // reads that ancestor's field.
        const depth = parentChainDepth(expr);
        if (depth !== null) return this.nthParentType(scope, depth) ?? T.any;
        const objDepth = parentChainDepth(expr.object);
        const objType =
          objDepth === null
            ? this.checkExpr(expr.object, scope)
            : (this.nthParentType(scope, objDepth) ?? T.any);
        return this.checkMemberAccess(
          objType,
          expr.name,
          expr.optional,
          expr.nameSpan,
        );
      }

      case 'bracket': {
        const objType = this.checkExpr(expr.object, scope);
        const arrayInfo = this.expectArray(
          objType,
          expr.span,
          'Filtering or indexing',
        );
        const element = arrayInfo ?? T.any;
        const inner = expr.inner;
        const innerScope: Scope = {
          vars: new Map(),
          element,
          bracketIdents: [],
          parent: scope,
        };
        const innerType = this.checkExpr(inner, innerScope);

        const mutable = expr as unknown as Record<string, unknown>;
        if (isNumberish(innerType) && innerType.kind !== 'any') {
          // Numeric index: rewrite to `index`; the element may be absent.
          // The runtime evaluates the index with element = undefined, so any
          // identifier statically resolved to THIS element must go dynamic.
          for (const id of innerScope.bracketIdents!) id.res = { kind: 'dyn' };
          mutable.kind = 'index';
          mutable.index = inner;
          delete mutable.inner;
          delete mutable.predicate;
          return makeUnion([element, T.undefined]);
        }
        if (!isBooleanish(innerType)) {
          this.error(
            'TF2009',
            `A filter predicate must be of type 'boolean', got '${typeToString(innerType)}'.`,
            inner.span,
          );
        }
        mutable.kind = 'filter';
        mutable.predicate = inner;
        delete mutable.inner;
        delete mutable.index;
        return objType.kind === 'any' ? T.any : T.array(element);
      }

      // Already-rewritten nodes (re-checked when a body is analyzed against several union parts).
      case 'index': {
        const objType = this.checkExpr(expr.object, scope);
        const element =
          this.expectArray(objType, expr.span, 'Indexing') ?? T.any;
        this.checkExpr((expr as IndexExpr).index, {
          vars: new Map(),
          element,
          noRuntimeElement: true,
          parent: scope,
        });
        return makeUnion([element, T.undefined]);
      }
      case 'filter': {
        const objType = this.checkExpr(expr.object, scope);
        const element =
          this.expectArray(objType, expr.span, 'Filtering') ?? T.any;
        this.checkExpr((expr as FilterExpr).predicate, {
          vars: new Map(),
          element,
          parent: scope,
        });
        return objType.kind === 'any' ? T.any : T.array(element);
      }

      case 'sort': {
        const objType = this.checkExpr(expr.object, scope);
        const element =
          this.expectArray(objType, expr.span, 'Sorting') ?? T.any;
        const keyScope: Scope = { vars: new Map(), element, parent: scope };
        for (const term of expr.terms) {
          const keyType = this.checkExpr(term.key, keyScope);
          // Nullish keys are allowed — the runtime sorts them last — so check
          // only the non-nullish part of the key's type. `unknown` keys pass
          // too: comparing a value is safe (unlike member access), and it lets
          // a not-yet-refined leaf be sorted on.
          const sortable = stripNullish(keyType);
          if (
            keyType.kind !== 'any' &&
            sortable.kind !== 'unknown' &&
            !isNumberish(sortable) &&
            !isStringish(sortable)
          ) {
            this.error(
              'TF2011',
              `A sort key must be of type 'number' or 'string', got '${typeToString(keyType)}'.`,
              term.key.span,
            );
          }
        }
        return objType.kind === 'any' ? T.any : T.array(element);
      }

      case 'project': {
        const objType = this.checkExpr(expr.object, scope);
        // Optional `-> l { ... }` alias binds each element to `l` as well as `$`;
        // `-> l, i { ... }` also binds the 0-based position to `i` (a number).
        const bindScope = (element: Type): Scope => {
          const vars = new Map<string, Type>();
          if (expr.binder) vars.set(expr.binder, element);
          if (expr.indexBinder) vars.set(expr.indexBinder, T.number);
          return { vars, element, parent: scope };
        };
        if (objType.kind === 'any') {
          this.checkExpr(expr.body, bindScope(T.any));
          return T.any;
        }
        if (containsNullish(objType)) {
          this.error(
            'TF2003',
            `The target of '->' is possibly ${nullishNames(objType)}.`,
            expr.object.span,
            "Provide a default with '??' before projecting.",
          );
        }
        const results: Type[] = [];
        for (const part of nonNullishParts(objType)) {
          if (
            part.kind === 'object' ||
            part.kind === 'any' ||
            part.kind === 'unknown'
          ) {
            results.push(this.checkExpr(expr.body, bindScope(part)));
          } else if (part.kind === 'array') {
            const el = part.element;
            results.push(T.array(this.checkExpr(expr.body, bindScope(el))));
          } else {
            this.error(
              'TF2006',
              `'->' projection requires an object or an array of objects, got '${typeToString(part)}'.`,
              expr.object.span,
            );
            results.push(T.any);
          }
        }
        return makeUnion(results.length ? results : [T.any]);
      }

      case 'unary': {
        const t = this.checkExpr(expr.operand, scope);
        if (expr.op === '!') {
          if (!isBooleanish(t)) {
            this.error(
              'TF2004',
              `Operator '!' cannot be applied to type '${typeToString(t)}'.`,
              expr.span,
            );
          }
          return T.boolean;
        }
        if (!isNumberish(t)) {
          this.error(
            'TF2004',
            `Operator '-' cannot be applied to type '${typeToString(t)}'.`,
            expr.span,
          );
        }
        return T.number;
      }

      case 'binary':
        return this.checkBinary(expr, scope);

      case 'cond': {
        const condType = this.checkExpr(expr.cond, scope);
        if (!isBooleanish(condType)) {
          this.error(
            'TF2004',
            `A condition must be of type 'boolean', got '${typeToString(condType)}'.`,
            expr.cond.span,
          );
        }
        const thenType = this.checkExpr(expr.then, scope);
        const elseType = this.checkExpr(expr.else, scope);
        return makeUnion([thenType, elseType]);
      }

      case 'call': {
        const fn = this.functions[expr.name];
        if (!fn) {
          const names = Object.keys(this.functions);
          const suggestion = suggestName(expr.name, names);
          this.error(
            'TF2007',
            `Unknown function '${expr.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
            expr.nameSpan,
            `Available functions: ${names.join(', ')}.`,
          );
          expr.args.forEach((a) => this.checkExpr(a, scope));
          return T.any;
        }
        const required = fn.params.filter((p) => !p.optional).length;
        if (
          expr.args.length < required ||
          expr.args.length > fn.params.length
        ) {
          const expected =
            required === fn.params.length
              ? `${required}`
              : `${required} to ${fn.params.length}`;
          this.error(
            'TF2008',
            `Expected ${expected} argument(s), got ${expr.args.length}.`,
            expr.span,
            fn.signature,
          );
        }
        const argTypes = expr.args.map((arg, i) => {
          const argType = this.checkExpr(arg, scope);
          const param = fn.params[i];
          if (param && argType.kind !== 'any' && !param.check(argType)) {
            this.error(
              'TF2008',
              `Argument of type '${typeToString(argType)}' is not assignable to parameter of type '${param.label}'.`,
              arg.span,
              fn.signature,
            );
          }
          return argType;
        });
        return typeof fn.result === 'function'
          ? fn.result(argTypes)
          : fn.result;
      }

      case 'object': {
        // `let` bindings open a child scope for this block: each binding sees
        // the ones declared before it (forward references are rejected, so no
        // cycles), and all of the block's properties see every binding.
        let blockScope = scope;
        if (expr.lets && expr.lets.length > 0) {
          const vars = new Map<string, Type>();
          const boundNames = new Set<string>();
          blockScope = { vars, parent: scope };
          for (const binding of expr.lets) {
            if (boundNames.has(binding.name)) {
              this.error(
                'TF2018',
                `Duplicate binding '${binding.name}'.`,
                binding.nameSpan,
              );
            }
            boundNames.add(binding.name);
            // Checked in `blockScope`, so a binding sees earlier bindings only.
            const bindingType = this.checkExpr(binding.value, blockScope);
            vars.set(binding.name, bindingType);
          }
        }

        const fields: ObjectField[] = [];
        const seen = new Set<string>();
        for (const prop of expr.props) {
          if (seen.has(prop.name)) {
            this.error(
              'TF2014',
              `Duplicate property '${prop.name}'.`,
              prop.span,
            );
            continue;
          }
          seen.add(prop.name);
          const valueType = this.checkExpr(prop.value, blockScope);
          // A value that may be undefined becomes an optional output field.
          if (containsUndefined(valueType)) {
            fields.push({
              name: prop.name,
              type: stripUndefined(valueType),
              optional: true,
            });
          } else {
            fields.push({ name: prop.name, type: valueType, optional: false });
          }
        }
        return T.object(fields);
      }

      case 'array': {
        const elementTypes = expr.elements.map((e) => this.checkExpr(e, scope));
        return T.array(
          elementTypes.length ? makeUnion(elementTypes) : T.unknown,
        );
      }
    }
  }

  private checkMemberAccess(
    objType: Type,
    name: string,
    optional: boolean,
    nameSpan: Span,
  ): Type {
    if (objType.kind === 'any') return T.any;
    if (objType.kind === 'unknown') {
      this.error(
        'TF2012',
        `Property '${name}' does not exist on type 'unknown'.`,
        nameSpan,
      );
      return T.any;
    }

    let addUndefined = false;
    if (containsNullish(objType)) {
      if (!optional) {
        this.error(
          'TF2003',
          `Object is possibly ${nullishNames(objType)}.`,
          nameSpan,
          `Use the optional access operator: '?.${name}', or provide a default with '??'.`,
        );
      } else {
        addUndefined = true;
      }
      objType = stripNullish(objType);
    }

    const results: Type[] = [];
    for (const part of nonNullishParts(objType)) {
      results.push(this.accessOnPart(part, name, nameSpan));
    }
    if (addUndefined) results.push(T.undefined);
    return makeUnion(results.length ? results : [T.any]);
  }

  private accessOnPart(part: Type, name: string, nameSpan: Span): Type {
    if (part.kind === 'any') return T.any;
    if (part.kind === 'object') {
      const field = part.fields.find((f) => f.name === name);
      if (!field) {
        const suggestion = suggestName(
          name,
          part.fields.map((f) => f.name),
        );
        this.error(
          'TF2002',
          `Property '${name}' does not exist on type '${typeToString(part)}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
          nameSpan,
        );
        return T.any;
      }
      return field.optional ? makeUnion([field.type, T.undefined]) : field.type;
    }
    if (part.kind === 'array') {
      // Path access distributes over arrays of objects: `items.name` maps to `string[]`.
      const el = part.element;
      if (el.kind === 'object' || el.kind === 'any' || el.kind === 'union') {
        const mapped = this.accessOnPart(
          el.kind === 'union' ? makeUnion(el.types) : el,
          name,
          nameSpan,
        );
        return T.array(mapped);
      }
      this.error(
        'TF2006',
        `Cannot access property '${name}' on elements of type '${typeToString(el)}'.`,
        nameSpan,
      );
      return T.any;
    }
    this.error(
      'TF2006',
      `Cannot access property '${name}' on type '${typeToString(part)}'.`,
      nameSpan,
    );
    return T.any;
  }

  private expectArray(
    t: Type,
    span: Span,
    operation: string,
  ): Type | undefined {
    if (t.kind === 'any') return undefined;
    if (containsNullish(t)) {
      this.error(
        'TF2003',
        `Object is possibly ${nullishNames(t)}.`,
        span,
        "Provide a default with '??' before filtering or indexing.",
      );
      t = stripNullish(t);
    }
    const parts = nonNullishParts(t);
    const elements: Type[] = [];
    for (const part of parts) {
      if (part.kind === 'array') elements.push(part.element);
      else if (part.kind === 'any') return undefined;
      else {
        this.error(
          'TF2005',
          `${operation} requires an array type, got '${typeToString(part)}'.`,
          span,
        );
        return undefined;
      }
    }
    return elements.length ? makeUnion(elements) : undefined;
  }

  private checkBinary(
    expr: Extract<Expr, { kind: 'binary' }>,
    scope: Scope,
  ): Type {
    const left = this.checkExpr(expr.left, scope);

    if (expr.op === '??') {
      if (
        !containsNullish(left) &&
        left.kind !== 'any' &&
        left.kind !== 'unknown'
      ) {
        this.warn(
          'TF2013',
          `The left side of '??' has type '${typeToString(left)}', which is never null or undefined.`,
          expr.left.span,
        );
      }
      const right = this.checkExpr(expr.right, scope);
      return makeUnion([stripNullish(left), right]);
    }

    const right = this.checkExpr(expr.right, scope);
    const bothAny = left.kind === 'any' && right.kind === 'any';

    switch (expr.op) {
      case '+': {
        if (bothAny) return T.any;
        const leftStr = isStringish(left);
        const rightStr = isStringish(right);
        const leftNum = isNumberish(left);
        const rightNum = isNumberish(right);
        if (
          (leftStr && rightStr) ||
          (left.kind === 'any' && rightStr) ||
          (leftStr && right.kind === 'any')
        ) {
          return T.string;
        }
        if (
          (leftNum && rightNum) ||
          (left.kind === 'any' && rightNum) ||
          (leftNum && right.kind === 'any')
        ) {
          return T.number;
        }
        this.error(
          'TF2004',
          `Operator '+' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
          expr.span,
          "Typeflow does not coerce types: '+' expects two strings or two numbers.",
        );
        return T.any;
      }
      case '-':
      case '*':
      case '/':
      case '%': {
        if (!isNumberish(left) || !isNumberish(right)) {
          this.error(
            'TF2004',
            `Operator '${expr.op}' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
            expr.span,
          );
        }
        return T.number;
      }
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const bothNumbers = isNumberish(left) && isNumberish(right);
        const bothStrings = isStringish(left) && isStringish(right);
        if (!bothNumbers && !bothStrings) {
          this.error(
            'TF2004',
            `Operator '${expr.op}' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
            expr.span,
          );
        }
        return T.boolean;
      }
      case '==':
      case '!=': {
        if (!typesOverlap(left, right)) {
          this.warn(
            'TF2367',
            `This comparison appears to be unintentional because the types '${typeToString(left)}' and '${typeToString(right)}' have no overlap.`,
            expr.span,
          );
        }
        return T.boolean;
      }
      case '&&':
      case '||': {
        if (!isBooleanish(left) || !isBooleanish(right)) {
          this.error(
            'TF2004',
            `Operator '${expr.op}' expects boolean operands, got '${typeToString(left)}' and '${typeToString(right)}'.`,
            expr.span,
          );
        }
        return T.boolean;
      }
    }
  }
}

function nullishNames(t: Type): string {
  const parts = t.kind === 'union' ? t.types : [t];
  const hasUndefined = parts.some((p) => p.kind === 'undefined');
  const hasNull = parts.some((p) => p.kind === 'null');
  if (hasUndefined && hasNull) return "'null' or 'undefined'";
  return hasNull ? "'null'" : "'undefined'";
}

function baseCategories(t: Type): Set<string> {
  const out = new Set<string>();
  const parts = t.kind === 'union' ? t.types : [t];
  for (const p of parts) {
    if (p.kind === 'literal') out.add(typeof p.value);
    else if (p.kind === 'any' || p.kind === 'unknown') out.add('*');
    else out.add(p.kind);
  }
  return out;
}

function typesOverlap(a: Type, b: Type): boolean {
  const ca = baseCategories(a);
  const cb = baseCategories(b);
  if (ca.has('*') || cb.has('*')) return true;
  for (const c of ca) if (cb.has(c)) return true;
  return false;
}
