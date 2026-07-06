# Plugin TypeScript pour `.typeflow` — analyse

_Rapport du 2026-07-05. Périmètre B implémenté le même jour — voir
« Implémentation » tout en bas._

## Objectif

`import userTypeflow from "./user.typeflow"` avec inférence complète dans
l'IDE (hover, autocomplete sur la sortie, erreurs sur les mauvais champs) —
« naturellement », sans étape manuelle à retenir.

## Ce qui existe déjà (et qui marche)

Le mécanisme n'est pas à inventer, il est déjà dans le repo :

- `tsconfig.json` a `allowArbitraryExtensions: true`.
- `emitDts()` (`src/compiler/emit.ts`) génère un `.d.typeflow.ts` sidecar à
  côté du `.typeflow` :
  ```ts
  type TypeflowInput = { id: number; firstName: string; ... };
  type TypeflowOutput = { id: number; fullName: string; ... };
  declare const mapping: (input: TypeflowInput) => TypeflowOutput;
  export default mapping;
  ```
  Grâce à `allowArbitraryExtensions`, TypeScript résout
  `import mapUser from "./user.typeflow"` contre ce `user.d.typeflow.ts` —
  c'est une fonctionnalité TS 5.0+ standard, pas un hack.
- `typeflow types` (`src/cli/commands/analyze.ts:cmdTypes`) génère ces
  sidecars en une passe ; `typeflow types --check` détecte le drift (utile en
  CI, déjà branché dans le script `typecheck` de `package.json`).
- `typeflow watch` (`cmdWatch`) surveille le filesystem (`fs.watch`,
  debounce 150 ms) et régénère les `.d.typeflow.ts` à chaque sauvegarde d'un
  `.typeflow`. Lancé à côté de l'éditeur, c'est déjà une expérience quasi
  « live » : VS Code/tsserver détectent le fichier `.d.typeflow.ts` modifié
  sur disque et rafraîchissent l'inférence sans action supplémentaire.

Donc `import x from "./user.typeflow"` **fonctionne et s'infère
correctement aujourd'hui**, à condition d'avoir lancé `typeflow watch` (ou
relancé `typeflow types` après chaque modification).

## Ce qu'il manque pour que ce soit « naturel »

Trois frictions, indépendantes les unes des autres :

1. **Il faut se souvenir de lancer `typeflow watch`.** Rien ne le fait tout
   seul à l'ouverture du projet — ce n'est ni automatique ni découvrable pour
   quelqu'un qui ne lit pas le README.
2. **Latence fichier.** Sauvegarde → `fs.watch` (debounce 150 ms) → recompile
   → écriture disque → tsserver renote le fichier. En pratique quasi
   instantané, mais ce n'est pas la frappe-par-frappe que donne un vrai
   plugin de langage (édition dans un buffer non sauvegardé, par exemple).
3. **Rien à l'intérieur du `.typeflow` lui-même.** Cette chaîne ne concerne
   que le fichier `.ts` qui _importe_ le mapping. Ouvrir `user.typeflow` dans
   l'éditeur ne donne ni coloration syntaxique, ni erreurs inline (TF2xxx),
   ni autocomplete sur les champs de l'input ou les 51 builtins — seul
   `typeflow check`/`watch` en terminal les affiche.

Ce sont trois problèmes différents, avec trois solutions différentes. Un
« plugin TypeScript » ne répond qu'au premier et au deuxième.

## Ce qu'apporterait un vrai plugin TypeScript (Language Service Plugin)

TypeScript expose une API de plugin (`ts.server.PluginModule`, chargée par
`tsserver` — le process que VS Code, WebStorm, Neovim/coc-tsserver pilotent
tous). C'est le mécanisme derrière `@vue/typescript-plugin` (`.vue`),
`svelte-language-server`, l'extension Astro : faire comprendre à `tsserver`
un fichier qui n'est pas du TypeScript, pour que l'IDE (hover, autocomplete,
diagnostics, go-to-definition) fonctionne comme s'il en était.

Deux briques possibles, combinables :

### A. Proxy du Language Service

Le plugin reçoit le `LanguageService` réel et retourne un objet qui
intercepte certaines méthodes (`getSemanticDiagnostics`,
`getQuickInfoAtPosition`, `getCompletionsAtPosition`…) pour les positions qui
tombent sur un import `.typeflow` ou sur son spécificateur.

### B. Fichiers virtuels via `resolveModuleNameLiterals` + `getScriptSnapshot`

Le plugin intercepte la résolution de module : quand `tsserver` rencontre
`import x from "./user.typeflow"`, au lieu de chercher `user.d.typeflow.ts`
sur disque, le plugin **synthétise en mémoire** un fichier virtuel — le même
contenu que `emitDts()` produit déjà, calculé à la volée en appelant
`compile()` sur le contenu ACTUEL du buffer (pas forcément sauvegardé). Ça
élimine la friction n°2 : plus besoin d'écrire sur disque, tsserver a déjà
tout le mécanisme d'invalidation par version de fichier (`getScriptVersion`)
pour ne rafraîchir que ce qui a changé.

C'est un réemploi direct de l'existant : `compile()` et `emitDts()` sont déjà
la bonne API, il n'y a rien à dupliquer côté logique de types — le plugin
n'est qu'un adaptateur entre l'API `ts.LanguageServiceHost` et ce qui existe
déjà dans `src/compiler`.

### Contrainte importante : `tsc` en CLI ignore les plugins de langage

`tsc --noEmit` (utilisé par `bun run typecheck` et par CI) **ne charge pas**
les plugins de `tsserver` — seuls les éditeurs le font. C'est exactement
pourquoi l'écosystème Vue a dû créer `vue-tsc` (un wrapper CLI séparé) en
plus de `@vue/typescript-plugin` : le plugin ne suffit pas pour la ligne de
commande.

Bonne nouvelle : typeflow n'a pas ce problème à résoudre, il est déjà réglé —
`typeflow types --check` fait exactement le travail de vérification en CLI
que `vue-tsc` fait pour Vue, et existe déjà. Un plugin TS n'y changerait
rien ; les deux mécanismes coexisteraient (plugin pour l'IDE, `types --check`
pour la CI), sans duplication de logique puisque les deux appellent
`compile()`/`emitDts()`.

### Contrainte d'adoption

Un Language Service Plugin **n'est pas zero-config** : le projet consommateur
doit ajouter dans son `tsconfig.json` :

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@thomasfarineau/typeflow/ts-plugin" }],
  },
}
```

Pas pire que Vue/Svelte/Astro (tous demandent ça), mais ça reste une étape
manuelle en plus de `npm i` — à mettre en balance avec le gain réel (éliminer
`typeflow watch` en tâche de fond).

## Trois périmètres possibles

### A. Automatiser l'existant (petit, pas de plugin TS)

`typeflow watch` déjà présent, mais jamais lancé automatiquement. Options
sans écrire de plugin TS :

- Documenter/fournir un `.vscode/tasks.json` avec `"runOn": "folderOpen"`
  lançant `typeflow watch` à l'ouverture du dossier dans VS Code.
- Un hook `postinstall` qui rappelle de le lancer (ou le lance en arrière-plan
  via un supervisor léger) — plus intrusif, à éviter par défaut.

Ferme la friction n°1 pour VS Code spécifiquement, zéro nouveau code dans
`src/`, un fichier de config. Ne résout pas la latence fichier ni
l'expérience d'édition du `.typeflow` lui-même.

### B. Vrai Language Service Plugin (moyen)

Sous-chemin du package existant `@thomasfarineau/typeflow/ts-plugin` (pas un
nouveau package séparé — cohérent avec un seul `npm i`) :

- Implémente `resolveModuleNameLiterals` + fichiers virtuels (option B
  ci-dessus) pour les imports `.typeflow`, en réutilisant `compile()` +
  `emitDts()` tels quels.
- Élimine la latence fichier et le besoin de lancer `typeflow watch` pour que
  l'IMPORT soit inféré — mais seulement dans l'éditeur (voir contrainte CI
  ci-dessus, déjà couverte par l'existant).
- N'apporte rien à l'édition du `.typeflow` lui-même (périmètre C).

#### Validation : le mécanisme central marche, testé directement contre l'API TS

Le risque technique principal de B — est-ce que rediriger un import vers un
fichier virtuel calculé à la volée donne vraiment du hover/autocomplete
live ? — se teste sans écrire de vrai plugin `tsserver` : un
`ts.LanguageServiceHost` custom suffit, appelé directement via
`ts.createLanguageService`. Testé avec le vrai `compile()`/`emitDts()` de
`src/compiler`, aucune logique de types réimplémentée.

```ts
const host: ts.LanguageServiceHost = {
  // ...
  getScriptSnapshot: (fileName) => {
    if (fileName === DTS_FILE) {
      // Le cœur du mécanisme : (re)calculé à la volée depuis la source EN
      // MÉMOIRE du mapping, jamais écrit sur disque.
      return ts.ScriptSnapshot.fromString(currentDts());
    }
    // ...
  },
  resolveModuleNameLiterals: (literals) =>
    literals.map((lit) =>
      lit.text.endsWith('.typeflow')
        ? { resolvedModule: { resolvedFileName: DTS_FILE, extension: ts.Extension.Dts, isExternalLibraryImport: false } }
        : /* résolution normale */,
    ),
};
```

Résultat, sur `import mapUser from "./user.typeflow"` + `const out = mapUser(...); out.` :

```
=== hover sur mapUser ===
(alias) mapUser(input: TypeflowInput): TypeflowOutput

=== completions sur `out.` (mapping initial) ===
[ "fullName", "id", "isAdmin" ]

=== completions sur `out.` (après édition EN MÉMOIRE, +champ email) ===
[ "email", "fullName", "id", "isAdmin" ]
```

La dernière ligne est le point qui compte : le mapping a été modifié en
mémoire (pas de sauvegarde disque, pas de réécriture de fichier), seul un
compteur de version a été incrémenté — `getCompletionsAtPosition` reflète le
nouveau champ immédiatement. C'est exactement la promesse du périmètre B
(latence zéro, pas de `typeflow watch`), démontrée sans écrire le plugin
`tsserver` complet.

Ce que ça ne teste pas encore : le fonctionnement **dans un vrai `tsserver`**
piloté par un éditeur (le `ts.server.PluginModule` est une couche
supplémentaire — un objet `{ create(info): ts.LanguageService }` que
`tsserver` instancie par projet, où `info.languageServiceHost` est déjà
fourni par `tsserver` lui-même : il faut alors _patcher_ les méthodes
existantes de cet host plutôt que d'en fournir un de zéro comme ci-dessus).
C'est un changement d'échafaudage, pas un changement de mécanisme — la partie
prouvée ici (redirection + snapshot recalculé + invalidation par version) est
réutilisée telle quelle à l'intérieur du `create()`.

- Effort révisé : le risque « est-ce que la redirection de module donne
  vraiment du live » est levé. Ce qui reste : l'échafaudage
  `ts.server.PluginModule` (créer/patcher le host fourni par `tsserver`,
  gérer plusieurs projets), remonter les diagnostics TF2xxx du mapping lui
  -même sur la ligne d'import (mapping des spans typeflow → plages TS), et le
  packaging/publish. ~1 semaine reste une estimation raisonnable ; référence :
  code source des plugins Vue/Svelte/Astro pour l'échafaudage
  `PluginModule`.

### C. Expérience d'édition du `.typeflow` (plus grand, hors scope de la demande initiale)

Coloration syntaxique, erreurs inline (TF2xxx), hover et autocomplete sur les
champs de l'input et les 51 builtins **à l'intérieur** du fichier
`.typeflow` — un besoin réel mais différent, qui ne se résout pas avec un
Language Service Plugin TS (le `.typeflow` n'est pas du TypeScript, tsserver
ne l'ouvre jamais). Deux options si un jour ça devient prioritaire :

- Une extension VS Code dédiée (grammaire TextMate + une diagnostic
  collection alimentée par `compile()`) — le plus rapide, mais VS Code
  uniquement.
- Un vrai serveur LSP (`vscode-languageserver`) — portable (VS Code,
  Neovim, JetBrains via LSP4IJ), plus de travail, réutilise toujours
  `compile()`/`checker` côté sémantique.

Périmètre indépendant de A et B ; à ne traiter que si le besoin se
manifeste (aujourd'hui `typeflow check`/`watch` en terminal couvre le
signal, juste pas inline).

## Recommandation

1. **Court terme** : périmètre A — un `.vscode/tasks.json` documenté (ou
   embarqué dans `typeflow init`) qui lance `typeflow watch` automatiquement.
   Zéro nouveau package, ferme la friction la plus bête (« j'ai oublié de
   lancer watch ») pour la majorité des utilisateurs VS Code.
2. **Si le besoin de latence zéro se confirme** : périmètre B — le mécanisme
   central (redirection de module + snapshot recalculé + invalidation par
   version) est validé, pas juste théorique (voir plus haut). Ce qui reste
   est de l'échafaudage `ts.server.PluginModule` connu (précédents
   Vue/Svelte/Astro), pas de la recherche. Reste un adaptateur autour de
   `compile()`/`emitDts()`, aucune logique de types dupliquée. Garder
   `typeflow types --check` pour la CI (déjà fait, ne change pas).
3. **Périmètre C** (édition du `.typeflow` lui-même) : backlog séparé, pas un
   prérequis pour que l'import soit « naturellement inféré » — c'est déjà
   vrai aujourd'hui pour le fichier qui importe, via le mécanisme existant.

## Implémentation (périmètre B)

Fait, dans `src/ts-plugin/index.ts`, exporté en tant que sous-chemin du
package (`@thomasfarineau/typeflow/ts-plugin`) — pas un nouveau package npm
séparé, cohérent avec le principe « un seul `npm i` ».

### Ce que fait le code

`init({ typescript }) → { create(info), getExternalFiles(project) }` — la
forme standard d'un `ts.server.PluginModule` :

- `create(info)` patche en place les méthodes de `info.languageServiceHost`
  que `tsserver` a déjà construit :
  - `resolveModuleNameLiterals` : tout spécificateur qui finit par
    `.typeflow` est redirigé vers un fichier virtuel `<chemin>.typeflow.d.ts`
    (chemin résolu à la main, normalisé en `/` — voir bug ci-dessous) ;
    tout le reste passe à la résolution d'origine.
  - `getScriptSnapshot` / `getScriptVersion` / `fileExists` / `readFile` :
    pour un chemin `*.typeflow.d.ts`, appellent `computeDts()`, qui lit le
    `.typeflow` réel via `ts.sys.readFile`, appelle `compile()` +
    `emitDts()` (les mêmes fonctions que `typeflow types`), et met en cache
    par mtime — pas de recompilation si le fichier n'a pas changé.
  - `getExternalFiles(project)` : liste les `.typeflow` réels correspondant
    aux fichiers virtuels déjà résolus, pour que l'éditeur les surveille et
    revalide les importeurs — un plus, pas un prérequis (la vérification par
    version au moment de la requête suffit déjà).
- `input user: T from "./mod"` fonctionne : `computeDts` passe
  `createTypeScriptResolver()` (le même adaptateur que la CLI) à `compile()`,
  pas seulement les types inline.

### Bug trouvé et corrigé pendant la validation

Premier essai : chemin virtuel construit par concaténation d'un suffixe
`.typeflow.d.ts` sur un chemin qui finissait déjà par `.typeflow` →
`user.typeflow.typeflow.d.ts`, résolution silencieusement ratée (aucune
erreur, juste `unknown` partout). Deuxième bug, Windows spécifique :
`path.resolve`/`path.dirname` renvoient des chemins à antislash, alors que
les clés de fichiers internes de TS sont canoniques en `/` même sous
Windows — sans normalisation, le fichier virtuel existait sous une clé que
`getScriptSnapshot` ne reconnaissait jamais. Les deux corrigés, testés avant
et après (voir ci-dessous).

### Validation

Deux niveaux, tous les deux contre du code réel, pas contre une
réimplémentation :

1. **Mécanisme** (avant d'écrire `src/ts-plugin/`) : un
   `ts.LanguageServiceHost` construit à la main avec la redirection
   directement dedans, testé via `ts.createLanguageService`. Sert à valider
   l'idée avant d'investir dans l'échafaudage `PluginModule`.
2. **Artefact réel** (après) : `dist/ts-plugin/index.cjs` (le build `bun run
build` normal du projet) chargé via `require()` — exactement comme
   `tsserver` le ferait — puis `create(info)` appelé sur un `LanguageService`
   **déjà construit** avant le patch (ça reproduit l'ordre réel : `tsserver`
   construit son `Project`/`LanguageService` puis instancie les plugins
   ensuite). Résultat, sur le mapping `user.typeflow` d'exemple :

   ```
   hover sur mapUser → (alias) mapUser(input: TypeflowInput): TypeflowOutput
   diagnostics → []
   completions sur `out.` → [ "fullName", "id" ]

   # user.typeflow modifié SUR DISQUE (+ champ isAdmin), sans rien redémarrer :
   completions sur `out.` → [ "fullName", "id", "isAdmin" ]
   ```

`bun run build && bun test && bunx tsc --noEmit -p tsconfig.json` passent
tous (148 tests, 0 échec).

### Ce qui n'est PAS validé

Le fonctionnement dans un vrai `tsserver` piloté par VS Code/un éditeur —
testé ici via un harnais qui reproduit l'API et l'ordre d'appel réels
(`LanguageService` construit avant le patch), mais pas via une vraie session
d'éditeur. À faire avant de documenter la fonctionnalité comme stable :
ajouter `"plugins": [{ "name": "@thomasfarineau/typeflow/ts-plugin" }]` au
`tsconfig.json` d'un projet consommateur et ouvrir `consumer.ts` dans VS
Code pour confirmer hover/autocomplete en conditions réelles.

Confirmé aussi dans ce rapport, pas juste supposé : sans extension
d'éditeur compagnon, « live » veut dire « à jour au dernier fichier
sauvegardé sur disque » (le test ci-dessus édite le fichier avec `writeFileSync`,
pas un buffer non sauvegardé) — le plugin élimine `typeflow watch` et le
fichier `.d.typeflow.ts`, pas l'étape de sauvegarde elle-même.

## Exemple réel construit (`examples/ts-plugin/`, retiré depuis)

Un exemple Node autonome a été ajouté et validé, sans `package.json`/
`node_modules` (auto-référencement, comme `examples/api-response` et
`examples/bun-plugin`) :

- `hover-demo.ts` — `import mapUser from "./user.typeflow"` local, pensé pour
  être ouvert dans un éditeur (hover, autocomplete, mise à jour après
  sauvegarde).
- `cross-import-demo.ts` — `import mapUser, { type Input } from
  "../api-response/user.typeflow"` : import **cross-répertoire** d'un mapping
  d'un autre exemple, qui déclare un type externe (`ApiUser from
  "./user-types"`, pas inline). Validé que le plugin résout le type externe
  via `createTypeScriptResolver()` relatif au dossier du `.typeflow`, peu
  importe qui l'importe :
  ```
  hover sur mapUser → (alias) mapUser(input: Input): TypeflowOutput
  hover sur Input   → type Input = { id: number; firstName: string; ...; address: {...}; scores: number[] }
  completions sur mapped. → [ activeTags, address, email, fullName, id, isAdmin, tagCount, totalScore ]
  ```
- `run.ts` — exécute le mapping pour de vrai (`compile()` + `createMapping()`
  explicites), sans dépendre d'aucun des deux mécanismes ci-dessous.

## Deuxième mécanisme construit : exécuter `.typeflow` hors Bun (`src/node-loader/`)

Question complémentaire posée en cours de route : le plugin TS rend l'import
*typé*, mais `hover-demo.ts`/`cross-import-demo.ts` ne sont exécutables
qu'avec le plugin Bun (`@thomasfarineau/typeflow/plugin`, préchargé via
`bunfig.toml`) — `tsx`/`ts-node`/`node` nu échouent avec
`ERR_UNKNOWN_FILE_EXTENSION` (aucun loader pour `.typeflow`).

Réponse : un hook de chargement Node natif (`node:module` `register()` —
le mécanisme sur lequel `tsx` lui-même est bâti, visible dans sa propre
stack trace : `node:internal/modules/customization_hooks`). Même génération
de code que le plugin Bun (compiler une fois, émettre un petit module
`createMapping(<artefact JSON>)`), exposé en sous-chemin
`@thomasfarineau/typeflow/node-loader`.

Validé réellement, pas juste en théorie :

```console
$ node --import ./register.mjs --experimental-strip-types hover-demo.ts
42 Ada Lovelace true [ 'founder' ]

$ NODE_OPTIONS="--import ./register.mjs" npx tsx cross-import-demo.ts
Ada Lovelace { city: 'London', country: 'unknown' }
```

Matrice complète qui en résultait :

| Besoin                          | Mécanisme                                  |
| -------------------------------- | ------------------------------------------- |
| Inférence IDE (hover/autocomplete)| `@thomasfarineau/typeflow/ts-plugin`         |
| Exécution sous Bun                | `@thomasfarineau/typeflow/plugin`            |
| Exécution sous Node/tsx/ts-node   | `@thomasfarineau/typeflow/node-loader`       |

## État actuel : retiré du code

Les deux mécanismes construits dans cette session (`src/ts-plugin/`,
`src/node-loader/`), l'exemple (`examples/ts-plugin/`), et les branchements
associés (`package.json` exports, `scripts/build.ts`, `tsconfig.json` paths,
section README) ont été **retirés du code** — rien n'est resté en place.

Le plugin Bun préexistant (`src/plugin/index.ts`, `examples/bun-plugin/`,
sous-chemin `@thomasfarineau/typeflow/plugin`) a été retiré dans la foulée,
sur demande explicite — ce n'était pas un ajout de cette session mais une
fonctionnalité déjà livrée. Avec les trois mécanismes partis, il n'y a plus
aucun moyen d'exécuter un import `.typeflow` directement (`import x from
"./m.typeflow"`) dans ce repo — seul `compile()` + `createMapping()` (ou
`loadTypeflowMapping()`) explicites restent, ce qui marche partout sans
aucun plugin.

Ce rapport (analyse, code de référence, bugs trouvés, résultats de
validation ci-dessus) reste la base à reprendre telle quelle si ce travail
redémarre :
le risque technique est levé des deux côtés (redirection de module pour le
plugin TS, hook `register()` pour l'exécution), il ne reste que du code à
réécrire, pas de la recherche.
