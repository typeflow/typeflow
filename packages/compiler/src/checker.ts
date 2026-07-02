import {
  containsNullish,
  containsUndefined,
  makeUnion,
  nonNullishParts,
  stripNullish,
  stripUndefined,
  suggestName,
  T,
  typeToString,
  type Diagnostic,
  type Expr,
  type FilterExpr,
  type IndexExpr,
  type ObjectExpr,
  type ObjectField,
  type Span,
  type Type,
} from "@thomasfarineau/typeflow-core";
import { BUILTINS, isBooleanish, isNumberish, isStringish } from "./builtins.ts";

interface Scope {
  vars: Map<string, Type>;
  /** Element type for filter predicates and `->` projections; fields resolve as bare identifiers. */
  element?: Type;
  parent?: Scope;
}

export class Checker {
  constructor(private diagnostics: Diagnostic[]) {}

  private error(code: string, message: string, span: Span, hint?: string): void {
    this.diagnostics.push({ code, message, span, severity: "error", hint });
  }

  private warn(code: string, message: string, span: Span, hint?: string): void {
    this.diagnostics.push({ code, message, span, severity: "warning", hint });
  }

  checkMapping(map: ObjectExpr, inputName: string, inputType: Type): Type {
    const root: Scope = { vars: new Map([[inputName, inputType]]) };
    return this.checkExpr(map, root);
  }

  private resolveIdent(name: string, scope: Scope): Type | undefined {
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.element) {
        if (name === "$") return s.element;
        if (s.element.kind === "any" || s.element.kind === "unknown") return T.any;
        if (s.element.kind === "object") {
          const field = s.element.fields.find((f) => f.name === name);
          if (field) return field.optional ? makeUnion([field.type, T.undefined]) : field.type;
        }
      }
      const v = s.vars.get(name);
      if (v) return v;
    }
    return undefined;
  }

  private visibleNames(scope: Scope): string[] {
    const names: string[] = [];
    for (let s: Scope | undefined = scope; s; s = s.parent) {
      if (s.element?.kind === "object") names.push(...s.element.fields.map((f) => f.name));
      names.push(...s.vars.keys());
    }
    return names;
  }

  private checkExpr(expr: Expr, scope: Scope): Type {
    switch (expr.kind) {
      case "lit":
        if (expr.value === null) return T.null;
        return T.literal(expr.value);

      case "ident": {
        const t = this.resolveIdent(expr.name, scope);
        if (t === undefined) {
          const suggestion = suggestName(expr.name, this.visibleNames(scope));
          this.error(
            "TF2001",
            `Cannot find name '${expr.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
            expr.span,
          );
          return T.any;
        }
        return t;
      }

      case "member": {
        const objType = this.checkExpr(expr.object, scope);
        return this.checkMemberAccess(objType, expr.name, expr.optional, expr.nameSpan);
      }

      case "bracket": {
        const objType = this.checkExpr(expr.object, scope);
        const arrayInfo = this.expectArray(objType, expr.span, "Filtering or indexing");
        const element = arrayInfo ?? T.any;
        const inner = expr.inner;
        const innerScope: Scope = { vars: new Map(), element, parent: scope };
        const innerType = this.checkExpr(inner, innerScope);

        const mutable = expr as unknown as Record<string, unknown>;
        if (isNumberish(innerType) && innerType.kind !== "any") {
          // Numeric index: rewrite to `index`; the element may be absent.
          mutable.kind = "index";
          mutable.index = inner;
          delete mutable.inner;
          delete mutable.predicate;
          return makeUnion([element, T.undefined]);
        }
        if (!isBooleanish(innerType)) {
          this.error(
            "TF2009",
            `A filter predicate must be of type 'boolean', got '${typeToString(innerType)}'.`,
            inner.span,
          );
        }
        mutable.kind = "filter";
        mutable.predicate = inner;
        delete mutable.inner;
        delete mutable.index;
        return objType.kind === "any" ? T.any : T.array(element);
      }

      // Already-rewritten nodes (re-checked when a body is analyzed against several union parts).
      case "index": {
        const objType = this.checkExpr(expr.object, scope);
        const element = this.expectArray(objType, expr.span, "Indexing") ?? T.any;
        this.checkExpr((expr as IndexExpr).index, { vars: new Map(), element, parent: scope });
        return makeUnion([element, T.undefined]);
      }
      case "filter": {
        const objType = this.checkExpr(expr.object, scope);
        const element = this.expectArray(objType, expr.span, "Filtering") ?? T.any;
        this.checkExpr((expr as FilterExpr).predicate, { vars: new Map(), element, parent: scope });
        return objType.kind === "any" ? T.any : T.array(element);
      }

      case "project": {
        const objType = this.checkExpr(expr.object, scope);
        if (objType.kind === "any") {
          this.checkExpr(expr.body, { vars: new Map(), element: T.any, parent: scope });
          return T.any;
        }
        if (containsNullish(objType)) {
          this.error(
            "TF2003",
            `The target of '->' is possibly ${nullishNames(objType)}.`,
            expr.object.span,
            "Provide a default with '??' before projecting.",
          );
        }
        const results: Type[] = [];
        for (const part of nonNullishParts(objType)) {
          if (part.kind === "object" || part.kind === "any" || part.kind === "unknown") {
            results.push(this.checkExpr(expr.body, { vars: new Map(), element: part, parent: scope }));
          } else if (part.kind === "array") {
            const el = part.element;
            results.push(T.array(this.checkExpr(expr.body, { vars: new Map(), element: el, parent: scope })));
          } else {
            this.error(
              "TF2006",
              `'->' projection requires an object or an array of objects, got '${typeToString(part)}'.`,
              expr.object.span,
            );
            results.push(T.any);
          }
        }
        return makeUnion(results.length ? results : [T.any]);
      }

      case "unary": {
        const t = this.checkExpr(expr.operand, scope);
        if (expr.op === "!") {
          if (!isBooleanish(t)) {
            this.error("TF2004", `Operator '!' cannot be applied to type '${typeToString(t)}'.`, expr.span);
          }
          return T.boolean;
        }
        if (!isNumberish(t)) {
          this.error("TF2004", `Operator '-' cannot be applied to type '${typeToString(t)}'.`, expr.span);
        }
        return T.number;
      }

      case "binary":
        return this.checkBinary(expr, scope);

      case "cond": {
        const condType = this.checkExpr(expr.cond, scope);
        if (!isBooleanish(condType)) {
          this.error(
            "TF2004",
            `A condition must be of type 'boolean', got '${typeToString(condType)}'.`,
            expr.cond.span,
          );
        }
        const thenType = this.checkExpr(expr.then, scope);
        const elseType = this.checkExpr(expr.else, scope);
        return makeUnion([thenType, elseType]);
      }

      case "call": {
        const builtin = BUILTINS[expr.name];
        if (!builtin) {
          const suggestion = suggestName(expr.name, Object.keys(BUILTINS));
          this.error(
            "TF2007",
            `Unknown function '${expr.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
            expr.nameSpan,
            `Available functions: ${Object.keys(BUILTINS).join(", ")}.`,
          );
          expr.args.forEach((a) => this.checkExpr(a, scope));
          return T.any;
        }
        if (expr.args.length !== builtin.params.length) {
          this.error(
            "TF2008",
            `Expected ${builtin.params.length} argument(s), got ${expr.args.length}.`,
            expr.span,
            builtin.signature,
          );
        }
        expr.args.forEach((arg, i) => {
          const argType = this.checkExpr(arg, scope);
          const param = builtin.params[i];
          if (param && argType.kind !== "any" && !param.check(argType)) {
            this.error(
              "TF2008",
              `Argument of type '${typeToString(argType)}' is not assignable to parameter of type '${param.label}'.`,
              arg.span,
              builtin.signature,
            );
          }
        });
        return builtin.result;
      }

      case "object": {
        const fields: ObjectField[] = [];
        const seen = new Set<string>();
        for (const prop of expr.props) {
          if (seen.has(prop.name)) {
            this.error("TF2014", `Duplicate property '${prop.name}'.`, prop.span);
            continue;
          }
          seen.add(prop.name);
          const valueType = this.checkExpr(prop.value, scope);
          // A value that may be undefined becomes an optional output field.
          if (containsUndefined(valueType)) {
            fields.push({ name: prop.name, type: stripUndefined(valueType), optional: true });
          } else {
            fields.push({ name: prop.name, type: valueType, optional: false });
          }
        }
        return T.object(fields);
      }

      case "array": {
        const elementTypes = expr.elements.map((e) => this.checkExpr(e, scope));
        return T.array(elementTypes.length ? makeUnion(elementTypes) : T.unknown);
      }
    }
  }

  private checkMemberAccess(objType: Type, name: string, optional: boolean, nameSpan: Span): Type {
    if (objType.kind === "any") return T.any;
    if (objType.kind === "unknown") {
      this.error("TF2012", `Property '${name}' does not exist on type 'unknown'.`, nameSpan);
      return T.any;
    }

    let addUndefined = false;
    if (containsNullish(objType)) {
      if (!optional) {
        this.error(
          "TF2003",
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
    if (part.kind === "any") return T.any;
    if (part.kind === "object") {
      const field = part.fields.find((f) => f.name === name);
      if (!field) {
        const suggestion = suggestName(name, part.fields.map((f) => f.name));
        this.error(
          "TF2002",
          `Property '${name}' does not exist on type '${typeToString(part)}'.${suggestion ? ` Did you mean '${suggestion}'?` : ""}`,
          nameSpan,
        );
        return T.any;
      }
      return field.optional ? makeUnion([field.type, T.undefined]) : field.type;
    }
    if (part.kind === "array") {
      // Path access distributes over arrays of objects: `items.name` maps to `string[]`.
      const el = part.element;
      if (el.kind === "object" || el.kind === "any" || el.kind === "union") {
        const mapped = this.accessOnPart(el.kind === "union" ? makeUnion(el.types) : el, name, nameSpan);
        return T.array(mapped);
      }
      this.error(
        "TF2006",
        `Cannot access property '${name}' on elements of type '${typeToString(el)}'.`,
        nameSpan,
      );
      return T.any;
    }
    this.error("TF2006", `Cannot access property '${name}' on type '${typeToString(part)}'.`, nameSpan);
    return T.any;
  }

  private expectArray(t: Type, span: Span, operation: string): Type | undefined {
    if (t.kind === "any") return undefined;
    if (containsNullish(t)) {
      this.error(
        "TF2003",
        `Object is possibly ${nullishNames(t)}.`,
        span,
        "Provide a default with '??' before filtering or indexing.",
      );
      t = stripNullish(t);
    }
    const parts = nonNullishParts(t);
    const elements: Type[] = [];
    for (const part of parts) {
      if (part.kind === "array") elements.push(part.element);
      else if (part.kind === "any") return undefined;
      else {
        this.error("TF2005", `${operation} requires an array type, got '${typeToString(part)}'.`, span);
        return undefined;
      }
    }
    return elements.length ? makeUnion(elements) : undefined;
  }

  private checkBinary(expr: Extract<Expr, { kind: "binary" }>, scope: Scope): Type {
    const left = this.checkExpr(expr.left, scope);

    if (expr.op === "??") {
      if (!containsNullish(left) && left.kind !== "any" && left.kind !== "unknown") {
        this.warn(
          "TF2013",
          `The left side of '??' has type '${typeToString(left)}', which is never null or undefined.`,
          expr.left.span,
        );
      }
      const right = this.checkExpr(expr.right, scope);
      return makeUnion([stripNullish(left), right]);
    }

    const right = this.checkExpr(expr.right, scope);
    const bothAny = left.kind === "any" && right.kind === "any";

    switch (expr.op) {
      case "+": {
        if (bothAny) return T.any;
        const leftStr = isStringish(left);
        const rightStr = isStringish(right);
        const leftNum = isNumberish(left);
        const rightNum = isNumberish(right);
        if ((leftStr && rightStr) || (left.kind === "any" && rightStr) || (leftStr && right.kind === "any")) {
          return T.string;
        }
        if ((leftNum && rightNum) || (left.kind === "any" && rightNum) || (leftNum && right.kind === "any")) {
          return T.number;
        }
        this.error(
          "TF2004",
          `Operator '+' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
          expr.span,
          "Typeflow does not coerce types: '+' expects two strings or two numbers.",
        );
        return T.any;
      }
      case "-":
      case "*":
      case "/": {
        if (!isNumberish(left) || !isNumberish(right)) {
          this.error(
            "TF2004",
            `Operator '${expr.op}' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
            expr.span,
          );
        }
        return T.number;
      }
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const bothNumbers = isNumberish(left) && isNumberish(right);
        const bothStrings = isStringish(left) && isStringish(right);
        if (!bothNumbers && !bothStrings) {
          this.error(
            "TF2004",
            `Operator '${expr.op}' cannot be applied to types '${typeToString(left)}' and '${typeToString(right)}'.`,
            expr.span,
          );
        }
        return T.boolean;
      }
      case "==":
      case "!=": {
        if (!typesOverlap(left, right)) {
          this.warn(
            "TF2367",
            `This comparison appears to be unintentional because the types '${typeToString(left)}' and '${typeToString(right)}' have no overlap.`,
            expr.span,
          );
        }
        return T.boolean;
      }
      case "&&":
      case "||": {
        if (!isBooleanish(left) || !isBooleanish(right)) {
          this.error(
            "TF2004",
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
  const parts = t.kind === "union" ? t.types : [t];
  const hasUndefined = parts.some((p) => p.kind === "undefined");
  const hasNull = parts.some((p) => p.kind === "null");
  if (hasUndefined && hasNull) return "'null' or 'undefined'";
  return hasNull ? "'null'" : "'undefined'";
}

function baseCategories(t: Type): Set<string> {
  const out = new Set<string>();
  const parts = t.kind === "union" ? t.types : [t];
  for (const p of parts) {
    if (p.kind === "literal") out.add(typeof p.value);
    else if (p.kind === "any" || p.kind === "unknown") out.add("*");
    else out.add(p.kind);
  }
  return out;
}

function typesOverlap(a: Type, b: Type): boolean {
  const ca = baseCategories(a);
  const cb = baseCategories(b);
  if (ca.has("*") || cb.has("*")) return true;
  for (const c of ca) if (cb.has(c)) return true;
  return false;
}
