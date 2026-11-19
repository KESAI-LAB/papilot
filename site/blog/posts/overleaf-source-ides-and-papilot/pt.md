Todo grupo de pesquisa acaba chegando a um acordo silencioso em torno do LaTeX. Um coautor prefere uma aba do navegador que abra em qualquer lugar sem precisar instalar uma distribuição TeX de quatro gigabytes; outro vive dentro de um editor de código local integrado ao Git, a atalhos de teclado e a um agente de programação; um terceiro imprime o PDF compilado — ou o abre em um tablet — porque só na página diagramada saltam realmente aos olhos transições frágeis, tabelas apertadas e deslizes de notação.

Quando alguém procura hoje uma configuração de LaTeX assistida por IA, raramente lhe faltam modelos de linguagem capazes. Os agentes de programação atuais já navegam por repositórios com múltiplos arquivos, seguem macros personalizadas e consertam entradas `.bib` com facilidade. O que define a qualidade da escrita no dia a dia é o **contrato do espaço de trabalho** ao redor do modelo: onde você expressa o que deve mudar, como confere o que a IA editou e se adotar uma ferramenta melhor obriga seus coautores a abandonar a deles.

Em vez de afirmar que uma única ferramenta substitui todas as outras em qualquer situação, é muito mais útil colocar lado a lado os três principais fluxos de trabalho em LaTeX — editores de navegador em tela dividida como o Overleaf, IDEs locais de código-fonte combinados a agentes de programação e o espaço centrado no PDF do [Papilot](https://github.com/PapilotAI/papilot) — e observar como a sincronização em tempo real permite que todos trabalhem juntos no mesmo manuscrito.

## O que os fluxos atuais de LaTeX resolvem bem

Antes de examinar onde a edição com IA centrada no código-fonte encontra seus limites, vale reconhecer por que o Overleaf e os editores de código locais conquistaram seu espaço na escrita acadêmica.

**O Overleaf resolveu a entrada de novos colaboradores.** Antes do TeX no navegador, começar um artigo com coautores de diferentes instituições significava depurar versões incompatíveis do TeX Live, pacotes `.sty` ausentes e conflitos de merge no Git antes mesmo de escrever o resumo. Compartilhar um link de projeto em que todos digitam no navegador e enxergam cursores caractere por caractere em tempo real continua sendo o caminho de menor atrito para equipes mistas colaborarem, sobretudo em máquinas sem uma instalação local de TeX.

**Os IDEs locais de código-fonte resolveram a escala de repositório e a automação.** Combinar VS Code e LaTeX Workshop — ou Cursor, Neovim e agentes de terminal como Claude Code ou Codex — a um repositório Git local oferece busca rápida em múltiplos arquivos, compilação offline com `latexmk`, scripts de build reprodutíveis e controle direto ao criar classes de documento `.cls`, pacotes `.sty` ou figuras programáticas em TikZ.

Ambos os fluxos esbarram no mesmo atrito exatamente no mesmo ponto: **revisar alterações substantivas feitas pela IA em um argumento ou em uma derivação real**.

![Três fluxos de trabalho em LaTeX comparados lado a lado: a tela dividida do Overleaf no navegador, um IDE de código-fonte com agente de programação e o espaço centrado no PDF do Papilot com sincronização em tempo real com o Overleaf.](/assets/blog/three-workflows.pt.svg "O Overleaf otimiza a colaboração no navegador sem configuração e os IDEs de código-fonte otimizam a edição da marcação bruta, enquanto o Papilot concentra a revisão com IA no PDF compilado e sincroniza em tempo real com o Overleaf.")

Em uma tela dividida no navegador ou em um IDE de código, o assistente de IA edita a marcação `.tex` e apresenta sua proposta como um diff de código em vermelho e verde. Em um parágrafo reescrito com novas quebras de linha, ou em uma derivação `\begin{align}` de várias linhas usando macros específicas do projeto, ler o patch exige compilar LaTeX mentalmente — ou recompilar o PDF inteiro e sair caçando o que mudou sutilmente lá na página nove.

## Comparando os três fluxos em seis dimensões

A tabela abaixo resume como cada ambiente lida com a redação diária, a revisão com IA, a verificação e a colaboração.

| Dimensão do fluxo | Overleaf (editor no navegador) | IDE de código + agente (VS Code, Cursor, CLI) | Papilot (espaço agêntico centrado no PDF) |
| --- | --- | --- | --- |
| Espaço de trabalho principal | Tela dividida: editor `.tex` à esquerda, prévia do PDF compilado à direita | Árvore de arquivos `.tex` e painéis de código, com uma aba secundária para a prévia do PDF | O próprio manuscrito compilado em PDF; o código-fonte continua disponível sob demanda |
| Como orientar edições da IA | Copiar trechos para o chat ou escrever prompts dentro do buffer `.tex` | Indicar caminho de arquivo, intervalo de linhas ou código `.tex` selecionado | Destacar texto ou contornar equações e figuras diretamente no PDF; o SyncTeX mapeia as linhas exatas do código |
| Como revisar edições da IA | Inspecionar mudanças brutas no `.tex` ou recompilar e examinar visualmente o novo PDF | `git diff` linha a linha sobre marcação LaTeX bruta | Diffs de PDF diagramados de antes e depois no próprio lugar, com alternativas por nota e alternância para o código-fonte |
| Colaboração entre coautores | Edição nativa em tempo real no navegador por links de projeto ou compartilhamento | Git push/pull; gera atrito quando os coautores preferem o Overleaf | Worktrees do Git integrados **mais** sincronização bidirecional em tempo real (~1 s) com o Overleaf |
| Escolha de modelo e agente de IA | Opções de assistente integradas à própria plataforma | Preso ao fornecedor do IDE ou a uma única ferramenta de CLI configurada | Use seu próprio login ou chave em 16 agentes: Papilot Writer integrado e 15 agentes de código (Codex, Claude, Cursor, Copilot, Antigravity, Pi, OpenCode e outros) |
| Instalação, arquivos e licença | Projeto hospedado na nuvem; dispensa instalação local de TeX | Arquivos locais em texto puro + Git + distribuição TeX | Arquivos locais em texto puro + Git + distribuição TeX; gratuito e de código aberto (MIT) |

## Colaborar sem forçar os coautores a mudar de ferramenta

O motivo mais comum pelo qual pesquisadores hesitam em adotar uma ferramenta local de LaTeX não tem nada a ver com recursos: *"Meu orientador e três coautores já estão editando no Overleaf."* Exportar um ZIP, rodar uma revisão com IA localmente e colar os arquivos `.tex` alterados de volta em uma aba do navegador é quase um convite para sobrescrever parágrafos alheios na hora.

A partir do Papilot 0.11, o recurso **Sincronizar com o Overleaf** elimina esse dilema. Você pode colar um link de projeto do Overleaf — ou um link de compartilhamento com permissão de edição — diretamente no Papilot, ou vincular uma pasta local já existente do manuscrito ao projeto correspondente no Overleaf. Enquanto o Papilot está aberto, os arquivos locais e o projeto no Overleaf permanecem alinhados pelo próprio serviço de edição em tempo real do Overleaf:

- **Atualizações de ida e volta em menos de um segundo.** As alterações que você aceita e aplica no Papilot chegam às abas do Overleaf dos seus coautores em cerca de um segundo, e o que eles digitam no Overleaf volta para os seus arquivos `.tex` locais e para o PDF compilado.
- **Mesclagem concorrente caractere por caractere.** Edições feitas no mesmo parágrafo exatamente ao mesmo tempo são mescladas caractere por caractere, do mesmo jeito que acontece entre duas abas do navegador no Overleaf.
- **Sem exigir assinatura paga para Git.** A sincronização em tempo real funciona com uma conta gratuita padrão do Overleaf (e também oferece suporte a instâncias auto-hospedadas do Overleaf), permitindo ainda isolar as tarefas da IA em worktrees locais do Git antes que qualquer mudança chegue ao rascunho compartilhado.

![Ilustração do produto Papilot mostrando uma comparação diagramada do antes e depois na página do PDF, com ações para aceitar, rejeitar e comentar.](/assets/blog/review.en.png "Revise cada alteração proposta pela IA como um diff diagramado de antes e depois antes que qualquer mudança seja aplicada ao projeto compartilhado no Overleaf.")

Trazer um manuscrito para o espaço de trabalho é igualmente direto: **Importar ou abrir** aceita URLs de artigos do arXiv (links da página de resumo, PDF ou HTML), links de visualização ou edição do Overleaf e URLs de repositórios públicos do GitHub, detectando automaticamente o arquivo `.tex` principal e o motor de compilação. E, ao começar do zero, o [Papilot Universe](https://papilot.ai/universe/) oferece modelos prontos para compilar de periódicos, teses, apresentações, pôsteres, currículos, livros e mais de 400 congressos.

## Escolhendo a ferramenta certa para cada etapa do artigo

Como o Papilot trabalha sobre arquivos `.tex` e `.bib` padrão no disco, esses fluxos são complementares em vez de mutuamente exclusivos:

1. **Use o Overleaf no navegador** quando estiver longe de uma máquina com TeX instalado, fazendo pequenos ajustes manuais de redação em um notebook emprestado ou convidando colaboradores não técnicos que preferem zero configuração local.
2. **Abra um IDE de código-fonte** quando estiver construindo pacotes de estilo `.sty` sob medida, depurando expansão de macros em baixo nível ou programando pipelines no repositório inteiro para gerar tabelas `.tex` a partir de Python ou R.
3. **Trabalhe no Papilot** ao redigir, reestruturar, conferir derivações e lapidar o próprio manuscrito com agentes de IA — quando apontar diretamente para a página diagramada e revisar cada mudança proposta como um diff de PDF renderizado de antes e depois mantém o rigor acadêmico afiado e protege o texto compartilhado até você aplicar explicitamente suas decisões.

Você pode experimentar agora mesmo no navegador o ciclo de anotação no PDF e revisão diagramada na nossa [demonstração interativa](/demo/), sem precisar instalar TeX nem configurar modelos localmente. Se esse fluxo combina com a maneira como você escreve artigos, baixe o aplicativo desktop para macOS, Windows ou Linux em [papilot.ai](/pt/) — e considere [dar uma estrela ao Papilot no GitHub](https://github.com/PapilotAI/papilot) para encontrá-lo facilmente quando começar o seu próximo prazo.
