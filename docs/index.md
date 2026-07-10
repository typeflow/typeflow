---
layout: home

hero:
  name: Typeflow
  text: Typed JSON transformations
  tagline: A declarative mapping language for JSON — validated paths, inferred output types, and compile-time errors instead of production incidents.
  image:
    src: /logo.svg
    alt: Typeflow
  actions:
    - theme: brand
      text: Try the Playground
      link: /playground
    - theme: alt
      text: Getting started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/thomasfarineau/typeflow

features:
  - icon: 🧭
    title: Paths are validated
    details: Every path in a mapping is checked against the input type. A typo like user.emial is a compile error with a "Did you mean 'email'?" suggestion.
    link: /operators/paths
    linkText: Paths & optionality
  - icon: 🧠
    title: Output types are inferred
    details: The compiler derives a precise output type from the mapping — optionality included — and emits .d.typeflow.ts declarations so imports are fully typed.
    link: /guide/getting-started#typed-imports
    linkText: Typed imports
  - icon: 🛡️
    title: Optionality is enforced
    details: Accessing an optional path without ?. is an error. Adding a ?? default removes the optionality from the inferred output type.
    link: /reference/diagnostics#tf2003
    linkText: See the diagnostic
  - icon: 📦
    title: Mappings are artifacts
    details: Compiled mappings are JSON-serializable and run on a small, deterministic, dependency-free interpreter — Node, Bun, browsers, CI.
    link: /guide/getting-started#use-it-from-code
    linkText: Use it from code
  - icon: 🧩
    title: Bring your own functions
    details: A JSONata-level standard library, plus fn definitions, use declarations, and defineFunction — all checked at compile time like builtins.
    link: /functions/custom
    linkText: Custom functions
  - icon: 🔁
    title: Coming from JSONata?
    details: The converter rewrites paths, predicates, lambdas and the $-stdlib to typed Typeflow — and tells you exactly what it couldn't convert.
    link: /migration/jsonata
    linkText: Migrate a mapping
  - icon: 🧰
    title: Coming from jq?
    details: Convert declarative jq filters — paths, select, map, sort_by and common functions — into typed Typeflow mappings.
    link: /migration/jq
    linkText: Migrate a jq filter
---

<div class="home-section">

## Try it — this page runs the real compiler

<p class="h2-sub">Everything below is live: edit the mapping or the input and watch the output, the inferred type, and the diagnostics update on every keystroke. No server — the compiler and the runtime are running in your browser.</p>

::: playground

```typeflow
input user: {
  id: number,
  firstName: string,
  lastName: string,
  role: "admin" | "member" | "guest",
  contact?: { email?: string },
  labels: { name: string, active: boolean }[],
  scores: number[],
}

fn grade(score: number) = score >= 15 ? "A" : score >= 10 ? "B" : "C"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  isAdmin: user.role == "admin",
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
  results: user.scores -> { value: $, grade: grade($) },
}
```

```json
{
  "id": 42,
  "firstName": "Ada",
  "lastName": "Lovelace",
  "role": "admin",
  "contact": {},
  "labels": [
    { "name": "founder", "active": true },
    { "name": "legacy", "active": false }
  ],
  "scores": [16, 9, 12]
}
```

:::

## Typos are compile errors, not production incidents

<p class="h2-sub">This mapping has two classic bugs: a misspelled property and an unguarded optional access. In a plain function they'd ship as silent <code>undefined</code>s — here they never leave your editor. Fix them live: <code>emial</code> → <code>email</code>, and add <code>?.</code> + <code>??</code> on the second line.</p>

::: playground

```typeflow
input user: {
  email: string,
  contact?: { phone: string },
}

map {
  mail: user.emial,
  phone: user.contact.phone,
}
```

```json
{ "email": "ada@lovelace.dev", "contact": { "phone": "+44" } }
```

:::

Every diagnostic has a stable code, a hint, and a live reproduction in the [diagnostics reference](/reference/diagnostics).

## The whole language is documented from source

<p class="h2-sub">Operator pages, the function reference, and the diagnostics reference are generated from the same definitions the compiler executes — signatures, docs and examples can't drift from the implementation. The build fails if an example stops compiling.</p>

<HomeStats />

## Why not JSONata, jq, or a plain function?

|                                     | Typeflow | JSONata | jq  | Zod             | Plain TS function |
| ----------------------------------- | -------- | ------- | --- | --------------- | ----------------- |
| Declarative transformation          | ✅       | ✅      | ✅  | ❌ (validation) | ❌                |
| Input paths statically validated    | ✅       | ❌      | ❌  | n/a             | ✅                |
| Output type inferred                | ✅       | ❌      | ❌  | ⚠️ declared     | ✅                |
| Serializable / sandboxable artifact | ✅       | ✅      | ✅  | ❌              | ❌                |
| Deterministic by design             | ✅       | ⚠️      | ✅  | n/a             | ❌                |

Zod is a natural _input_ to Typeflow, not a competitor: Zod answers "is this X?"; Typeflow answers "how does X become Y, and is that conversion sound?"

## Get started in a minute

```console
$ bun add -d typeflow-js
$ bunx typeflow init                 # scaffold an example mapping
$ bunx typeflow check                # tsc-style diagnostics
$ bunx typeflow run user.typeflow --input data.json
```

<div class="home-cta">
  <a class="primary" href="/typeflow/guide/getting-started">Read the guide</a>
  <a class="alt" href="/typeflow/playground">Open the playground</a>
  <a class="alt" href="/typeflow/functions/">Browse all functions</a>
</div>

</div>
