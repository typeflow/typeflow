# Réécrire Typeflow en Rust — analyse

_Rapport du 2026-07-04. À lire après `optimisation-runtime.md` : plusieurs conclusions en dépendent._

## Ce qui est portable, ce qui ne l'est pas

| Module              | Portable en Rust ? | Remarques                                                                 |
| ------------------- | ------------------ | ------------------------------------------------------------------------- |
| core (AST, types, diagnostics) | ✅        | Structures pures, serde-friendly                                          |
| parser (lexer + descente récursive) | ✅   | Port mécanique                                                             |
| compiler / checker  | ✅ (gros morceau)  | Le système de types (unions, littéraux, optionnalité) est le plus long     |
| runtime (interpréteur) | ✅              | Petit ; l'artefact JSON v1 est déjà le contrat                             |
| formatter, converter JSONata | ✅         | Ports mécaniques                                                           |
| CLI                 | ✅                 | Binaire unique possible                                                    |
| **adapter-typescript** | ❌              | `input x: T from "./mod"` passe par l'API du compilateur TypeScript — ça reste du Node. Un binaire Rust devrait l'appeler en sidecar (process Node) ou se limiter aux types inline |
| bun plugin          | ❌ (glue JS)       | Reste en TS par nature                                                     |
| **playground de la doc** | ⚠️ WASM       | Le site exécute compilateur + runtime dans le navigateur ; un port Rust doit sortir une cible wasm-bindgen pour ne pas régresser |
| **génération de la doc** | ⚠️ couplage fort | Les 51 builtins sont définis UNE fois en TS (signature + impl + doc) et la doc/FnIndex/le checker en dérivent. Porter les builtins en Rust déplace ou duplique cette source de vérité |

## Le point dur : la frontière JS ↔ natif

C'est LE piège du « Rust pour la perf » ici. Le travail d'un mapping est
proportionnel à la taille de l'input ; or pour appeler un runtime Rust depuis
Node (napi-rs) ou depuis le navigateur (WASM), il faut **convertir l'input à
chaque appel** :

- Input = objet JS déjà parsé (le cas `mapUser(apiResponse)` du README) →
  la traversée de l'objet JS pour le convertir coûte du même ordre que la
  transformation elle-même. Sur ce cas, un runtime Rust peut être **plus lent**
  que le runtime JS optimisé en closures (voir l'autre rapport : celui-ci est
  déjà à ~×4 du JS natif).
- Input = **texte JSON** (body HTTP, fichier, batch CLI) → Rust gagne
  franchement : `serde_json` parse + transforme + sérialise sans jamais créer
  d'objets JS. C'est le cas d'usage où le port a un vrai rendement.

Conclusion honnête : **Rust n'accélère pas « les requêtes » in-process Node ;
il accélère les pipelines qui manipulent du JSON textuel** (CLI batch, serveur
Rust, edge/WASI) et il offre un binaire sans dépendance Node.

## Trois périmètres possibles

### A. Crate runtime seul (`typeflow-runtime`) — recommandé si on y va

- Consomme l'artefact JSON v1 (déjà sérialisable, versionné) : le compilateur
  TS reste l'unique frontal.
- Cibles : lib Rust + CLI `typeflow-run` (JSON in → JSON out), feature `wasm`.
- À porter : l'interpréteur (~300 lignes) + **les impls des 51 builtins** —
  c'est là que vit le risque de divergence sémantique (nullish, `+` sans
  coercition, tri stable avec nullish en dernier, regex de `matches`…).
- Effort : ~2-4 semaines avec la suite de conformité (voir plus bas).

### B. Toolchain complète (style oxc/biome)

- parser + checker + formatter + converter + CLI en Rust, WASM pour le
  playground, adapter TS en sidecar Node.
- Bénéfices réels : `typeflow check` instantané sur de gros dépôts, binaire
  unique, embarquable partout.
- Coûts : plusieurs mois ; duplication de la source de vérité des builtins et
  des diagnostics (la doc générée, les dictionnaires FR et la page /benchmark
  dérivent tous du TS) ; le checker est en évolution active (let, sort, index
  binder ajoutés cette semaine) — porter une cible mouvante multiplie le coût.
- À n'envisager qu'après gel de la grammaire (roadmap v1.0).

### C. Statu quo outillé (le « non » argumenté)

- Faire l'optimisation closures du runtime JS (×2-4,7 mesuré, 1 journée),
  garder une seule implémentation, réévaluer quand un cas d'usage batch/edge
  concret se présente.

## Prérequis quel que soit le choix : la suite de conformité

Déjà dans la roadmap v1.0, et c'est le verrou anti-divergence :

- des fixtures dorées `(mapping, input) → output attendu` couvrant chaque
  opérateur, chaque builtin, chaque règle nullish ;
- `(source) → diagnostics attendus` pour les 21 codes TF ;
- exécutées en CI contre **chaque** implémentation (TS aujourd'hui, Rust demain).

Sans elle, deux runtimes = deux sémantiques qui dérivent en silence. Avec elle,
le port Rust devient un exercice borné et vérifiable.

## Recommandation

1. **Court terme** : optimisation closures du runtime TS (rapport
   `optimisation-runtime.md`) — le gros du gain perçu, zéro nouveau langage,
   zéro duplication.
2. **Moyen terme** : écrire la suite de conformité (utile en soi, requis v1.0).
3. **Ensuite seulement** : périmètre A (crate runtime + WASM) si un cas d'usage
   « JSON textuel à haut débit » ou « exécution hors Node » existe vraiment —
   avec un benchmark de la frontière napi/WASM AVANT de s'engager, sur le
   modèle de la page /benchmark (les scénarios de `scripts/bench/scenarios.ts`
   sont réutilisables tels quels côté Rust : mêmes entrées générées, même
   vérification d'équivalence).
4. Le périmètre B attend le gel de la grammaire.

_Note : `src/rust/**` figure déjà dans les ignorePatterns d'oxfmt — l'emplacement
du crate est donc déjà réservé si le périmètre A se lance._
