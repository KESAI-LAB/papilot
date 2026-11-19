Peça a um agente de programação para enxugar uma demonstração de duas páginas ou padronizar a notação ao longo de um manuscrito em LaTeX, e o `git diff` bruto chegará em segundos. Ler esse diff é onde começa o verdadeiro atraso. Uma única macro renomeada, um parágrafo com novas quebras de linha ou um bloco `\begin{aligned}` ajustado se transformam em dezenas de linhas de código-fonte em vermelho e verde. Mesmo que você rode `latexdiff` no projeto inteiro, ambientes matemáticos destacados mais frágeis costumam quebrar, as quebras de página se deslocam adiante e ainda não resta uma maneira limpa de aceitar o segundo parágrafo, rejeitar a quarta equação e gravar no disco apenas as edições de código-fonte que você escolheu.

Para que o [Papilot](https://github.com/PapilotAI/papilot) torne o PDF compilado o espaço de trabalho principal, comparações diagramadas não podem parecer uma exportação lenta em lote no fim de uma compilação. Cada rodada de edições do agente precisa permanecer isolada da sua árvore de trabalho, compilar aproximadamente no tempo de uma única passada incremental do `latexmk`, atribuir os destaques com precisão a cada nota individual e registrar cada decisão de aceitar ou rejeitar em um diário de revisão reversível. Veja a seguir como esse pipeline funciona nos bastidores.

## Isolando cada turno do agente em worktrees do Git e snapshots rápidos da árvore

Segurança vem antes de velocidade. Quando você destaca frases ou contorna equações em uma página do PDF e as envia para Codex, Claude, Cursor ou Papilot Writer, o agente nunca edita diretamente o diretório de trabalho do seu manuscrito. Em vez disso, cada tarefa roda dentro do seu próprio worktree descartável do Git.

Para comparar revisões de forma reprodutível — e garantir que o SyncTeX aponte sempre para a versão exata do código-fonte exibida na tela —, cada build roda em um diretório de compilação imutável em vez de alterar no próprio lugar a pasta do autor. Criar um novo snapshot de build em uma tese extensa poderia facilmente virar um gargalo se o Git calculasse o hash do repositório inteiro a cada vez. O Papilot evita isso gravando snapshots por meio de índices privados do Git (`.git/papilot/working-index` para o manuscrito e `papilot/snapshot-index` no worktree de cada tarefa), inicializado a partir do snapshot anterior ou do índice do repositório para que o Git recalcule o hash apenas dos arquivos cujo tamanho ou horário de modificação realmente mudaram.

![Diagrama do pipeline de engenharia em quatro etapas: snapshot em worktree do Git, builds incrementais de capítulos com estado-semente, atribuição de diffs diagramados e diário de revisão reversível.](/assets/blog/review-pipeline.pt.svg "Cada turno do agente roda em um worktree do Git isolado, reaproveita o estado aquecido do LaTeX em builds paralelos de capítulos, atribui diffs finos de prosa e atômicos de matemática e registra decisões reversíveis antes de tocar na sua árvore de trabalho.")

## Fazendo builds imutáveis de LaTeX custarem segundos, não uma recompilação do zero

Rodar `pdflatex` ou `xelatex` do zero em um artigo com vários capítulos ou em uma tese de 300 páginas exige múltiplas passadas para resolver citações, referências cruzadas e caches do `minted` ou do TikZ. Como o Papilot isola os builds em diretórios separados, um isolamento ingênuo jogaria fora todo o estado incremental do `latexmk` a cada turno.

O Papilot mantém os builds isolados rápidos por meio de quatro mecanismos:

1. **Clonagem do build recente mais próximo.** Ao preparar uma nova pasta de compilação, o Papilot inspeciona os builds concluídos recentemente para o mesmo conjunto de capítulos e escolhe o candidato cuja árvore Git difere no menor número de arquivos. No macOS com APFS, o copy-on-write de `cp -c` clona todo o diretório de build em um único passo e em seguida transfere do Git apenas os blobs alterados.
2. **Reaproveitamento de estado auxiliar e reescrita in-place do SyncTeX.** O banco `.fdb_latexmk` do `latexmk`, os arquivos `.aux` e `.bbl` e os caches do `minted` seguem junto para o diretório clonado. Como as pastas de build usam chaves de diretório de mesmo comprimento, o Papilot reescreve no próprio lugar os caminhos dentro dos logs e dados preservados do SyncTeX sem invalidar deslocamentos de bytes — de modo que o `latexmk` normalmente executa apenas uma única passada incremental, ou nada quando as entradas não mudaram.
3. **Builds paralelos de capítulos com `\includeonly` nas revisões.** Quando um agente edita um ou dois capítulos de um manuscrito dividido em vários arquivos, uma rodada de revisão não recompila o livro inteiro. Tanto a versão de base quanto a revisada compilam em paralelo apenas os capítulos tocados via `\includeonly`, alimentados pelos arquivos `.aux` de um build base completo para que referências cruzadas, numeração de figuras e citações dos capítulos intocados permaneçam exatas. Ambos os builds também fixam um mesmo carimbo de tempo para que `\today` nunca crie diffs fantasmas na virada da meia-noite.
4. **Prévias logo na primeira passada e fallback limpo automático.** Quando uma edição altera a paginação ou as citações e o `latexmk` agenda passadas adicionais, um hook exibe as páginas recém-diagramadas e o mapa do SyncTeX logo após a primeira passada, enquanto os números de referência terminam de estabilizar em segundo plano. Se algum estado auxiliar herdado causar erro nos arquivos gerados, o Papilot tenta novamente de forma automática uma vez a partir de um diretório limpo.

| Etapa de build e revisão | Pipeline ingênuo de build limpo | Pipeline incremental de revisão do Papilot |
| --- | --- | --- |
| Isolamento do espaço de trabalho | Altera a pasta de trabalho ou copia todos os arquivos do zero | Worktree do Git por tarefa + índices privados de snapshot (`working-index` / `snapshot-index`), clonados via `cp -c` no APFS |
| Compilação de revisão em múltiplos capítulos | Recompilação completa em várias passadas antes e depois | Builds paralelos com `\includeonly` alimentados pelos arquivos auxiliares do build base, com data fixada |
| SyncTeX e estado auxiliar | Reconstruídos do zero em cada diretório isolado | Chaves de build de igual comprimento permitem reescrever caminhos do SyncTeX in-place e reusar o estado do `latexmk` |
| Latência de múltiplas passadas na tela | Aguarda todas as passadas do BibTeX e de referências cruzadas terminarem | Exibe as páginas atualizadas do PDF logo após a primeira passada enquanto as demais consolidam a numeração |

## Atribuição fina na prosa e comparações atômicas em matemática

Depois que o PDF de base e o revisado estão compilados, renderizar duas páginas inteiras lado a lado ainda não basta: o autor quer decidir sobre cada mudança lógica exatamente onde ela aparece na página, sem perder o contexto tipográfico.

O Papilot separa **o que pode ser dividido** do **que precisa permanecer inteiro**:

- **Deslocamentos finos na prosa.** Dentro de parágrafos comuns, cada edição corresponde a deslocamentos exatos de caracteres no código-fonte `.tex` e a marcações de destaque atribuídas individualmente no PDF renderizado. Ajustes invisíveis de espaços em branco ou quebras de linha no arquivo `.tex` são agrupados automaticamente com a edição substantiva mais próxima no mesmo parágrafo, para que o autor nunca precise clicar em ruído de formatação.
- **Construções TeX atômicas.** Equações destacadas, tabelas, figuras e entradas bibliográficas permanecem como unidades atômicas, e regiões sobrepostas do PDF se fundem em um único bloco coerente de comparação que mantém as linhas vizinhas no lugar — preservando quebras de linha reais, kerning e espaçamento matemático.

![Interface do Papilot mostrando uma equação contornada por um quadro e uma frase destacada no PDF compilado, cada uma com uma nota do autor pronta para o agente.](/assets/blog/notes.en.png "As notas no PDF conectam citações específicas e regiões de equações a deslocamentos no código-fonte, permitindo focar a revisão em uma nota por vez.")

Quando você anexa notas no PDF a uma tarefa, o Papilot também pode pedir ao agente conectado que prepare **alternativas concisas por nota** ao lado da proposta principal no mesmo turno. Antes de abrir a revisão, o Papilot valida cada patch alternativo contra os intervalos exatos de código-fonte vinculados àquela nota e compila prévias candidatas isoladamente. Clicar em uma nota destaca na página apenas as marcações daquela nota e permite alternar entre as redações preparadas — ou exibir o diff `.tex` exato — direto do cache local, com **zero chamadas adicionais ao LLM** durante a revisão.

## Um diário de revisão reversível antes que qualquer mudança toque a `main`

Em editores centrados no código-fonte, clicar em "Manter" em um painel de chat da IA altera imediatamente seus arquivos de trabalho. No Papilot, revisar e entregar são deliberadamente desacoplados.

Aceitar uma alteração — ou escolher uma alternativa para uma única nota — grava em um diário de revisão reversível dentro da tarefa. Rejeitar uma nota restaura na hora seus intervalos originais no código `.tex`, mantendo intactas as edições e decisões não relacionadas. Só ao concluir a revisão você escolhe se deseja **Aplicar** as alterações aprovadas ao diretório de trabalho sem criar commit (e, se estiver vinculado, sincronizá-las em cerca de um segundo com os coautores no Overleaf) ou **Confirmar** apenas as edições aceitas dessa tarefa diretamente no branch atual do manuscrito.

Você pode testar comparações diagramadas por nota, replays de tarefas preparadas e o staging local no Git direto pelo navegador na [demonstração estática online](/demo/). Todo o motor de revisão, o pipeline de compilação e o aplicativo desktop têm código aberto sob licença MIT — explore o código, abra uma issue ou [dê uma estrela ao Papilot no GitHub](https://github.com/PapilotAI/papilot).
