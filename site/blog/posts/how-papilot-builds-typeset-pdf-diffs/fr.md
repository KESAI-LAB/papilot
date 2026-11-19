Cet article suit un cycle de révision à travers le code de Papilot, de la dernière écriture de fichier par l'agent jusqu'à votre décision sur la page. Les chemins renvoient au [dépôt](https://github.com/PapilotAI/papilot) ; les chiffres proviennent de [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), mesurés sur une thèse de 240 MB utilisant XeLaTeX, BibTeX, minted et des chapitres découpés avec `\include`.

## Un arbre de travail et un instantané

Chaque tâche est un arbre de travail Git détaché, créé à partir d'un instantané du manuscrit incluant les modifications non validées (`engine/src/core/tasks.ts`). L'agent s'exécute avec cet arbre de travail comme répertoire courant et bac à sable.

Un cycle commence par l'enregistrement de l'arbre de travail sous forme d'arbre Git. Calculer les empreintes de toute une thèse à chaque cycle serait lent ; l'instantané passe donc par un fichier d'index privé, `papilot/snapshot-index`, dans le répertoire Git de l'arbre de travail (le manuscrit possède le sien, `.git/papilot/working-index`). L'index est initialisé à partir de l'instantané précédent ou de l'index du dépôt, de sorte que Git ne recalcule l'empreinte que des fichiers dont la taille ou la date de modification a changé. Chaque instantané est pris deux fois et comparé, afin qu'un fichier en cours d'enregistrement ne puisse pas produire un arbre qui n'a jamais existé sur le disque. Sur la thèse, la prise d'un instantané est passée de 2.1 s à 0.1 s.

## Compiler les deux versions

Chaque compilation s'exécute dans son propre dossier, identifié par une clé correspondant à ce qu'elle compile, pour que SyncTeX pointe toujours vers le code source exact du PDF affiché à l'écran. Partir d'un dossier vide à chaque fois ferait perdre l'état de latexmk ; un nouveau dossier repart donc du dossier précédent le plus proche (`engine/src/core/build.ts`) :

- **Choisir une base.** Parmi les 16 dernières compilations sans erreur ayant les mêmes chapitres, paramètres et version du compilateur, on retient celle dont l'arbre diffère du nouveau par le plus petit nombre de fichiers (`git diff-tree`), ou la plus récente en cas d'égalité.
- **Cloner, puis appliquer les différences.** Les sources de la base sont clonées en copie sur écriture (`cp -c -R` sur APFS). Les fichiers absents du nouvel arbre sont supprimés, ceux ayant le même objet Git et la même taille sont conservés, et le reste est extrait en flux continu via un seul `git cat-file --batch`. Les fichiers de sortie de LaTeX sont clonés avec `COPYFILE_FICLONE`. L'exportation de la thèse prend 0.76 s ; la copie de son état LaTeX, 0.06 s.
- **Conserver l'état de latexmk.** Les fichiers `.aux`, `.bbl`, `.fdb_latexmk`, le cache de minted et les autres fichiers intermédiaires sont repris (tous sauf `.fls`). Les chemins qu'ils contiennent incluent la clé de cache de 32 caractères du dossier. Comme chaque clé a la même longueur, l'ancienne clé est remplacée octet par octet, ce qui maintient la validité des décalages dans les données SyncTeX (`.synctex.gz` est décompressé puis recompressé). latexmk décide ensuite des commandes à exécuter, comme il le ferait dans votre dossier.

**Cycles par chapitre.** Lorsque le fichier principal inclut des chapitres avec `\include` et que chaque fichier modifié appartient à l'un d'eux, chaque version fait l'objet d'une unique compilation avec `\includeonly` limitée aux chapitres modifiés. Les fichiers `.aux` des autres chapitres proviennent d'une compilation complète de la base de la tâche, afin que la numérotation des équations, les références croisées et les citations restent exactes. Les deux versions compilent simultanément avec le même `SOURCE_DATE_EPOCH` (midi UTC à la date du cycle, avec `FORCE_SOURCE_DATE=1`), pour que `\today` n'apparaisse jamais comme une modification. La compilation d'un chapitre de la thèse est passée de 68.7–88.5 s (3 passes, 2 exécutions de BibTeX) à 25.8 s (1 passe).

**Avant la fin du tour.** Chaque fichier écrit par l'agent lance une compilation et une comparaison spéculatives, annulées par son écriture suivante (`engine/src/core/publish.ts`), si bien que le rendu du cycle est souvent prêt au moment où l'agent s'arrête.

**Une machine, deux exécutions TeX.** L'aperçu du manuscrit, les cycles de chaque tâche et les compilations spéculatives se partagent deux créneaux TeX sur l'ensemble des processus. Lorsqu'une exécution plus urgente attend, une moins urgente est mise en pause avec `SIGSTOP` et reprise plus tard (`engine/src/core/pool.ts`).

**Échecs.** Une compilation dont les erreurs pointent vers des fichiers résiduels dans `build/` est relancée une fois depuis un dossier propre. Si le document révisé ne compile pas, l'erreur est renvoyée à l'agent sous forme d'un nouveau tour. Si le document de référence ne compile pas, la compilation est forcée au-delà des erreurs ; en cas d'échec, le cycle n'affiche que les modifications du code source.

![Quatre étapes : prendre un instantané de la tâche dans un arbre de travail Git, compiler les deux versions à partir d'un état LaTeX préchauffé, comparer les documents composés et enregistrer chaque décision dans un journal.](/assets/blog/review-pipeline.fr.svg "Un cycle : instantané, compilation, comparaison, décision.")

## Localiser chaque modification sur la page

**Unités dans le code source.** Le calcul des différences découpe le texte en mots (en caractères pour les textes CJK). Certaines constructions restent des jetons uniques : les commentaires, les mathématiques en ligne et hors texte, les groupes entre accolades, les commandes avec leurs arguments, ainsi que les environnements tels que `equation`, `align`, `tabular`, `verbatim`, `minted` et `tikzpicture`. Les modifications séparées uniquement par des espaces ou de la ponctuation sont fusionnées, et chaque modification résultante constitue une décision associée à une plage exacte dans le code source. Les images et autres fichiers binaires forment des unités à l'échelle du fichier entier, et les blocs modifiant une même entrée `.bib` ne forment qu'une seule unité.

**Où les documents diffèrent.** Un processus de travail extrait le texte des deux PDF avec MuPDF et aligne les deux documents mot à mot (`engine/src/render/effects.ts`) : des séquences uniques de huit mots servent de points d'ancrage entre eux, la plus longue chaîne croissante de ces ancres est conservée, et les intervalles entre les ancres sont comparés. Les séquences d'au moins 20 lettres et chiffres qui ont changé de place sont signalées comme des déplacements. C'est la comparaison des documents entiers qui permet de détecter les changements à distance de la modification : chaque utilisation d'une macro redéfinie, les équations renumérotées ou une nouvelle entrée bibliographique.

**Où se trouve chaque modification.** SyncTeX, compilé en WebAssembly et indexé une seule fois par compilation, associe les anciennes lignes de chaque modification à l'ancien PDF et les nouvelles lignes au nouveau, produisant des découpes de page ; ces découpes sont arrêtées aux lignes partagées par les deux documents. Chaque modification est ensuite classée comme texte modifié, mise en page modifiée (comparaison de pixels à l'échelle 2×), déplacée, composée à l'identique ou non associée. Les changements d'encrage uniquement (police, couleur, texte décalé verticalement) et les dessins vectoriels sont comparés séparément. Les découpes qui partagent une même ligne imprimée fusionnent en une seule région, tandis que chaque modification conserve ses propres boutons Accept et Reject. Les bandes affichées à l'écran sont en SVG vectoriel.

Une modification ne portant que sur des espaces et dont le rendu composé est identique est rattachée à la modification réelle la plus proche dans le même paragraphe, sans jamais franchir une ligne vide, un `\par` ou un titre de section, tout en restant une décision distincte.

**Changements à distance de la modification (optionnel).** Lorsque l'option **Track indirect changes** est activée, les différences situées en dehors des découpes de toutes les modifications sont reliées à leur cause en compilant des variantes : d'abord les modifications sans effet visible direct, comme la définition d'une macro, puis par moitiés de l'ensemble des modifications. L'union des causes est vérifiée, jusqu'à trois emplacements sont affichés sous chaque modification, et le reste est chargé à la demande.

## Les décisions sous forme de journal

Une décision n'écrit jamais directement dans votre dossier. Chacune est enregistrée dans un journal SQLite avec les octets attendus et cibles de chaque écriture, vérifiée par rapport au disque et annulée si une étape échoue (`engine/src/core/review.ts`) :

- **Accept** enregistre la modification dans un commit privé, `refs/papilot/<task>/accepted`.
- **Reject** annule la modification dans l'arbre de travail par une fusion à trois voies, laissant intacts les passages modifiés depuis. Tant que l'agent travaille, les rejets attendent la fin de son tour.
- **Undo** annule la dernière décision.
- **Apply** fusionne les modifications acceptées dans vos fichiers de travail, là encore à trois voies. **Commit** n'écrit que les modifications de la tâche sur `HEAD` avec `git commit-tree` tout en détenant `index.lock`, après avoir vérifié que la branche n'a pas bougé, et conserve tout ce que vous aviez déjà indexé par ailleurs.

Si le manuscrit a été modifié entre-temps dans les mêmes passages, rien n'est écrasé : la proposition est rebasée sur le manuscrit actuel et revient sous la forme d'une nouvelle révision dans la même tâche.

## Le coût de l'isolation

Par rapport à `latexmk` exécuté dans une copie du même dossier :

| Modification | `latexmk` dans le dossier | Papilot |
| --- | --- | --- |
| Modifier un chapitre | 69.2 s, 1 passe | 71.2 s, 1 passe |
| Modifier un fichier non lu par TeX | 0.2 s, rien à faire | 1.9 s, aucune exécution TeX |
| Ouvrir l'article | 0.2 s, rien à faire | 71.3 s, 1 passe |

Entre la modification d'un agent et un cycle prêt à réviser, il s'est écoulé 23.1–47.2 s. Avec la compilation suivante du manuscrit anticipée pendant une révision de 150 s, le PDF était prêt 0.8 s après le commit.
