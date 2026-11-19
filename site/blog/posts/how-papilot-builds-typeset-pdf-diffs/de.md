Dieser Beitrag begleitet eine Review-Runde durch den Code von Papilot, vom letzten Schreibvorgang des Agenten bis zu Ihrer Entscheidung auf der gesetzten Seite. Pfade beziehen sich auf das [Repository](https://github.com/PapilotAI/papilot); die Messwerte stammen aus [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), gemessen an einer 240 MB großen Dissertation mit XeLaTeX, BibTeX, minted und über `\include` aufgeteilten Kapiteln.

## Ein Worktree und ein Snapshot

Jede Aufgabe ist ein losgelöster Git-Worktree, der aus einem Snapshot des Manuskripts einschließlich noch nicht committeter Änderungen erstellt wird (`engine/src/core/tasks.ts`). Der Agent läuft mit diesem Worktree als Arbeitsverzeichnis und Sandbox.

Eine Runde beginnt damit, den Worktree als Git-Tree festzuhalten. Eine ganze Dissertation in jeder Runde neu zu hashen wäre langsam; deshalb läuft der Snapshot über eine eigene Indexdatei, `papilot/snapshot-index` im Git-Verzeichnis des Worktrees (das Manuskript besitzt eine eigene unter `.git/papilot/working-index`). Der Index wird aus dem vorherigen Snapshot oder aus dem Index des Repositories vorbelegt, sodass Git nur Dateien neu hasht, deren Größe oder Änderungszeitpunkt sich geändert hat. Jeder Snapshot wird zweimal erstellt und verglichen, damit eine halb geschriebene Datei keinen Tree erzeugen kann, der so nie auf der Festplatte existierte. Bei der Dissertation sank die Dauer eines Snapshots dadurch von 2.1 s auf 0.1 s.

## Beide Seiten kompilieren

Jeder Build läuft in einem eigenen Ordner, benannt nach einem Schlüssel dessen, was er kompiliert, sodass SyncTeX immer genau auf den Quelltext des angezeigten PDFs verweist. Würde jeder Ordner leer beginnen, ginge der Zustand von latexmk verloren; daher baut ein neuer Ordner auf dem ähnlichsten vorherigen auf (`engine/src/core/build.ts`):

- **Basis auswählen.** Aus den letzten 16 fehlerfreien Builds mit denselben Kapiteln, Compilereinstellungen und derselben Compilerversion wird derjenige gewählt, dessen Tree sich in den wenigsten Dateien vom neuen unterscheidet (`git diff-tree`), bei Gleichstand der neuere.
- **Klonen, dann patchen.** Die Quelldateien der Basis werden per Copy-on-Write geklont (`cp -c -R` auf APFS). Dateien außerhalb des neuen Trees werden entfernt, Dateien mit identischem Git-Objekt und gleicher Größe bleiben erhalten, und der Rest wird aus einem einzigen `git cat-file --batch` gestreamt. Die Ausgabedateien von LaTeX werden mit `COPYFILE_FICLONE` geklont. Das Exportieren der Dissertation dauert 0.76 s, das Kopieren des LaTeX-Zustands 0.06 s.
- **Zustand von latexmk übernehmen.** `.aux`, `.bbl`, `.fdb_latexmk`, der minted-Cache und die übrigen Hilfsdateien werden übernommen (alle außer `.fls`). Darin enthaltene Pfade tragen den 32 Zeichen langen Cache-Schlüssel des Ordners. Da jeder Schlüssel gleich lang ist, wird der alte Schlüssel Byte für Byte ersetzt, wodurch die Offsets in den SyncTeX-Daten gültig bleiben (`.synctex.gz` wird entpackt und wieder gepackt). Anschließend entscheidet latexmk wie in Ihrem eigenen Projektordner, welche Läufe nötig sind.

**Kapitelrunden.** Wenn die Hauptdatei Kapitel per `\include` einbindet und jede geänderte Datei zu einem dieser Kapitel gehört, wird auf beiden Seiten nur ein `\includeonly`-Build der geänderten Kapitel ausgeführt. Die `.aux`-Dateien der übrigen Kapitel stammen aus einem vollständigen Build der Aufgabenbasis, sodass Gleichungsnummern, Querverweise und Zitate stimmen. Beide Seiten kompilieren gleichzeitig mit derselben `SOURCE_DATE_EPOCH` (12:00 Uhr UTC am Tag der Runde, mit `FORCE_SOURCE_DATE=1`), damit `\today` nie als Änderung erscheint. Ein Kapitel-Build der Dissertation verkürzte sich von 68.7–88.5 s (3 Durchläufe, 2 BibTeX-Läufe) auf 25.8 s (1 Durchlauf).

**Noch während der Agent arbeitet.** Jede Datei, die der Agent schreibt, startet einen spekulativen Build und Vergleich, der beim nächsten Schreibvorgang abgebrochen wird (`engine/src/core/publish.ts`). Dadurch ist die Runde oft schon fertig gerendert, sobald der Agent seinen Zug beendet.

**Ein Rechner, zwei TeX-Läufe.** Die Manuskriptvorschau, die Runden aller Aufgaben und die spekulativen Builds teilen sich prozessübergreifend zwei TeX-Slots. Wartet ein dringenderer Lauf, wird ein weniger dringender mit `SIGSTOP` pausiert und später fortgesetzt (`engine/src/core/pool.ts`).

**Fehlerfälle.** Ein Build, dessen Fehlermeldungen auf verbliebene Dateien unter `build/` zeigen, wird einmal in einem frischen Ordner wiederholt. Kompiliert das überarbeitete Dokument nicht, geht der Fehler als neuer Zug zurück an den Agenten. Kompiliert die Ausgangsversion nicht, wird sie über ihre Fehler hinweg kompiliert; schlägt auch das fehl, zeigt die Runde nur Änderungen im Quelltext.

![Vier Phasen: Snapshot der Aufgabe in einem Git-Worktree erstellen, beide Seiten aus einem warmen LaTeX-Zustand kompilieren, die gesetzten Dokumente vergleichen und jede Entscheidung in einem Journal festhalten.](/assets/blog/review-pipeline.de.svg "Eine Runde: Snapshot, Build, Vergleich, Entscheidung.")

## Jede Änderung auf der Seite finden

**Einheiten im Quelltext.** Der Diff zerlegt Fließtext in Wörter (in CJK-Texten in einzelne Zeichen). Bestimmte Konstrukte bleiben einzelne Tokens: Kommentare, Inline- und abgesetzte Mathematik, Klammergruppen, Befehle samt Argumenten sowie Umgebungen wie `equation`, `align`, `tabular`, `verbatim`, `minted` und `tikzpicture`. Änderungen, die nur durch Leerzeichen oder Satzzeichen getrennt sind, werden zusammengefasst; jede resultierende Änderung bildet eine Entscheidung mit exaktem Quelltextbereich. Bilder und andere Binärdateien gelten jeweils als ganze Datei, und Änderungen am selben `.bib`-Eintrag bilden eine gemeinsame Einheit.

**Wo sich die Dokumente unterscheiden.** Ein Worker-Prozess extrahiert den Text beider PDFs mit MuPDF und richtet die beiden Dokumente Wort für Wort aneinander aus (`engine/src/render/effects.ts`): Eindeutige Folgen von acht Wörtern verankern sie miteinander, die längste aufsteigende Kette dieser Anker bleibt erhalten, und die Lücken zwischen den Ankern werden per Diff verglichen. Folgen von mindestens 20 Buchstaben und Ziffern, die an eine andere Stelle gewandert sind, werden als Verschiebungen ausgewiesen. Erst der Vergleich der gesamten Dokumente macht Änderungen sichtbar, die fernab der eigentlichen Editierstelle auftreten: jede Verwendung eines umdefinierten Makros, neu nummerierte Gleichungen oder ein neuer Literaturverweis.

**Wo jede Änderung liegt.** SyncTeX, nach WebAssembly kompiliert und einmal pro Build indiziert, bildet die alten Zeilen jeder Änderung auf das alte PDF und die neuen Zeilen auf das neue PDF ab und liefert so Seitenausschnitte; beschnitten wird an Zeilen, die in beiden Dokumenten übereinstimmen. Jede Änderung wird anschließend klassifiziert als geänderter Text, geändertes Layout (Pixelvergleich bei 2×), verschoben, identisch gesetzt oder nicht zuordenbar. Reine Darstellungsänderungen (Schrift, Farbe, hoch- oder tiefgestellter Text) und Vektorgrafiken werden separat verglichen. Ausschnitte, die sich eine gedruckte Zeile teilen, verschmelzen zu einem Bereich, während jede Änderung ihre eigenen Schaltflächen für Accept und Reject behält. Die Streifen auf dem Bildschirm sind Vektor-SVGs.

Eine reine Whitespace-Änderung mit identischem Satzbild wird an die nächstgelegene echte Änderung im selben Absatz gehängt, niemals jedoch über eine Leerzeile, ein `\par` oder eine Abschnittsüberschrift hinweg, und bleibt eine eigene Entscheidung.

**Änderungen fernab der Editierstelle (optional).** Ist **Track indirect changes** aktiviert, werden Abweichungen außerhalb der Ausschnitte aller direkten Änderungen auf ihre Ursache zurückgeführt, indem Varianten kompiliert werden: zuerst die Änderungen ohne eigene sichtbare Wirkung, etwa eine Makrodefinition, danach jeweils Hälften der Änderungsmenge. Die Vereinigung der Ursachen wird verifiziert, bis zu drei Fundstellen werden unter jeder Änderung eingeblendet, die übrigen bei Bedarf nachgeladen.

## Entscheidungen als Journal

Eine Entscheidung schreibt niemals direkt in Ihren Projektordner. Jede Entscheidung wird in einem SQLite-Journal mit den erwarteten und den zu schreibenden Bytes jedes Schreibvorgangs protokolliert, gegen die Festplatte geprüft und zurückgerollt, falls ein Schritt fehlschlägt (`engine/src/core/review.ts`):

- **Accept** speichert die Änderung in einem privaten Commit unter `refs/papilot/<task>/accepted`.
- **Reject** nimmt die Änderung im Worktree per Drei-Wege-Merge zurück, sodass inzwischen bearbeitete Textstellen unangetastet bleiben. Solange der Agent arbeitet, warten Ablehnungen, bis sein Zug beendet ist.
- **Undo** nimmt die letzte Entscheidung zurück.
- **Apply** führt die angenommenen Änderungen ebenfalls per Drei-Wege-Merge mit Ihren Arbeitsdateien zusammen. **Commit** schreibt mit `git commit-tree` bei gehaltenem `index.lock` ausschließlich die Änderungen der Aufgabe auf `HEAD`, nachdem geprüft wurde, dass sich der Branch nicht weiterbewegt hat, und lässt alles andere, was Sie bereits für einen Commit vorgemerkt hatten, unberührt.

Wurde das Manuskript in der Zwischenzeit an denselben Stellen geändert, wird nichts überschrieben: Der Vorschlag wird per Rebase auf das aktuelle Manuskript übertragen und kehrt als neues Review innerhalb derselben Aufgabe zurück.

## Was die Isolierung kostet

Im Vergleich zu einem Aufruf von `latexmk` in einer Kopie desselben Ordners:

| Änderung | `latexmk` im Ordner | Papilot |
| --- | --- | --- |
| Ein Kapitel bearbeiten | 69.2 s, 1 Durchlauf | 71.2 s, 1 Durchlauf |
| Eine von TeX nicht gelesene Datei bearbeiten | 0.2 s, nichts zu tun | 1.9 s, kein TeX-Lauf |
| Das Dokument öffnen | 0.2 s, nichts zu tun | 71.3 s, 1 Durchlauf |

Von der Änderung durch den Agenten bis zur fertigen Review-Runde vergingen 23.1–47.2 s. Wurde der nächste Manuskript-Build während eines 150 s dauernden Reviews bereits vorberechnet, lag das PDF 0.8 s nach dem Commit bereit.
