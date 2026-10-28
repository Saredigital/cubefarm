# Cómo funciona sareoffice

Los detalles de la oficina: cómo un issue se convierte en una pull request fusionada, quién hace qué y qué pueden hacer los agentes en tu máquina. Para empezar, ver el [README](../README.md); para qué es un agente, cómo crece y se reduce un equipo y la máquina de cada agente, ver [Agentes](agents.md).

## Cómo recorre un issue la oficina

1. **Backlog.** Un issue se asigna a un agente, o bien tú (Kanban, panel del terminal o consola del responsable) o bien automáticamente cuando la **autoasignación** está activada en esa planta. Cualquier agente puede coger cualquier tarea, y la autoasignación los mantiene a todos ocupados mientras haya trabajo que pueda empezar. Terminar va antes que empezar: las PRs que esperan QA o correcciones van antes que los issues nuevos.
   - Un issue que dice `Depends on #N` espera a que #N esté cerrado. Del resto, van primero los que bloquean la cadena más larga de otros issues, y después los más antiguos. Un issue con la etiqueta `swarm:skip`, `wontfix` o `question` se deja en paz.
   - Si una sesión falla, su issue vuelve al tablero para otra persona, y el agente recibe trabajo nuevo tras una pausa de dos minutos. Un issue que falla dos veces espera a que lo asignes a mano.
   - Si Claude rechaza una sesión porque has alcanzado tu límite de uso, la oficina no empieza trabajo nuevo hasta que se reinicia el límite.
   - Antes de eso, cuando Claude avisa de que el uso está alto, la oficina se frena hasta que se reinicia la ventana (una hora si Claude no lo dice): QA, correcciones y trabajos del CEO empiezan como siempre, pero los issues nuevos solo empiezan mientras haya menos sesiones en marcha que **Sesiones mientras se frena** (consola del responsable → Ajustes, 3 por defecto). Tu móvil recibe un mensaje cuando empieza y cuando termina el frenado.
   - Mientras se frena (o se pausa), una etiqueta bajo la tarjeta de la planta dice hasta cuándo, y las tarjetas del backlog en el Kanban muestran **⏸ frenado**. ¿Has recargado o se ha reiniciado tu uso? **Volver a toda velocidad** (consola del responsable → Centro de control, o `E` en el medidor de uso del vestíbulo) termina el frenado al momento, y los avisos posteriores sobre la misma ventana se ignoran. Una pausa después de que Claude rechazara una sesión no se puede quitar antes de tiempo.
2. **En curso.** La máquina del agente trae el repositorio a su propio clon, y su worktree pasa a la rama `swarm/issue-<n>-<agent>`, creada desde la rama por defecto. El agente de código arranca ahí con el texto del issue. Implementa el cambio, ejecuta los checks del proyecto, sube la rama y abre una PR con `gh pr create` que dice `Closes #<n>`.
3. **En QA.** Un agente libre saca la cabeza de la PR en su propio worktree y la prueba en una **sesión nueva**: QA nunca reanuda la sesión que construyó la PR. Va a un agente distinto del autor: el autor sigue con otro trabajo y la prueba el siguiente agente que quede libre. El autor prueba su propia PR, siempre en una sesión nueva, solo cuando nadie más de la planta puede, o nadie más ha quedado libre en 15 minutos, así que una planta de un solo agente nunca se atasca. Quien prueba:
   - lee la PR y el issue enlazado para sacar los criterios de aceptación
   - revisa el diff como un revisor de código: bugs, errores sin tratar y casos límite, problemas de seguridad, código de depuración olvidado, tests que faltan
   - ejecuta la batería de tests, los linters y la build, salvo que la PR tenga checks de GitHub: entonces se le dice lo que dicen en ese momento, lee qué cubren y ejecuta solo lo que necesita el cambio (un check que falla es un hallazgo)
   - prueba la funcionalidad en un navegador real sin interfaz (Playwright), incluidos tamaños de móvil y casos límite, con capturas de cada estado importante
   - devuelve un informe estructurado: un veredicto, las comprobaciones hechas, los comandos ejecutados y un pie para cada captura
4. **Pruebas en la PR.** El servidor sube las capturas a una rama huérfana llamada `swarm-qa-evidence`, para que las pruebas nunca acaben en tu código, y publica un comentario en la PR con el veredicto, una tabla de comprobaciones, los comandos ejecutados y las capturas.
5. **Falla → corregir → volver a probar.** Si QA falla, el informe vuelve al agente que escribió la PR, que reanuda su propia sesión y sube las correcciones a la misma rama. Si está ocupado con otra cosa, la corrección la coge cualquier agente libre. La PR vuelve entonces a QA para la siguiente ronda, que comprueba primero los hallazgos de la ronda anterior, y después prueba lo que ha cambiado desde el commit que probó la última vez más una prueba rápida del flujo principal. Una PR que ya entra en conflicto con la rama por defecto vuelve a su autor para que lo resuelva antes de que QA la pruebe. A una sesión de corrección que no sube nada se le pide una vez más que suba, o que explique por qué no hay nada que cambiar (y entonces QA la vuelve a probar). Tras 6 rondas de QA fallidas, o 3 sesiones de corrección seguidas que fallan o no suben nada, se marca como **te necesita**.
6. **Merge.** Cuando QA la aprueba, la PR pasa a **Lista para merge**. Con el **auto-merge** activado en la planta (por defecto; cámbialo en la consola del responsable o en el tablero Kanban), la oficina se encarga a partir de ahí:
   - Espera a los checks de GitHub (Actions, Vercel, etc.) y fusiona en cuanto están en verde, pero solo el commit exacto que aprobó QA. Los commits subidos después de la aprobación vuelven a pasar por QA.
   - Si los checks fallan, o la PR entra en conflicto con la rama por defecto porque otro trabajo se fusionó antes, un agente libre recibe los checks que fallan o el conflicto, corrige la rama y QA la vuelve a probar si el código ha cambiado (tras corregir un conflicto, una revisión más ligera del merge, CI y la funcionalidad). Tras 5 correcciones así se marca como **te necesita**.
   - Hace squash-merge (o un commit de merge si el repositorio no permite squash), borra la rama remota y actualiza antes la rama si el repositorio solo fusiona ramas al día.
   - Si GitHub rechaza el merge (por ejemplo, la protección de rama pide una revisión aprobatoria), tu móvil recibe un mensaje y la oficina lo reintenta cada 10 minutos. Los checks que siguen en marcha a los 30 minutos también generan un mensaje.
   - Solo se fusionan solas las ramas `swarm/`. Las PRs que abrieron personas se dejan para ti.

   Una PR atascada (3 rondas de QA fallidas, 3 correcciones de merge o sesiones de corrección que siguen fallando) va primero al CEO: su tarjeta dice **🧭 El CEO lo está mirando** mientras el CEO lee el informe de QA y los checks, y después reintenta QA, la devuelve para corregir con una nota, vuelve a lanzar un check inestable o la cierra (su issue sigue abierto, para construirlo de nuevo). Solo muestra **te necesita**, con un mensaje al móvil, cuando el CEO la escala con un diagnóstico de una línea, termina sin actuar o la PR se atasca por tercera vez.

   Con el auto-merge desactivado, revisa la PR en GitHub, incluido el comentario de QA, y pulsa **Merge** (squash) en el tablero. Fusionar una PR que no ha pasado QA te pide confirmación primero. En cualquier caso, el autor ve el merge, lo celebra y vuelve al backlog.
7. **Tu carpeta se pone al día.** Tras cualquier merge, la carpeta de la planta hace fast-forward a la rama por defecto, pero solo cuando está en esa rama y sin cambios locales. Nunca se hace stash, reset ni se descarta nada; si no, la consola del responsable muestra por qué no se actualizó (`2 behind: local changes in package-lock.json`, `on branch feature-x`, `diverged`). Si cambiaron `package.json` o el lockfile, ejecuta `npm install`. **Sincronizar ahora** en la consola del responsable lo reintenta.

   La carpeta de la propia oficina es la excepción: actualizarla reiniciaría la oficina a mitad de trabajo, así que muestra `update ready` y la fila **Oficina**, arriba en la consola del responsable, toma el relevo. Cuando la oficina la arrancó su lanzador (`npm start`, `npm run dev`) y **Actualizar automáticamente** está activado, o pulsas **Actualizar ahora**, la oficina se vacía: no empieza issues, QA ni trabajos del CEO nuevos y deja terminar las sesiones en marcha. Cuando ya no hay nada en marcha (o a los 20 minutos, cuando las sesiones que quedan se paran y su trabajo vuelve a la cola), pasa la actualización al lanzador, que trae los cambios, instala, construye y la reinicia; después tu móvil dice a qué commit pasó, o por qué se deshizo la actualización. **Más tarde** la pospone 2 horas, o hasta que llegue un commit más nuevo. Arrancada de cualquier otra forma, la oficina solo avisa de la actualización.

**Cerrar un issue o una PR** (su **Cerrar** en la consola del responsable → Issues o en su tarjeta del Kanban, las herramientas del CEO, o en GitHub) recoge lo que deja: quien esté trabajando en ello se para, como con ■ Parar, su puesto se despeja y tu móvil dice a quién se paró y por qué. Se descartan el QA y las correcciones en cola de una PR cerrada, y nada empieza en un issue o una PR que GitHub dice que está cerrado. Los cierres hechos en la oficina tienen efecto al momento, y los de GitHub en la siguiente sincronización. Un merge no es un cierre: no corta la sesión de nadie. Cerrar una PR nunca cierra su issue, y nunca lo vuelve a repartir por sí solo: el issue espera en el Backlog, marcado con ⏸, hasta que lo asignes (o lo cierres). El cierre por triaje del CEO es la excepción: cierra una PR para que su issue se vuelva a construir.

Las PRs abiertas por personas, no por agentes, aparecen en **En QA** como "sin probar todavía", con un botón **Mandar a QA**.

Puedes escribir a un agente en cualquier momento. Mientras trabaja, el mensaje se inyecta en su sesión en directo. Después de construir o corregir algo, el mensaje reanuda su sesión, p. ej. "el CI ha fallado, corrige los errores de lint".

## QA

- QA es una tarea, no un puesto: cualquier agente libre prueba una PR, en una sesión nueva, con los mismos ajustes de modelo y esfuerzo que para cualquier otra cosa. Puedes dar una PR a un agente concreto: deja su pósit en su puesto, o elígela en el panel de su terminal.
- Las instrucciones de QA le dicen al agente que no suba, comente, revise, fusione ni edite PRs ni issues: la oficina publica su informe por él.
- QA es automático en todas las PRs de una rama `swarm/`, esté o no activada la autoasignación.

## El equipo

Los agentes son intercambiables: sin cargos, descripciones de puesto ni especialidades, y sin laboratorio de QA. Una planta tiene hasta 10 (Ajustes → **Máximo de agentes por planta**, como mucho 15: la sala tiene 12 puestos en la zona abierta y 3 junto a la pared este). Conectar un repositorio sienta a un agente en un puesto; el CEO dimensiona el equipo a partir de ahí (ver [Agentes](agents.md)).

Cuando el CEO amplía un equipo (y apruebas los cambios de equipo, que es lo normal), cada candidato espera en el vestíbulo: seis sillas junto a la puerta de cristal, cada uno con el aspecto que tendrá cuando se le contrate, y una etiqueta con el nombre del agente de código que usará (si son más de seis: "+N esperando" en el cartel). Pulsa `E` en uno para configurarlo antes de crearlo: su nombre, agente de código, modelo y esfuerzo de razonamiento, el motivo del CEO y una nota que lee el CEO. **Contratar** y te da la mano y sube en el ascensor a su planta, donde recibe una visita de bienvenida (la pizarra, el gong, un compañero saludando en cada parada) antes de sentarse; si entra trabajo por el camino, va directo a su puesto. **Rechazar** y asiente con educación y se va por la puerta. Un equipo más pequeño es un sobre en el puesto del agente que el CEO eligió para irse (uno sin trabajo si lo hay). Decidir en el móvil (👥 Equipo) o en la consola del responsable funciona igual, y la gente del edificio reacciona en cualquier caso. Con Ajustes → **Cambios de equipo del CEO: Aplicarlos directamente**, los agentes nuevos entran al momento y los que no tienen trabajo se van al momento; uno ocupado se va cuando termina su tarea. En la oficina demo, Equipo en el móvil puede ampliar o reducir una planta a demanda.

Los agentes reciben nombres de una lista de pioneros de la informática y detectives de ficción. El aspecto de cada personaje sale de su nombre, así que Ada, Grace y Marple se dibujan con melena, coleta o moño. Puedes cambiar el nombre o el aspecto de cualquier agente en la consola del responsable → Equipo, o en la ⚙️ Configuración de arriba de su propio panel (abre su puesto), que también tiene su agente de código, modelo y esfuerzo. Los cambios se aplican desde su siguiente tarea. **Qué se le dice**, en esa misma Configuración, muestra el prompt que la oficina le da para cada tipo de tarea (construir un issue, probar una PR, corregirla); el del CEO está en la pestaña CEO de la consola.

El resto de su aspecto sale de su id (pelo, gafas, ropa, complexión, etc.); el CEO lleva americana y acreditación. **Aspecto**, en su Configuración, tiene una vista previa en directo y cambia cualquier cosa (pelo, color de pelo, tono de piel, vello facial, gafas, sombrero, ropa, color de acento, complexión); los cambios se guardan al momento, se ven en su personaje enseguida, y **Volver a su aspecto original** los deshace. Sus caras siguen lo que hacen: concentrados mientras trabajan, desconcertados cuando los checks de su PR se ponen en rojo o QA la suspende, estresados tras una larga pelea con una PR, felices mientras celebran un merge y orgullosos después, con sueño tras mucho rato sin trabajo.

## Centro de control

**Ajustes → Centro de control** muestra cómo va la empresa, por proyecto y en total: el flujo (issues listos para
empezar, en construcción, en QA, en corrección, listos para fusionar), los merges de hoy y de la última hora, y lo que
te necesita: una PR atascada o un agente que lleva más de 10 minutos en un error, con sus arreglos de un clic. El
medidor de uso de Claude está en la barra lateral del panel: normal, frenado o pausado, y cuándo se reinicia.

El servidor calcula las cifras con lo que ya sabe más una semana móvil de merges, veredictos de QA, ejecuciones de
checks y costes de sesión guardada en el fichero de estado, y las envía al navegador como el evento `ops`.

## Modelos y uso

- Por defecto, los agentes usan **Claude Code con Claude Opus 5.5 (`claude-opus-5-5`) y esfuerzo medio**. En la consola del responsable, Ajustes fija el agente de código por defecto, su modelo y el esfuerzo; la pestaña Equipo cambia cualquiera de ellos por agente. El modelo por defecto pertenece al agente de código por defecto: un agente con otro usa el modelo por defecto de ese agente salvo que le pongas uno. El CEO usa Claude Code, con su propio modelo y esfuerzo en la pestaña CEO.
- Los agentes usan tu **suscripción** de Claude: el servidor quita `ANTHROPIC_API_KEY` y todas las demás variables `CLAUDE_*` / `ANTHROPIC_*` heredadas antes de arrancar cada agente, así que Claude Code usa tu sesión. Los agentes de Codex y OpenCode usan la sesión que tengan esas CLIs, y no cuentan para el frenado por uso de Claude.
- Todos los agentes tiran de los mismos límites de uso de la suscripción. Por defecto, todos los agentes con trabajo se ejecutan a la vez; pon un **Límite de sesiones** en la consola del responsable para acotarlo. Cuando se alcanza un límite, el terminal del agente lo muestra.

## Los terminales de los agentes

Por defecto (consola del responsable → Ajustes → **Cómo se ejecutan los agentes: Terminales reales**) cada agente es la CLI de código de verdad en su propio pseudoterminal en tu máquina. Abre un puesto para verlo en directo; haz clic en el terminal para escribir en él (mientras tiene el foco, `Esc` va al agente, que interrumpe su turno: la oficina cuenta entonces al agente como parado, igual que con el botón Parar, y lo que escribas después en su prompt es un seguimiento). La oficina guarda una copia de la pantalla y el historial de cada agente, así que un terminal abierto tarde muestra todo lo anterior, y se guarda en `<SWARM_HOME>/terminals/` para que sobreviva a un reinicio. El cuadro de mensaje bajo el terminal escribe en él por ti o, cuando el agente no está en marcha, reanuda su sesión.

- **Claude Code** (el de por defecto; la oficina ejecuta la copia que viene con el Agent SDK, la misma en la que inicia sesión `npm run login`) informa de cada paso a la oficina mediante hooks HTTP pasados con `--settings`: cada llamada a herramienta (el hook además la aprueba, así que la CLI nunca se para a preguntar), cada turno terminado con su mensaje final, los fallos y, por su línea de estado, el coste y los límites de uso para el frenado. La línea de estado bajo su prompt muestra quién es el agente y en qué está.
- **Codex** y **OpenCode** (experimentales) se ejecutan si están instalados: elige uno para todos (Ajustes → *Agente de código por defecto*) o por agente (Equipo). Reciben el mismo prompt y las mismas instrucciones, y avisan a la oficina cuando termina un turno (el programa `notify` de Codex, un plugin de OpenCode). Codex recibe además los hooks de la oficina (`-c hooks.*`, que solo informan de sus pasos, y Esc como `Interrupt`), pero Codex solo ejecuta hooks cuando confías en ellos: la primera vez, Codex pide revisarlos, la oficina sigue sin ellos y su registro explica cómo confiar en ellos (escribe `/hooks` en el terminal de un agente de Codex y pulsa `t`). Eso vale para todas las sesiones posteriores, porque el comando del hook de la oficina nunca cambia (la dirección de la oficina viaja en `SAREOFFICE_HOOK_URL`). Hasta entonces, y para OpenCode, la oficina muestra su tarea en lugar de cada paso. Sus capturas del navegador siguen llegando a la oficina: el servidor Playwright de cada sesión guarda sus instantáneas y capturas sin nombre en la carpeta propia de la sesión (no en el worktree), y la oficina recoge de ahí las imágenes nuevas, así que sus informes de QA también llevan capturas. Codex guarda cada sesión en tu propio Codex, donde las apps de Codex y ChatGPT la listan junto a tus chats, así que la oficina archiva el hilo de cada agente (`codex archive`) cuando se cierra su CLI y lo desarchiva antes de reanudarlo: están en la lista de Archivados de las apps, no en tus chats recientes. Ninguno se ejecuta en sandbox ni se para a pedir aprobación (ver el modelo de seguridad). La autoactualización de OpenCode está desactivada, porque varios agentes arrancando a la vez lo reinstalarían cada uno. El CEO siempre usa Claude Code.
- Una sesión termina cuando acaba el turno de la CLI y no coge otro prompt en 3 segundos. Después de construir o corregir, la CLI de un agente se queda en su prompt 30 minutos: escribe en ella y la oficina lo toma como un seguimiento, y el cuadro de mensaje (o la propia oficina, p. ej. para corregir los hallazgos de QA) continúa en la misma CLI. Después de QA, y para el CEO, la CLI se cierra. A partir de ahí, un seguimiento reanuda la sesión en una CLI nueva (solo la CLI que creó una sesión puede reanudarla).
- La oficina responde a la pregunta de confianza en la carpeta para sus propios worktrees (moviéndose primero a "Yes" donde la CLI selecciona "No"). Cualquier otra cosa que pregunte una CLI antes de arrancar (iniciar sesión, pantallas de primer uso) te espera en su terminal, y el registro del agente lo dice.
- **Los agentes siguen trabajando mientras la oficina se reinicia** (una actualización, un cambio de código durante el desarrollo, un fallo). Las CLIs se ejecutan en el *guardián de terminales* de la oficina (`server/ptyHost.ts`), un pequeño proceso propio que la oficina arranca y con el que habla por un socket local (una tubería con nombre en Windows, `<SWARM_HOME>/pty.sock` en el resto, con un secreto en `<SWARM_HOME>/pty.secret`). Sus hooks también van al guardián, que retiene cada uno mientras la oficina no está, así que ninguno falla y no se pierde nada. Cuando la oficina vuelve, recoge cada CLI de nuevo en el terminal de su agente (lo que imprimió entretanto y después un redibujado) y sigue las sesiones de los ocupados. La sesión del CEO se reanuda en su lugar, porque sus herramientas de oficina viven en la oficina. Cuando la oficina se cierra del todo (Ctrl+C), las CLIs se paran con ella, y un guardián al que no vuelve ninguna oficina en 10 minutos las para por su cuenta. Si el guardián no puede arrancar, los terminales se ejecutan dentro de la oficina y se paran cuando se reinicia, como antes.
- **Agent SDK** ejecuta Claude Code por el SDK, mostrado como un registro de sus pasos: el runtime original de la oficina.

## Modelo de seguridad

Los agentes se comportan como los agentes de código que ejecutas en tu propio terminal: cargan tu configuración (ajustes de usuario y de proyecto, `CLAUDE.md`, skills, plugins, servidores MCP y conectores de claude.ai; Codex y OpenCode su propia configuración), y nada se ejecuta en un sandbox. Encima de eso, la oficina añade sus hooks, su servidor Playwright cuando una planta prueba en navegador, las herramientas de oficina para el CEO y sus instrucciones.

Puede que nadie esté mirando para responder a una pregunta de permisos, así que la oficina aprueba todas las llamadas a herramientas (Claude Code mediante su hook PreToolUse, Codex con `--dangerously-bypass-approvals-and-sandbox`, OpenCode mediante su configuración de permisos). El flujo de trabajo de la oficina está en las instrucciones de cada agente, no impuesto: sube tu propia rama y abre una PR, nunca subas a la rama por defecto, hagas force-push ni fusiones (la oficina fusiona tras QA) y, al probar una PR, no toques GitHub porque la oficina publica el informe. `AskUserQuestion` y el modo plan siguen desactivados en Claude Code: los agentes deciden y apuntan sus suposiciones en la PR (siempre puedes escribir en el terminal de cualquier agente).

Los agentes pueden hacer todo lo que puede hacer tu propio agente de código en un terminal. Ejecuta la oficina donde ejecutarías esos agentes.

La oficina solo escucha en `127.0.0.1`, pero hay un **problema conocido sin corregir**: los WebSockets `/ws` y `/ws/term` no comprueban la cabecera `Origin`, así que una web abierta en el mismo navegador podría conectarse y escribir en el terminal de un agente. Hasta que se corrija, no navegues por webs desconocidas en el mismo navegador con la oficina abierta.

## Dónde se guardan las cosas

- `~/.sareoffice/state.json`: plantas, agentes, ajustes, historial de los terminales, los últimos 7 días del centro de control y el registro detrás de las monedas, decoraciones, trofeos y carreras de los agentes (`SWARM_HOME` cambia la carpeta)
- `~/.sareoffice/terminals/<agent>.ansi`: la pantalla y el historial del terminal de cada agente
- `~/.sareoffice/sessions/<token>/`: los ajustes, la configuración MCP y las instrucciones de una sesión de CLI en marcha (se borran al terminar); `~/.sareoffice/bin/`: los pequeños scripts con los que las CLIs llaman de vuelta a la oficina
- `~/.sareoffice/workspaces/<owner>__<repo>/main`: un clon de cada repositorio
- `~/.sareoffice/machines/<machine>/`: la máquina de cada agente: su propio clon del repositorio de la planta (`repos/`), su worktree (`work/`), reutilizado de tarea en tarea, y su carpeta temporal (`tmp/`). Quitar un agente quita su máquina, guardando antes en `leftovers/` el trabajo que no está en ninguna rama de GitHub. Un puesto sin uso durante más de **Liberar puestos sin uso tras** (consola del responsable → Ajustes, 120 minutos por defecto, 0 = nunca) pierde sus `node_modules` (a cualquier profundidad) y la salida de build y tests (`dist/`, `dist-server/`, `test-results/`, `playwright-report/`, `.swarm-home/`, `.preview-tmp/`, `.playwright-mcp/`), una vez por periodo sin uso; los ficheros fuente con y sin seguimiento se quedan, y la siguiente tarea vuelve a instalar. La oficina lo comprueba cada 15 minutos, nunca toca un puesto ocupado ni el de una vista previa en marcha, y tu móvil dice cuánto ha liberado. Una carpeta que Windows aún tiene bloqueada se vuelve a intentar la próxima vez.
- `~/.sareoffice/leftovers/<owner>__<repo>/`: el trabajo guardado de los puestos que la oficina ha limpiado
- `~/.sareoffice/secrets.json`: la clave de ElevenLabs y los webhooks de las apps de chat; `~/.sareoffice/push.json`: las claves de Web Push y las suscripciones de tus dispositivos ([docs/pocket.md](pocket.md))

Cada 30 minutos (y cuando arranca una planta o se despide a alguien) la oficina limpia cada planta: quita las máquinas y puestos que ya nadie usa y las ramas `swarm/issue-*` y `qa/pr-*` terminadas que nadie tiene sacadas ni tienen una PR abierta, en el checkout de la planta y en el clon de cada máquina. Un puesto con cambios sin commit en ficheros con seguimiento o con commits sin subir se guarda antes como `.patch` en `leftovers/`, y una carpeta que un programa aún tiene abierta se deja para la siguiente limpieza. Tus propias ramas y worktrees fuera de `desks/` nunca se tocan.

Los espacios de trabajo viven fuera de este proyecto a propósito: los agentes que trabajan en ellos nunca cogen el `CLAUDE.md` de este proyecto.

Desconectar una planta nunca borra nada en GitHub, y deja el clon en disco.

## Funciones de la oficina 3D retiradas

La presencia compartida (visitantes), el time-lapse, el clima, los temas festivos, el ping-pong y la decoración con
monedas eran parte de la oficina 3D y se retiraron con ella, en el cliente y en el servidor. Las carreras de los agentes
y los logros siguen: se ven en Ajustes → Equipo y en el chat.

## Una empresa grande

Diez proyectos de quince agentes ocupados es la referencia. Cada pestaña dice a la oficina lo que muestra (el proyecto
abierto, un terminal, las tarjetas de los agentes) y recibe las líneas de terminal solo de esos agentes, más la última
de cada uno; los cambios de agentes y proyectos llegan agrupados cada 250 ms (`server/outbox.ts`), y
`server/scale.test.ts` fija sus presupuestos. `node bin/sareoffice.js --demo --floors 10 --agents 15` monta una empresa
demo así de grande.

## Conexiones entre plantas

En la consola del responsable, cada planta puede **vincularse** a otros repositorios conectados. Los agentes de esa planta tienen acceso de lectura a los clones de los repositorios vinculados (por ejemplo, un equipo de frontend que necesita leer el repositorio de la API) y se les habla de ellos en sus instrucciones.

## Vistas previas de las plantas

Cada planta puede ejecutar su app para que la abras y la uses desde la oficina. El lado del servidor:

- `POST /api/repos/:repo/preview` la arranca en la rama por defecto, o `{ "pr": 12 }` en una pull request abierta (y la reinicia si ya está en marcha con otra referencia). `DELETE /api/repos/:repo/preview` la para. Una vista previa por planta.
- Se ejecuta en su propio worktree, `workspaces/<owner>__<repo>/desks/preview` (rama `swarm-preview`), nunca en el checkout principal de la planta.
- Su puerto está reservado para la planta: **6300 + número de planta** (se sube 100 si choca con el `SWARM_PORT` de la oficina o con otra vista previa). Nunca usa el 4317, el 5317 ni el rango 5200-5899 de los agentes. Si otra cosa ya tiene el puerto, la vista previa informa de un error y deja ese programa en paz.
- Estados: `preparing` (checkout) → `installing` (`npm ci` con lockfile, si no `npm install`; se salta cuando `package.json` y el lockfile no han cambiado desde la última instalación) → `starting` → `running` (cuando el puerto acepta conexiones; 3 minutos de tiempo límite), o `error` / `stopped`. El campo `preview` del repositorio lleva el estado, la URL, la referencia, el commit corto, la hora de inicio, el error y las últimas 40 líneas del registro, y se envía por el websocket.
- Las vistas previas se paran cuando se desconecta su planta y cuando el servidor recibe SIGINT/SIGTERM; lo que quede tras un cierre forzado se limpia en el siguiente arranque, y todas las vistas previas aparecen como `stopped` tras un reinicio.

**Configurarla** (`PATCH /api/repos/:repo` con `previewCommand` y `previewEnv`, o la herramienta `set_floor_profile` del CEO con `preview_command` / `preview_env`):

- `previewCommand`: un comando de shell ejecutado desde la raíz del worktree (`cmd.exe` en Windows). `null` o `""` significa el de por defecto: `npm run dev`, si no `npm run start`, si no `npm run preview`. A los scripts `vite` sin más se les añade `-- --port {port} --strictPort`, porque Vite ignora `PORT`. Sin comando y sin `package.json`, queda `unconfigured`.
- `previewEnv`: variables de entorno extra (valores de texto). Se rechazan los nombres `ANTHROPIC_*` / `CLAUDE_*`. Cualquier número de variables, hasta 16.000 caracteres en total, contando cada una como `KEY=value` más 2 (`shared/previewEnv.ts`): el entorno se suma al de la oficina en el proceso de la app, que Windows limita a 32.767 caracteres.
- Marcadores, sustituidos en el comando y en los valores del entorno: `{port}` es el puerto de vista previa de la planta; `{tmp}` es una carpeta temporal dentro del worktree de la vista previa (`.preview-tmp`, fuera de git status).
- `PORT={port}` siempre se define. La app recibe el entorno de la oficina sin `ANTHROPIC_*`, `CLAUDE_*` ni las variables `SWARM_*` propias de la oficina.

Ejemplo, este repositorio viéndose a sí mismo (una oficina demo en el puerto de la planta, con su estado en la carpeta temporal):

```json
{ "previewCommand": "npm run build && node --import tsx server/index.ts --demo",
  "previewEnv": { "SWARM_PORT": "{port}", "SWARM_HOME": "{tmp}" } }
```

En modo `--demo` no se ejecuta git ni npm: arrancar una vista previa sirve una pequeña página de relleno ("<planta> app · <ref>", con un contador de clics) en el puerto de la planta.

### La sala de PRs

Cualquier PR abierta puede ejecutarse junto a la vista previa principal de la planta, para que la pruebes antes de que se fusione. La fila de abajo de la pantalla grande tiene un canal por PR abierta (apunta a uno y pulsa E), y el visor de la app tiene los mismos canales: "main" y "PR #12 · título · ✅ QA aprobado".

- `POST /api/repos/:repo/pr-previews/:n` arranca la vista previa de la PR #n (se deja como está si ya está en marcha; `{ "restart": true }` la vuelve a ejecutar desde la última cabeza de la PR). `DELETE` la para. Las vistas previas están en el `prPreviews` del snapshot y en los eventos `prPreview` / `prPreviewRemoved`.
- Ejecuta el comando y el entorno de vista previa de la planta, desde un worktree de hueco: `desks/preview-pr-1` o `desks/preview-pr-2` (rama `swarm-preview-pr-<slot>`). Un hueco que pasa a otra PR de la misma planta conserva sus `node_modules`, así que la instalación se salta cuando las dependencias coinciden.
- Puertos: 100 por encima de las vistas previas de las plantas, un carril por hueco (6401, 6403 … y 6402, 6404 …), saltándose los puertos de la oficina, los de otras vistas previas y cualquiera que ya esté escuchando. `SWARM_PREVIEW_PORT` mueve los dos rangos (6300 por defecto); solo lo necesitan las oficinas de pruebas.
- Como mucho **2** vistas previas de PR a la vez. Una tercera para la que nadie ha mirado desde hace más tiempo (primero una que haya fallado); una que está en pantalla nunca se para para hacer sitio.
- Un visor abierto dice qué PR tiene en pantalla (`POST /api/previews/watch`, cada 30 segundos). Una vista previa de PR se para tras **20 minutos** fuera de pantalla (`SWARM_PR_PREVIEW_IDLE_MIN` lo cambia, admite fracciones, para los tests), cuando su PR se fusiona o se cierra, y cuando se para la oficina. Su worktree se va con ella; el siguiente arranque de la oficina limpia lo que dejara una parada forzada.
- **Comparar con main** pone main a la izquierda y la PR a la derecha, con la misma ruta en ambas. **Sincronizar desplazamiento** muestra cada lado a través de un pequeño proxy de paso (`POST /api/repos/:repo/preview/sync`, un puerto que elige el sistema, en loopback) que añade un script a las páginas HTML, para que cada lado siga el desplazamiento y los enlaces del otro. Funciona con páginas web normales que desplazan la propia página.
- El panel lateral muestra los checks de GitHub de la PR y el último informe de QA: resumen, comprobaciones y capturas. Las capturas de QA de la última ronda de una PR se guardan en `<SWARM_HOME>/qa-shots/` (servidas en `/api/repos/:repo/pulls/:n/qa-shots/:i`) hasta que la PR sale de QA.
- En modo `--demo`, una vista previa de PR es su propia página de relleno: el número y el título de la PR, una fila resaltada de "nuevo en esta PR" y páginas Inicio / Acerca de para probar la sincronización de rutas y desplazamiento.

## Actualizar la oficina

Ejecutada desde un clon de este repositorio, la oficina tiene un proceso padre, el lanzador `scripts/office.mjs`. `npm start` ejecuta bajo él la oficina construida (`bin/sareoffice.js`: las comprobaciones de siempre y después `dist-server/` sirviendo `dist/`); `npm run dev` y `npm run demo` añaden `--dev`: el servidor desde el código fuente más Vite (en `SWARM_CLIENT_PORT`, 5317 por defecto), con el servidor reiniciado cuando cambia código en `server/` o `shared/`. Arranca el servidor con un canal IPC y `SWARM_LAUNCHER=1`.

Cuando la oficina ha terminado su trabajo y pide una actualización (`{ type: 'office:update', from }`), o cuando escribes `u` + Enter en el terminal del lanzador, el lanzador:

1. Pausa el vigilante de ficheros y para la oficina: envía al servidor `{ type: 'office:shutdown', restart: true }` (el servidor para sus vistas previas y sale; las CLIs de los agentes siguen en el guardián de terminales), para Vite y mata lo que siga en marcha a los 20 segundos, árboles de procesos incluidos (`taskkill /T /F` en Windows).
2. Comprueba la carpeta: solo en la rama por defecto de origin, sin cambios locales y sin commits locales. Si no, no cambia nada. Nunca se hace stash ni se descarta nada.
3. Ejecuta `git fetch` y `git merge --ff-only origin/<default>`.
4. Ejecuta `npm install --no-save` si cambiaron `package.json` o `package-lock.json`. Esto solo ocurre cuando no hay nada en marcha, porque Windows bloquea los binarios de esbuild y de Rollup mientras se usan. `--no-save` deja el lockfile tal como llegó, para que otra versión de npm no lo convierta en un cambio local que bloquee la siguiente actualización.
5. Con `npm start`, ejecuta `npm run build`.
6. Escribe `<SWARM_HOME>/last-update.json`: `{ from, to, ok, error?, installed, built, at }`. Aquí `to` es el commit que ejecuta la oficina después, `installed` y `built` dicen si se ejecutaron npm install y la build, y `at` es una marca de tiempo en milisegundos. Después vuelve a arrancar la oficina, y el servidor informa del resultado en tu móvil.

Si falla un paso, el lanzador vuelve atrás con `git reset --keep <from>`, que nunca toca los cambios locales. Reinstala las dependencias antiguas si se ejecutó npm install, reconstruye si se ejecutó una build, arranca la versión antigua y escribe `ok: false` con el error. Una actualización rechazada (otra rama, cambios locales) también escribe `ok: false`.

Ctrl+C (o SIGTERM) para el servidor, luego Vite, y no deja procesos atrás; púlsalo dos veces para salir al momento. El lanzador es solo para un clon: `node bin/sareoffice.js` y un `node --import tsx server/index.ts` sin más no lo tienen, así que ahí la oficina solo avisa de que hay una actualización lista.

Como sareoffice no se publica en npm, desplegar una versión nueva es fusionar en `main` de [Saredigital/cubefarm](https://github.com/Saredigital/cubefarm): cada oficina arrancada con `npm start` la recoge sola así.
