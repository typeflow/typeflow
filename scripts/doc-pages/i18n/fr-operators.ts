import { type FrOperatorPage } from './types';

/** French copy for the operators pages, keyed by page id. */
export const FR_OPERATOR_PAGES: Record<string, FrOperatorPage> = {
  literals: {
    title: 'Littéraux & objets',
    intro:
      "Les feuilles d'un bloc `map` sont des expressions. Les expressions les plus simples sont les **littéraux** — des valeurs fixes copiées telles quelles dans la sortie. Chaque exemple de cette page est interactif : modifier le mapping ou l'entrée recalcule la sortie instantanément.",
    outro:
      "Suite : [Chemins & optionnalité](/fr/operators/paths) — lire des valeurs dans l'entrée.",
    items: {
      scalar: {
        effect: 'littéraux scalaires : chaîne, nombre, booléen, null',
        doc: "Les chaînes utilisent des guillemets doubles ; les nombres, booléens et `null` s'écrivent comme en JSON.",
      },
      'array-object': {
        effect: "littéraux de tableau et d'objet",
        doc: "Les tableaux et objets littéraux peuvent mélanger valeurs fixes et expressions sur l'entrée.",
      },
      nesting: {
        effect: "la valeur d'un champ peut elle-même être un objet de champs",
        doc: 'La forme du bloc `map` reflète la forme de la sortie.',
      },
    },
  },
  paths: {
    title: 'Chemins & optionnalité',
    intro:
      "Un **chemin** lit une valeur dans l'entrée : `user.address.city`. L'entrée étant typée, chaque segment est validé à la compilation — une faute de frappe est une erreur de compilation, pas un `undefined` silencieux.",
    outro: 'Suite : [Arithmétique & chaînes](/fr/operators/arithmetic).',
    items: {
      path: {
        effect: "lire une valeur dans l'entrée",
        doc: 'Chaque segment est validé — une faute de frappe est `TF2002` avec une suggestion « vouliez-vous dire », pas un `undefined` silencieux.',
      },
      'optional-chain': {
        effect: 'requis pour les segments optionnels ou nullables',
        doc: "Si un segment peut être absent (`contact?:`) ou nullable, l'accès simple par `.` est refusé (`TF2003`). Sans valeur par défaut, une valeur possiblement `undefined` devient un **champ optionnel** du type de sortie — le champ est simplement absent du JSON de sortie quand sa valeur est `undefined`.",
      },
      default: {
        effect: "fournir un repli pour null/undefined, supprime l'optionnalité",
        doc: "Le compilateur signale aussi l'erreur inverse : utiliser `??` sur une valeur jamais nullish est l'avertissement `TF2013` — du code mort.",
      },
    },
  },
  arithmetic: {
    title: 'Arithmétique & chaînes',
    intro:
      'Les opérateurs arithmétiques travaillent sur les nombres, avec la précédence habituelle (utiliser des parenthèses pour grouper). `+` concatène aussi les chaînes — mais ne mélange jamais les deux : `string + number` est une erreur de compilation (`TF2004`), pas une coercition silencieuse.',
    outro:
      'Cet exemple est **volontairement cassé** — `+` ne fait jamais de coercition :\n\n```typeflow\ninput order: { id: number }\n\nmap {\n  label: "Order #" + order.id,\n}\n```\n\nLe formatage de types mixtes passe par une conversion explicite — `"Order #" + string(order.id)` — ou reste dans le langage hôte.\n\nSuite : [Comparaisons](/fr/operators/comparisons).',
    items: {
      add: {
        effect: 'additionner des nombres, ou concaténer des chaînes',
        doc: "Entre deux nombres, additionne. Entre deux chaînes, concatène. Mélanger une chaîne et un nombre est `TF2004` — convertir explicitement avec `string(...)` d'abord.",
      },
      subtract: {
        effect: 'soustraire des nombres',
      },
      multiply: {
        effect: 'multiplier des nombres',
      },
      divide: {
        effect: 'diviser des nombres',
      },
      modulo: {
        effect: 'reste de la division',
      },
    },
  },
  comparisons: {
    title: 'Comparaisons & logique',
    outro: 'Suite : [Conditionnelles](/fr/operators/conditionals).',
    items: {
      compare: {
        effect: 'comparer deux valeurs, produire un booléen',
        doc: "Comparer des valeurs dont les types n'ont **aucun recouvrement** — un nombre avec une chaîne, par exemple — ne peut jamais être vrai. Le compilateur avertit (`TF2367`) plutôt que de laisser le mapping renvoyer silencieusement `false` à jamais. Retirer le littéral incompatible corrige le problème — c'est un avertissement, pas une erreur, donc le mapping s'exécute quand même.",
      },
      and: {
        effect: 'ET logique — les deux opérandes doivent être booléens',
        doc: "`&&`, `||` et `!` exigent des opérandes booléens — pas de truthiness sur les chaînes ou les nombres. `user.active && user.age` est rejeté (`TF2004`) puisque `age` n'est pas booléen.",
      },
      or: {
        effect: 'OU logique — les deux opérandes doivent être booléens',
      },
      not: {
        effect: 'négation booléenne',
      },
    },
  },
  conditionals: {
    title: 'Conditionnelles',
    outro:
      'Noter le type inféré de `tier` : `"gold" | "standard"`, et pas simplement `string`.\n\nSuite : [Tableaux](/fr/operators/arrays).',
    items: {
      ternary: {
        effect: 'la seule construction de branchement',
        doc: "La condition doit être un booléen ; le type du résultat est l'**union des deux branches**. Les ternaires s'imbriquent pour exprimer des cascades — l'indentation est libre.",
      },
      'nullish-vs-ternary': {
        effect:
          "ne réagit qu'à null/undefined, pas une conditionnelle générale",
        doc: "`??` n'est pas une conditionnelle générale — il ne réagit qu'à `null`/`undefined`, tandis que `? :` branche sur n'importe quel booléen.",
      },
    },
  },
  arrays: {
    title: 'Tableaux',
    intro:
      "Typeflow n'a pas de boucles — le travail sur les tableaux se fait avec quatre constructions postfixes (distribution, `[filtre]`, `[index]`, `^(tri)`) plus la [projection](/fr/operators/projection) et les [fonctions](/fr/functions/arrays) d'agrégation.",
    outro: 'Suite : [Projection](/fr/operators/projection).',
    items: {
      distribution: {
        effect:
          "distribuer un accès de propriété sur les éléments d'un tableau",
        doc: "Accéder à une propriété **sur un tableau d'objets** distribue sur les éléments — `labels.name` sur `{ name: string }[]` produit `string[]`.",
      },
      filter: {
        effect: 'conserver les éléments satisfaisant un prédicat booléen',
        doc: "Une expression booléenne entre crochets conserve les éléments correspondants. Entre les crochets, on est en **portée d'élément** : les identifiants nus se résolvent sur l'élément. Le prédicat doit être booléen — `user.labels[name]` est rejeté (`TF2009`).",
      },
      index: {
        effect: 'accéder à un élément par index',
        doc: "L'indexation produit `element | undefined` (le tableau peut être plus court), donc tout accès ultérieur nécessite `?.`.",
      },
      sort: {
        effect: 'trier les éléments selon une ou plusieurs clés',
        doc: "Trie une copie du tableau selon chaque clé tour à tour. Les clés sont des expressions en **portée d'élément** ; préfixer une clé par `>` pour un tri descendant (`<` ou rien pour ascendant). Une clé doit être un `number` ou une `string` (`TF2011`) ; les clés nullish sont triées en dernier.",
      },
      aggregate: {
        effect: 'réduire un tableau à un scalaire',
        doc: 'Voir [Fonctions](/fr/functions/arrays) pour la liste complète des agrégats.',
      },
    },
  },
  projection: {
    title: 'Projection',
    intro:
      "`array -> { ... }` transforme **chaque élément** d'un tableau en une nouvelle forme d'objet. C'est le remplaçant de `Array.prototype.map` en Typeflow.",
    outro:
      "Les corps de projection sont des corps de map à part entière : ils peuvent imbriquer des objets, utiliser des conditionnelles, appeler des fonctions — tout ce qu'un champ de premier niveau peut faire. Utiliser un alias (`-> l { ... }`) dès qu'un champ d'élément masquerait un nom encore nécessaire, et `$root` / `$parent` pour atteindre l'extérieur depuis le corps.",
    items: {
      project: {
        effect:
          "transformer chaque élément d'un tableau en une nouvelle forme d'objet",
        doc: "Dans le corps de la projection, les identifiants nus se résolvent sur l'élément courant, et `$` est l'élément lui-même. Les constructions postfixes s'enchaînent — filtrer d'abord (`arr[bool] -> { ... }`), puis remodeler les survivants.",
      },
      element: {
        effect: "l'élément courant (requis pour les tableaux de scalaires)",
        doc: "Pour les tableaux de scalaires, `$` est le seul moyen de référencer l'élément.",
      },
      binder: {
        effect: "nommer l'élément courant",
        doc: "Comme les identifiants nus se résolvent sur l'élément courant, un champ d'élément **masque** une variable externe du même nom — y compris l'entrée. Donner à l'élément un alias explicite avec `-> alias { ... }` et référencer ses champs via l'alias ; les noms nus, l'alias et `$` restent tous disponibles, et la portée parente n'est jamais masquée.",
      },
      index: {
        effect: "nommer l'élément et sa position (base 0)",
        doc: "Un second binder capture l'**index base 0** de l'élément dans le tableau, en `number` — utile pour des ordinaux ou des identifiants séquentiels. Les deux binders se nomment : `-> el, i { ... }`. L'élément reste accessible via `$` et les champs nus ; nommer l'élément `_` quand seul l'index est utile.",
      },
      'root-parent': {
        effect: "atteindre l'entrée ou l'élément englobant",
        doc: "En restant dans le style des champs nus, `$root` atteint l'**entrée** à travers n'importe quel niveau d'imbrication — même au-delà d'un champ qui la masque — et `$parent` atteint l'élément de la projection ou du filtre **englobant**. On peut l'enchaîner — `$parent.$parent` remonte de deux niveaux, `$parent.$parent.$parent` de trois — et une chaîne qui dépasse tous les éléments englobants atterrit sur l'entrée. Au premier niveau (un seul `->`), l'élément n'a pas d'élément englobant, donc `$parent` est déjà l'entrée, comme `$root`.",
      },
    },
  },
  bindings: {
    title: 'Liaisons',
    intro:
      "`let name = expr` nomme une sous-expression au sein d'un bloc pour pouvoir la réutiliser — la version Typeflow du `$x := ...` de JSONata. Les liaisons sont immuables et n'apparaissent pas dans la sortie ; elles n'existent que pour éviter la répétition et clarifier l'intention.",
    outro:
      "Pour de la logique à réutiliser entre plusieurs mappings — pas seulement au sein d'un bloc — préférer une [fonction](/fr/functions/custom) : `fn` pour les helpers purs du langage de mapping, `use` pour les fonctions hôtes typées.",
    items: {
      let: {
        effect: 'nommer une sous-expression pour la réutiliser',
        doc: 'Une liaison `let` est visible par chaque propriété de son bloc. Elle est calculée une seule fois et se lit comme un identifiant ordinaire — `total: base + tax` au lieu de répéter les chemins sous-jacents.',
      },
      scope: {
        effect: 'les liaisons atteignent les blocs imbriqués',
        doc: "Une liaison a pour portée son bloc et chaque bloc imbriqué dedans, si bien qu'un corps de projection (ou un objet imbriqué) peut ajouter ses propres liaisons tout en voyant celles de l'extérieur.",
      },
      order: {
        effect: 'une liaison ne voit que les liaisons antérieures',
        doc: "Toutes les propriétés d'un bloc peuvent utiliser n'importe laquelle de ses liaisons, mais une liaison ne peut référencer que les liaisons déclarées **avant** elle — les références en avant et les autoréférences sont rejetées (`TF2001`), ce qui garantit que les mappings terminent. Deux liaisons du même nom dans un bloc constituent une erreur (`TF2018`).",
      },
    },
  },
};
