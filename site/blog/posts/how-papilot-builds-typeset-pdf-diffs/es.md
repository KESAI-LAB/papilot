Esta publicación recorre una ronda de revisión a través del código de Papilot, desde la última escritura de archivos del agente hasta tu decisión sobre la página. Las rutas se refieren al [repositorio](https://github.com/PapilotAI/papilot); las cifras provienen de [docs/performance.md](https://github.com/PapilotAI/papilot/blob/main/docs/performance.md), medidas en una tesis de 240 MB con XeLaTeX, BibTeX, minted y capítulos divididos mediante `\include`.

## Un árbol de trabajo y una instantánea

Cada tarea es un árbol de trabajo desconectado de Git creado a partir de una instantánea del manuscrito, incluidos los cambios sin confirmar (`engine/src/core/tasks.ts`). El agente se ejecuta con ese árbol de trabajo como directorio de trabajo y entorno aislado.

Una ronda comienza registrando el árbol de trabajo como un árbol de Git. Calcular el hash de una tesis en cada ronda sería lento, por lo que la instantánea pasa por un archivo de índice privado, `papilot/snapshot-index`, en el directorio Git del árbol de trabajo (el manuscrito tiene el suyo propio, `.git/papilot/working-index`). El índice se inicializa a partir de la instantánea anterior o del índice del repositorio, de modo que Git solo vuelve a calcular el hash de los archivos cuyo tamaño o fecha de modificación cambiaron. Cada instantánea se toma dos veces y se compara, para que un archivo guardado a medias no pueda producir un árbol que nunca existió en disco. En la tesis, tomar una instantánea pasó de 2.1 s a 0.1 s.

## Compilación de ambas versiones

Cada compilación se ejecuta en su propia carpeta, identificada por una clave según lo que compila, de modo que SyncTeX siempre apunta al código fuente exacto del PDF en pantalla. Empezar cada carpeta desde cero descartaría el estado de latexmk, por lo que una carpeta nueva parte de la compilación previa más cercana (`engine/src/core/build.ts`):

- **Elegir una base.** De las últimas 16 compilaciones sin errores con los mismos capítulos, ajustes y versión del compilador, se elige aquella cuyo árbol difiere del nuevo en la menor cantidad de archivos (`git diff-tree`), o la más reciente en caso de empate.
- **Clonar y luego aplicar parches.** Los archivos fuente de la base se clonan mediante copia en escritura (`cp -c -R` en APFS). Los archivos que no están en el árbol nuevo se eliminan, los archivos con el mismo objeto de Git y tamaño se conservan, y el resto se transmite desde un único `git cat-file --batch`. Los archivos de salida de LaTeX se clonan con `COPYFILE_FICLONE`. Exportar la tesis toma 0.76 s; copiar su estado de LaTeX, 0.06 s.
- **Conservar el estado de latexmk.** Los archivos `.aux`, `.bbl`, `.fdb_latexmk`, la caché de minted y el resto se reutilizan (todos excepto `.fls`). Las rutas dentro de ellos contienen la clave de caché de 32 caracteres de la carpeta. Como todas las claves tienen la misma longitud, la clave antigua se reemplaza byte por byte, lo que mantiene válidos los desplazamientos en los datos de SyncTeX (`.synctex.gz` se descomprime y se vuelve a comprimir). Luego, latexmk decide qué ejecutar, tal como lo haría en tu carpeta.

**Rondas por capítulos.** Cuando el archivo principal incluye capítulos con `\include` y cada archivo modificado pertenece a uno de ellos, cada versión se compila en una sola ejecución con `\includeonly` de los capítulos modificados. Los archivos `.aux` de los demás capítulos provienen de una compilación completa de la base de la tarea, por lo que la numeración de ecuaciones, las referencias cruzadas y las citas se mantienen correctas. Ambas versiones se compilan al mismo tiempo, con el mismo `SOURCE_DATE_EPOCH` (mediodía UTC de la fecha de la ronda, con `FORCE_SOURCE_DATE=1`), para que `\today` nunca aparezca como un cambio. La compilación de un capítulo de la tesis pasó de 68.7–88.5 s (3 pasadas, 2 ejecuciones de BibTeX) a 25.8 s (1 pasada).

**Antes de que termine el turno.** Cada archivo que el agente escribe inicia una compilación y comparación especulativas, que se cancelan con su siguiente escritura (`engine/src/core/publish.ts`), por lo que la ronda suele estar renderizada para cuando el agente se detiene.

**Una máquina, dos ejecuciones de TeX.** La vista previa del manuscrito, las rondas de cada tarea y las compilaciones especulativas comparten dos ranuras de TeX entre todos los procesos. Cuando espera una ejecución más urgente, una menos urgente se pausa con `SIGSTOP` y se reanuda más tarde (`engine/src/core/pool.ts`).

**Fallos.** Una compilación cuyos errores apuntan a archivos residuales dentro de `build/` se reintenta una vez desde una carpeta limpia. Si el documento revisado no compila, el error vuelve al agente como un turno nuevo. Si la versión base no compila, se fuerza la compilación ignorando los errores; si eso falla, la ronda muestra solo los cambios en el código fuente.

![Cuatro etapas: tomar una instantánea de la tarea en un árbol de trabajo de Git, compilar ambas versiones desde un estado de LaTeX precalentado, comparar los documentos compuestos y registrar cada decisión en un diario.](/assets/blog/review-pipeline.es.svg "Una ronda: instantánea, compilación, comparación y decisión.")

## Localizar cada cambio en la página

**Unidades en el código fuente.** El cálculo de diferencias divide el texto en palabras (o caracteres en texto CJK). Algunas construcciones se mantienen como tokens únicos: comentarios, expresiones matemáticas en línea y en bloque, grupos entre llaves, comandos con sus argumentos y entornos como `equation`, `align`, `tabular`, `verbatim`, `minted` y `tikzpicture`. Las ediciones separadas únicamente por espacios o signos de puntuación se unen, y cada edición resultante constituye una decisión con un rango exacto en el código fuente. Las imágenes y otros archivos binarios se tratan como unidades de archivo completo, y los fragmentos que modifican una misma entrada `.bib` forman una sola unidad.

**Dónde difieren los documentos.** Un proceso de trabajo extrae el texto de ambos archivos PDF con MuPDF y alinea los dos documentos palabra por palabra (`engine/src/render/effects.ts`): secuencias únicas de ocho palabras los fijan entre sí, se conserva la cadena creciente más larga de esos puntos de anclaje y se calculan las diferencias en los intervalos entre ellos. Las secuencias de al menos 20 letras y dígitos que cambiaron de lugar se registran como desplazamientos. Comparar los documentos completos permite encontrar cambios lejos del punto de edición: cada uso de una macro redefinida, ecuaciones renumeradas o una nueva entrada en la bibliografía.

**Dónde está cada edición.** SyncTeX, compilado a WebAssembly e indexado una vez por compilación, proyecta las líneas antiguas de cada edición en el PDF antiguo y las líneas nuevas en el nuevo, generando recortes de página; los recortes se delimitan en líneas que ambos documentos comparten. Luego, cada edición se clasifica como texto modificado, diseño modificado (comparación de píxeles a 2×), desplazada, compuesta de forma idéntica o sin correspondencia. Los cambios solo de tinta (tipografía, color, texto elevado o descendido) y los gráficos vectoriales se comparan por separado. Los recortes que comparten una línea impresa se fusionan en una sola región, mientras que cada edición conserva sus propios botones Accept y Reject. Las franjas en pantalla son gráficos vectoriales SVG.

Una edición solo de espacios en blanco que produce una composición idéntica se vincula a la edición real más cercana dentro del mismo párrafo, nunca a través de una línea en blanco, un `\par` o un encabezado de sección, y se mantiene como una decisión independiente.

**Cambios lejos de la edición (opcional).** Con **Track indirect changes** activado, las diferencias fuera del recorte de cada edición se rastrean hasta su causa compilando variantes: primero las ediciones sin efecto visible propio, como la definición de una macro, y luego mitades del conjunto de ediciones. Se verifica la unión de las causas, se muestran hasta tres ubicaciones debajo de cada edición y el resto se carga bajo demanda.

## Las decisiones como un diario

Una decisión nunca escribe directamente en tu carpeta. Cada una se registra en un diario de SQLite con los bytes esperados y de destino de cada escritura, se verifica contra el disco y se revierte si algún paso falla (`engine/src/core/review.ts`):

- **Accept** registra el cambio en una confirmación privada, `refs/papilot/<task>/accepted`.
- **Reject** revierte el cambio en el árbol de trabajo mediante una fusión de tres vías, de modo que los pasajes editados posteriormente no se tocan. Mientras el agente está trabajando, los rechazos esperan hasta que termine su turno.
- **Undo** deshace la última decisión.
- **Apply** fusiona los cambios aceptados en tus archivos de trabajo, también mediante tres vías. **Commit** escribe únicamente los cambios de la tarea sobre `HEAD` con `git commit-tree` mientras mantiene `index.lock`, tras comprobar que la rama no se ha movido, y conserva cualquier otro cambio que tuvieras preparado en el área de preparación.

Si el manuscrito cambió en los mismos pasajes mientras tanto, no se sobrescribe nada: la propuesta se reubica sobre el manuscrito actual y regresa como una nueva revisión dentro de la misma tarea.

## El costo del aislamiento

Comparado con `latexmk` ejecutado en una copia de la misma carpeta:

| Cambio | `latexmk` en la carpeta | Papilot |
| --- | --- | --- |
| Editar un capítulo | 69.2 s, 1 pasada | 71.2 s, 1 pasada |
| Editar un archivo que TeX no lee | 0.2 s, nada que hacer | 1.9 s, sin ejecutar TeX |
| Abrir el artículo | 0.2 s, nada que hacer | 71.3 s, 1 pasada |

Desde la edición de un agente hasta una ronda lista transcurrieron entre 23.1–47.2 s. Al predecir la siguiente compilación del manuscrito durante una revisión de 150 s, el PDF estuvo listo 0.8 s después de confirmar los cambios.
