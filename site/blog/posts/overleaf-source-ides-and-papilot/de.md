Fast jede Forschungsgruppe pendelt sich rund um LaTeX irgendwann auf einen stillen Kompromiss ein. Ein Koautor bevorzugt einen Browser-Tab, der sich überall öffnen lässt, ohne erst eine vier Gigabyte große TeX-Distribution zu installieren; eine andere lebt in einem lokalen Code-Editor samt Git-Anbindung, Tastenkürzeln und Coding-Agent; ein dritter druckt das kompilierte PDF aus – oder öffnet es auf dem Tablet –, weil holprige Übergänge, gedrängte Tabellen und verrutschte Notation erst auf der fertig gesetzten Seite wirklich ins Auge fallen.

Wer heute nach einer KI-gestützten LaTeX-Umgebung sucht, leidet selten unter einem Mangel an fähigen Sprachmodellen. Moderne Coding-Agenten navigieren längst mühelos durch Repositories mit dutzenden Dateien, folgen eigenen Makros und reparieren `.bib`-Einträge im Handumdrehen. Was die Qualität beim täglichen Schreiben tatsächlich entscheidet, ist die **Gestaltung des Arbeitsbereichs** rund um das Modell: wo Sie ausdrücken, was geändert werden soll, wie Sie überprüfen, was die KI bearbeitet hat, und ob der Umstieg auf ein besseres Werkzeug Ihre Koautorinnen und Koautoren zwingt, ihr gewohntes aufzugeben.

Statt zu behaupten, ein einziges Werkzeug ersetze alle anderen in jeder Lage, lohnt es sich, die drei wichtigsten LaTeX-Workflows nebeneinanderzustellen – Browser-Editoren mit geteilter Ansicht wie Overleaf, lokale Quellcode-IDEs mit Coding-Agenten sowie den PDF-zentrierten Arbeitsbereich von [Papilot](https://github.com/PapilotAI/papilot) – und zu betrachten, wie sie dank Live-Synchronisation am selben Manuskript zusammenspielen.

## Was bestehende LaTeX-Workflows richtig machen

Bevor wir betrachten, wo quellcodezentrierte KI-Bearbeitung an Grenzen stößt, verdient Anerkennung, warum sich Overleaf und lokale Code-Editoren ihren festen Platz im wissenschaftlichen Schreiben erarbeitet haben.

**Overleaf hat den Einstieg in die Zusammenarbeit gelöst.** Vor browserbasiertem TeX bedeutete der Start eines gemeinsamen Artikels über Institutsgrenzen hinweg oft, abweichende TeX-Live-Jahrgänge, fehlende `.sty`-Pakete und Git-Merge-Konflikte zu beheben, noch ehe die erste Zeile des Abstracts geschrieben war. Einen Projektlink zu teilen, über den alle im Browser tippen und zeichengenaue Cursor in Echtzeit sehen, ist bis heute der reibungsärmste Weg für gemischte Teams – besonders auf Rechnern ohne lokale TeX-Installation.

**Lokale Quellcode-IDEs haben Projektgröße und Automatisierung gelöst.** Die Kombination aus VS Code und LaTeX Workshop – oder Cursor, Neovim sowie Terminal-Agenten wie Claude Code oder Codex – mit einem lokalen Git-Repository bietet schnelle dateiübergreifende Suche, Offline-Kompilierung per `latexmk`, reproduzierbare Build-Skripte und volle Kontrolle beim Entwickeln eigener `.cls`-Dokumentklassen, `.sty`-Pakete oder programmatischer TikZ-Grafiken.

Beide Workflows stoßen jedoch an derselben Stelle auf Reibung: **beim Prüfen substanzieller KI-Überarbeitungen an einer Argumentation oder mathematischen Herleitung**.

![Drei LaTeX-Workflows im direkten Vergleich: die geteilte Browseransicht von Overleaf, eine Quellcode-IDE mit Coding-Agent und der PDF-zentrierte Arbeitsbereich von Papilot mit Live-Synchronisation zu Overleaf.](/assets/blog/three-workflows.de.svg "Overleaf optimiert die sofortige Zusammenarbeit im Browser und Quellcode-IDEs die Arbeit am rohen Markup, während Papilot KI-Überarbeitung und Prüfung auf dem kompilierten PDF bündelt und live mit Overleaf synchronisiert.")

Sowohl in der geteilten Browseransicht als auch in einer Code-IDE bearbeitet ein KI-Assistent `.tex`-Markup und legt seinen Vorschlag als rot-grünen Quellcode-Diff vor. Bei umgebrochener Prosa über mehrere Zeilen hinweg oder einer mehrzeiligen `\begin{align}`-Herleitung mit projektspezifischen Makros heißt das Lesen des Patches, LaTeX im Kopf selbst zu kompilieren – oder das gesamte PDF neu zu bauen und anschließend auf Seite neun mühsam nachzuspüren, was sich im Detail verändert hat.

## Die drei Workflows im Vergleich über sechs Dimensionen

Die folgende Tabelle fasst zusammen, wie die drei Umgebungen das tägliche Entwerfen, KI-Überarbeitungen, die inhaltliche Prüfung und die Zusammenarbeit im Team handhaben.

| Dimension | Overleaf (Browser-Editor) | Quellcode-IDE + Coding-Agent (VS Code, Cursor, CLI) | Papilot (PDF-zentrierter agentischer Arbeitsbereich) |
| --- | --- | --- | --- |
| Hauptarbeitsbereich | Geteilte Ansicht: links `.tex`-Editor, rechts kompilierte PDF-Vorschau | `.tex`-Dateibaum und Codefenster, mit sekundärem PDF-Vorschau-Tab | Das kompilierte PDF-Manuskript selbst; der Quellcode bleibt bei Bedarf jederzeit einsehbar |
| KI-Änderungen anweisen | Textstellen in den Chat kopieren oder direkt im `.tex`-Puffer prompten | Prompt über Dateipfad, Zeilenbereich oder markierten `.tex`-Code | Text direkt auf dem PDF hervorheben oder Formeln und Abbildungen einrahmen; SyncTeX ordnet die exakten Quellzeilen zu |
| KI-Änderungen prüfen | Rohe `.tex`-Änderungen lesen oder neu kompilieren und das neue PDF visuell absuchen | Zeilenbasiertes `git diff` auf rohem LaTeX-Markup | Gesetzte Vorher-Nachher-Vergleiche direkt an Ort und Stelle im PDF, mit Alternativen pro Notiz und Quellcode-Umschaltung |
| Zusammenarbeit mit Koautoren | Gemeinsames Echtzeit-Editieren im Browser über Projekt- oder Freigabelinks | Git Push/Pull; Reibungsverluste, wenn Koautoren Overleaf bevorzugen | Integrierte Git-Worktrees **plus** bidirektionale Live-Synchronisation mit Overleaf in ~1 s |
| Wahl von KI-Modell & Agent | An die plattformeigenen Assistenten gebunden | An den Anbieter der IDE oder ein einzelnes konfiguriertes CLI-Tool gekoppelt | Eigener Login oder API-Schlüssel für 16 Agenten: integrierter Papilot Writer plus 15 Coding-Agenten (Codex, Claude, Cursor, Copilot, Antigravity, Pi, OpenCode u. a.) |
| Einrichtung, Dateien & Lizenz | Cloud-Projekt; keine lokale TeX-Installation erforderlich | Lokale Textdateien + Git + TeX-Distribution | Lokale Textdateien + Git + TeX-Distribution; kostenlos und Open Source (MIT) |

## Zusammenarbeiten, ohne Koautoren zum Wechsel zu drängen

Der häufigste Grund, warum Forschende vor einem lokalen LaTeX-Werkzeug zurückschrecken, hat nichts mit Funktionen zu tun: *„Meine Betreuerin und drei Koautoren schreiben bereits auf Overleaf.“* Ein ZIP-Archiv zu exportieren, lokal eine KI-Überarbeitung durchzuführen und geänderte `.tex`-Dateien wieder in den Browser einzufügen, führt fast unweigerlich dazu, dass frisch geschriebene Absätze überschrieben werden.

Ab Papilot 0.11 hebt **Mit Overleaf synchronisieren** (Sync with Overleaf) diesen Zielkonflikt auf. Sie können einen Overleaf-Projektlink – oder einen Freigabelink mit Bearbeitungsrecht – direkt in Papilot einfügen oder einen bestehenden lokalen Manuskriptordner mit dem zugehörigen Overleaf-Projekt verknüpfen. Solange Papilot läuft, bleiben lokale Dateien und Overleaf-Projekt über den Echtzeit-Bearbeitungsdienst von Overleaf im Gleichschritt:

- **Bidirektionale Aktualisierung im Sekundentakt.** Änderungen, die Sie in Papilot prüfen, annehmen und anwenden, erscheinen nach rund einer Sekunde in den Browser-Tabs Ihrer Koautoren auf Overleaf; umgekehrt fließen deren Eingaben auf Overleaf direkt in Ihre lokalen `.tex`-Dateien und das kompilierte PDF zurück.
- **Zeichengenaues Zusammenführen gleichzeitiger Eingaben.** Bearbeiten mehrere Personen denselben Absatz im selben Moment, werden die Eingaben Zeichen für Zeichen zusammengeführt – genau wie zwischen zwei Overleaf-Browserfenstern.
- **Kein kostenpflichtiges Git-Add-on nötig.** Die Live-Synchronisation funktioniert bereits mit einem kostenlosen Standardkonto bei Overleaf (und unterstützt ebenso selbst gehostete Overleaf-Instanzen). Gleichzeitig bleiben KI-Aufgaben in lokalen Git-Worktrees isoliert, bis Sie geprüfte Änderungen bewusst in den gemeinsamen Entwurf übernehmen.

![Produktansicht von Papilot mit einem gesetzten Vorher-Nachher-Vergleich direkt auf der PDF-Seite samt Aktionen zum Annehmen, Ablehnen und Kommentieren.](/assets/blog/review.en.png "Prüfen Sie jede vorgeschlagene KI-Änderung als gesetzten Vorher-Nachher-Vergleich, bevor irgendetwas in das gemeinsame Overleaf-Projekt übernommen wird.")

Ebenso geradlinig gelangt ein Manuskript in den Arbeitsbereich: **Importieren oder öffnen** akzeptiert arXiv-URLs (Abstract-, PDF- oder HTML-Links), Lese- oder Bearbeitungslinks von Overleaf sowie öffentliche GitHub-Repository-URLs und erkennt dabei automatisch die zentrale `.tex`-Hauptdatei samt passender TeX-Engine. Und wer ein Projekt von Grund auf neu beginnt, findet in [Papilot Universe](https://papilot.ai/universe/) sofort kompilierbare Vorlagen für Fachzeitschriften, Abschlussarbeiten, Präsentationen, Poster, Lebensläufe, Bücher und über 400 Konferenzen.

## Das passende Werkzeug für jede Phase eines Artikels

Da Papilot direkt auf regulären `.tex`- und `.bib`-Dateien auf der Festplatte arbeitet, schließen sich diese drei Workflows nicht gegenseitig aus, sondern ergänzen einander:

1. **Nutzen Sie Overleaf im Browser**, wenn Sie unterwegs an einem Rechner ohne TeX-Installation sitzen, auf einem geliehenen Laptop rasch ein paar Formulierungen glätten oder Mitwirkende einladen möchten, die keinerlei lokale Einrichtung wünschen.
2. **Öffnen Sie eine Quellcode-IDE**, wenn Sie eigene `.sty`-Stildateien entwickeln, tiefgreifende Makroexpansionen debuggen oder Skript-Pipelines in Python oder R schreiben, die `.tex`-Tabellen automatisiert aus Messdaten erzeugen.
3. **Arbeiten Sie in Papilot**, wenn Sie mit KI-Agenten das Manuskript selbst entwerfen, umstrukturieren, Herleitungen prüfen und sprachlich feinschleifen – dort, wo der direkte Fingerzeig auf die gesetzte Seite und der gerenderte Vorher-Nachher-Vergleich Ihr wissenschaftliches Urteil schärfen und den gemeinsamen Entwurf schützen, bis Sie Ihre Entscheidungen ausdrücklich anwenden.

Sie können das Zusammenspiel aus PDF-Annotation und gesetzter Änderungsprüfung schon jetzt direkt im Browser mit unserer [interaktiven Demo](/demo/) ausprobieren – ganz ohne lokale TeX- oder Modelleinrichtung. Wenn dieser Workflow zu Ihrer Art passt, wissenschaftliche Arbeiten zu schreiben, laden Sie die Desktop-App für macOS, Windows oder Linux unter [papilot.ai](/de/) herunter – und vergeben Sie gern einen [Stern für Papilot auf GitHub](https://github.com/PapilotAI/papilot), damit Sie das Projekt vor der nächsten Einreichungsfrist sofort wiederfinden.
