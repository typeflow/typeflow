# Optimisation du runtime — compilation en closures

_Rapport du 2026-07-04. Mesures faites sur ce poste (Bun 1.3.13, Windows x64), scénarios de `scripts/bench/scenarios.ts` (les mêmes que la page /benchmark)._

## Constat

L'interpréteur actuel (`src/runtime/interpreter.ts`) est un tree-walker : l'IR est re-parcouru intégralement à chaque exécution du mapping.

Écart mesuré vs une fonction JS écrite à la main :

| Scénario         | interpréteur | JS natif      | écart     |
| ---------------- | ------------ | ------------- | --------- |
| reshape, n=10    | 383 k ops/s  | 8 400 k ops/s | **×21,9** |
| reshape, n=1000  | 13,1 k       | 90,2 k        | **×6,9**  |
| catalog, n=10    | 109 k        | 1 141 k       | **×10,5** |
| catalog, n=1000  | 1,7 k        | 17,6 k        | **×10,2** |

## Où part le temps (dans `interpreter.ts`)

1. **Dispatch `switch` par nœud, à chaque appel** — `evalExpr` re-décide la nature de chaque nœud à chaque exécution.
2. **Allocations par élément** :
   - `filter` / `project` / `sort` allouent un `Env` par élément ; `project` alloue en plus un objet `bindings` même sans binder (`bindEnv`).
   - `evalObject` alloue **deux objets** par objet produit : `Object.create(null)` puis re-wrap `{ ...out }` — par élément dans une projection.
3. **`lookup()` dynamique** : chaque identifiant remonte la chaîne d'`Env` avec `Object.hasOwn` à chaque niveau — dans un prédicat de filtre, c'est par élément.
4. **Travail refaisable une seule fois refait à chaque appel** : `parentChainDepth()` recalculé par nœud `member` ; `call` remonte les envs (functions/defs) puis consulte `BUILTINS` à chaque appel ; `expr.args.map(...)` alloue à chaque appel.

## Piste principale : compiler l'IR en closures (SANS eval)

Une passe unique dans `createMapping` transforme chaque nœud en fonction JS imbriquée :

```ts
type Op = (env: Env) => unknown;
function compileExpr(e: Expr): Op {
  switch (e.kind) {
    case 'lit': { const v = e.value; return () => v; }
    case 'member': { const o = compileExpr(e.object); const n = e.name;
                     return (env) => member(o(env), n); }
    // … le switch ne tourne plus qu'UNE fois, à la préparation
  }
}
```

Tout ce qui est décidable statiquement est résolu à la préparation : dispatch,
`parentChainDepth`, présence de binders, liste des propriétés, arité des
appels, cible des fonctions. L'exécution n'est plus que des appels directs.

**Propriétés conservées** (c'est le point clé vs `new Function`) :

- pas d'`eval` / `new Function` → CSP stricte OK, sandbox intact ;
- l'artefact JSON (`CompiledMapping` v1) ne change pas ;
- l'API publique (`createMapping`, `runMapping`) ne change pas ;
- déterminisme et limite de profondeur inchangés.

### Gain mesuré (prototype validé, sorties identiques bit à bit)

Prototype : scratchpad `closure-proto.ts` (session Claude du 2026-07-04),
couvre lit/ident/member/index/filter/project/cond/call/object/array/unary/binary + lets.

| Scénario         | interpréteur | closures    | **gain** | reste vs natif |
| ---------------- | ------------ | ----------- | -------- | -------------- |
| reshape, n=10    | 366 k ops/s  | 1 051 k     | **×2,9** | ×6,4           |
| reshape, n=1000  | 11,5 k       | 24,4 k      | **×2,1** | ×3,6           |
| catalog, n=10    | 114 k        | 466 k       | **×4,1** | ×3,8           |
| catalog, n=1000  | 1,1 k        | 5,0 k       | **×4,7** | ×3,9           |

Le prototype garde le `lookup` **dynamique** — le gain ci-dessus est donc la
borne basse de l'approche.

## Marches suivantes (dans l'ordre de rendement)

1. **Compilation en closures** (ci-dessus) — ×2 à ×4,7 mesuré. Effort : ~1 journée,
   un seul fichier de runtime + tests. `evalExpr` peut rester exporté pour référence
   ou disparaître.
2. **Résolution statique des identifiants** — le checker sait déjà où chaque
   identifiant se résout (champ d'élément à profondeur k, binding `let`, paramètre
   de `fn`, input). Annoter l'IR à la compilation (champ optionnel → artefact v1
   rétro-compatible) et compiler l'accès en lecture directe au lieu du walk
   `hasOwn`. C'est ce qui doit manger une bonne partie du ×3,6–6,4 restant,
   surtout sur les prédicats de filtre. Effort : checker + runtime, ~1-2 jours.
3. **`evalObject` sans double allocation** — décider à la compilation si une clé
   dangereuse (`__proto__`, `constructor`…) existe ; sinon écrire directement dans
   un `{}`. (Inclus naturellement dans la marche 1.)
4. **Résolution des appels à la préparation** — figer la cible (builtin / def /
   externe) dans la closure au lieu du walk par appel. (Inclus dans la marche 1.)
5. **Fusion d'opérateurs** (optionnel, plus tard) — `sum(arr[pred].price)` en une
   passe sans tableaux intermédiaires ; `arr[pred] -> {…}` filtre+map fusionnés.
   Travail côté compilateur (réécriture d'IR), à ne faire qu'après 1+2 si le
   besoin persiste.

## À ne PAS faire

- **Codegen `new Function`** : plus rapide encore, mais casse l'argument
  sandbox/CSP qui est un pilier du positionnement (« deterministic and
  sandboxable by construction »). Si un jour c'est envisagé, ce doit être un
  mode opt-in explicite, jamais le défaut.

## Validation

- Les 148 tests existants couvrent le comportement du runtime — ils valident la
  passe telle quelle (l'API ne bouge pas).
- La page **/benchmark** de la doc reflétera le gain immédiatement (elle recompile
  à chaque run).
- Ajouter idéalement un test de non-régression d'équivalence interpréteur ↔
  closures sur les fixtures existantes tant que les deux coexistent.
