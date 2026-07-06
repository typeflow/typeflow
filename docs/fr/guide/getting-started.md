# Bien démarrer

[[toc]]

Typeflow permet d'écrire des transformations JSON dans des fichiers `.typeflow` que TypeScript comprend réellement — les chemins d'entrée sont validés, les types de sortie sont inférés, et les erreurs cassent votre build plutôt que votre trafic en production.

## Installation

Un seul paquet, aucune configuration — fonctionne avec Node (≥ 18), npm, pnpm ou Bun :

```console
$ npm i @thomasfarineau/typeflow
```

::: warning Pré-version
Typeflow est pré-1.0 : la syntaxe et les API sont volontairement instables, et le paquet n'est pas encore publié sur npm. Clonez le dépôt pour l'essayer dès aujourd'hui.
:::

## Votre premier mapping

Générez un exemple :

```console
$ npx typeflow init
Created user-types.ts, user.typeflow.
```

`user.typeflow` lie son entrée à un type TypeScript exporté et reflète la forme de la sortie :

```
input user: User from "./user-types"

map {
  id: user.id,
  fullName: user.firstName + " " + user.lastName,
  email: user.contact?.email ?? "unknown",
  activeTags: user.labels[active].name,
}
```

Vérifiez-le, inspectez la sortie inférée, exécutez-le :

```console
$ npx typeflow check user.typeflow
✔ 1 mapping(s) checked, 0 errors.

$ npx typeflow infer user.typeflow
{ id: number; fullName: string; email: string; activeTags: string[] }

$ echo '{"id":1,"firstName":"Ada","lastName":"Lovelace","labels":[]}' | npx typeflow run user.typeflow
```

## Utiliser depuis le code {#depuis-le-code}

`loadTypeflowMapping` compile le fichier, résout ses types TypeScript, importe les éventuelles
[fonctions `use`](/fr/functions/custom#use), et retourne une fonction de mapping prête à l'emploi :

```ts
import { loadTypeflowMapping } from '@thomasfarineau/typeflow';

const mapUser = await loadTypeflowMapping('./user.typeflow');
const view = mapUser(apiResponse);
```

Pour les chemins chauds, compilez une fois et sérialisez : l'artefact compilé est du JSON pur, et
`@thomasfarineau/typeflow/runtime` est un minuscule interpréteur sans dépendance que vous pouvez embarquer seul
(il tourne même dans le navigateur — le [playground](/fr/playground) n'est rien d'autre que ça).

```ts
import { compile } from '@thomasfarineau/typeflow';
import { createMapping } from '@thomasfarineau/typeflow/runtime';

const { compiled } = compile(source, { fileName: 'user.typeflow' });
const mapUser = createMapping(compiled!);
```

## Imports typés {#imports-types}

Générez les déclarations et activez `allowArbitraryExtensions` :

```console
$ npx typeflow types
generated user.d.typeflow.ts
```

```jsonc
// tsconfig.json
{ "compilerOptions": { "allowArbitraryExtensions": true } }
```

TypeScript comprend désormais `import mapUser from "./user.typeflow"` — avec les types d'entrée/sortie complets.

## CI

```console
$ typeflow check && typeflow types --check
```

`types --check` échoue si les déclarations commitées ont dérivé des mappings.
