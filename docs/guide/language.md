# The language

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

```
map {
  city: user.address.city,        // validated: typos are compile errors
  email: user.contact?.email,     // optional segments REQUIRE ?.
  safe: user.contact?.email ?? "unknown",  // ?? removes optionality
}
```

- Accessing through an optional/nullable segment without `?.` is error `TF2003`.
- A field whose value may be `undefined` becomes an **optional field** of the output type.
- A `??` default strips `null | undefined` from the inferred type.

## Arrays

```
map {
  names: user.labels.name,        // path access distributes: string[]
  active: user.labels[active],    // [boolean expr] filters (element scope)
  first: user.labels[0],          // [number expr] indexes: element | undefined
  views: user.labels -> {         // -> projects each element
    label: upper(name),           // bare identifiers resolve on the element
    self: $,                      // $ is the current element
  },
}
```

## Expressions

| Category | Syntax |
|---|---|
| Literals | `"text"`, `42`, `true`, `null`, `[1, 2]`, `{ a: 1 }` |
| Arithmetic | `+ - * /` (numbers; `+` also concatenates two strings — no coercion) |
| Comparison | `== != < <= > >=` (comparisons between disjoint types are flagged) |
| Logic | `&& \|\| !` (boolean operands) |
| Conditional | `cond ? a : b` (result is the union of both branches) |
| Coalescing | `a ?? b` |

## Functions

Built-ins with typed signatures: `upper`, `lower`, `trim` (strings), `count`, `sum`, `join` (arrays). Unknown functions and wrong argument types are compile errors.

## Non-goals

No loops, no mutation, no recursion, no I/O, no inline lambdas. Anything beyond declarative reshaping belongs in your host language — mappings stay deterministic, serializable, and sandboxable.

## Diagnostics reference

| Code | Meaning |
|---|---|
| `TF1xxx` | Lexer/parser errors |
| `TF2001` | Unknown identifier (with suggestion) |
| `TF2002` | Unknown property (with suggestion) |
| `TF2003` | Unsafe access through an optional/nullable value |
| `TF2004` | Operator/type mismatch |
| `TF2005` | Filter/index on a non-array |
| `TF2006` | Invalid property access or projection target |
| `TF2007` / `TF2008` | Unknown function / bad arguments |
| `TF2009` | Non-boolean filter predicate |
| `TF2010` | Input type reference could not be resolved |
| `TF2013` | Useless `??` (left side never nullish) — warning |
| `TF2015` | No input declaration — warning |
| `TF2367` | Comparison between types with no overlap — warning |
