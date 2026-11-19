Be en kodagent att strama upp ett tvåsidigt bevis eller samordna notationen genom ett helt LaTeX-manuskript, så har du dess råa `git diff` inom några sekunder. Det är när du ska läsa diffen som den verkliga tidsförlusten börjar. Ett enda omdöpt makro, ett omradbrutet stycke eller ett justerat `\begin{aligned}`-block förvandlas genast till dussintals röda och gröna källkodsrader. Även om du kör `latexdiff` över hela projektet går känsliga matematikmiljöer ofta sönder, sidbrytningar förskjuts genom resten av dokumentet, och det finns fortfarande inget rent sätt att godta stycke två, avvisa ekvation fyra och skriva tillbaka enbart de valda källkodsändringarna till disk.

För att [Papilot](https://github.com/PapilotAI/papilot) ska kunna göra den kompilerade PDF-filen till primär arbetsyta får typsatta jämförelser inte kännas som en trög batchexport i slutet av ett bygge. Varje runda av agentändringar måste hållas isolerad från din arbetskatalog, kompilera på ungefär samma tid som ett enskilt inkrementellt `latexmk`-pass, knyta varje färgmarkering exakt till rätt kommentar och spara varje beslut att godta eller avvisa i en ångringsbar granskningslogg. Så här fungerar den pipelinen under huven.

## Att isolera agentrundor i Git-worktrees och snabba trädsnapshotar

Säkerhet går före hastighet. När du markerar meningar eller ramar in ekvationer på en PDF-sida och skickar dem till Codex, Claude, Cursor eller Papilot Writer redigerar agenten aldrig manuskriptets arbetskatalog direkt. I stället körs varje uppgift i ett eget, tillfälligt Git-worktree.

För att kunna jämföra versioner reproducerbart – och garantera att SyncTeX alltid pekar mot exakt den källkodsversion som visas på skärmen – körs varje bygge i en oföränderlig byggkatalog i stället för att skriva över författarens mapp på plats. På en omfattande avhandling skulle det snabbt bli en flaskhals att skapa en ny byggsnapshot om Git behövde hasha om hela arkivet varje gång. Papilot undviker detta genom att spara snapshotar via privata Git-snapshotindex (`.git/papilot/working-index` för manuskriptet och `papilot/snapshot-index` i varje uppgifts worktree), initierat från föregående snapshot eller arkivets befintliga index så att Git endast hashar om filer vars storlek eller ändringstid faktiskt har ändrats.

![Fyra steg i den tekniska pipelinen: snapshot i Git-worktree, förladdade inkrementella kapitelbyggen, koppling av typsatta diffar samt en ångringsbar granskningslogg.](/assets/blog/review-pipeline.sv.svg "Varje agentrunda körs i ett isolerat Git-worktree, återanvänder varm LaTeX-status för parallella kapitelbyggen, kopplar finkorniga prosa- och atomära matematikdiffar samt sparar ångringsbara beslut innan din arbetskatalog rörs.")

## Oföränderliga LaTeX-byggen på sekunder i stället för full omkompilering

Att köra `pdflatex` eller `xelatex` helt från noll på en artikel med flera kapitel eller en avhandling på 300 sidor kräver flera pass för att lösa ut källhänvisningar, korsreferenser samt cachefiler för `minted` eller TikZ. Eftersom Papilot isolerar byggen i separata kataloger skulle en naiv isolering kasta bort all inkrementell historik i `latexmk` vid varje runda.

Papilot håller isolerade byggen snabba genom fyra mekanismer:

1. **Kloning av närmaste nyss slutförda bygge.** När en ny byggmapp förbereds granskar Papilot nyligen slutförda byggen för samma kapiteluppsättning och väljer den kandidat vars Git-träd skiljer sig i lägst antal filer. På macOS med APFS klonar `cp -c` hela byggkatalogen i ett enda steg med copy-on-write och strömmar därefter endast de ändrade filobjekten från Git.
2. **Överföring av SyncTeX och hjälpfiler på plats.** Databasen `.fdb_latexmk` från `latexmk`, `.aux`- och `.bbl`-filer samt `minted`-cacher följer med in i den klonade katalogen. Eftersom alla byggmappar använder katalognycklar av exakt samma längd kan Papilot skriva om sökvägar inuti sparade SyncTeX-data och loggfiler direkt på plats utan att bytepositioner blir ogiltiga – så att `latexmk` normalt bara behöver köra ett enda inkrementellt pass, eller inget alls när indata inte har ändrats.
3. **Parallella kapitelbyggen med `\includeonly` vid granskning.** När en agent ändrar ett eller två kapitel i ett manuskript uppdelat på flera filer kompilerar en granskningsrunda inte om hela boken. Både basversionen och den reviderade versionen kompilerar enbart de berörda kapitlen parallellt via `\includeonly`, förladdade med `.aux`-filer från ett fullständigt basbygge så att korsreferenser, figurnummer och citeringar från orörda kapitel förblir korrekta. Båda byggena låser dessutom samma tidsstämpel så att `\today` aldrig skapar skendiffar över midnatt.
4. **Förhandsvisning efter första passet och automatisk ren omstart.** När en ändring flyttar sidbrytningar eller citeringar och `latexmk` schemalägger ytterligare pass lyfter en pass-hook fram de nytypsatta sidorna och SyncTeX-kartan direkt efter första passet medan referensnumren färdigställs i bakgrunden. Om kvarvarande hjälpfiler någonsin skulle orsaka ett fel i genererade filer gör Papilot automatiskt ett nytt försök i en helt ren katalog.

| Bygg- och granskningssteg | Naiv pipeline med full omkompilering | Papilots inkrementella granskningspipeline |
| --- | --- | --- |
| Isolering av arbetsyta | Ändrar arbetsmappen direkt eller kopierar varje fil från grunden | Uppgiftsbundet Git-worktree + privata snapshotindex (`working-index` / `snapshot-index`), klonade med `cp -c` på APFS |
| Granskningsbygge för flera kapitel | Fullständig omkompilering i flera pass av hela dokumentet före och efter | Parallella `\includeonly`-byggen förladdade med basbyggets hjälpfiler och låst datum |
| SyncTeX och hjälpstatus | Byggs upp från noll i varje isolerad katalog | Lika långa byggnycklar medger omskrivning av SyncTeX-sökvägar på plats och återanvändning av `latexmk`-status |
| Väntetid på skärmen vid flera pass | Väntar tills alla BibTeX- och korsreferenspass är helt klara | Visar uppdaterade PDF-sidor direkt efter pass ett medan återstående pass fastställer numreringen |

## Finkornig prosakoppling och atomära matematikjämförelser

När bas-PDF och reviderad PDF väl är kompilerade räcker det ändå inte att ställa två hela sidor bredvid varandra: en författare vill ta ställning till varje logisk ändring precis där den befinner sig på sidan, utan att förlora det typografiska sammanhanget.

Papilot skiljer mellan **det som kan delas upp** och **det som måste förbli helt**:

- **Finkorniga positioner i brödtext.** I vanliga textstycken kopplas varje ändring till exakta teckenpositioner i `.tex`-källkoden och separat tilldelade markeringar på den renderade PDF-sidan. Osynliga justeringar av blanksteg eller radbrytningar i `.tex`-filen grupperas automatiskt med närmaste innehållsliga ändring i samma stycke, så att författaren aldrig behöver klicka sig igenom rent formateringsbrus.
- **Atomära TeX-konstruktioner.** Fristående ekvationer, tabeller, figurer och referensposter förblir odelbara enheter, och överlappande PDF-områden slås samman till ett enda sammanhängande jämförelseblock med omgivande rader på plats – vilket bevarar faktiska radbrytningar, kerning och matematiska avstånd.

![Papilots gränssnitt med en inramad ekvation och en markerad mening på den kompilerade PDF-sidan, var och en försedd med en författarkommentar redo för agenten.](/assets/blog/notes.en.png "PDF-kommentarer länkar specifika citat och ekvationsområden till positioner i källkoden så att granskningen kan fokusera på en kommentar i taget.")

När du bifogar PDF-kommentarer till en uppgift kan Papilot dessutom be den anslutna agenten att i samma runda ta fram kortfattade **alternativ per kommentar** vid sidan av huvudförslaget. Innan granskningen öppnas validerar Papilot varje alternativ patch mot de exakta källkodsintervallen för respektive kommentar och förkompilerar förhandsvisningar isolerat. Klickar du på en kommentar framhävs endast dess markeringar på sidan, och du kan växla direkt mellan förberedda formuleringar – eller visa exakt `.tex`-diff – ur den lokala cachen, med **noll extra LLM-anrop** under granskningen.

## En ångringsbar granskningslogg innan någonting når `main`

I källkodscentrerade redigerare skriver ett klick på "Behåll" i en AI-chattpanel omedelbart över dina arbetsfiler. I Papilot är granskning och leverans medvetet åtskilda.

När du godtar en ändring – eller väljer ett alternativ för en enskild kommentar – skrivs beslutet till en ångringsbar granskningslogg inuti uppgiften. Avvisar du en kommentar återställs dess ursprungliga `.tex`-källkodsintervall omedelbart medan fristående ändringar och beslut lämnas orörda. Först när du har granskat klart väljer du om de godkända ändringarna ska skrivas till din arbetskatalog utan commit via **Verkställ** (och, om projektet är kopplat, synkroniseras på ungefär en sekund till medförfattare på Overleaf) eller checkas in direkt på manuskriptets aktuella gren med enbart uppgiftens godkända ändringar.

Du kan prova typsatta jämförelser per kommentar, förberedda uppgiftsuppspelningar och lokal Git-hantering direkt i webbläsaren med vår [statiska onlinedemo](/demo/). Hela granskningsmotorn, kompilatorpipelinen och skrivbordsapplikationen är öppen källkod under MIT-licensen – utforska koden, öppna ett ärende eller [ge Papilot en stjärna på GitHub](https://github.com/PapilotAI/papilot).
