# Faut-il éclater le repo en `core` / `cli` / `converter` ?

Date : 2026-07-06
Contexte : le plugin JetBrains vit maintenant dans `jetbrains-plugin/` à côté du repo TS. La question posée : est-ce que ça vaut le coup de splitter `typeflow` en plusieurs repos npm (core, cli, converter) ?

## Ce qui existe déjà

Le package est **mono-repo, mono-package, zéro dépendance runtime** :

```json
"dependencies": {},
"devDependencies": { "jsonata": "...", ... }
```

`jsonata` n'est même utilisé qu'en devDep par `src/converter/jsonata` — signe que le converter est déjà pensé comme un sous-module optionnel.

`package.json` expose déjà des **subpath exports** séparés :

- `.` → `src/index.ts`
- `./runtime` → `src/runtime/index.ts`
- `./converter`, `./converter/jsonata`, `./converter/jq` → indépendants
- `bin.typeflow` → `dist/cli/main.js`

Donc la séparation *logique* (core / runtime / converter / cli) existe déjà au niveau des exports. La question n'est pas "faut-il découper le code" (déjà fait) mais "faut-il découper le **repo git / package npm**".

## Taille réelle des modules

| Module | LOC | Rôle |
|---|---|---|
| `converter` | 2456 | jq/jsonata → typeflow (le plus gros, et le plus séparable) |
| `compiler` | 1163 | checker + emit dts |
| `builtins` | 1132 | fonctions intégrées |
| `parser` | 914 | lexer/parser |
| `cli` | 595 | commandes + reports |
| `core` | 649 | types, ast, diagnostics |
| `runtime` | 398 | interpréteur |
| `formatter` | 351 | pretty-printer |
| `adapter` | 198 | résolveur TS |

Total ~7850 LOC. C'est un **petit projet**. Pour comparaison, un split de repos a du sens généralement au-delà de 20-30k LOC par unité, ou quand des équipes différentes possèdent des parties différentes.

## Couplage réel entre modules (via graphify)

En traçant les imports :

- `cli` importe `core`, `compiler`, `adapter`, `runtime`, `formatter` — **le CLI dépend de presque tout**. Un repo `cli` séparé devrait donc dépendre de `core` en semver et se resynchroniser à chaque release, pour un module qui ne représente que 8% du LOC.
- `converter` importe `formatter` et s'importe lui-même (`jq` ← `jsonata/sample-type`). Il est le module le plus **indépendant** — c'est celui qui aurait le plus de sens à isoler s'il devait y en avoir un.
- `adapter` importe `core` + `compiler`.
- `compiler`/`builtins`/`runtime`/`core` sont fortement imbriqués (types partagés `Type`, `Diagnostic`, `Expr`, `CompiledFn` circulent entre les quatre).

Le cœur (`core` + `compiler` + `builtins` + `runtime` + `parser`) forme un seul bloc cohérent qui change ensemble à chaque évolution du langage. Le séparer casserait ça pour un gain nul : toute PR qui ajoute un builtin ou change l'AST toucherait 3 repos.

## Coût d'un split multi-repo

Concret, pas théorique — ce que ça ajoute :

- **Versioning** : `cli` et `converter` doivent pin une version de `core`. Chaque changement de type dans `core` = bump + republish + bump dans les deux autres + republish. Pour un projet solo/petite équipe, c'est de la friction pure, pas de la sécurité.
- **CI/release** : 3 pipelines, 3 changelogs, 3 `npm publish`, coordination des versions compatibles.
- **Dev loop** : plus de `bun link`/workspace juggling pour tester un changement de `core` dans `cli` en local, alors qu'aujourd'hui c'est un simple import relatif.
- **Le plugin JetBrains n'a même pas besoin de ça** : il consomme le CLI compilé (`dist/cli/main.js`) comme process externe, pas les sources TS. Le split de repo npm n'a aucun impact sur lui — le vrai sujet d'intégration, c'est le binaire/CLI, pas la modularité npm.

## Bénéfices attendus vs réels

Les raisons classiques de splitter :
1. **Équipes séparées / ownership** → n'existe pas ici (un seul mainteneur).
2. **Cycles de release différents** → possible en théorie (converter change moins souvent que core) mais pas observé dans l'historique de commits, et gérable avec des **subpath exports + tags de version** sans split de repo.
3. **Réduire le bundle consommé** → déjà réglé par les exports séparés (`./converter`, `./runtime`, etc.), un consommateur qui n'importe pas `converter` ne le tree-shake même pas besoin — il n'importe juste pas ce chemin.
4. **Publier `core` seul pour d'autres consommateurs** (ex: un jour un plugin qui veut juste le type-checker sans le CLI) → seul argument qui tient, mais résolu par les subpath exports actuels sans repo séparé.

## Recommandation

**Ne pas splitter en plusieurs repos maintenant.** Le ratio effort/bénéfice est mauvais à cette taille (7.8k LOC, zéro dépendance, un seul mainteneur) et le couplage réel entre `cli`/`core`/`compiler` rendrait la synchronisation de versions plus coûteuse que la valeur récupérée.

Si le besoin réapparaît plus tard (ex: quelqu'un veut consommer uniquement `core` en dépendance externe, ou une équipe dédiée reprend `converter`), la voie la moins chère est un **monorepo à workspaces** (bun/npm workspaces, packages séparés `@typeflow/core`, `@typeflow/cli`, `@typeflow/converter` dans un seul repo git) plutôt que 3 repos git. Ça donne le versioning indépendant et la publication séparée sans le coût de synchronisation cross-repo — et ça se fait en gardant la structure `src/` actuelle presque intacte (renommer les dossiers en packages, ajouter des `package.json` locaux).

Le seul module qui aurait un profil suffisamment autonome pour être extrait *seul* un jour est `converter` (2456 LOC, dépend juste de `formatter`, pas d'aller-retour avec `core`/`compiler`) — mais rien n'urge.

## Mise à jour 2026-07-06 : le plugin JetBrains, lui, sort du repo

Décision prise séparément (hors du sujet core/cli/converter ci-dessus) : `jetbrains-plugin/` va être extrait dans son propre repo git, `typeflow-idea-plugin`.

Ce n'est pas une exception à la recommandation "pas de split" — c'est un cas différent, avec un calcul coût/bénéfice opposé :

- **Zéro couplage source.** Vérifié dans `TypeflowCli.kt` : le plugin shell-out vers le binaire `typeflow` sur le `PATH` (`ProcessBuilder("typeflow", "check", ...)`). Il ne dépend d'aucune source TS du monorepo, seulement du CLI compilé une fois publié.
- **Toolchain complètement différente** : Gradle/Kotlin/IntelliJ Platform vs Bun/TS. Pas de tooling partagé, pas de lint/build unifié possible de toute façon.
- **Cycle de release indépendant et imposé de l'extérieur** : la JetBrains Marketplace a son propre versioning, signing (`CERTIFICATE_CHAIN`, `PRIVATE_KEY`) et pipeline de publish — rien à voir avec `npm publish` du package TS.
- **Historique quasi nul à préserver** : un seul commit (`d2d73cc wip: scaffold JetBrains/IntelliJ plugin`) touche ce dossier. L'extraction est une simple copie, pas un `git subtree split`.

Donc : le split `core`/`cli`/`converter` reste déconseillé (couplage fort, même toolchain, même cycle de release, gain nul). L'extraction de `jetbrains-plugin/` est justifiée (couplage nul, toolchain différente, cycle de release externe imposé). Les deux décisions utilisent le même critère — couplage réel + toolchain partagée — elles pointent juste dans des directions opposées selon le module.

Plan d'extraction retenu : nouveau repo `typeflow-idea-plugin`, copie du contenu utile (`src/`, `build.gradle.kts`, `settings.gradle.kts`, `gradle/`, `gradlew*`, `README.md`) en excluant les artefacts de build (`.gradle/`, `.intellijPlatform/`, `.kotlin/`, `build/`), `.gitignore` local à recréer, puis `git rm -r jetbrains-plugin` dans `typeflow` une fois le nouveau repo vérifié.
