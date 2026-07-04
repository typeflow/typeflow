# Le langage

[[toc]]

Un fichier `.typeflow` a deux parties : une **liaison d'entrée** (`input`) et un **bloc `map`** dont la structure reflète la sortie. Les feuilles sont des expressions sur l'entrée.

## Liaisons d'entrée

Depuis un type TypeScript (résolu via l'API du compilateur TS) :

```
input user: ApiUser from "./user-types"
```

Ou déclarée inline (syntaxe structurelle — c'est ce qu'utilise le [Playground](/fr/playground)) :

```
input user: {
  id: number,
  role: "admin" | "member",
  contact?: { email?: string },
  labels: { name: string, active: boolean }[],
}
```

Sans déclaration `input`, l'entrée est typée `any` et les chemins ne peuvent pas être validés (le compilateur avertit).

## Chemins et optionnalité

| Syntaxe | Effet                                                                                     |
| ------- | ----------------------------------------------------------------------------------------- |
| `.`     | lit une valeur ; chaque segment est validé, les coquilles sont des erreurs de compilation |
| `?.`    | requis pour traverser un segment optionnel/nullable (sinon `TF2003`)                      |
| `??`    | repli pour `null`/`undefined` ; retire l'optionnalité du type inféré                      |

```
map {
  city: user.address.city,
  email: user.contact?.email,
  safe: user.contact?.email ?? "unknown",
}
```

Un champ dont la valeur peut être `undefined` devient un **champ optionnel** du type de sortie. Voir [Chemins & optionnalité](/fr/operators/paths) pour la référence complète.

## Tableaux

| Syntaxe             | Effet                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `.`                 | l'accès de propriété sur un tableau d'objets se distribue : `labels.name` → `string[]`      |
| `[bool]`            | filtre les éléments (portée élément : les identifiants nus se résolvent sur l'élément)      |
| `[number]`          | indexe : produit `element \| undefined`                                                     |
| `^(key)`            | trie par une ou plusieurs clés (portée élément) ; `^(>key)` descendant, `^(<key)` ascendant |
| `->`                | projette chaque élément vers une nouvelle forme ; `$` est l'élément courant                 |
| `-> alias`          | nomme l'élément pour que ses champs ne masquent pas les noms externes                       |
| `-> alias, i`       | lie aussi l'index base 0 de l'élément à `i` (un `number`)                                   |
| `$root` / `$parent` | atteint l'entrée, ou l'élément de la projection englobante, depuis un corps                 |

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

Les identifiants nus se résolvent sur l'élément courant : un champ d'élément masque donc une variable externe du même nom. Utilisez `-> alias { ... }` pour garder le parent accessible, et `$root` / `$parent` pour atteindre l'extérieur explicitement. Voir [Tableaux](/fr/operators/arrays) et [Projection](/fr/operators/projection) pour la référence complète.

## Opérateurs

Chaque catégorie a sa page dédiée avec des exemples vivants et modifiables — voir la section [Opérateurs](/fr/operators/literals).

| Catégorie    | Syntaxe                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| Littéraux    | `"text"`, `42`, `true`, `null`, `[1, 2]`, `{ a: 1 }`                         |
| Arithmétique | `+ - * / %` (nombres ; `+` concatène aussi deux chaînes — pas de coercition) |
| Comparaison  | `== != < <= > >=` (les comparaisons entre types disjoints sont signalées)    |
| Logique      | `&& \|\| !` (opérandes booléens)                                             |
| Conditionnel | `cond ? a : b` (le résultat est l'union des deux branches)                   |
| Coalescence  | `a ?? b`                                                                     |

## Liaisons

`let name = expr` nomme une sous-expression au sein d'un bloc pour la réutiliser. Les liaisons sont immuables et n'apparaissent pas dans la sortie — elles n'existent que pour éviter la répétition et clarifier l'intention (la réponse de Typeflow au `$x := ...` de JSONata) :

```
map {
  let base = order.subtotal,
  let tax = base * 0.2,
  subtotal: base,
  tax: tax,
  total: base + tax,
}
```

Une liaison a pour portée son bloc et chaque bloc imbriqué dedans, un corps de projection peut donc ajouter les siennes :

```
map {
  lines: order.items -> {
    let net = price * qty,
    net: net,
    withTax: net * 1.2,
  },
}
```

Toutes les propriétés d'un bloc peuvent utiliser ses liaisons, mais une liaison ne peut référencer que les liaisons déclarées avant elle — les références en avant et les autoréférences sont rejetées (`TF2001`), les mappings restent donc terminants. Deux liaisons du même nom dans un bloc sont une erreur (`TF2018`).

## Fonctions

Une bibliothèque standard de niveau JSONata aux signatures typées — chaînes, nombres, agrégation, booléens, tableaux, objets, date & heure. Les fonctions inconnues et les mauvais types d'arguments sont des erreurs de compilation. Voir [Fonctions](/fr/functions/) pour la référence complète avec exemples vivants.

## Définir des fonctions

`fn` définit une fonction pure dans le langage de mapping lui-même — le corps est une expression Typeflow sur les paramètres (la liaison d'entrée n'est pas dans la portée). Le type de retour est optionnel (inféré depuis le corps, vérifié quand il est déclaré) :

```
fn fullName(first: string, last: string): string = first + " " + last
fn grade(score: number) = score >= 10 ? "pass" : "fail"

map {
  name: fullName(user.first, user.last),
}
```

Les fonctions peuvent appeler les natives et les fonctions déclarées avant elles ; les références en avant sont rejetées, il n'y a donc pas de récursion et les mappings restent terminants. Les définitions `fn` font partie de l'artefact compilé — elles fonctionnent partout où le runtime tourne, y compris le [playground](/fr/playground).

## Fonctions TypeScript personnalisées

`use` déclare une fonction externe avec une signature typée ; les appels sont vérifiés à la compilation et l'implémentation est importée depuis le module au chargement :

```
use slugify(value: string): string from "./helpers"

map {
  slug: slugify(user.firstName + " " + user.lastName),
}
```

`loadTypeflowMapping` et `typeflow run` importent le module automatiquement. Avec l'API bas niveau, passez les implémentations explicitement : `createMapping(compiled, { functions: { slugify } })` — l'instanciation échoue immédiatement s'il en manque une.

Les fonctions peuvent aussi être enregistrées côté application avec `defineFunction('slugify(value: string): string', { impl })` et passées à `compile`/`createMapping`/`loadTypeflowMapping` via `{ functions: [slugify] }` — même vérification à la compilation, sans ligne `use`. Voir [Fonctions personnalisées](/fr/functions/custom).

## Non-objectifs

Pas de boucles, pas de mutation, pas de récursion, pas d'E/S, pas de lambdas inline. Tout ce qui dépasse le remodelage déclaratif appartient à votre langage hôte — c'est à ça que sert [`use`](#fonctions-typescript-personnalisees). Les mappings restent déterministes, sérialisables et sandboxables (la surface externe d'un mapping est exactement l'ensemble de ses déclarations `use`).

## Diagnostics

Chaque diagnostic a un code `TFxxxx` stable, un message, et souvent un indice.
La **[référence des diagnostics](/fr/reference/diagnostics)** les documente tous,
chacun avec une reproduction vivante et modifiable — et le build de la doc vérifie
que chaque exemple déclenche toujours son code.
