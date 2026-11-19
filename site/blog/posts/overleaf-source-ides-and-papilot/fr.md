Presque chaque équipe de recherche finit par trouver un compromis tacite autour de LaTeX. Un coauteur préfère un onglet de navigateur accessible partout sans installer quatre gigaoctets de distribution TeX ; un autre vit dans un éditeur de code local relié à Git, à ses raccourcis clavier et à un agent de codage ; un troisième imprime le PDF compilé – ou l'ouvre sur une tablette – parce que seules les pages véritablement composées révèlent les transitions fragiles, les tableaux surchargés et les notations qui ont glissé.

Lorsqu'on cherche aujourd'hui un environnement LaTeX assisté par l'IA, ce ne sont presque jamais les modèles de langage qui font défaut. Les agents de codage actuels naviguent déjà sans peine dans des dépôts multi-fichiers, suivent des macros personnalisées et réparent les entrées `.bib`. Ce qui détermine réellement la qualité du travail quotidien, c'est le **contrat de l'espace de travail** construit autour du modèle : l'endroit où vous exprimez ce qui doit changer, la manière dont vous vérifiez ce que l'IA a modifié, et la question de savoir si l'adoption d'un meilleur outil oblige vos coauteurs à renoncer au leur.

Plutôt que de prétendre qu'un outil unique remplace tous les autres en toutes circonstances, il est plus éclairant de comparer côte à côte les trois grands flux de travail LaTeX – les éditeurs web en écran partagé tels qu'Overleaf, les IDE locaux couplés à des agents de codage et l'espace de travail centré sur le PDF de [Papilot](https://github.com/PapilotAI/papilot) – et de voir comment la synchronisation en direct leur permet de cohabiter sur un même manuscrit.

## Ce que les flux de travail LaTeX existants font très bien

Avant d'examiner où l'édition par IA centrée sur le code source atteint ses limites, il convient de saluer les raisons pour lesquelles Overleaf et les éditeurs de code locaux se sont imposés dans l'écriture académique.

**Overleaf a résolu l'accueil des collaborateurs.** Avant le TeX dans le navigateur, entamer un article entre plusieurs institutions impliquait souvent de déboguer des millésimes discordants de TeX Live, des paquets `.sty` manquants et des conflits de fusion Git avant même d'avoir rédigé le moindre résumé. Partager un lien de projet où chacun écrit dans son navigateur et voit instantanément les curseurs caractère par caractère demeure le moyen le plus fluide de réunir une équipe hétérogène, surtout depuis des machines dépourvues d'installation TeX locale.

**Les IDE locaux ont résolu le passage à l'échelle et l'automatisation.** Associer VS Code et LaTeX Workshop – ou Cursor, Neovim et des agents en terminal comme Claude Code ou Codex – à un dépôt Git local offre aux auteurs une recherche instantanée à travers tout le projet, une compilation hors ligne via `latexmk`, des scripts de génération reproductibles et une maîtrise directe lors de l'écriture de classes `.cls`, de paquets `.sty` ou de figures TikZ programmées.

Ces deux approches se heurtent toutefois au même point de friction : **la révision de modifications substantielles apportées par l'IA à une argumentation ou à une démonstration**.

![Comparaison côte à côte de trois flux de travail LaTeX : l'écran partagé d'Overleaf dans le navigateur, un IDE de code source avec agent de codage, et l'espace de travail centré sur le PDF de Papilot avec synchronisation Overleaf en direct.](/assets/blog/three-workflows.fr.svg "Overleaf excelle dans la coédition immédiate au navigateur et les IDE locaux dans l'édition du balisage brut, tandis que Papilot replace la révision IA sur le PDF compilé tout en se synchronisant en direct avec Overleaf.")

Dans un écran partagé au navigateur comme dans un IDE de code, l'assistant d'IA modifie le balisage `.tex` et présente sa proposition sous la forme d'un diff de code rouge et vert. Sur un paragraphe remanié d'une ligne à l'autre, ou sur une dérivation `\begin{align}` de plusieurs lignes utilisant les macros propres au projet, lire ce correctif revient à compiler mentalement du LaTeX – ou à recompiler tout le PDF avant de partir à la chasse aux changements subtils glissés à la page neuf.

## Comparer les trois flux de travail selon six dimensions

Le tableau ci-dessous résume la manière dont chaque environnement aborde la rédaction quotidienne, les révisions par IA, la vérification et la collaboration.

| Dimension du flux de travail | Overleaf (éditeur au navigateur) | IDE de code source + agent (VS Code, Cursor, CLI) | Papilot (espace agentique centré sur le PDF) |
| --- | --- | --- | --- |
| Espace de travail principal | Écran partagé : éditeur `.tex` à gauche, aperçu PDF compilé à droite | Arborescence `.tex` et volets de code, avec un onglet secondaire d'aperçu PDF | Le manuscrit PDF compilé lui-même ; le code source reste consultable à la demande |
| Guider les modifications de l'IA | Copier des extraits dans la discussion ou formuler un prompt dans le tampon `.tex` | Cibler par chemin de fichier, plage de lignes ou sélection de code `.tex` | Surligner du texte ou encadrer formules et figures directement sur le PDF ; SyncTeX cible les lignes sources exactes |
| Réviser les modifications de l'IA | Inspecter le code `.tex` brut ou recompiler puis parcourir visuellement le nouveau PDF | `git diff` ligne par ligne sur le balisage LaTeX brut | Comparaisons avant/après composées sur place dans le PDF, avec variantes par note et bascule vers le code source |
| Collaboration entre coauteurs | Édition temps réel native au navigateur via liens de projet ou de partage | Push/pull Git ; frictions lorsque des coauteurs préfèrent Overleaf | Worktrees Git intégrés **plus** synchronisation Overleaf bidirectionnelle en direct (~1 s) |
| Choix des modèles et agents d'IA | Options d'assistance liées à la plateforme | Lié à l'éditeur de l'IDE ou à un outil CLI configuré | Vos propres identifiants ou clés sur 16 agents : Papilot Writer intégré et 15 agents de code (Codex, Claude, Cursor, Copilot, Antigravity, Pi, OpenCode, etc.) |
| Installation, fichiers et licence | Projet hébergé dans le cloud ; aucune installation TeX locale requise | Fichiers texte brut locaux + Git + distribution TeX | Fichiers texte brut locaux + Git + distribution TeX ; gratuit et open source (MIT) |

## Collaborer sans obliger ses coauteurs à changer d'outil

La raison la plus fréquente pour laquelle les chercheurs hésitent à adopter un outil LaTeX local n'a rien à voir avec ses fonctionnalités : *« Mon directeur de thèse et trois coauteurs travaillent déjà sur Overleaf. »* Exporter une archive ZIP, lancer une révision par IA en local, puis recoller les fichiers `.tex` modifiés dans un onglet du navigateur conduit presque aussitôt à écraser des paragraphes rédigés entre-temps.

Depuis Papilot 0.11, **Synchroniser avec Overleaf** (Sync with Overleaf) lève ce dilemme. Vous pouvez coller un lien de projet Overleaf – ou un lien de partage avec droits d'édition – directement dans Papilot, ou relier un dossier de manuscrit local existant à son homologue sur Overleaf. Tant que Papilot est ouvert, les fichiers locaux et le projet Overleaf avancent de concert grâce au service d'édition en temps réel d'Overleaf :

- **Allers-retours en moins d'une seconde.** Les modifications que vous acceptez et appliquez dans Papilot apparaissent dans les onglets Overleaf de vos coauteurs en environ une seconde, et ce qu'ils saisissent sur Overleaf redescend aussitôt dans vos fichiers `.tex` locaux et votre PDF compilé.
- **Fusion simultanée caractère par caractère.** Les modifications apportées au même paragraphe au même instant fusionnent caractère par caractère, exactement comme entre deux onglets de navigateur sur Overleaf.
- **Aucune option Git payante requise.** La synchronisation en direct fonctionne avec un compte Overleaf gratuit standard (et prend également en charge les instances Overleaf auto-hébergées), tout en vous permettant d'isoler les tâches d'IA dans des worktrees Git locaux avant que quoi que ce soit ne touche le brouillon partagé.

![Aperçu produit de Papilot montrant une comparaison avant/après composée directement sur la page PDF, accompagnée des actions accepter, refuser et commenter.](/assets/blog/review.en.png "Révisez chaque modification proposée par l'IA sous forme de comparaison avant/après mise en page avant qu'elle ne soit appliquée au projet Overleaf partagé.")

L'ouverture d'un manuscrit est tout aussi directe : **Importer ou ouvrir** accepte les URL d'articles arXiv (liens vers le résumé, le PDF ou la version HTML), les liens de lecture ou d'édition Overleaf ainsi que les URL de dépôts GitHub publics, en détectant automatiquement le fichier `.tex` principal et le moteur de compilation. Pour partir d'une feuille blanche, [Papilot Universe](https://papilot.ai/universe/) rassemble des modèles prêts à compiler pour revues, thèses, présentations, posters, CV, livres et plus de 400 conférences.

## Choisir le bon outil à chaque étape d'un article

Parce que Papilot travaille directement sur des fichiers `.tex` et `.bib` standards enregistrés sur votre disque, ces trois flux de travail se complètent au lieu de s'exclure :

1. **Ouvrez Overleaf dans le navigateur** lorsque vous êtes loin d'une machine équipée de TeX, que vous corrigez rapidement quelques tournures sur un ordinateur emprunté ou que vous invitez des collaborateurs qui ne souhaitent aucune configuration locale.
2. **Passez sur un IDE de code source** lorsque vous concevez des feuilles de style `.sty` sur mesure, déboguez des expansions de macros de bas niveau ou orchestrez des scripts Python ou R qui génèrent automatiquement des tableaux `.tex`.
3. **Travaillez dans Papilot** lorsque vous rédigez, restructurez, vérifiez des démonstrations et polissez le manuscrit avec des agents d'IA – là où désigner directement la page composée et réviser chaque proposition sous forme de comparaison PDF avant/après préserve l'acuité du jugement scientifique et protège le brouillon commun jusqu'à ce que vous appliquiez explicitement vos décisions.

Vous pouvez explorer dès maintenant la boucle d'annotation PDF et de révision typographique directement dans votre navigateur grâce à notre [démonstration interactive](/demo/), sans installer TeX ni configurer de modèle. Si ce flux de travail correspond à votre manière d'écrire vos articles, téléchargez l'application de bureau pour macOS, Windows ou Linux sur [papilot.ai](/fr/) – et pensez à [donner une étoile à Papilot sur GitHub](https://github.com/PapilotAI/papilot) pour le retrouver facilement à l'approche de votre prochaine échéance.
