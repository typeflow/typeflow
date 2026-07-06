/**
 * Infers a structural Typeflow input type from a JSONata expression: every
 * root-relative path becomes a field, and usage (arithmetic, `&`, predicates,
 * `$fn` signatures, comparisons against literals) narrows the leaf types.
 * Unknowable leaves stay `unknown` — the user refines them afterwards.
 */
import { type JNode } from './parser';

type Leaf = 'string' | 'number' | 'boolean' | 'unknown';

interface TNode {
  leaf: Leaf;
  isArray: boolean;
  fields: Map<string, TNode>;
}

function makeNode(): TNode {
  return { leaf: 'unknown', isArray: false, fields: new Map() };
}

function setLeaf(node: TNode, leaf: Leaf): void {
  if (leaf === 'unknown') return;
  if (node.leaf === 'unknown') node.leaf = leaf;
  else if (node.leaf !== leaf) node.leaf = 'unknown';
}

/** JSONata functions whose first argument narrows the path it is applied to. */
const ARG_SHAPES: Record<string, { array?: boolean; leaf?: Leaf }> = {
  uppercase: { leaf: 'string' },
  lowercase: { leaf: 'string' },
  trim: { leaf: 'string' },
  length: { leaf: 'string' },
  substring: { leaf: 'string' },
  substringBefore: { leaf: 'string' },
  substringAfter: { leaf: 'string' },
  pad: { leaf: 'string' },
  contains: { leaf: 'string' },
  split: { leaf: 'string' },
  replace: { leaf: 'string' },
  base64encode: { leaf: 'string' },
  base64decode: { leaf: 'string' },
  encodeUrl: { leaf: 'string' },
  decodeUrl: { leaf: 'string' },
  encodeUrlComponent: { leaf: 'string' },
  decodeUrlComponent: { leaf: 'string' },
  toMillis: { leaf: 'string' },
  abs: { leaf: 'number' },
  floor: { leaf: 'number' },
  ceil: { leaf: 'number' },
  round: { leaf: 'number' },
  sqrt: { leaf: 'number' },
  power: { leaf: 'number' },
  formatBase: { leaf: 'number' },
  fromMillis: { leaf: 'number' },
  sum: { array: true, leaf: 'number' },
  max: { array: true, leaf: 'number' },
  min: { array: true, leaf: 'number' },
  average: { array: true, leaf: 'number' },
  join: { array: true, leaf: 'string' },
  count: { array: true },
  reverse: { array: true },
  distinct: { array: true },
  sort: { array: true },
  shuffle: { array: true },
};

interface Scope {
  element?: TNode;
  elementParam?: string;
  /** Enclosing element node, reached by JSONata `%` (`$parent`). */
  parent?: TNode;
  /** Lambda params bound through `$map` aliases → the element node they name. */
  params?: Map<string, TNode>;
}

function literalLeaf(n: JNode): Leaf {
  if (n.kind === 'num') return 'number';
  if (n.kind === 'str') return 'string';
  if (n.kind === 'bool') return 'boolean';
  return 'unknown';
}

class Inferrer {
  root = makeNode();

  /** Resolve a path-shaped expression to its tree node, creating fields as needed. */
  private resolve(node: JNode, scope: Scope): TNode | null {
    switch (node.kind) {
      case 'name': {
        const bound = scope.params?.get(node.value);
        if (bound) return bound;
        if (node.value === scope.elementParam) return scope.element ?? null;
        const base = scope.element ?? this.root;
        if (!base.fields.has(node.value))
          base.fields.set(node.value, makeNode());
        return base.fields.get(node.value)!;
      }
      case 'context':
        return scope.element ?? this.root;
      case 'root':
        return this.root;
      case 'parent':
        // One level up is the enclosing element; deeper `%.%` bottoms out at
        // the input for inference purposes (the emitter validates the depth).
        return node.depth <= 1 ? (scope.parent ?? null) : this.root;
      case 'dot': {
        if (node.right.kind !== 'name') return null;
        const left = this.resolve(node.left, scope);
        if (!left) return null;
        if (!left.fields.has(node.right.value))
          left.fields.set(node.right.value, makeNode());
        return left.fields.get(node.right.value)!;
      }
      case 'predicate': {
        const target = this.resolve(node.target, scope);
        if (!target) return null;
        target.isArray = true;
        this.walk(
          node.expr,
          { element: target, parent: scope.element ?? this.root },
          'boolean',
        );
        return target;
      }
      case 'bind':
        // `arr#$i` / `arr@$v` — the binding decorates the array; resolve through it.
        return this.resolve(node.target, scope);
      case 'sort': {
        const target = this.resolve(node.target, scope);
        if (!target) return null;
        target.isArray = true;
        const inner: Scope = {
          element: target,
          parent: scope.element ?? this.root,
        };
        // Sort keys are comparable but not necessarily a fixed leaf — leave them
        // to be narrowed by any other usage.
        for (const { key } of node.terms) this.walk(key, inner);
        return target;
      }
      default:
        return null;
    }
  }

  /** Bind a block's `$var`s to their value nodes, so uses in the result narrow them. */
  private blockScope(
    node: Extract<JNode, { kind: 'block' }>,
    scope: Scope,
  ): Scope {
    const params = new Map(scope.params);
    for (const { name, value } of node.bindings) {
      const inner: Scope = { ...scope, params };
      const t = this.resolve(value, inner);
      if (t) {
        params.set(name, t);
      } else {
        // The value is not a plain path (e.g. arithmetic): narrow the input
        // paths it uses, and bind the variable to a detached node so later
        // references don't fabricate a spurious root field.
        this.walk(value, inner);
        params.set(name, makeNode());
      }
    }
    return { ...scope, params };
  }

  /**
   * `arr.{ ... }` / `arr.( ...; { ... } )` per-element projection: mark the
   * target as an array of objects and walk the body in element scope. Returns
   * true when it handled the node.
   */
  private walkProjection(node: JNode, scope: Scope): boolean {
    if (node.kind !== 'dot') return false;
    const right = node.right;
    // Body is either `.{ ... }` or `.( ...; { ... } )` (block ending in object).
    const obj =
      right.kind === 'object'
        ? right
        : right.kind === 'block' && right.result.kind === 'object'
          ? right.result
          : null;
    if (!obj || obj.kind !== 'object') return false;
    const target = this.resolve(node.left, scope);
    if (target) {
      target.isArray = true;
      let inner: Scope = {
        element: target,
        parent: scope.element ?? this.root,
      };
      // `arr#$i.( ... )`: bind the index var to a detached node so `$i` uses in
      // the body don't fabricate an element field.
      if (node.left.kind === 'bind' && node.left.op === '#') {
        inner = {
          ...inner,
          params: new Map([
            ...(scope.params ?? []),
            [node.left.variable, makeNode()],
          ]),
        };
      }
      if (right.kind === 'block') inner = this.blockScope(right, inner);
      for (const { value } of obj.pairs) this.walk(value, inner);
    }
    return true;
  }

  walk(node: JNode, scope: Scope, expected: Leaf = 'unknown'): void {
    if (node.kind === 'block') {
      this.walk(node.result, this.blockScope(node, scope), expected);
      return;
    }
    // `arr.{ ... }` per-element constructor nested in a value position: the
    // target is an array of objects and the body sees each element.
    if (this.walkProjection(node, scope)) return;
    switch (node.kind) {
      case 'name':
      case 'context':
      case 'root':
      case 'parent':
      case 'dot':
      case 'predicate':
      case 'sort': {
        const t = this.resolve(node, scope);
        if (t) setLeaf(t, expected);
        return;
      }
      case 'call': {
        const shape = ARG_SHAPES[node.name];
        const [first, ...rest] = node.args;
        if (first) {
          if (shape?.array && first.kind === 'dot') {
            // `$sum(products.price)`: the CONTAINER is the array, the leaf a scalar.
            const container = this.resolve(first.left, scope);
            if (container) container.isArray = true;
            const leafNode = this.resolve(first, scope);
            if (leafNode && shape.leaf) setLeaf(leafNode, shape.leaf);
          } else if (shape) {
            const t = this.resolve(first, scope);
            if (t) {
              if (shape.array) t.isArray = true;
              if (shape.leaf) setLeaf(t, shape.leaf);
            } else {
              this.walk(first, scope);
            }
          } else if (node.name === 'filter' || node.name === 'map') {
            const t = this.resolve(first, scope);
            if (t) {
              t.isArray = true;
              const lambda = rest[0];
              if (lambda?.kind === 'lambda') {
                // `$map` binds its param as an alias, so keep outer aliases in
                // scope for nested maps; `$filter` predicates use `$` only.
                const params = new Map(scope.params);
                if (node.name === 'map' && lambda.params[0]) {
                  params.set(lambda.params[0], t);
                }
                this.walk(lambda.body, {
                  element: t,
                  elementParam: lambda.params[0],
                  parent: scope.element ?? this.root,
                  params,
                });
              }
            }
          } else {
            this.walk(first, scope);
          }
        }
        for (const a of rest) if (a.kind !== 'lambda') this.walk(a, scope);
        return;
      }
      case 'binary': {
        if (['+', '-', '*', '/', '%'].includes(node.op)) {
          this.walk(node.left, scope, 'number');
          this.walk(node.right, scope, 'number');
          return;
        }
        if (node.op === '&') {
          this.walk(node.left, scope, 'string');
          this.walk(node.right, scope, 'string');
          return;
        }
        if (['and', 'or'].includes(node.op)) {
          this.walk(node.left, scope, 'boolean');
          this.walk(node.right, scope, 'boolean');
          return;
        }
        if (node.op === 'in') {
          // `v in list`: the right side is an array; the left is one element.
          const list = this.resolve(node.right, scope);
          if (list) list.isArray = true;
          else this.walk(node.right, scope);
          this.walk(node.left, scope);
          return;
        }
        // comparisons: a literal on one side types the other side
        this.walk(node.left, scope, literalLeaf(node.right));
        this.walk(node.right, scope, literalLeaf(node.left));
        return;
      }
      case 'ternary':
        this.walk(node.cond, scope, 'boolean');
        this.walk(node.then, scope, expected);
        this.walk(node.else, scope, expected);
        return;
      case 'object': {
        // `arr.{ ... }` bodies are handled via 'dot'; a plain object walks values.
        for (const { value } of node.pairs) this.walk(value, scope);
        return;
      }
      case 'array':
        for (const item of node.items) this.walk(item, scope);
        return;
      case 'neg':
        this.walk(node.operand, scope, 'number');
        return;
      case 'lambda':
        this.walk(node.body, scope);
        return;
      default:
        return;
    }
  }

  /** `arr.{ ... }` projections need the target treated as an array of objects. */
  walkTop(node: JNode, scope: Scope): void {
    if (node.kind === 'block') {
      this.walkTop(node.result, this.blockScope(node, scope));
      return;
    }
    if (this.walkProjection(node, scope)) return;
    if (node.kind === 'object') {
      for (const { value } of node.pairs) this.walkTop(value, scope);
      return;
    }
    this.walk(node, scope);
  }
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderNode(node: TNode): string {
  const base =
    node.fields.size > 0
      ? `{ ${[...node.fields.entries()]
          .map(
            ([key, child]) =>
              `${IDENT_RE.test(key) ? key : JSON.stringify(key)}: ${renderNode(child)}`,
          )
          .join(', ')} }`
      : node.leaf;
  return node.isArray ? `${base}[]` : base;
}

/** Infer the inline input type of a parsed JSONata expression. */
export function inferInputType(ast: JNode): string {
  const inferrer = new Inferrer();
  inferrer.walkTop(ast, {});
  if (inferrer.root.fields.size === 0) return 'unknown';
  return renderNode(inferrer.root);
}
