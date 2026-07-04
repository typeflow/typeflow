import { type FrDiagnostic } from './types';

/** French copy for every diagnostic, keyed by code. */
export const FR_DIAGNOSTICS: Record<string, FrDiagnostic> = {
  TF1001: {
    title: 'Erreur lexicale',
    doc: 'La source contient du texte que le lexer ne peut pas transformer en tokens — le plus souvent une chaîne non terminée ou un caractère qui ne fait pas partie du langage.',
    fix: 'Fermer la chaîne (ou supprimer le caractère parasite). Le caret pointe sur l’offset exact.',
  },
  TF1002: {
    title: 'Erreur de parsing',
    doc: 'Les tokens ne forment pas un mapping valide — un `:` manquant, un `{` non fermé, une virgule mal placée. Le parsing s’arrête à la première erreur structurelle : la corriger puis relancer la vérification, les erreurs suivantes peuvent disparaître.',
    fix: 'Le message indique ce que le parser attendait à cette position.',
  },
  TF2001: {
    title: 'Identifiant inconnu',
    doc: 'Un nom nu ne correspond à rien dans la portée : ni le binding d’entrée, ni un champ d’élément de projection, ni un paramètre de fonction. Typeflow suggère le nom visible le plus proche.',
    fix: 'Vérifier l’orthographe par rapport à la déclaration `input` (ou à la projection englobante).',
  },
  TF2002: {
    title: 'Propriété inconnue',
    doc: 'La vérification phare : un segment de chemin n’existe pas sur le type depuis lequel il est lu. En code classique, cette faute de frappe serait un `undefined` silencieux en production — ici c’est une erreur à la compilation avec une suggestion « did you mean ».',
    fix: 'Corriger l’orthographe, ou mettre à jour le type d’entrée si les données possèdent réellement ce champ.',
  },
  TF2003: {
    title: 'Accès non sûr à travers une valeur optionnelle',
    doc: 'Un chemin traverse avec un simple `.` un segment qui peut être `undefined` ou `null` (déclaré `?:` ou nullable). La même règle protège les projections `->` et les filtres/indexations `[...]` sur des cibles potentiellement nullish.',
    fix: 'Utiliser l’opérateur d’accès optionnel (`?.`), ou fournir d’abord une valeur par défaut avec `??`. Une valeur par défaut `??` *supprime* aussi l’optionnalité du type de sortie inféré.',
  },
  TF2004: {
    title: 'Incompatibilité opérateur / type',
    doc: 'Un opérateur a reçu des opérandes qu’il n’accepte pas : `+` entre une chaîne et un nombre (Typeflow ne fait jamais de coercition), de l’arithmétique sur des non-nombres, `!`/`&&`/`||` sur des non-booléens, une condition `? :` non booléenne, des comparaisons d’ordre entre types mélangés.',
    fix: 'Convertir explicitement — `string(user.age)`, `number(raw)` — pour que l’intention soit visible dans le mapping.',
  },
  TF2005: {
    title: 'Filtre ou index sur un non-tableau',
    doc: 'L’opérateur `[...]` (filtrage avec un prédicat, ou indexation avec un nombre) a été appliqué à quelque chose qui n’est pas un tableau.',
    fix: 'Vérifier le chemin — le segment avant `[` doit être un tableau du type d’entrée.',
  },
  TF2006: {
    title: 'Accès à une propriété ou cible de projection invalide',
    doc: 'Une propriété a été lue sur un scalaire (`number`, `string`, `boolean`), ou une projection `->` a été appliquée à quelque chose qui n’est ni un objet ni un tableau d’objets.',
    fix: 'Suivre le type inféré du côté gauche — le message montre exactement sur quel type l’accès a été tenté.',
  },
  TF2007: {
    title: 'Fonction inconnue',
    doc: 'Un appel nomme une fonction qui n’est ni une [fonction native](/fr/functions/), ni une [définition `fn`](/fr/functions/custom), ni une déclaration [`use`](/fr/functions/custom#use), ni une fonction enregistrée via [`defineFunction`](/fr/functions/custom). L’indication liste tout ce qui *est* disponible.',
    fix: 'Choisir dans la liste de l’indication, ou déclarer la fonction (`fn`, `use` ou `defineFunction`).',
  },
  TF2008: {
    title: 'Arguments de fonction incorrects',
    doc: 'Une fonction a été appelée avec un mauvais nombre d’arguments, ou avec un argument dont le type ne correspond pas au paramètre. L’indication rappelle la signature complète. S’applique aussi bien aux fonctions natives qu’à vos propres fonctions `fn` / `use` / `defineFunction`.',
    fix: 'Respecter la signature — convertir les arguments explicitement quand nécessaire (`upper(string(user.age))`).',
  },
  TF2009: {
    title: 'Prédicat de filtre non booléen',
    doc: 'L’expression à l’intérieur d’un filtre `[...]` doit être un booléen. Les identifiants nus dans un filtre se résolvent sur l’*élément* : `labels[active]` fonctionne quand `active` est un champ booléen — mais `labels[name]` est une chaîne, pas un prédicat.',
    fix: 'Écrire une vraie condition : `labels[name == "core"]`.',
  },
  TF2010: {
    title: 'Type d’entrée non résolu',
    doc: 'Une déclaration `input x: T from "./module"` n’a pas pu être résolue : aucun adaptateur de schéma n’est configuré, le module n’existe pas, ou il n’exporte pas ce type. (Le playground ne peut pas importer de fichiers — cet exemple montre le diagnostic lui-même ; dans un projet, l’adaptateur TypeScript résout le type via l’API du compilateur.)',
    fix: 'Vérifier le chemin du module et le nom du type exporté — ou utiliser un type structurel inline.',
  },
  TF2011: {
    title: 'Clé de tri invalide',
    doc: 'Une clé de tri `^(...)` doit s’évaluer en `number` ou en `string` — les booléens, objets et tableaux n’ont pas d’ordre significatif. Les clés nullish sont acceptées : le runtime les trie en dernier.',
    fix: 'Trier sur un champ scalaire, ou en dériver un — `^(length(name))`.',
  },
  TF2012: {
    title: "Accès à une propriété sur 'unknown'",
    doc: 'Une valeur typée `unknown` ne peut pas être déréférencée — contrairement à `any`, `unknown` signifie « je ne promets rien sur cette forme », et Typeflow vous y tient.',
    fix: 'Affiner le type dans la déclaration d’entrée, ou transmettre la valeur telle quelle.',
  },
  TF2013: {
    title: "'??' inutile (jamais nullish)",
    doc: 'Le côté gauche de `??` ne peut jamais être `null` ou `undefined`, donc la valeur de repli est du code mort. Souvent un reliquat après qu’un type d’entrée a gagné un champ requis — le compilateur le signale pour que les mappings n’accumulent pas de scories.',
    fix: 'Supprimer le `?? default`, ou rendre le champ d’entrée optionnel s’il peut réellement être absent.',
  },
  TF2014: {
    title: 'Propriété dupliquée',
    doc: 'La même clé apparaît deux fois dans le corps d’un objet. JSON garderait silencieusement la dernière — Typeflow refuse l’ambiguïté.',
    fix: 'Supprimer ou renommer l’une des deux.',
  },
  TF2015: {
    title: "Aucune déclaration 'input'",
    doc: 'Sans déclaration `input`, l’entrée est typée `any` : le mapping s’exécute quand même, mais les chemins ne peuvent pas être validés — on perd tout l’intérêt du langage.',
    fix: 'Lier l’entrée : `input user: T from "./module"`, ou un type structurel inline.',
  },
  TF2016: {
    title: 'Conflit de nom de fonction',
    doc: 'Une définition `fn`, une déclaration `use` ou une fonction enregistrée porte le même nom qu’une fonction native ou qu’une autre fonction. Un nom, un sens — masquer les fonctions natives ferait signifier des choses différentes aux mappings selon le projet.',
    fix: 'Renommer votre fonction.',
  },
  TF2017: {
    title: "Type de retour de 'fn' incompatible",
    doc: 'Un `fn` déclare un type de retour, mais son corps s’évalue en quelque chose qui n’est pas assignable à ce type. Le type déclaré est un contrat — le corps doit le satisfaire.',
    fix: 'Corriger le corps, ou corriger (ou supprimer) le type de retour déclaré — il est optionnel et inféré depuis le corps.',
  },
  TF2018: {
    title: 'Binding dupliqué',
    doc: 'Deux bindings `let` du même bloc objet partagent un nom. Un binding ne voit que les bindings déclarés avant lui : redéfinir un nom dans le même bloc est ambigu — Typeflow le refuse.',
    fix: 'Renommer l’un des bindings.',
  },
  TF2367: {
    title: 'Comparaison sans recouvrement',
    doc: 'Les deux côtés d’une comparaison ont des types qui ne peuvent jamais être égaux — un `number` comparé à une `string`, par exemple. La comparaison est légale mais toujours `false`, ce qui est presque toujours un bug : Typeflow ne fait jamais de coercition, donc `age == "36"` ne fait pas ce qu’il ferait en JavaScript. (Même numéro que le TS2367 de TypeScript, à dessein.)',
    fix: 'Comparer avec le bon type — `user.age == 36` — ou convertir explicitement avec `string()` / `number()`.',
  },
};
