import { type FrFunctionGroup } from './types';

/** French copy for the builtin groups (titles, prose, category labels). */
export const FR_FUNCTION_GROUPS: Record<string, FrFunctionGroup> = {
  strings: {
    title: 'Chaînes de caractères',
    categories: {
      Conversion: 'Conversion',
      Inspect: 'Inspection',
      'Case & whitespace': 'Casse & espaces',
      Transform: 'Transformation',
      Encoding: 'Encodage',
    },
  },
  numbers: {
    title: 'Nombres',
    doc: "L'arrondi est de type banquier — au pair le plus proche (`round(2.5)` vaut `2`), comme en JSONata et XPath.",
    categories: {
      Conversion: 'Conversion',
      Rounding: 'Arrondi',
      Math: 'Mathématiques',
      Random: 'Aléatoire',
    },
  },
  aggregation: {
    title: 'Agrégation',
    doc: '`max`, `min` et `average` renvoient `undefined` pour un tableau vide ; `sum` renvoie `0`.',
  },
  booleans: {
    title: 'Booléens',
    doc: '`boolean` applique la véracité JSONata (les chaînes vides, `0`, les tableaux/objets vides sont faux) ; `not` la nie ; `exists` est vrai pour toute valeur autre que `undefined` (y compris `null`).',
  },
  arrays: {
    title: 'Tableaux',
    doc: "`sort`, `reverse` et `distinct` **préservent le type d'entrée** : `sort(scores)` sur un `number[]` infère `number[]`.\n\nPour transformer ou filtrer élément par élément, utiliser les constructions du langage — la [projection `->`](/fr/operators/projection) et les [filtres `[predicate]`](/fr/operators/arrays) — plutôt que les lambdas `$map`/`$filter` de JSONata.",
    categories: {
      Measure: 'Mesure',
      Combine: 'Combinaison',
      Reorder: 'Réordonnancement',
      Dedupe: 'Déduplication',
    },
  },
  objects: {
    title: 'Objets',
    doc: "`values` et `lookup` sont typés d'après les champs déclarés de l'objet — `lookup` infère l'union des types de champs.",
  },
  datetime: {
    title: 'Date & heure',
    doc: "`now()` renvoie l'horodatage ISO 8601 courant, `millis()` les millisecondes epoch ; `fromMillis`/`toMillis` convertissent entre les deux représentations.",
  },
};

/** French one-line doc for every builtin, keyed by function name. */
export const FR_FUNCTION_DOCS: Record<string, string> = {
  // ---- Chaînes de caractères ----
  string:
    'Convertit toute valeur en sa représentation textuelle (JSON pour les objets et les tableaux).',
  length: 'Nombre de caractères de la chaîne.',
  contains: 'Vrai si la chaîne contient la sous-chaîne donnée.',
  matches: "Vrai si la chaîne correspond à l'expression régulière `pattern`.",
  upper: 'Passe la chaîne en majuscules.',
  lower: 'Passe la chaîne en minuscules.',
  trim: 'Supprime les espaces en début et fin de chaîne.',
  pad: "Complète la chaîne jusqu'à `width` avec `char` (espace par défaut) ; une largeur négative complète à gauche.",
  substring:
    'Extrait `length` caractères à partir de `start` ; un début négatif compte depuis la fin.',
  split:
    'Découpe sur un séparateur, en ne gardant éventuellement que les `limit` premières parties.',
  replace: 'Remplace chaque occurrence de `pattern` par `replacement`.',
  base64encode: 'Encode la chaîne en Base64 (compatible UTF-8).',
  base64decode: 'Décode une chaîne Base64 (compatible UTF-8).',
  encodeUrl: 'Encode une URL complète (`encodeURI`).',
  decodeUrl: 'Décode une URL complète (`decodeURI`).',
  encodeUrlComponent: "Encode un composant d'URL (`encodeURIComponent`).",
  decodeUrlComponent: "Décode un composant d'URL (`decodeURIComponent`).",

  // ---- Nombres ----
  number:
    'Convertit chaînes et booléens en nombre (`undefined` si non analysable).',
  formatBase: 'Rend un entier dans la base donnée (2–36, 10 par défaut).',
  floor: "Arrondit à l'entier inférieur.",
  ceil: "Arrondit à l'entier supérieur.",
  round:
    'Arrondit à `precision` chiffres, au pair le plus proche comme JSONata.',
  abs: 'Valeur absolue.',
  power: '`base` élevé à la puissance `exponent`.',
  sqrt: 'Racine carrée (`undefined` pour une entrée négative).',
  random: 'Nombre pseudo-aléatoire dans [0, 1).',

  // ---- Agrégation ----
  sum: 'Somme des nombres (0 pour un tableau vide).',
  max: 'Plus grand nombre (`undefined` pour un tableau vide).',
  min: 'Plus petit nombre (`undefined` pour un tableau vide).',
  average: 'Moyenne arithmétique (`undefined` pour un tableau vide).',

  // ---- Booléens ----
  boolean: 'Véracité JSONata : `""`, `0`, `[]` et `{}` sont faux.',
  not: 'Véracité JSONata niée.',
  exists: 'Vrai sauf si la valeur est `undefined` (`null` existe).',

  // ---- Tableaux ----
  count: "Nombre d'éléments.",
  join: 'Concatène les chaînes avec un séparateur (`""` par défaut).',
  append: 'Concatène deux tableaux.',
  zip: 'Apparie les éléments par indice, tronqué au tableau le plus court.',
  sort: "Trie en ordre naturel croissant ; le résultat conserve le type d'entrée.",
  reverse: "Inverse l'ordre ; le résultat conserve le type d'entrée.",
  shuffle: "Permutation aléatoire ; conserve le type d'entrée.",
  distinct:
    "Supprime les doublons (égalité profonde pour les objets) ; conserve le type d'entrée.",

  // ---- Objets ----
  keys: "Noms des propriétés (fusionnés entre les éléments pour un tableau d'objets).",
  values:
    "Valeurs des propriétés, typées comme l'union des types de champs de l'objet.",
  lookup:
    "Valeur de la clé donnée (appliquée à chaque élément pour un tableau d'objets).",
  merge: "Fusionne un tableau d'objets de gauche à droite.",
  spread: "Éclate un objet en un tableau d'objets à une seule propriété.",
  type: '`"string" | "number" | "boolean" | "null" | "array" | "object" | "undefined"`.',

  // ---- Date & heure ----
  now: 'Horodatage courant, ISO 8601.',
  millis: "Horodatage courant, en millisecondes depuis l'epoch.",
  fromMillis: 'Millisecondes epoch → chaîne ISO 8601.',
  toMillis: 'Chaîne ISO 8601 (ou toute date analysable) → millisecondes epoch.',
};
