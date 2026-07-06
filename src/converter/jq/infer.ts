/**
 * Lightweight jq input inference. It records root-relative field paths and
 * narrows obvious arithmetic/comparison/function usages.
 */
import { type QNode } from './parser';

type Leaf = 'string' | 'number' | 'boolean' | 'unknown';

interface TNode {
  leaf: Leaf;
  isArray: boolean;
  fields: Map<string, TNode>;
}

interface Scope {
  current: TNode;
  root: TNode;
}

function makeNode(): TNode {
  return { leaf: 'unknown', isArray: false, fields: new Map() };
}

function setLeaf(node: TNode, leaf: Leaf): void {
  if (leaf === 'unknown') return;
  if (node.leaf === 'unknown') node.leaf = leaf;
  else if (node.leaf !== leaf) node.leaf = 'unknown';
}

function literalLeaf(node: QNode): Leaf {
  if (node.kind === 'num') return 'number';
  if (node.kind === 'str') return 'string';
  if (node.kind === 'bool') return 'boolean';
  return 'unknown';
}

class Inferrer {
  root = makeNode();

  private resolve(node: QNode, scope: Scope): TNode | null {
    switch (node.kind) {
      case 'input':
        return scope.current;
      case 'field': {
        const base = this.resolve(node.target, scope);
        if (!base) return null;
        if (!base.fields.has(node.name)) base.fields.set(node.name, makeNode());
        return base.fields.get(node.name)!;
      }
      case 'index':
        return this.resolve(node.target, scope);
      case 'iterate': {
        const target = this.resolve(node.target, scope);
        if (target) target.isArray = true;
        return target;
      }
      case 'pipe': {
        const left = this.resolve(node.left, scope);
        if (!left) {
          this.walk(node.left, scope);
          return null;
        }
        return this.resolve(node.right, { ...scope, current: left });
      }
      default:
        return null;
    }
  }

  walk(node: QNode, scope: Scope, expected: Leaf = 'unknown'): void {
    switch (node.kind) {
      case 'input':
      case 'field':
      case 'index':
      case 'iterate': {
        const target = this.resolve(node, scope);
        if (target) setLeaf(target, expected);
        return;
      }
      case 'pipe': {
        const left = this.resolve(node.left, scope);
        if (left) {
          this.walk(node.right, { ...scope, current: left }, expected);
        } else {
          this.walk(node.left, scope);
          this.walk(node.right, scope, expected);
        }
        return;
      }
      case 'call': {
        if (node.name === 'select' && node.args[0]) {
          scope.current.isArray = true;
          this.walk(node.args[0], { ...scope, current: scope.current }, 'boolean');
          return;
        }
        if (node.name === 'map' && node.args[0]) {
          scope.current.isArray = true;
          this.walk(node.args[0], { ...scope, current: scope.current });
          return;
        }
        if (node.name === 'sort_by' && node.args[0]) {
          scope.current.isArray = true;
          this.walk(node.args[0], { ...scope, current: scope.current });
          return;
        }
        if (['length', 'join', 'split', 'contains'].includes(node.name)) {
          if (node.name === 'length') scope.current.isArray = true;
          else setLeaf(scope.current, 'string');
        }
        if (['tonumber', 'floor', 'ceil', 'round', 'sqrt', 'add'].includes(node.name)) {
          setLeaf(scope.current, 'number');
        }
        for (const arg of node.args) this.walk(arg, scope);
        return;
      }
      case 'binary': {
        if (node.op === '//') {
          this.walk(node.left, scope, expected);
          this.walk(node.right, scope, expected);
          return;
        }
        if (['+', '-', '*', '/', '%'].includes(node.op)) {
          this.walk(node.left, scope, 'number');
          this.walk(node.right, scope, 'number');
          return;
        }
        if (['and', 'or'].includes(node.op)) {
          this.walk(node.left, scope, 'boolean');
          this.walk(node.right, scope, 'boolean');
          return;
        }
        this.walk(node.left, scope, literalLeaf(node.right));
        this.walk(node.right, scope, literalLeaf(node.left));
        return;
      }
      case 'unary':
        this.walk(node.expr, scope, node.op === 'not' ? 'boolean' : 'number');
        return;
      case 'object':
        for (const { value } of node.pairs) this.walk(value, scope);
        return;
      case 'array':
        for (const item of node.items) this.walk(item, scope);
        return;
      default:
        return;
    }
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

export function inferInputType(ast: QNode): string {
  const inferrer = new Inferrer();
  inferrer.walk(ast, { root: inferrer.root, current: inferrer.root });
  if (inferrer.root.fields.size === 0) return 'unknown';
  return renderNode(inferrer.root);
}
