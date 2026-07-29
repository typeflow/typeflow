/**
 * French copy for the whole-page templates of the generator (the pages whose
 * English text lives inline in scripts/generate-docs.ts), plus the handful
 * of section labels the generator emits.
 */

export const FR_LABELS = {
  playground: 'Playground',
  howToFix: 'Comment corriger',
  functionsIndexTitle: 'Toutes les fonctions',
  customFunctionsTitle: 'Fonctions personnalisées',
  diagnosticsTitle: 'Diagnostics',
  severity: { error: 'erreur', warning: 'avertissement' } as Record<
    string,
    string
  >,
  diagTable: { code: 'Code', severity: 'Sévérité', meaning: 'Signification' },
  opTable: { operator: 'Opérateur', effect: 'Effet' },
};

/** Intro of /fr/functions/ — `{count}` is replaced by the builtin count. */
export const FR_FUNCTIONS_INDEX_INTRO = `La bibliothèque standard complète — **{count} fonctions**, chacune avec une
signature typée que le compilateur fait respecter (\`TF2007\` pour un nom
inconnu, \`TF2008\` pour de mauvais arguments). Cet index est généré depuis les
définitions mêmes qu'utilisent le compilateur et le runtime — il ne peut pas
dériver. Besoin de plus ? [Ajoutez vos propres fonctions](/fr/functions/custom).`;

/** Intro of /fr/reference/diagnostics (between the title and the table). */
export const FR_DIAGNOSTICS_INTRO = `Tous les diagnostics que le compilateur peut émettre, au même endroit. Les
erreurs font échouer \`typeflow check\` (code de sortie non nul) ; les
avertissements non, mais ils méritent attention. Les codes sont stables — on
peut les grepper et pointer dessus sans risque.

Chaque exemple ci-dessous est **vivant** (modifiez-le !) et **vérifié au
build** : la génération de la doc compile chacun d'eux et échoue s'il cesse de
reproduire son code.`;

/** Body of /fr/functions/custom (after the frontmatter/title). */
export const FR_CUSTOM_FUNCTIONS_BODY = `Typeflow embarque une **bibliothèque standard de niveau JSONata** aux signatures typées (voir [Fonctions](/fr/functions/)), plus des déclarations \`use\` pour amener vos propres fonctions TypeScript dans un mapping. Fonction inconnue : \`TF2007\` ; mauvais types d'arguments : \`TF2008\` — les deux à la compilation.

Quand la bibliothèque standard ne suffit pas, définissez vos propres fonctions. Les trois variantes sont **vérifiées à la compilation** exactement comme les natives — nom inconnu, mauvaise arité et mauvais types d'arguments sont des erreurs de compilation.

### Dans le langage : \`fn\`

Définissez des fonctions pures directement dans le mapping — le corps est une expression Typeflow sur les paramètres (l'input n'est pas dans la portée, les fonctions restent donc réutilisables et indépendantes de leur position). Le type de retour est optionnel : il est inféré depuis le corps, et vérifié (\`TF2017\`) quand il est déclaré. Une fonction peut appeler les natives et les fonctions déclarées avant elle — pas de référence avant déclaration, les mappings restent donc terminants.

Entièrement sérialisable : les définitions \`fn\` voyagent dans l'artefact compilé, elles fonctionnent donc partout où le runtime tourne — y compris ici même :

::: playground
\`\`\`typeflow
input user: { first: string, last: string, scores: number[] }

fn fullName(first: string, last: string): string = first + " " + last
fn grade(score: number) = score >= 15 ? "A" : score >= 10 ? "B" : "C"

map {
  name: fullName(user.first, user.last),
  grades: user.scores -> { value: $, grade: grade($) },
}
\`\`\`
\`\`\`json
{ "first": "Ada", "last": "Lovelace", "scores": [16, 9, 12] }
\`\`\`
:::

### Depuis TypeScript : \`use\` {#use}

Déclarez la signature typée dans le fichier \`.typeflow\` ; l'implémentation est importée depuis le module au chargement du mapping :

\`\`\`
use slugify(value: string): string from "./helpers"
\`\`\`

\`\`\`ts
// helpers
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
\`\`\`

\`loadTypeflowMapping("./user.typeflow")\` et \`typeflow run\` importent \`./helpers\` automatiquement. Avec l'API bas niveau du runtime, passez les implémentations explicitement — l'instanciation échoue immédiatement s'il en manque une :

\`\`\`ts
createMapping(compiled, { functions: { slugify } });
\`\`\`

### Depuis votre application : \`defineFunction\`

Enregistrez des fonctions une fois, côté application — aucune ligne \`use\` nécessaire dans les mappings. Une définition se déclare comme une native : signature typée, doc, implémentation :

\`\`\`ts
import { defineFunction, compile, createMapping } from 'typeflowjs';

const slugify = defineFunction('slugify(value: string): string', {
  doc: 'Slug en minuscules, séparé par des tirets.',
  impl: (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
});

const result = compile(source, { functions: [slugify] });
const run = createMapping(result.compiled!, { functions: [slugify] });
\`\`\`

Les paramètres optionnels fonctionnent (\`clamp(n: number, max?: number): number\`), l'artefact compilé enregistre quelles fonctions le mapping appelle réellement, et \`createMapping\` échoue immédiatement s'il en manque une. \`loadTypeflowMapping(path, { functions })\` les accepte aussi.

### Essayez en direct

Le playground ne peut pas importer de fichiers, il fournit donc deux implémentations de démonstration : \`slugify\` et \`capitalize\` (notez le \`?\` — les paramètres optionnels sont pris en charge) :

::: playground
\`\`\`typeflow
input user: { firstName: string, lastName: string }

use slugify(value: string): string from "./helpers"
use capitalize(value: string): string from "./helpers"

map {
  handle: slugify(user.firstName + " " + user.lastName),
  display: capitalize(user.firstName),
}
\`\`\`
\`\`\`json
{ "firstName": "ada", "lastName": "Lovelace" }
\`\`\`
:::

Les signatures sont imposées comme pour les natives — essayez \`slugify(42)\` ci-dessus (\`TF2008\`), ou renommez un \`use\` en \`upper\` (\`TF2016\` : conflit avec une native).

## Cet exemple est volontairement cassé

Une fonction inconnue est une erreur de compilation, et le diagnostic liste ce qui est disponible :

::: playground
\`\`\`typeflow
input user: { name: string }

map {
  name: capitalizeWords(user.name),
}
\`\`\`
\`\`\`json
{ "name": "ada lovelace" }
\`\`\`
:::`;

/**
 * Body of /fr/migration/jsonata. Mirrors the English page in
 * generate-docs.ts — the conversion tables must list the same rows.
 */
export function frMigrationBody(worked: {
  jsonata: string;
  typeflow: string;
}): string {
  return `Collez un mapping JSONata dans le [playground](#playground) et récupérez du Typeflow typé équivalent. Le convertisseur traduit fidèlement le sous-ensemble déclaratif et **signale ce qu'il ne sait pas convertir** au lieu de deviner — une conversion est donc soit correcte, soit une erreur claire, jamais une surprise silencieuse.

## Ce qui se convertit

| JSONata | Typeflow | Notes |
| --- | --- | --- |
| \`{ "a": x }\`, \`[x, y]\` | \`{ a: x }\`, \`[x, y]\` | constructeurs d'objets & de tableaux |
| \`a.b.c\` | \`a.b.c\` | chemins (les noms relatifs à la racine reçoivent le préfixe de l'input) |
| \`items[price > 10]\` | \`items[price > 10]\` | prédicat / filtre |
| \`items[0]\` | \`items[0]\` | index |
| \`arr^(>a, b)\` | \`arr ^(>a, b)\` | [tri](/fr/operators/arrays#sort) ; \`>\` descendant, \`<\`/nu ascendant |
| \`a & b\` | \`(string(a) + string(b))\` | \`&\` → \`+\`, non-chaînes enveloppées dans \`string()\` |
| \`a = b\`, \`a != b\` | \`a == b\`, \`a != b\` | comparaisons |
| \`a and b\`, \`a or b\` | \`a && b\`, \`a \\|\\| b\` | logique booléenne |
| \`c ? a : b\` | \`c ? a : b\` | ternaire |
| \`v in list\` | \`count(list[$ == v]) > 0\` | appartenance à un tableau |
| \`+ - * / %\` | \`+ - * / %\` | arithmétique |
| \`$uppercase(x)\`, \`$sum(x)\` | \`upper(x)\`, \`sum(x)\` | stdlib \`$\` → même nom, sans \`$\` |
| \`$filter(a, fn($x){ p })\` | \`a[p]\` | lambda à un paramètre → [prédicat](/fr/operators/arrays#filter) |
| \`$map(a, fn($x){ o })\` | \`(a) -> $x { o }\` | lambda à un paramètre → [projection](/fr/operators/projection) |
| \`arr.{ ... }\` | \`(arr) -> { ... }\` | constructeur d'objet par élément |
| \`arr.( $v := e; { ... } )\` | \`(arr) -> { let $v = e, ... }\` | **bloc** par élément → bindings [\`let\`](/fr/operators/bindings) |
| \`( $x := e; { ... } )\` | \`{ let $x = e, ... }\` | bloc de variables retournant un objet |
| \`( $x := e; scalar )\` | le scalaire avec \`$x\` inliné | bloc de variables retournant un scalaire |
| \`arr[p]#$i.( ... )\` | \`arr[p] -> _, $i { ... }\` | [binder d'index](/fr/operators/projection#index) positionnel |
| \`$$\`, \`%\` | \`$root\`, \`$parent\` | contextes racine & parent |
| \`%.%\`, \`%.%.%\`, … | \`$parent.$parent…\` (ou \`$root\`) | parent multi-niveaux : une chaîne de \`$parent\`, ramenée à \`$root\` quand elle atteint l'input |
| \`$notInStdlib(x)\` | \`fn notInStdlib(a0) = a0\` | \`$fn\` inconnu → un mock \`fn\` + une note |

## Ce qui ne se convertit pas

Le convertisseur refuse ces formes au lieu d'émettre quelque chose de subtilement faux — chacune revient dans \`errors\`, le build échoue donc bruyamment plutôt que de livrer un mauvais mapping.

| JSONata | Pourquoi | À la place |
| --- | --- | --- |
| \`$reduce\`, \`$sift\`, \`$each\`, \`$single\` | repli / itération — pas de forme déclarative | une fonction [\`fn\`](/fr/functions/custom) ou [\`use\`](/fr/functions/custom#use) |
| \`( a; b )\` blocs d'expressions nues | séquencement sans bindings \`:=\` | restructurer en définitions [\`fn\`](/fr/functions/custom) |
| liaisons de contexte \`@$v\` | pas de portée équivalente | remodeler explicitement avec \`->\` / \`$parent\` |
| \`#$i\` hors d'une projection | l'index doit se lier à un \`->\` | le déplacer sur la projection : \`arr#$i.( ... )\` |
| jokers \`*\` / \`**\` | descente non typée | nommer les chemins explicitement |
| \`$eval\`, pictures \`$formatNumber\` | dynamique / formatage localisé | volontairement hors périmètre |

## Exemple complet

Un mapping qui exerce l'essentiel du convertisseur d'un coup : objets imbriqués et concaténation \`&\`, un bloc \`( $var := ...; { ... } )\`, des fonctions d'agrégation sur un tableau filtré, puis un pipeline \`filtre → tri → bloc par élément avec index\` dont le bloc ajoute ses propres bindings \`let\` et un niveau ternaire.

**JSONata**

\`\`\`
${worked.jsonata}
\`\`\`

**Typeflow** (exactement ce que le convertisseur émet)

\`\`\`typeflow
${worked.typeflow}
\`\`\`

Chaque ligne ci-dessus et cet exemple complet sont **convertis et vérifiés par le vrai convertisseur au moment du build de cette doc** — si une traduction était fausse, le build échouerait au lieu de la publier.

## Playground

<JsonataPlayground />`;
}

/** Body of /fr/migration/jq. Mirrors the English jq page in generate-docs.ts. */
export function frJqMigrationBody(worked: {
  jq: string;
  typeflow: string;
}): string {
  return `Utilisez cette page quand un filtre jq est surtout un mapping de données : remodelage d'objets, lectures de chemins, filtres de tableaux, projections, tris et appels de fonctions simples. Le convertisseur vise le sous-ensemble déclaratif et refuse les constructions non prises en charge au lieu de deviner.

## Ce qui se convertit

| jq | Typeflow | Notes |
| --- | --- | --- |
| \`{ a: .x }\`, \`[.x, .y]\` | \`{ a: data.x }\`, \`[data.x, data.y]\` | constructeurs d'objets & de tableaux |
| \`.a.b.c\` | \`data.a.b.c\` | les chemins relatifs à la racine reçoivent le préfixe de l'input |
| \`.items[]\` | \`data.items\` | l'itération de tableau est représentée comme la valeur tableau |
| \`.items[] \\| select(.price > 10)\` | \`data.items[price > 10]\` | \`select\` jq -> filtre Typeflow |
| \`.items[] \\| select(...) \\| .name\` | \`data.items[...].name\` | filtre puis extraction de champ |
| \`.items \\| map({ id: .id })\` | \`data.items -> { id: id }\` | \`map\` jq -> projection |
| \`.orders \\| sort_by(.total)\` | \`data.orders ^(total)\` | \`sort_by\` jq -> tri |
| \`.totals \\| add\` | \`sum(data.totals)\` | \`add\` devient une somme numérique |
| \`length\`, \`tostring\`, \`tonumber\` | \`count(x)\`, \`string(x)\`, \`number(x)\` | fonctions filtres jq -> appels Typeflow |
| \`floor\`, \`ceil\`, \`round\`, \`sqrt\` | mêmes noms | fonctions numériques |
| \`keys\`, \`reverse\`, \`unique\` | \`keys\`, \`reverse\`, \`distinct\` | helpers objets/tableaux |
| \`join\`, \`split\`, \`contains\` | mêmes noms | helpers chaînes/tableaux |
| \`== != < <= > >=\` | mêmes opérateurs | comparaisons |
| \`and\`, \`or\`, \`not\` | \`&&\`, \`\\|\\|\`, \`!\` | logique booléenne |
| \`+ - * / %\` | mêmes opérateurs | arithmétique |

## Ce qui ne se convertit pas

Les formes jq non prises en charge reviennent dans \`errors\`, pour que la génération de doc et les migrations échouent clairement plutôt que de publier un mauvais mapping.

| jq | Pourquoi | À la place |
| --- | --- | --- |
| \`reduce\`, \`foreach\`, descente récursive \`..\` | contrôle de flux itératif / récursif | une fonction [\`fn\`](/fr/functions/custom) ou [\`use\`](/fr/functions/custom#use) |
| \`as $x\`, variables, destructuring | modèle de portée pas encore équivalent | réécrire avec un \`let\` Typeflow ou une projection |
| affectations \`|=\`, \`+=\`, \`del\` | jq orienté mutation | exprimer directement l'objet de sortie attendu |
| chemins optionnels \`.a?\` et \`try/catch\` | sémantique d'erreurs différente | modéliser l'optionalité avec \`?.\` et \`??\` |
| clés dynamiques et interpolation | forme de sortie dynamique | garder des clés littérales ou utiliser une fonction personnalisée |
| modules/imports | fonctionnalité du runtime jq externe | utiliser les [fonctions personnalisées](/fr/functions/custom) Typeflow |

## Exemple complet

Un mapping jq compact qui remodèle des champs client, filtre et projette des produits, trie des commandes, et utilise \`add\` pour un total.

**jq**

\`\`\`
${worked.jq}
\`\`\`

**Typeflow** (exactement ce que le convertisseur émet)

\`\`\`typeflow
${worked.typeflow}
\`\`\`

Chaque ligne ci-dessus et cet exemple complet sont **convertis et vérifiés par le vrai convertisseur jq au moment du build de cette doc**.

## Playground

<JqPlayground />`;
}
