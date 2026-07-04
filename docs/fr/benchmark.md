---
aside: false
outline: false
---

<div class="tf-wide"></div>

# Benchmark

La même transformation, trois moteurs, mesurée **dans votre navigateur, sur votre machine** — aucun chiffre précuit. Chaque scénario est écrit comme un mapping Typeflow, une expression JSONata équivalente, et une fonction JavaScript écrite à la main (le plafond natif). Choisissez une taille de tableau, lancez, comparez.

Deux garanties avant d'afficher le moindre chiffre :

- **Les trois implémentations produisent une sortie identique.** C'est vérifié au build de cette doc (un écart fait échouer le build) _et_ revérifié dans votre navigateur juste avant chaque mesure.
- **Les coûts uniques sont séparés.** Typeflow est compilé une fois et JSONata parsé une fois — les barres comparent l'exécution par appel, ce qui compte quand un mapping tourne à chaque requête. Le coût unique est indiqué sous les résultats.

<ClientOnly><Benchmark /></ClientOnly>

## Les petites lignes

- C'est un **microbenchmark** : il mesure ces transformations sur des données synthétiques, pas votre charge réelle. Les ratios sont indicatifs, pas absolus.
- La boucle de mesure est adaptative (≈250 ms de temps _actif_ par moteur, après échauffement) et rend la main à l'interface entre les lots — le temps d'attente est exclu du calcul.
- Le `evaluate()` de JSONata v2 est asynchrone : ses chiffres incluent le surcoût des promesses, inhérent à son API. Le runtime Typeflow et la fonction native sont synchrones.
- Les résultats varient selon votre matériel, votre navigateur et la charge du moment. Lancez plusieurs fois.
- La fonction écrite à la main est la borne haute honnête : elle fait exactement le travail, sans interprétation. L'interpréteur Typeflow parcourt un IR compilé ; l'écart avec le natif est le prix d'un artefact sérialisable et sandboxable.
