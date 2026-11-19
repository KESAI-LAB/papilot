Det här inlägget följer en granskningsomgång genom Papilots kod, från agentens sista filskrivning till ditt beslut på sidan. Sökvägar hänvisar till [kodförrådet](https://github.com/PapilotAI/papilot); siffrorna kommer från [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), uppmätta på en avhandling på 240 MB med XeLaTeX, BibTeX, minted och kapitel uppdelade med `\include`.

## En worktree och en ögonblicksbild

Varje uppgift är en fristående Git-worktree som skapas från en ögonblicksbild av manuskriptet, inklusive icke-incheckade ändringar (`engine/src/core/tasks.ts`). Agenten körs med denna worktree som arbetskatalog och sandlåda.

En omgång börjar med att arbetskatalogen sparas som ett Git-träd. Att hasha en hel avhandling i varje omgång vore långsamt, så ögonblicksbilden går via en privat indexfil, `papilot/snapshot-index` i arbetskatalogens Git-katalog (manuskriptet har sin egen, `.git/papilot/working-index`). Indexet utgår från föregående ögonblicksbild eller från förrådets index, så att Git bara hashar om filer vars storlek eller ändringstid har ändrats. Varje ögonblicksbild tas två gånger och jämförs, så att en fil som sparas mitt under pågående läsning inte kan ge upphov till ett träd som aldrig funnits på disk. För avhandlingen sjönk tiden för en ögonblicksbild från 2.1 s till 0.1 s.

## Att bygga båda sidor

Varje bygge körs i en egen mapp, nycklad efter vad som kompileras, så att SyncTeX alltid pekar på exakt rätt källkod för den PDF som visas på skärmen. Att börja varje mapp tom skulle kasta bort latexmk:s tillstånd, så en ny mapp utgår från den närmaste föregående (`engine/src/core/build.ts`):

- **Välj en bas.** Bland de senaste 16 felfria byggena med samma kapitel, kompilatorinställningar och kompilatorversion väljs det vars träd skiljer sig från det nya i färst filer (`git diff-tree`), och det nyare vid lika antal.
- **Klona och patcha.** Basens källfiler klonas med copy-on-write (`cp -c -R` på APFS). Filer utanför det nya trädet tas bort, filer med samma Git-objekt och storlek behålls, och resten strömmas från ett enda `git cat-file --batch`. LaTeX utdatafiler klonas med `COPYFILE_FICLONE`. Att exportera avhandlingen tar 0.76 s; att kopiera dess LaTeX-tillstånd tar 0.06 s.
- **Behåll latexmk:s tillstånd.** `.aux`, `.bbl`, `.fdb_latexmk`, minted-cachen och övriga filer följer med (alla utom `.fls`). Sökvägarna i dem innehåller mappens 32 tecken långa cachenyckel. Varje nyckel har samma längd, så den gamla nyckeln ersätts byte för byte, vilket gör att positionerna i SyncTeX-datan förblir giltiga (`.synctex.gz` packas upp och komprimeras igen). latexmk avgör sedan vad som behöver köras, precis som i din egen mapp.

**Kapitelomgångar.** När huvudfilen inkluderar kapitel med `\include` och varje ändrad fil tillhör något av dem, utgörs varje sida av ett enda `\includeonly`-bygge av de ändrade kapitlen. De övriga kapitlens `.aux`-filer hämtas från ett fullständigt bygge av uppgiftens bas, så att ekvationsnummer, hänvisningar och citeringar förblir korrekta. De två sidorna kompileras samtidigt med samma `SOURCE_DATE_EPOCH` (kl. 12.00 UTC på omgångens datum, med `FORCE_SOURCE_DATE=1`), så att `\today` aldrig dyker upp som en ändring. Ett kapitelbygge av avhandlingen gick från 68.7–88.5 s (3 körningar, 2 BibTeX-körningar) till 25.8 s (1 körning).

**Innan turen är slut.** Varje fil som agenten skriver startar ett spekulativt bygge och en jämförelse som avbryts vid nästa skrivning (`engine/src/core/publish.ts`), så att omgången ofta är färdigrenderad när agenten stannar.

**En maskin, två TeX-körningar.** Förhandsgranskningen av manuskriptet, varje uppgifts omgångar och de spekulativa byggena delar på två TeX-platser över alla processer. När en mer brådskande körning väntar pausas en mindre brådskande med `SIGSTOP` och återupptas senare (`engine/src/core/pool.ts`).

**Fel.** Ett bygge vars fel pekar på kvarlämnade filer under `build/` försöks igen en gång från en ren mapp. Om det reviderade dokumentet inte går att kompilera skickas felet tillbaka till agenten som en ny tur. Om baslinjen inte går att kompilera tvingas kompileringen förbi felen; om det misslyckas visar omgången enbart källkodsändringar.

![Fyra steg: ta en ögonblicksbild av uppgiften i en Git-worktree, bygg båda sidor från ett varmt LaTeX-tillstånd, jämför de typsatta dokumenten och spara varje beslut i en journal.](/assets/blog/review-pipeline.sv.svg "En omgång: ögonblicksbild, bygge, jämförelse, beslut.")

## Att hitta varje ändring på sidan

**Enheter i källkoden.** Diffen delar upp löptext i ord (tecken i CJK-text). Vissa konstruktioner behålls som enskilda token: kommentarer, matematik i löptext och fristående formler, klammergrupper, kommandon med sina argument samt miljöer som `equation`, `align`, `tabular`, `verbatim`, `minted` och `tikzpicture`. Ändringar som bara skiljs åt av blanksteg eller skiljetecken slås ihop, och varje resulterande ändring blir ett beslut med ett exakt intervall i källkoden. Bilder och andra binärfiler hanteras som hela filer, och ändringsblock som rör samma `.bib`-post bildar en enhet.

**Var dokumenten skiljer sig åt.** En arbetarprocess extraherar texten ur båda PDF-filerna med MuPDF och riktar in de två dokumenten ord för ord (`engine/src/render/effects.ts`): unika följder om åtta ord fäster dem i varandra, den längsta stigande kedjan av sådana ankare behålls, och luckorna mellan ankarna diffas. Följder på minst 20 bokstäver och siffror som har flyttats rapporteras som förflyttningar. Genom att jämföra hela dokument hittar man ändringar på andra ställen än där redigeringen gjordes: varje användning av ett omdefinierat makro, omnumrerade ekvationer eller en ny referens i litteraturlistan.

**Var varje ändring befinner sig.** SyncTeX, kompilerat till WebAssembly och indexerat en gång per bygge, mappar varje ändrings gamla rader till den gamla PDF-filen och dess nya rader till den nya, vilket ger sidutsnitt; utsnitten beskärs vid rader som båda dokumenten delar. Varje ändring klassificeras sedan som ändrad text, ändrad layout (pixeljämförelse vid 2×), flyttad, identiskt typsatt eller omappad. Ändringar som enbart gäller trycksvärta (typsnitt, färg, höjd eller sänkt text) samt vektorgrafik jämförs separat. Utsnitt som delar en tryckt rad slås samman till ett område, medan varje ändring behåller sina egna Accept och Reject. Remsorna på skärmen är vektor-SVG.

En ändring som bara rör blanksteg och som typsätts identiskt kopplas till närmaste verkliga ändring i samma stycke, aldrig över en tom rad, `\par` eller en avsnittsrubrik, och förblir ett eget beslut.

**Ändringar på andra ställen än redigeringen (valfritt).** När **Track indirect changes** är aktiverat spåras skillnader utanför samtliga ändringars utsnitt till sin orsak genom att varianter kompileras: först ändringar utan egen synlig effekt, såsom en makrodefinition, och därefter halvor av ändringsmängden. Unionen av orsaker verifieras, upp till tre ställen ritas ut under varje ändring och resten laddas vid behov.

## Beslut som en journal

Ett beslut skriver aldrig direkt i din mapp. Varje beslut sparas i en SQLite-journal med förväntade och nya byte för varje skrivning, kontrolleras mot disk och rullas tillbaka om något steg misslyckas (`engine/src/core/review.ts`):

- **Accept** sparar ändringen i en privat commit, `refs/papilot/<task>/accepted`.
- **Reject** återställer ändringen i arbetskatalogen med en trevägssammanslagning, så att stycken som redigerats sedan dess lämnas orörda. Medan agenten arbetar väntar avvisningar tills dess tur är slut.
- **Undo** ångrar det senaste beslutet.
- **Apply** slår samman de accepterade ändringarna med dina arbetsfiler, även det med en trevägssammanslagning. **Commit** skriver enbart uppgiftens ändringar till `HEAD` med `git commit-tree` medan `index.lock` hålls, efter att ha kontrollerat att grenen inte har flyttats, och behåller allt annat som du hade köat i indexet.

Om manuskriptet under tiden har ändrats i samma stycken skrivs ingenting över: förslaget rebaseras mot det aktuella manuskriptet och kommer tillbaka som en ny granskning i samma uppgift.

## Vad isoleringen kostar

Jämfört med `latexmk` kört i en kopia av samma mapp:

| Ändring | `latexmk` i mappen | Papilot |
| --- | --- | --- |
| Redigera ett kapitel | 69.2 s, 1 pass | 71.2 s, 1 pass |
| Redigera en fil som TeX inte läser | 0.2 s, inget att göra | 1.9 s, ingen TeX-körning |
| Öppna artikeln | 0.2 s, inget att göra | 71.3 s, 1 pass |

Från en agents redigering till en färdig omgång tog det 23.1–47.2 s. När nästa manuskriptbygge förutsågs under en 150 s lång granskning var PDF-filen klar 0.8 s efter commit.
