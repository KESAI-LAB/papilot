Todo grupo de investigación acaba llegando a un pacto tácito en torno a LaTeX. Un coautor prefiere una pestaña del navegador que se abra desde cualquier lugar sin necesidad de instalar cuatro gigabytes de una distribución TeX; otro vive dentro de un editor de código local conectado a Git, atajos de teclado y un agente de programación; un tercero imprime el PDF compilado —o lo abre en una tableta— porque solo sobre la página maquetada saltan realmente a la vista las transiciones débiles, las tablas saturadas y los deslices de notación.

Cuando hoy alguien busca un entorno de LaTeX asistido por IA, rara vez le faltan modelos de lenguaje capaces. Los agentes de programación actuales ya recorren repositorios de múltiples archivos, siguen macros personalizadas y reparan entradas `.bib` con soltura. Lo que determina la calidad de la escritura cotidiana es el **contrato del espacio de trabajo** que rodea al modelo: dónde expresas qué debe cambiar, cómo verificas lo que la IA ha editado y si adoptar una herramienta mejor obliga a tus coautores a abandonar la suya.

Más que pretender que una sola herramienta reemplace a todas las demás en cualquier situación, resulta mucho más útil comparar de frente los tres flujos principales de trabajo en LaTeX —editores de navegador en pantalla dividida como Overleaf, IDE locales de código fuente combinados con agentes de programación y el espacio centrado en el PDF de [Papilot](https://github.com/PapilotAI/papilot)— y ver cómo la sincronización en tiempo real les permite convivir sobre un mismo manuscrito.

## Qué resuelven bien los flujos actuales de LaTeX

Antes de examinar dónde flaquea la edición con IA centrada en el código fuente, conviene reconocer por qué Overleaf y los editores de código locales se ganaron su lugar en la escritura académica.

**Overleaf resolvió la incorporación colaborativa.** Antes del TeX en navegador, arrancar un artículo con coautores de distintas instituciones significaba depurar versiones dispares de TeX Live, paquetes `.sty` ausentes y conflictos de fusión en Git antes siquiera de redactar el resumen. Compartir un enlace de proyecto donde todo el mundo escribe en el navegador y ve al instante los cursores carácter a carácter sigue siendo la vía con menor fricción para que un equipo heterogéneo colabore, sobre todo desde equipos sin una instalación local de TeX.

**Los IDE locales de código fuente resolvieron la escala del repositorio y la automatización.** Combinar VS Code y LaTeX Workshop —o Cursor, Neovim y agentes de terminal como Claude Code o Codex— con una copia local de Git ofrece búsquedas rápidas en múltiples archivos, compilación sin conexión mediante `latexmk`, scripts de construcción reproducibles y control directo al diseñar clases de documento `.cls`, paquetes `.sty` o figuras programáticas en TikZ.

Ambos flujos chocan con la misma fricción en idéntico punto: **revisar modificaciones sustantivas de la IA sobre un argumento o una derivación real**.

![Tres flujos de trabajo en LaTeX comparados de frente: la pantalla dividida de Overleaf en el navegador, un IDE de código fuente con agente de programación y el espacio centrado en el PDF de Papilot con sincronización en vivo con Overleaf.](/assets/blog/three-workflows.es.svg "Overleaf optimiza la colaboración en navegador sin configuración previa y los IDE de código fuente optimizan la edición del marcado crudo, mientras que Papilot centra la revisión con IA en el PDF compilado y se sincroniza en tiempo real con Overleaf.")

En una pantalla dividida del navegador o en un IDE de código, el asistente de IA edita el marcado `.tex` y presenta su propuesta como un diff de código en rojo y verde. En un párrafo reformulado cuyos saltos de línea han cambiado, o en una derivación `\begin{align}` de varias líneas con macros propias del proyecto, leer el parche obliga a compilar mentalmente LaTeX en la cabeza, o bien a recompilar todo el PDF y salir a cazar qué ha cambiado sutilmente en la página nueve.

## Comparativa de los tres flujos en seis dimensiones

La siguiente tabla resume cómo aborda cada entorno la redacción diaria, la revisión asistida por IA, la verificación y el trabajo colaborativo.

| Dimensión del flujo | Overleaf (editor en navegador) | IDE de código + agente (VS Code, Cursor, CLI) | Papilot (espacio agéntico centrado en el PDF) |
| --- | --- | --- | --- |
| Espacio principal de trabajo | Pantalla dividida: editor `.tex` a la izquierda y vista previa del PDF compilado a la derecha | Árbol de archivos `.tex` y paneles de código, con una pestaña secundaria para el PDF | El propio manuscrito compilado en PDF; el código fuente sigue disponible cuando quieras inspeccionarlo |
| Cómo dirigir cambios de la IA | Copiar fragmentos al chat o escribir prompts dentro del búfer `.tex` | Indicar ruta de archivo, rango de líneas o código `.tex` seleccionado | Resaltar texto o enmarcar fórmulas y figuras directamente sobre el PDF; SyncTeX localiza las líneas exactas del código |
| Cómo revisar cambios de la IA | Inspeccionar cambios `.tex` crudos o recompilar y rastrear visualmente el nuevo PDF | `git diff` línea por línea sobre marcado LaTeX crudo | Diffs maquetados del antes y el después en su sitio, con alternativas por nota y conmutador de código fuente |
| Colaboración entre coautores | Edición nativa en tiempo real en el navegador mediante enlaces de proyecto o de uso compartido | Push/pull en Git; genera fricción cuando los coautores prefieren Overleaf | Worktrees de Git integrados **más** sincronización bidireccional en vivo (~1 s) con Overleaf |
| Elección de modelo y agente de IA | Opciones de asistente integradas en la plataforma | Vinculado al proveedor del IDE o a una única herramienta de CLI configurada | Usa tu propia cuenta o clave en 16 agentes: Papilot Writer integrado y 15 agentes de código (Codex, Claude, Cursor, Copilot, Antigravity, Pi, OpenCode y más) |
| Instalación, archivos y licencia | Proyecto alojado en la nube; no requiere instalar TeX en local | Archivos locales de texto plano + Git + distribución TeX | Archivos locales de texto plano + Git + distribución TeX; gratuito y de código abierto (MIT) |

## Colaborar sin obligar a tus coautores a cambiar de herramienta

La razón más habitual por la que muchos investigadores dudan antes de adoptar una herramienta local de LaTeX no tiene nada que ver con sus funciones: *«Mi director de tesis y tres coautores ya están editando en Overleaf»*. Exportar un ZIP, ejecutar una revisión con IA en local y volver a pegar los archivos `.tex` modificados en una pestaña del navegador es una receta casi segura para sobrescribir párrafos ajenos al instante.

A partir de Papilot 0.11, **Sincronizar con Overleaf** elimina esa disyuntiva. Puedes pegar un enlace de proyecto de Overleaf —o un enlace compartido con permisos de edición— directamente en Papilot, o vincular la carpeta local de un manuscrito existente con su homólogo en Overleaf. Mientras Papilot está abierto, los archivos locales y el proyecto de Overleaf avanzan al unísono a través del servicio de edición en tiempo real de Overleaf:

- **Actualizaciones de ida y vuelta en menos de un segundo.** Los cambios que aceptas y aplicas en Papilot llegan a las pestañas del navegador de tus coautores en Overleaf en aproximadamente un segundo, y lo que ellos escriben en Overleaf regresa a tus archivos `.tex` locales y al PDF compilado.
- **Fusión concurrente carácter a carácter.** Las ediciones realizadas sobre el mismo párrafo en el mismo instante se fusionan carácter a carácter, exactamente igual que entre dos pestañas de navegador en Overleaf.
- **Sin necesidad del complemento de pago para Git.** La sincronización en vivo funciona con una cuenta estándar gratuita de Overleaf (y también admite instancias autoalojadas de Overleaf), al tiempo que te permite aislar las tareas de la IA en worktrees locales de Git antes de aplicar nada al borrador compartido.

![Ilustración del producto Papilot que muestra una comparación maquetada del antes y el después sobre la página del PDF, con acciones para aceptar, rechazar y comentar.](/assets/blog/review.en.png "Revisa cada cambio propuesto por la IA como una comparación maquetada del antes y el después antes de aplicar nada al proyecto compartido en Overleaf.")

Llevar un manuscrito al espacio de trabajo resulta igual de directo: **Importar o abrir** admite URL de artículos en arXiv (enlaces de resumen, PDF o HTML), enlaces de lectura o edición de Overleaf y URL de repositorios públicos en GitHub, detectando automáticamente el archivo `.tex` principal y el motor de compilación. Y si partes desde cero, [Papilot Universe](https://papilot.ai/universe/) reúne plantillas listas para compilar de revistas, tesis, presentaciones, pósteres, currículos, libros y más de 400 congresos.

## Elegir la herramienta adecuada para cada etapa del artículo

Como Papilot trabaja sobre archivos `.tex` y `.bib` estándar en disco, estos flujos de trabajo son complementarios en lugar de excluyentes:

1. **Usa Overleaf en el navegador** cuando no tengas a mano un equipo con TeX instalado, quieras hacer retoques rápidos de redacción desde un portátil prestado o invites a colaboradores de perfil menos técnico que prefieran no configurar nada en local.
2. **Abre un IDE de código fuente** cuando estés desarrollando archivos de estilo `.sty` a medida, depurando expansiones de macros de bajo nivel o programando pipelines en todo el repositorio que generen tablas `.tex` desde Python o R.
3. **Trabaja en Papilot** cuando redactes, reestructures, verifiques derivaciones y pulas el propio manuscrito junto a agentes de IA: señalar sobre la página maquetada y revisar cada propuesta como un diff de PDF compuesto del antes y el después mantiene afilado el criterio académico y protege el borrador compartido hasta que decidas aplicar explícitamente tus cambios.

Puedes probar ahora mismo el ciclo de anotación en PDF y revisión maquetada directamente desde el navegador con nuestra [demostración interactiva](/demo/), sin instalar TeX ni configurar modelos en local. Si este flujo encaja con tu forma de escribir artículos, descarga la aplicación de escritorio para macOS, Windows o Linux en [papilot.ai](/es/) y anímate a [darle una estrella a Papilot en GitHub](https://github.com/PapilotAI/papilot) para tenerlo a mano cuando empiece tu próxima entrega.
