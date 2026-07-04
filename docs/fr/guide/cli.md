# CLI

[[toc]]

Toutes les commandes acceptent des motifs glob ; le défaut est `**/*.typeflow` (hors `node_modules`).

| Commande          | Effet                                                        |
| ----------------- | ------------------------------------------------------------ |
| [`check`](#check) | analyse complète, diagnostics façon tsc — le pilier de la CI |
| [`infer`](#infer) | affiche le type de sortie inféré d'un mapping                |
| [`types`](#types) | émet les déclarations `.d.typeflow.ts`, ou les vérifie en CI |
| [`run`](#run)     | compile et exécute un mapping                                |
| [`fmt`](#fmt)     | réécrit les mappings sous forme canonique                    |
| [`watch`](#watch) | re-vérifie et régénère les déclarations à chaque changement  |
| [`init`](#init)   | génère un mapping d'exemple                                  |

## `typeflow check [motifs...]` {#check}

Analyse complète avec diagnostics façon tsc. Sortie non nulle en cas d'erreur — le pilier de la CI.

```console
$ typeflow check
user.typeflow:4:11 - error TF2002: Property 'emial' does not exist on type
'{ email: string }'. Did you mean 'email'?
```

## `typeflow infer <fichier>` {#infer}

Affiche le type de sortie inféré d'un mapping. L'outil exploratoire « qu'est-ce que ça produit ? ».

## `typeflow types [motifs...] [--check]` {#types}

Émet les fichiers de déclaration `.d.typeflow.ts` à côté de chaque mapping (convention `allowArbitraryExtensions` de TypeScript). `--check` vérifie que les déclarations commitées sont à jour et sort en erreur en cas de dérive — le garde-fou de la CI.

## `typeflow run <fichier> [--input data.json]` {#run}

Compile et exécute un mapping ; l'entrée vient de `--input` ou de stdin, la sortie est affichée en JSON. Idéal pour déboguer et pour les transformations ponctuelles.

## `typeflow fmt [motifs...] [--check]` {#fmt}

Réécrit les mappings sous forme canonique. `--check` sort en erreur si un fichier n'est pas déjà formaté.

## `typeflow watch [motifs...]` {#watch}

Re-vérifie et régénère les déclarations dès qu'un fichier `.typeflow` ou `.ts` change. Ce qu'on laisse tourner pendant le développement.

## `typeflow init` {#init}

Génère un mapping d'exemple (`user.typeflow`) et son module de types dans le répertoire courant.

## Recette CI

```yaml
- run: bun install --frozen-lockfile
- run: bunx typeflow check
- run: bunx typeflow types --check
```
