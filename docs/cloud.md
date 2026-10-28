# Agentes en la nube

De serie, todos los agentes trabajan en tu ordenador: si cierras la oficina o apagas el portátil, se paran. Los **agentes en la nube** trabajan cada uno en una [Upstash Box](https://upstash.com/docs/box/overall/quickstart), una pequeña máquina Linux en la nube, así que siguen con su tarea mientras la oficina está cerrada. Es opcional: los agentes en tu ordenador siguen siendo lo normal, y puedes tener de los dos tipos en la misma planta.

## Qué sigue funcionando con la oficina cerrada

Un agente en la nube termina la tarea en la que está: escribe el código, ejecuta los checks, sube su rama y abre su pull request, o prueba una pull request y escribe su informe de QA. Cuando vuelves a abrir la oficina, se pone al día: lee lo que hizo cada agente en la nube mientras no estaba, pone en cola el QA de las pull requests que abrieron, publica los informes de QA que escribieron y reparte el trabajo siguiente.

La oficina en sí sigue ejecutándose en tu ordenador. Repartir trabajo nuevo, los relevos de QA entre agentes y los merges ocurren mientras está abierta. (Ejecutar la propia oficina en la nube es un paso posterior.)

## Configuración

Necesitas una cuenta de Upstash. El plan gratuito basta para probarlo.

1. **Conecta Upstash.** En la [consola de Upstash](https://console.upstash.com), abre **Box → API Keys** y crea una clave. En la oficina: consola del responsable → **Ajustes → Agentes en la nube** → pégala como *clave de API de Upstash Box*. La oficina la comprueba antes de guardarla.
2. **GitHub, una vez para todas las Boxes.** Se usa tu sesión de `gh` tal cual (la oficina lee `gh auth token` al empezar una sesión y nunca lo guarda). Más seguro: pega un [token de grano fino](https://github.com/settings/personal-access-tokens/new) limitado a los repositorios de tus plantas, con **Contents**, **Pull requests** e **Issues** en lectura y escritura.
3. **Elige dónde trabajan los agentes nuevos.** En *Dónde trabajan los agentes nuevos*, elige **Una Upstash Box cada uno**. A partir de entonces, las nuevas contrataciones trabajan en la nube, y el vestíbulo te deja elegirlo para cada candidato. Para mover a un agente que ya tienes, abre su ⚙️ Configuración y cambia *Trabaja en* mientras no tenga tarea.
4. **Inicia sesión en cada agente en la nube, una vez.** Su agente de código inicia sesión con tu propia suscripción, en su terminal: ver más abajo.

La oficina demo (`node bin/sareoffice.js --demo`) tiene una cuenta de Upstash simulada: cualquier clave vale, y sus Boxes aparecen y desaparecen sin coste. Sus inicios de sesión también son simulados (cualquier código vale), y Ajustes → Agentes en la nube → *Caducar sesiones (demo)* cierra la sesión de todas las Boxes, para ver cómo es una sesión caducada.

## Iniciar sesión en un agente en la nube

El Claude Code o el Codex de un agente en la nube inicia sesión con **tu propia suscripción** (Claude Pro o Max, un plan de ChatGPT), mediante el login propio del agente de código, ejecutado en el terminal de ese agente. Completas tú el inicio de sesión de Anthropic o de OpenAI, una vez por máquina en la nube:

1. Cuando la Box de un agente en la nube nuevo está lista, la oficina pregunta a su agente de código si tiene la sesión iniciada. Si no, el agente se marca como **necesita iniciar sesión**: no coge trabajo (una tarea que iba a empezar espera), su puesto muestra una nota 🔑 en el monitor y su ficha un botón **🔑 Iniciar sesión**. El móvil también te avisa.
2. Ve a su puesto y pulsa `E`, o toca **🔑 Iniciar sesión** (consola del responsable → Equipo, la pestaña Equipo del móvil o la vista de lista). Su terminal se abre con el inicio de sesión en marcha:
   - **Claude Code** (`claude auth login`) muestra un enlace. Ábrelo, aprueba con tu cuenta de Claude, pega en el terminal el código que te da la página y pulsa Enter.
   - **Codex** (`codex login --device-auth`) muestra un enlace y un código de un solo uso. Abre el enlace, inicia sesión en ChatGPT e introduce allí el código. (El inicio de sesión habitual de Codex espera a un navegador en la propia Box, que nadie puede abrir; este funciona desde cualquier sitio.) El código dura 15 minutos: **↻ Empezar de nuevo**, encima del terminal, muestra uno nuevo.
3. La oficina ve que el inicio de sesión ha terminado, quita la marca y arranca la tarea que esperaba.

La Box conserva la sesión (la de Claude Code en `~/.claude` y la de Codex en `~/.codex`, en el home del usuario de la Box) a través de pausas y reinicios de la oficina, así que en cada máquina en la nube se inicia sesión una sola vez. Desaparece con la Box cuando el agente se va.

**Cuando una sesión caduca** (o se revoca), la oficina lo detecta antes de la siguiente tarea del agente, o cuando su sesión falla por ello a mitad de tarea. Olvida el login muerto de su Box, lo vuelve a marcar como **necesita iniciar sesión** y retiene la tarea; al iniciar sesión de nuevo de la misma forma, la tarea continúa en la misma conversación.

**¿Prefieres no iniciar sesión Box a Box?** Una clave en Ajustes → Agentes en la nube la usan todos los agentes en la nube: una **clave de API de Anthropic** (`sk-ant-…`, se factura por token) para Claude Code, una **clave de API de OpenAI** para Codex. O, para Claude Code con tu suscripción, un token de `claude setup-token` guardado en tu entorno como `SAREOFFICE_CLAUDE_TOKEN` (Windows: `setx SAREOFFICE_CLAUDE_TOKEN "<token>"`; macOS o Linux: `export SAREOFFICE_CLAUDE_TOKEN="<token>"` en el perfil de tu shell), y después reinicia la oficina. Es un nombre exclusivo de sareoffice, así que tu propio `claude` mantiene su sesión normal, y la oficina nunca lo apunta.

## Cómo funciona

- **Una Box por agente.** La Box de un agente en la nube se crea y se configura en segundo plano cuando se le contrata o se le mueve (tarda alrededor de un minuto). Se llama `sareoffice-<office>-<agent>` y lleva la etiqueta `sareoffice`, así que se distingue de las Boxes de tus otras apps, y la oficina solo toca las suyas. La oficina instala en ella sus propias copias de los agentes de código en las versiones que admite (no las de la imagen de la Box), Playwright para las pruebas en navegador, tmux y git. La Box conserva el clon y el worktree propios del agente del repositorio de la planta entre tareas, como haría una máquina en tu ordenador.
- **Las credenciales de la oficina nunca llegan al disco de la Box.** El token de GitHub y las claves o tokens de Ajustes viajan solo como entorno de los comandos que los necesitan. git lee el token mediante un helper, no desde un fichero. Las claves que pegas se guardan en `~/.sareoffice/secrets.json` en tu ordenador, nunca en el estado de la oficina, en sus registros ni en lo que ve tu navegador. La única excepción es **el propio inicio de sesión** de un agente de código: Claude Code y Codex guardan su sesión en el home del usuario de la Box, donde el agente (que se ejecuta como ese usuario) puede leerla.
- **La oficina nunca ve un inicio de sesión.** Arranca el login propio del agente de código en el terminal del agente y transmite tus teclas y su pantalla como en cualquier terminal. Nunca lee, analiza ni guarda el enlace, el código ni la sesión, y solo pregunta si el agente de código tiene la sesión iniciada (por su código de salida). Nunca copia una sesión de tu ordenador a una Box: las condiciones de Anthropic no permiten que apps como esta recojan o guarden credenciales de Claude.ai, y las sesiones copiadas se cierran unas a otras al rotar sus tokens de refresco.
- **El terminal es en directo.** La CLI de un agente se ejecuta bajo tmux en su Box, y su puesto muestra su terminal como el de cualquier agente: míralo, escríbele, pulsa `Esc` para interrumpir. Si se cae la conexión, la oficina se reconecta; el agente ni se entera.
- **La oficina lee lo que hicieron.** Una Box no puede llegar a tu ordenador, así que la CLI de un agente en la nube escribe lo que hace (cada llamada a herramienta, cada turno terminado, su coste) en un fichero de su Box. La oficina lee ese fichero mientras está conectada y se pone al día al volver.
- **Las Boxes inactivas se pausan.** La CLI de un agente en la nube se cierra 5 minutos después de terminar, y la Box de un agente sin nada que hacer se pausa. Una Box pausada solo cuesta su disco y despierta en segundos para la siguiente tarea. Upstash también pausa una Box que nadie ha usado en un tiempo: tras una hora en el plan gratuito y seis horas en pago por uso.
- **Al irse.** Cuando un agente en la nube se va, su trabajo que no está en GitHub se guarda en `~/.sareoffice/leftovers` como parche, y después se borra su Box. **Borrar huérfanas** en Ajustes elimina las Boxes de las que esta oficina ya no tiene agente.

## Costes y límites

- Upstash factura una Box por la CPU que usa mientras trabaja, desde 0,10 $ por hora de CPU activa para una Box pequeña (2 vCPU, 4 GB). Las Boxes pausadas solo pagan su disco. Ajustes → Agentes en la nube fija el tamaño de las Boxes nuevas. Ver [los precios de Upstash](https://upstash.com/pricing/box).
- El plan gratuito permite **10 Boxes** (las pausadas cuentan) y 5 horas de CPU al mes. Ajusta *Límite de Boxes de tu plan* a tu plan: la oficina no contratará un agente en la nube por encima de él.
- Los agentes de código en la nube usan tu suscripción o tu clave de API igual que en tu ordenador, y comparten sus límites de uso.
- **OpenCode** todavía no puede ejecutarse en una Box; un agente de OpenCode se queda en tu ordenador.
- **Los repositorios vinculados** se copian en la Box en solo lectura para cada tarea en lugar de leerse desde tu ordenador.

## Seguridad

Los agentes en una Box trabajan como los agentes en tu ordenador: aprueban sus propias llamadas a herramientas, tienen sus credenciales durante una sesión y leen el texto de los issues. La diferencia es dónde: una Box es un sandbox propio, sin nada tuyo salvo el repositorio de la planta y, cuando inicias sesión en ellos, la sesión de su agente de código, que el agente puede leer como cualquier fichero de su home. Lee un issue antes de dejar que un agente lo coja, sobre todo en un repositorio público. Si crees que se ha hecho mal uso de la sesión de una Box, cierra las demás sesiones desde tu cuenta de Claude o de ChatGPT, o despide al agente (su Box se va con él). Rota un token o una clave si alguna vez se mostró o se pegó donde no debía; el token de `claude setup-token` dura un año.
