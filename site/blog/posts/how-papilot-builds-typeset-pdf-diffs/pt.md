Este artigo acompanha uma rodada de revisão pelo código do Papilot, desde a última gravação de arquivo feita pelo agente até a sua decisão na página. Os caminhos referem-se ao [repositório](https://github.com/PapilotAI/papilot); os números vêm de [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), medidos em uma tese de 240 MB com XeLaTeX, BibTeX, minted e capítulos divididos com `\include`.

## Uma worktree e um snapshot

Cada tarefa é uma worktree destacada do Git criada a partir de um snapshot do manuscrito, incluindo edições não confirmadas (`engine/src/core/tasks.ts`). O agente executa tendo essa worktree como seu diretório de trabalho e sandbox.

Uma rodada começa registrando a worktree como uma árvore do Git. Calcular o hash de uma tese a cada rodada seria lento, então o snapshot passa por um arquivo de índice privado, `papilot/snapshot-index` no diretório Git da worktree (o manuscrito tem o seu próprio, `.git/papilot/working-index`). O índice é inicializado a partir do snapshot anterior ou do índice do repositório, de modo que o Git recalcula o hash apenas dos arquivos cujo tamanho ou data de modificação mudaram. Cada snapshot é tirado duas vezes e comparado, para que um arquivo salvo pela metade não possa produzir uma árvore que nunca existiu no disco. Na tese, um snapshot passou de 2.1 s para 0.1 s.

## Compilando os dois lados

Cada compilação roda em sua própria pasta, identificada pelo que compila, para que o SyncTeX sempre aponte para o código-fonte exato do PDF na tela. Começar cada pasta vazia descartaria o estado do latexmk, então uma nova pasta começa a partir da anterior mais próxima (`engine/src/core/build.ts`):

- **Escolher uma base.** Entre as últimas 16 compilações sem erros com os mesmos capítulos, configurações e versão do compilador, escolhe-se aquela cuja árvore difere da nova no menor número de arquivos (`git diff-tree`), ou a mais recente em caso de empate.
- **Clonar e aplicar as alterações.** Os arquivos-fonte da base são clonados com copy-on-write (`cp -c -R` no APFS). Arquivos fora da nova árvore são removidos, arquivos com o mesmo objeto Git e tamanho são mantidos, e o restante é transmitido a partir de um único `git cat-file --batch`. Os arquivos de saída do LaTeX são clonados com `COPYFILE_FICLONE`. Exportar a tese leva 0.76 s; copiar seu estado do LaTeX, 0.06 s.
- **Manter o estado do latexmk.** `.aux`, `.bbl`, `.fdb_latexmk`, o cache do minted e o restante são reaproveitados (todos, exceto `.fls`). Os caminhos dentro deles contêm a chave de cache de 32 caracteres da pasta. Como toda chave tem o mesmo comprimento, a chave antiga é substituída byte a byte, o que mantém válidos os deslocamentos nos dados do SyncTeX (`.synctex.gz` é descompactado e compactado novamente). O latexmk decide então o que executar, como faria na sua pasta.

**Rodadas por capítulo.** Quando o arquivo principal inclui capítulos com `\include` e todos os arquivos alterados pertencem a um deles, cada lado é uma única compilação `\includeonly` dos capítulos alterados. Os arquivos `.aux` dos outros capítulos vêm de uma compilação completa da base da tarefa, para que a numeração de equações, as referências e as citações permaneçam corretas. Os dois lados compilam ao mesmo tempo, com o mesmo `SOURCE_DATE_EPOCH` (meio-dia UTC da data da rodada, com `FORCE_SOURCE_DATE=1`), para que `\today` nunca apareça como uma alteração. A compilação de um capítulo da tese passou de 68.7–88.5 s (3 passagens, 2 execuções do BibTeX) para 25.8 s (1 passagem).

**Antes do turno terminar.** Cada arquivo que o agente grava inicia uma compilação e uma comparação especulativas, canceladas pela próxima gravação (`engine/src/core/publish.ts`), de modo que a rodada geralmente já está renderizada quando o agente termina.

**Uma máquina, duas execuções do TeX.** A pré-visualização do manuscrito, as rodadas de cada tarefa e as compilações especulativas compartilham duas vagas do TeX entre todos os processos. Quando uma execução mais urgente aguarda, uma menos urgente é pausada com `SIGSTOP` e retomada depois (`engine/src/core/pool.ts`).

**Falhas.** Uma compilação cujos erros apontam para arquivos remanescentes sob `build/` é tentada novamente uma vez a partir de uma pasta limpa. Se o documento revisado não compilar, o erro volta para o agente como um novo turno. Se a versão de base não compilar, ela é compilada ignorando os erros; se isso falhar, a rodada mostra apenas as alterações no código-fonte.

![Quatro etapas: registrar o snapshot da tarefa em uma worktree do Git, compilar os dois lados a partir de um estado aquecido do LaTeX, comparar os documentos diagramados e registrar cada decisão em um diário.](/assets/blog/review-pipeline.pt.svg "Uma rodada: snapshot, compilação, comparação, decisão.")

## Encontrando cada alteração na página

**Unidades no código-fonte.** O diff divide o texto em palavras (caracteres em texto CJK). Algumas construções permanecem como tokens únicos: comentários, expressões matemáticas em linha e destacadas, grupos entre chaves, comandos com seus argumentos e ambientes como `equation`, `align`, `tabular`, `verbatim`, `minted` e `tikzpicture`. Edições separadas apenas por espaços ou pontuação são unidas, e cada edição resultante é uma decisão com um intervalo exato no código-fonte. Imagens e outros arquivos binários são unidades de arquivo inteiro, e trechos alterados que tocam a mesma entrada `.bib` formam uma única unidade.

**Onde os documentos diferem.** Um processo worker extrai o texto de ambos os PDFs com o MuPDF e alinha os dois documentos palavra por palavra (`engine/src/render/effects.ts`): sequências únicas de oito palavras funcionam como âncoras entre eles, a maior cadeia crescente dessas âncoras é mantida e as lacunas entre elas são comparadas. Sequências de pelo menos 20 letras e dígitos que mudaram de lugar são reportadas como trechos movidos. Comparar documentos inteiros é o que encontra alterações distantes da edição: cada uso de uma macro redefinida, equações renumeradas, uma nova entrada na bibliografia.

**Onde está cada edição.** O SyncTeX, compilado para WebAssembly e indexado uma vez por compilação, mapeia as linhas antigas de cada edição no PDF antigo e as novas linhas no PDF novo, gerando recortes de página; os recortes são feitos em linhas compartilhadas pelos dois documentos. Cada edição é então classificada como texto alterado, layout alterado (comparação de pixels em 2×), movida, diagramada de forma idêntica ou não mapeada. Alterações apenas de tinta (fonte, cor, texto elevado ou rebaixado) e desenhos vetoriais são comparados separadamente. Recortes que compartilham uma linha impressa fundem-se em uma única região, enquanto cada edição mantém seus próprios botões Accept e Reject. As faixas na tela são em SVG vetorial.

Uma edição apenas de espaços em branco que seja diagramada de forma idêntica é anexada à edição real mais próxima no mesmo parágrafo, nunca atravessando uma linha em branco, `\par` ou um título de seção, e continua sendo uma decisão própria.

**Alterações distantes da edição (opcional).** Com **Track indirect changes** ativado, diferenças fora do recorte de todas as edições são rastreadas até a sua causa compilando variantes: primeiro as edições sem efeito visível próprio, como uma definição de macro, e depois metades do conjunto de edições. A união das causas é verificada, até três locais são exibidos sob cada edição e o restante é carregado sob demanda.

## Decisões como um diário

Uma decisão nunca grava diretamente na sua pasta. Cada uma é registrada em um diário SQLite com os bytes esperados e os bytes finais de cada gravação, verificados contra o disco e revertidos se qualquer etapa falhar (`engine/src/core/review.ts`):

- **Accept** registra a alteração em um commit privado, `refs/papilot/<task>/accepted`.
- **Reject** reverte a alteração na worktree com um merge de três vias, para que trechos editados desde então não sejam afetados. Enquanto o agente está trabalhando, as rejeições aguardam até o fim do turno.
- **Undo** desfaz a decisão mais recente.
- **Apply** mescla as alterações aceitas nos seus arquivos de trabalho, novamente em três vias. **Commit** grava apenas as alterações da tarefa em `HEAD` com `git commit-tree` enquanto mantém `index.lock`, após verificar que o branch não avançou, e preserva qualquer outra alteração que você já tivesse preparado no stage.

Se o manuscrito tiver mudado nos mesmos trechos enquanto isso, nada é sobrescrito: a proposta passa por rebase sobre o manuscrito atual e retorna como uma nova revisão na mesma tarefa.

## O custo do isolamento

Comparado ao `latexmk` executado em uma cópia da mesma pasta:

| Alteração | `latexmk` na pasta | Papilot |
| --- | --- | --- |
| Editar um capítulo | 69.2 s, 1 passagem | 71.2 s, 1 passagem |
| Editar um arquivo que o TeX não lê | 0.2 s, nada a fazer | 1.9 s, sem execução do TeX |
| Abrir o artigo | 0.2 s, nada a fazer | 71.3 s, 1 passagem |

Da edição de um agente até uma rodada pronta levaram-se 23.1–47.2 s. Com a próxima compilação do manuscrito prevista durante uma revisão de 150 s, o PDF ficou pronto 0.8 s após o commit.
