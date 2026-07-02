---
layout: home

hero:
  name: Typeflow
  text: Typed JSON transformations
  tagline: A declarative mapping language for JSON — validated paths, inferred output types, and compile-time errors instead of production incidents.
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
  - icon: 🧠
    title: Output types are inferred
    details: The compiler derives a precise output type from the mapping — optionality included — and emits .d.typeflow.ts declarations so imports are fully typed.
  - icon: 🛡️
    title: Optionality is enforced
    details: Accessing an optional path without ?. is an error. Adding a ?? default removes the optionality from the inferred output type.
  - icon: 📦
    title: Mappings are artifacts
    details: Compiled mappings are JSON-serializable and run on a small, deterministic, dependency-free interpreter — Node, Bun, browsers, CI.
---
