# Optimisation du runtime — compilation en closures

> **État : marches 1 et 2 livrées (2026-07-08).** Le runtime de production
> (`src/runtime/compile.ts`, branché dans `createMapping`/`runMapping`) compile
> l'IR une seule fois en closures imbriquées, **et** résout statiquement les
> identifiants quand le checker peut le prouver stable au runtime. L'ancien
> tree-walker (`src/runtime/interpreter.ts`) reste dans le repo comme
> implémentation de référence, comparée à `compile.ts` par
> `test/runtime-equivalence.test.ts` (scénarios de benchmark + cas ciblés :
> shadowing let/champ, binders `-> l, i`, champs optionnels, scopes d'index).
> Chiffres à jour dans `benchmarks/<date>/result.md`, généré par
> `bun run bench` et publié dans la doc par `bun run bench:publish`.

_Rapport initial du 2026-07-04, mis à jour le 2026-07-08 après implémentation. Mesures faites sur ce poste (Bun 1.3.13, Windows x64), scénarios de `scripts/bench/scenarios.ts` (les mêmes que la page /benchmark)._

## Constat de départ

L'interpréteur (`src/runtime/interpreter.ts`) est un tree-walker : l'IR est re-parcouru intégralement à chaque exécution du mapping.

Écart mesuré vs une fonction JS écrite à la main, avant toute optimisation :

| Scénario         | interpréteur | JS natif      | écart     |
| ---------------- | ------------ | ------------- | --------- |
| reshape, n=10    | 383 k ops/s  | 8 400 k ops/s | **×21,9** |
| reshape, n=1000  | 13,1 k       | 90,2 k        | **×6,9**  |
| catalog, n=10    | 109 k        | 1 141 k       | **×10,5** |
| catalog, n=1000  | 1,7 k        | 17,6 k        | **×10,2** |

## Où partait le temps (dans `interpreter.ts`)

1. **Dispatch `switch` par nœud, à chaque appel** — `evalExpr` re-décide la nature de chaque nœud à chaque exécution.
2. **Allocations par élément** :
   - `filter` / `project` / `sort` allouent un `Env` par élément ; `project` alloue en plus un objet `bindings` même sans binder (`bindEnv`).
   - `evalObject` alloue **deux objets** par objet produit : `Object.create(null)` puis re-wrap `{ ...out }` — par élément dans une projection.
3. **`lookup()` dynamique** : chaque identifiant remonte la chaîne d'`Env` avec `Object.hasOwn` à chaque niveau — dans un prédicat de filtre, c'est par élément.
4. **Travail refaisable une seule fois refait à chaque appel** : `parentChainDepth()` recalculé par nœud `member` ; `call` remonte les envs (functions/defs) puis consulte `BUILTINS` à chaque appel ; `expr.args.map(...)` alloue à chaque appel.

## Marche 1 — compiler l'IR en closures (SANS eval)

**Livrée dans `src/runtime/compile.ts`.** Une passe unique dans `createMapping` transforme chaque nœud en fonction JS imbriquée :

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
appels, cible des fonctions (builtin / `fn` / externe, figée dans la closure),
et la présence d'une clé dangereuse (`__proto__`) dans un littéral objet
(sinon écriture directe dans un `{}`, sans le double-allocation
`Object.create(null)` + `{ ...out }` de l'interpréteur). L'exécution n'est
plus que des appels directs.

**Propriétés conservées** (c'est le point clé vs `new Function`) :

- pas d'`eval` / `new Function` → CSP stricte OK, sandbox intact ;
- l'artefact JSON (`CompiledMapping` v1) ne change pas ;
- l'API publique (`createMapping`, `runMapping`) ne change pas ;
- déterminisme et limite de profondeur inchangés.

## Marche 2 — résolution statique des identifiants

**Livrée.** Le checker (`src/compiler/checker.ts`) annote chaque `IdentExpr`
de l'IR avec sa résolution (`IdentRes`, champ optionnel `res` — artefact v1
reste rétro-compatible) :

- `{ kind: 'var', hops }` — un binding (`let`, paramètre de `fn`, entrée) à
  `hops` niveaux de scope au-dessus ;
- `{ kind: 'field', hops }` — un champ d'élément (filtre, `->`, tri) à `hops`
  niveaux, non optionnel ;
- `{ kind: 'dyn' }` — la résolution n'est pas garantie stable au runtime :
  champ optionnel (peut être absent et retomber sur un scope externe),
  élément `any`/union/tableau/primitif croisé sur le chemin (le `hasOwn`
  dynamique pourrait encore matcher dessus), résolutions divergentes entre
  deux re-checks d'un même corps sur des parties d'union différentes, ou
  scope d'un index de `[...]` (l'élément y est `undefined` au runtime même si
  le checker le type pour valider l'expression).

Le runtime (`src/runtime/compile.ts`) compile un identifiant annoté en une
lecture directe à profondeur connue (un seul `Object.hasOwn`, avec les mêmes
garde-fous que le lookup dynamique — pas de lecture sur les tableaux ni le
prototype) au lieu du walk complet de la chaîne d'`Env`. Les identifiants non
annotés (ou `dyn`) gardent le lookup dynamique inchangé : c'est un fallback
sûr, jamais un cas d'erreur.

Le point qui rend ça correct : **la chaîne de scopes du checker et la chaîne
d'`Env` du runtime sont alignées 1:1**, scope par scope (racine, éléments de
filtre/index/tri, scopes `->`, blocs `let`, corps de `fn`) — un `hops` compté
côté checker désigne exactement le même niveau côté runtime.

## Gain mesuré (implémentation livrée, sorties identiques bit à bit)

Comparaison de l'interpréteur (`interpreter.ts`, référence) contre le runtime
compilé livré (`compile.ts`, closures + résolution statique des
identifiants) :

| Scénario         | interpréteur | closures + static | **gain** | reste vs natif |
| ---------------- | ------------ | ------------------ | -------- | -------------- |
| reshape, n=10    | 414 k ops/s  | 1 090 k            | **×2,6** | ×8,0 (n=10)    |
| reshape, n=1000  | 13,6 k       | 28,4 k             | **×2,1** | ×1,4 (n=1000)  |
| reshape, n=10000 | 1,4 k        | 2,8 k              | **×2,0** | ×2,1 (n=10000) |
| catalog, n=10    | 122 k        | 375 k              | **×3,1** | ×3,8 (n=10)    |
| catalog, n=1000  | 1,6 k        | 5,1 k              | **×3,2** | ×3,5 (n=1000)  |
| catalog, n=10000 | 160          | 502                | **×3,1** | ×2,8 (n=10000) |

Colonnes « reste vs natif » recalculées depuis `benchmarks/2026-07-08/result.md`
(voir ce fichier pour les chiffres exacts, JSONata et jq inclus). Chiffres à
rafraîchir à chaque `bun run bench`.

Le gain de la résolution statique (marche 2 seule, par rapport à la marche 1
seule) est plus net sur `catalog` — deux prédicats de filtre par mapping,
c'est exactement le point chaud visé — que sur `reshape`, qui a un filtre et
moins de profondeur de scope.

## Marches suivantes (dans l'ordre de rendement)

1. ~~**Compilation en closures**~~ — livrée (ci-dessus).
2. ~~**Résolution statique des identifiants**~~ — livrée (ci-dessus).
3. ~~**`evalObject` sans double allocation**~~ — livrée dans le cadre de la marche 1 (décision `__proto__` figée à la compilation).
4. ~~**Résolution des appels à la préparation**~~ — livrée dans le cadre de la marche 1 (cible builtin/def/externe figée dans la closure).
5. **Fusion d'opérateurs** (optionnel, à évaluer si le besoin persiste) —
   `sum(arr[pred].price)` en une passe sans tableaux intermédiaires ;
   `arr[pred] -> {…}` filtre+map fusionnés. Travail côté compilateur
   (réécriture d'IR). Le reste vs natif (×1,4 à ×8 selon le scénario et la
   taille, voir tableau ci-dessus) vient surtout de l'allocation d'un objet
   par élément projeté et des tableaux intermédiaires de `filter`/`project` —
   c'est ce que cette étape viserait.

## À ne PAS faire

- **Codegen `new Function`** : plus rapide encore, mais casse l'argument
  sandbox/CSP qui est un pilier du positionnement (« deterministic and
  sandboxable by construction »). Si un jour c'est envisagé, ce doit être un
  mode opt-in explicite, jamais le défaut.

## Validation

- La suite de tests (164 tests, `bun test`) couvre le comportement du
  runtime et passe sans changement d'API.
- `test/runtime-equivalence.test.ts` compare `interpreter.ts` et `compile.ts`
  sortie pour sortie (les scénarios de benchmark + shadowing/binders/champs
  optionnels/index) — la garantie de non-régression tant que les deux
  implémentations coexistent.
- La page **/benchmark** de la doc et `bun run bench` reflètent le gain
  immédiatement (ils recompilent à chaque run).
