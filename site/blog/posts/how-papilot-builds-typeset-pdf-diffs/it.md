Questo articolo segue un ciclo di revisione attraverso il codice di Papilot, dall'ultima scrittura su file dell'agente fino alla decisione presa sulla pagina. I percorsi si riferiscono al [repository](https://github.com/PapilotAI/papilot); i numeri provengono da [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), misurati su una tesi da 240 MB con XeLaTeX, BibTeX, minted e capitoli suddivisi con `\include`.

## Una worktree e uno snapshot

Ogni task è una worktree Git scollegata, creata a partire da uno snapshot del manoscritto che include anche le modifiche non committate (`engine/src/core/tasks.ts`). L'agente viene eseguito usando quella worktree come directory di lavoro e sandbox.

Un ciclo inizia registrando la worktree come un albero Git. Calcolare l'hash di un'intera tesi a ogni ciclo sarebbe lento, quindi lo snapshot passa attraverso un file di indice privato, `papilot/snapshot-index` nella directory Git della worktree (il manoscritto ha il proprio, `.git/papilot/working-index`). L'indice viene inizializzato dallo snapshot precedente o dall'indice del repository, così Git ricalcola l'hash solo per i file la cui dimensione o data di modifica è cambiata. Ogni snapshot viene acquisito due volte e confrontato, in modo che un file salvato solo a metà non possa produrre un albero mai esistito su disco. Sulla tesi, il tempo di uno snapshot è sceso da 2.1 s a 0.1 s.

## Compilare entrambe le versioni

Ogni compilazione viene eseguita nella propria cartella, identificata da ciò che compila, così SyncTeX punta sempre all'esatto sorgente del PDF mostrato a schermo. Partire ogni volta da una cartella vuota scarterebbe lo stato di latexmk, perciò una nuova cartella parte da quella precedente più simile (`engine/src/core/build.ts`):

- **Scelta della base.** Tra le ultime 16 compilazioni senza errori con gli stessi capitoli, le stesse impostazioni e la stessa versione del compilatore, si sceglie quella il cui albero differisce dal nuovo nel minor numero di file (`git diff-tree`), preferendo la più recente in caso di parità.
- **Clonazione e patch.** I sorgenti della base vengono clonati in modalità copy-on-write (`cp -c -R` su APFS). I file assenti nel nuovo albero vengono rimossi, quelli con lo stesso oggetto Git e la stessa dimensione vengono mantenuti, mentre i restanti vengono estratti in flusso da un singolo `git cat-file --batch`. I file di output di LaTeX vengono clonati con `COPYFILE_FICLONE`. Esportare la tesi richiede 0.76 s; copiare lo stato di LaTeX, 0.06 s.
- **Mantenimento dello stato di latexmk.** I file `.aux`, `.bbl`, `.fdb_latexmk`, la cache di minted e il resto vengono conservati (tutto tranne `.fls`). I percorsi al loro interno contengono la chiave di cache a 32 caratteri della cartella. Ogni chiave ha la stessa lunghezza, quindi la vecchia chiave viene sostituita byte per byte, mantenendo validi gli offset nei dati di SyncTeX (`.synctex.gz` viene decompresso e ricompresso). A quel punto latexmk decide cosa eseguire, proprio come farebbe nella cartella dell'utente.

**Cicli per capitolo.** Quando il file principale include i capitoli tramite `\include` e ogni file modificato appartiene a uno di essi, ciascuna versione viene compilata con un singolo `\includeonly` limitato ai capitoli modificati. I file `.aux` degli altri capitoli provengono da una compilazione completa della base del task, così la numerazione delle equazioni, i riferimenti incrociati e le citazioni restano corretti. Le due versioni vengono compilate in parallelo con lo stesso `SOURCE_DATE_EPOCH` (mezzogiorno UTC della data del ciclo, con `FORCE_SOURCE_DATE=1`), così `\today` non compare mai come modifica. La compilazione di un capitolo della tesi è scesa da 68.7–88.5 s (3 passaggi, 2 esecuzioni di BibTeX) a 25.8 s (1 passaggio).

**Prima che il turno finisca.** Ogni file scritto dall'agente avvia una compilazione e un confronto speculativi, annullati dalla scrittura successiva (`engine/src/core/publish.ts`), così il ciclo è spesso già renderizzato nel momento in cui l'agente termina.

**Una macchina, due esecuzioni TeX.** L'anteprima del manoscritto, i cicli di ogni task e le compilazioni speculative condividono due slot TeX tra tutti i processi. Quando un'esecuzione più urgente è in attesa, una meno urgente viene messa in pausa con `SIGSTOP` e ripresa in seguito (`engine/src/core/pool.ts`).

**Errori di compilazione.** Una compilazione i cui errori puntano a file residui sotto `build/` viene ritentata una volta a partire da una cartella pulita. Se il documento revisionato non compila, l'errore viene restituito all'agente come nuovo turno. Se è la versione di riferimento a non compilare, la compilazione prosegue oltre gli errori; se anche questo fallisce, il ciclo mostra soltanto le modifiche al sorgente.

![Quattro fasi: acquisire lo snapshot del task in una worktree Git, compilare entrambe le versioni a partire da uno stato LaTeX caldo, confrontare i documenti impaginati e registrare ogni decisione in un journal.](/assets/blog/review-pipeline.it.svg "Un ciclo: snapshot, compilazione, confronto, decisione.")

## Individuare ogni modifica sulla pagina

**Unità nel sorgente.** Il diff suddivide il testo in parole (caratteri nel testo CJK). Alcuni costrutti restano token singoli: commenti, formule matematiche in linea e fuori testo, gruppi tra parentesi graffe, comandi con i relativi argomenti e ambienti come `equation`, `align`, `tabular`, `verbatim`, `minted` e `tikzpicture`. Le modifiche separate solo da spazi o punteggiatura vengono unite, e ciascuna modifica risultante costituisce una singola decisione associata a un intervallo esatto nel sorgente. Le immagini e gli altri file binari sono trattati come unità a file intero, mentre i blocchi di modifiche che toccano la stessa voce `.bib` formano un'unica unità.

**Dove differiscono i documenti.** Un processo worker estrae il testo di entrambi i PDF con MuPDF e allinea i due documenti parola per parola (`engine/src/render/effects.ts`): sequenze univoche di otto parole fanno da ancoraggio tra i due testi, viene mantenuta la più lunga catena crescente di tali ancoraggi e vengono calcolate le differenze negli intervalli intermedi. Le sequenze di almeno 20 lettere e cifre che hanno cambiato posizione vengono segnalate come spostamenti. È il confronto tra documenti interi a rilevare i cambiamenti lontani dal punto modificato: ogni occorrenza di una macro ridefinita, equazioni rinumerate, una nuova voce bibliografica.

**Dove si trova ogni modifica.** SyncTeX, compilato in WebAssembly e indicizzato una sola volta per compilazione, mappa le vecchie righe di ciascuna modifica nel vecchio PDF e le nuove righe in quello nuovo, producendo ritagli di pagina; i ritagli vengono delimitati in corrispondenza di righe condivise da entrambi i documenti. Ogni modifica viene poi classificata come testo modificato, layout modificato (confronto dei pixel a 2×), spostamento, impaginazione identica o non mappata. Le modifiche che riguardano solo l'inchiostro (font, colore, testo alzato o abbassato) e i disegni vettoriali vengono confrontate separatamente. I ritagli che condividono una riga stampata si fondono in un'unica regione, mentre ogni modifica mantiene i propri controlli Accept e Reject. Le strisce mostrate a schermo sono in formato vettoriale SVG.

Una modifica composta solo da spazi bianchi che produce un'impaginazione identica viene collegata alla modifica effettiva più vicina nello stesso paragrafo — mai oltre una riga vuota, un `\par` o un titolo di sezione — e rimane una decisione indipendente.

**Cambiamenti lontani dalla modifica (opzionale).** Attivando **Track indirect changes**, le differenze esterne al ritaglio di ciascuna modifica vengono ricondotte alla loro causa compilando delle varianti: prima le modifiche prive di un effetto visibile diretto, come la definizione di una macro, poi metà successive dell'insieme di modifiche. L'unione delle cause viene verificata; sotto ciascuna modifica vengono mostrati fino a tre punti interessati, mentre i restanti vengono caricati su richiesta.

## Le decisioni come journal

Una decisione non scrive mai direttamente nella cartella di lavoro. Ciascuna viene registrata in un journal SQLite con i byte attesi e quelli di destinazione di ogni scrittura, verificata rispetto al disco e annullata tramite rollback se un passaggio fallisce (`engine/src/core/review.ts`):

- **Accept** registra la modifica in un commit privato, `refs/papilot/<task>/accepted`.
- **Reject** annulla la modifica nella worktree tramite un merge a tre vie, così i passaggi modificati nel frattempo non vengono toccati. Mentre l'agente è al lavoro, i rifiuti attendono la fine del suo turno.
- **Undo** annulla l'ultima decisione presa.
- **Apply** fonde le modifiche accettate nei file di lavoro, sempre tramite un merge a tre vie. **Commit** scrive solo le modifiche del task su `HEAD` con `git commit-tree` mantenendo il blocco su `index.lock`, dopo aver verificato che il branch non si sia spostato, e preserva qualsiasi altra modifica già presente nello stage.

Se nel frattempo il manoscritto è cambiato negli stessi passaggi, nulla viene sovrascritto: la proposta viene ribasata sul manoscritto corrente e ripresentata come nuova revisione all'interno dello stesso task.

## Il costo dell'isolamento

Confronto con `latexmk` eseguito in una copia della stessa cartella:

| Modifica | `latexmk` nella cartella | Papilot |
| --- | --- | --- |
| Modifica di un capitolo | 69.2 s, 1 passaggio | 71.2 s, 1 passaggio |
| Modifica di un file non letto da TeX | 0.2 s, nessuna operazione | 1.9 s, nessuna esecuzione TeX |
| Apertura dell'articolo | 0.2 s, nessuna operazione | 71.3 s, 1 passaggio |

Dalla modifica di un agente a un ciclo pronto per la revisione sono trascorsi 23.1–47.2 s. Con la compilazione successiva del manoscritto preparata in anticipo durante una revisione di 150 s, il PDF è risultato pronto 0.8 s dopo il commit.
