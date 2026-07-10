---
layout: home

hero:
  name: Typeflow
  text: Transformations JSON typées
  tagline: Un langage de mapping déclaratif pour JSON — chemins validés, types de sortie inférés, et des erreurs de compilation plutôt que des incidents en production.
  image:
    src: /logo.svg
    alt: Typeflow
  actions:
    - theme: brand
      text: Essayer le Playground
      link: /fr/playground
    - theme: alt
      text: Bien démarrer
      link: /fr/guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/thomasfarineau/typeflow

features:
  - icon: 🧭
    title: Les chemins sont validés
    details: Chaque chemin d'un mapping est vérifié contre le type d'entrée. Une coquille comme user.emial est une erreur de compilation avec une suggestion « Did you mean 'email'? ».
    link: /fr/operators/paths
    linkText: Chemins & optionnalité
  - icon: 🧠
    title: Les types de sortie sont inférés
    details: Le compilateur dérive un type de sortie précis depuis le mapping — optionnalité comprise — et émet des déclarations .d.typeflow.ts pour des imports entièrement typés.
    link: /fr/guide/getting-started#imports-types
    linkText: Imports typés
  - icon: 🛡️
    title: L'optionnalité est imposée
    details: Accéder à un chemin optionnel sans ?. est une erreur. Ajouter un défaut ?? retire l'optionnalité du type de sortie inféré.
    link: /fr/reference/diagnostics#tf2003
    linkText: Voir le diagnostic
  - icon: 📦
    title: Les mappings sont des artefacts
    details: Les mappings compilés sont sérialisables en JSON et tournent sur un petit interpréteur déterministe sans dépendance — Node, Bun, navigateurs, CI.
    link: /fr/guide/getting-started#depuis-le-code
    linkText: Utiliser depuis le code
  - icon: 🧩
    title: Apportez vos fonctions
    details: Une bibliothèque standard de niveau JSONata, plus les définitions fn, les déclarations use et defineFunction — toutes vérifiées à la compilation comme les natives.
    link: /fr/functions/custom
    linkText: Fonctions personnalisées
  - icon: 🔁
    title: Vous venez de JSONata ?
    details: Le convertisseur réécrit chemins, prédicats, lambdas et la stdlib $ en Typeflow typé — et dit exactement ce qu'il n'a pas pu convertir.
    link: /fr/migration/jsonata
    linkText: Migrer un mapping
  - icon: 🧰
    title: Vous venez de jq ?
    details: Convertissez des filtres jq déclaratifs — chemins, select, map, sort_by et fonctions courantes — en mappings Typeflow typés.
    link: /fr/migration/jq
    linkText: Migrer un filtre jq
---

<div class="home-section">

## Essayez — cette page exécute le vrai compilateur

<p class="h2-sub">Tout ce qui suit est vivant : modifiez le mapping ou l'entrée et regardez la sortie, le type inféré et les diagnostics se mettre à jour à chaque frappe. Pas de serveur — le compilateur et le runtime tournent dans votre navigateur.</p>

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

## Les coquilles sont des erreurs de compilation, pas des incidents en production

<p class="h2-sub">Ce mapping contient deux bugs classiques : une propriété mal orthographiée et un accès optionnel non protégé. Dans une fonction ordinaire, ils partiraient en production comme des <code>undefined</code> silencieux — ici ils ne quittent jamais votre éditeur. Corrigez-les en direct : <code>emial</code> → <code>email</code>, et ajoutez <code>?.</code> + <code>??</code> sur la seconde ligne.</p>

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

Chaque diagnostic a un code stable, un indice, et une reproduction vivante dans la [référence des diagnostics](/fr/reference/diagnostics).

## Tout le langage est documenté depuis la source

<p class="h2-sub">Les pages d'opérateurs, la référence des fonctions et celle des diagnostics sont générées depuis les définitions mêmes que le compilateur exécute — signatures, docs et exemples ne peuvent pas dériver de l'implémentation. Le build échoue si un exemple cesse de compiler.</p>

<HomeStats />

## Pourquoi pas JSONata, jq, ou une simple fonction ?

|                                       | Typeflow | JSONata | jq  | Zod             | Fonction TS |
| ------------------------------------- | -------- | ------- | --- | --------------- | ----------- |
| Transformation déclarative            | ✅       | ✅      | ✅  | ❌ (validation) | ❌          |
| Chemins d'entrée validés statiquement | ✅       | ❌      | ❌  | n/a             | ✅          |
| Type de sortie inféré                 | ✅       | ❌      | ❌  | ⚠️ déclaré      | ✅          |
| Artefact sérialisable / sandboxable   | ✅       | ✅      | ✅  | ❌              | ❌          |
| Déterministe par construction         | ✅       | ⚠️      | ✅  | n/a             | ❌          |

Zod est une _entrée_ naturelle de Typeflow, pas un concurrent : Zod répond « est-ce un X ? » ; Typeflow répond « comment X devient-il Y, et cette conversion est-elle sûre ? »

## Démarrez en une minute

```console
$ bun add -d typeflow-js
$ bunx typeflow init                 # génère un mapping d'exemple
$ bunx typeflow check                # diagnostics façon tsc
$ bunx typeflow run user.typeflow --input data.json
```

<div class="home-cta">
  <a class="primary" href="/typeflow/fr/guide/getting-started">Lire le guide</a>
  <a class="alt" href="/typeflow/fr/playground">Ouvrir le playground</a>
  <a class="alt" href="/typeflow/fr/functions/">Parcourir les fonctions</a>
</div>

</div>
