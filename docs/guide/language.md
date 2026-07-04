# The language

[[toc]]

A `.typeflow` file has two parts: an **input binding** and a **map block** whose structure mirrors the output. Leaves are expressions over the input.

## Input bindings

From a TypeScript type (resolved through the TS compiler API):

```
input user: ApiUser from "./user-types"
```

Or declared inline (structural syntax — this is what the [Playground](/playground) uses):

```
input user: {
  id: number,
  role: "admin" | "member",
  contact?: { email?: string },
  labels: { name: string, active: boolean }[],
}
```

Without an `input` declaration, the input is typed `any` and paths cannot be validated (the compiler warns).

## Paths and optionality

| Syntax | Effect                                                                     |
| ------ | -------------------------------------------------------------------------- |
| `.`    | read a value; every segment is validated, typos are compile errors         |
| `?.`   | required to access through an optional/nullable segment (else `TF2003`)    |
| `??`   | fallback for `null`/`undefined`; strips optionality from the inferred type |

```
map {
  city: user.address.city,
  email: user.contact?.email,
  safe: user.contact?.email ?? "unknown",
}
```

A field whose value may be `undefined` becomes an **optional field** of the output type. See [Paths & optionality](/operators/paths) for the full reference.

## Arrays

| Syntax              | Effect                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `.`                 | property access on an array of objects distributes: `labels.name` → `string[]`                   |
| `[bool]`            | filters elements (element scope: bare identifiers resolve on the element)                        |
| `[number]`          | indexes: yields `element \| undefined`                                                           |
| `^(key)`            | orders by one or more keys (element scope); `^(>key)` descending, `^(<key)` ascending            |
| `->`                | projects each element to a new shape; `$` is the current element                                 |
| `-> alias`          | names the element so its fields don't shadow outer names                                         |
| `-> alias, i`       | also binds the element's 0-based index to `i` (a number)                                         |
| `$root` / `$parent` | reach the input, or the enclosing element, from inside a body (`$parent.$parent` climbs further) |

```
map {
  names: user.labels.name,
  active: user.labels[active],
  first: user.labels[0],
  ranked: user.orders ^(>total, name),
  views: user.labels -> l {
    label: upper(l.name),
    self: $,
    org: $root.org,
  },
}
```

Bare identifiers resolve on the current element, so an element field shadows an outer variable of the same name. Use `-> alias { ... }` to keep the parent reachable, and `$root` / `$parent` to reach outward explicitly. See [Arrays](/operators/arrays) and [Projection](/operators/projection) for the full reference.

## Operators

Each category has a dedicated page with live, editable examples — see the [Operators](/operators/literals) section.

| Category    | Syntax                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Literals    | `"text"`, `42`, `true`, `null`, `[1, 2]`, `{ a: 1 }`                   |
| Arithmetic  | `+ - * / %` (numbers; `+` also concatenates two strings — no coercion) |
| Comparison  | `== != < <= > >=` (comparisons between disjoint types are flagged)     |
| Logic       | `&& \|\| !` (boolean operands)                                         |
| Conditional | `cond ? a : b` (result is the union of both branches)                  |
| Coalescing  | `a ?? b`                                                               |

## Bindings

`let name = expr` names a subexpression inside a block so it can be reused. Bindings are immutable and don't appear in the output — they exist only to avoid repetition and clarify intent (Typeflow's answer to JSONata's `$x := ...`):

```
map {
  let base = order.subtotal,
  let tax = base * 0.2,
  subtotal: base,
  tax: tax,
  total: base + tax,
}
```

A binding is scoped to its block and every nested block within it, so a projection body can add its own:

```
map {
  lines: order.items -> {
    let net = price * qty,
    net: net,
    withTax: net * 1.2,
  },
}
```

All of a block's properties can use its bindings, but a binding may only reference bindings declared before it — forward and self references are rejected (`TF2001`), so mappings stay terminating. Duplicate names in one block are an error (`TF2018`).

## Functions

A JSONata-level standard library with typed signatures — strings, numbers, aggregation, booleans, arrays, objects, date & time. Unknown functions and wrong argument types are compile errors. See [Functions](/functions/strings) for the full reference with live examples.

## Defining functions

`fn` defines a pure function in the mapping language itself — the body is a Typeflow expression over the parameters (the input binding is not in scope). The return type is optional (inferred from the body, checked when declared):

```
fn fullName(first: string, last: string): string = first + " " + last
fn grade(score: number) = score >= 10 ? "pass" : "fail"

map {
  name: fullName(user.first, user.last),
}
```

Functions can call builtins and functions declared above them; forward references are rejected, so there is no recursion and mappings stay terminating. `fn` definitions are part of the compiled artifact — they work anywhere the runtime runs, including the [playground](/playground).

## Custom TypeScript functions

`use` declares an external function with a typed signature; calls are checked at compile time and the implementation is imported from the module at load time:

```
use slugify(value: string): string from "./helpers"

map {
  slug: slugify(user.firstName + " " + user.lastName),
}
```

`loadTypeflowMapping` and `typeflow run` import the module automatically. With the low-level API, pass implementations explicitly: `createMapping(compiled, { functions: { slugify } })` — instantiation fails fast if one is missing.

Functions can also be registered application-side with `defineFunction('slugify(value: string): string', { impl })` and passed to `compile`/`createMapping`/`loadTypeflowMapping` via `{ functions: [slugify] }` — same compile-time checking, no `use` line needed. See [Custom functions](/functions/custom).

## Non-goals

No loops, no mutation, no recursion, no I/O, no inline lambdas. Anything beyond declarative reshaping belongs in your host language — that's what [`use`](#custom-typescript-functions) is for. Mappings stay deterministic, serializable, and sandboxable (a mapping's external surface is exactly its `use` declarations).

## Diagnostics

Every diagnostic has a stable `TFxxxx` code, a message, and usually a hint.
The **[diagnostics reference](/reference/diagnostics)** documents all of them,
each with a live, editable reproduction — and the docs build verifies that
every example still triggers its code.
