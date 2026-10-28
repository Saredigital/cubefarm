# Agentes

Cómo entiende sareoffice a sus agentes: agentes de código intercambiables, cada uno en una máquina propia, y cómo crece y se reduce el equipo de una planta. Para la vida de un issue y de una pull request, ver [Cómo funciona](how-it-works.md).

## Un agente es un agente

Todos los agentes son lo mismo: una sesión de agente de código (Claude Code, Codex u OpenCode) esperando trabajo. No hay roles, cargos, descripciones de puesto ni especialidades, ni testers de QA separados de los desarrolladores. Sea lo que sea lo siguiente en el tablero de la planta, lo coge cualquier agente libre:

- **Construir un issue**: un worktree con rama nueva, el cambio, los checks del proyecto, una pull request.
- **Hacer QA de una pull request**: revisar el diff, ejecutar los checks, probarla en un navegador, informar.
- **Corregir una pull request**: los hallazgos de QA, checks que fallan o un conflicto de merge, subido a la misma rama.

Lo que hace independiente a QA es una **sesión nueva**, no un tipo distinto de agente: una ronda de QA nunca reanuda la sesión que construyó la pull request. QA va a un agente distinto del autor: el autor sigue con otro trabajo y la prueba el siguiente agente que quede libre. El autor prueba su propia pull request (en una sesión nueva) solo cuando nadie más de la planta puede, o nadie más ha quedado libre en 15 minutos, así que una planta de un solo agente nunca se atasca.

Las correcciones vuelven al autor de la pull request mientras esté disponible (tiene la sesión y el worktree), y si no, a cualquier agente libre.

Un agente tiene nombre y aspecto, para darle personalidad, y tres ajustes: su **proveedor** (Claude Code, Codex u OpenCode), su **modelo** y su **esfuerzo de razonamiento**. Cada uno toma el valor por defecto de la oficina (Ajustes) si se deja vacío. El CEO o el responsable pueden cambiarlos; los cambios se aplican desde la siguiente tarea del agente.

La mayoría de la gente tiene una sola suscripción, así que por defecto todos los agentes usan el mismo proveedor. Mezclar proveedores (Codex revisando lo que escribió Claude, por ejemplo) es una opción para quien tenga más de una, nunca un requisito.

## El equipo de una planta

Cada planta (un repositorio) tiene su propio equipo, de hasta **10 agentes** por defecto (Ajustes → *Máximo de agentes por planta*, como mucho 15: la sala tiene 15 puestos). Los agentes se quedan en su planta y cogen el trabajo de ese tablero.

El CEO nunca decide trabajo nuevo: solo abre issues de GitHub cuando se lo pides (un encargo al mudar el proyecto, **Plan** o un mensaje), y la oficina rechaza su `file_issue` en cualquier otro trabajo. Sus revisiones, la incorporación de proyectos y el triaje sugieren trabajo en su mensaje para ti.

El **CEO** vigila el rendimiento de cada planta (issues listos para empezar, pull requests esperando QA o en corrección, agentes sin trabajo, merges por hora) y fija el tamaño del equipo con su herramienta `scale_team`, explicando por qué. Ajustes → *Cambios de equipo* decide qué pasa después:

- **Apruebo cada cambio** (por defecto): los candidatos esperan en el vestíbulo, en las sillas junto a la puerta de cristal. Pulsa `E` en uno para ver quién sería: el motivo del CEO, y su proveedor, modelo y esfuerzo, que puedes cambiar antes de crearlo. **Contratar** crea el agente y su máquina; sube en el ascensor y recibe la visita de bienvenida. Un equipo más pequeño es un sobre en el puesto del agente que el CEO eligió para irse.
- **Aplicarlos directamente**: dentro del máximo de la planta, el cambio ocurre en el acto; los agentes sin trabajo se van primero, y a los ocupados se les deja terminar.

El móvil y la consola del responsable muestran las mismas solicitudes. Siempre puedes añadir o quitar agentes tú mismo (consola → Equipo, o `E` en un puesto vacío).

## Máquinas

Cada agente trabaja en una **máquina** propia: una carpeta en tu ordenador (por defecto) o una [Upstash Box](cloud.md) en la nube, que sigue trabajando con la oficina cerrada. La oficina habla con una máquina mediante una única interfaz (`server/machines.ts`), así que dónde se ejecuta puede cambiar sin tocar el planificador. La ⚙️ Configuración de un agente muestra dónde trabaja (*Trabaja en*) y le cambia de sitio mientras no tiene tarea.

Una máquina local vive en `<SWARM_HOME>/machines/<machine>/`, con el nombre del principio del id de su agente:

| Carpeta | Qué es |
| --- | --- |
| `repos/<owner>__<repo>/` | el clon propio del agente del repositorio de su planta (toma prestados los objetos del checkout de la planta, así que se crea rápido) |
| `work/<owner>__<repo>/` | el worktree del agente sobre ese clon, donde se sacan sus ramas de trabajo (`swarm/issue-*`, `qa/pr-*`, ramas de PR) |
| `tmp/` | su carpeta temporal (`TMP`, `TEMP` y `TMPDIR` en sus sesiones) |

Como cada máquina tiene su propio clon, los agentes ya no hacen cola tras un único bloqueo de repositorio compartido, y una rama que tiene sacada un agente nunca bloquea a otro. El checkout propio de la planta (tu carpeta del proyecto, o el clon de la oficina) queda para ti, para las lecturas del CEO y para el monitor de vistas previas.

Quitar un agente quita su máquina; el trabajo sin commit o sin subir se guarda antes en `<SWARM_HOME>/leftovers/`. Las limpiezas de la oficina borran las ramas terminadas del clon de cada máquina, y las máquinas cuyos agentes ya no están.

Los agentes de antes de las máquinas conservan su antiguo puesto hasta que termina su tarea actual, y pasan a una máquina propia en la siguiente. Una sesión solo se puede reanudar desde la carpeta en la que se ejecutó, así que sus correcciones empiezan entonces una sesión nueva.

### Inicio de sesión

Las máquinas de tu ordenador usan las sesiones y ajustes de los agentes de código de ese ordenador: tus inicios de sesión de Claude Code, Codex y OpenCode, skills, plugins y servidores MCP, y tu sesión de `gh`. Funciona porque las máquinas son carpetas del mismo ordenador. Las máquinas en otro sitio necesitan credenciales propias, y las reglas cambian según el proveedor:

- **Nunca copies un fichero de sesión** (`~/.claude/.credentials.json`, el `auth.json` de Codex) a varias máquinas, ni de tu ordenador a una. Sus tokens de refresco rotan, así que las copias se cierran la sesión unas a otras.
- **Las apps de terceros no pueden recoger ni guardar credenciales ni tokens de sesión de claude.ai** (condiciones de Anthropic). sareoffice nunca gestiona un inicio de sesión por sí mismo: arranca el login propio del agente de código en el terminal de ese agente, tú completas allí el flujo de Anthropic o de OpenAI, y la sesión se queda en esa copia del agente de código. sareoffice solo pregunta si tiene la sesión iniciada.

Los agentes en la nube funcionan así hoy ([Iniciar sesión en un agente en la nube](cloud.md#iniciar-sesión-en-un-agente-en-la-nube)):

- **Claude Code**: inicia sesión una vez por Box con su propio login (`claude auth login` en el terminal del agente), guardado en el `~/.claude` del usuario de la Box. Antes de cada tarea la oficina lo comprueba (`claude auth status`); si no tiene sesión, o falla a mitad de tarea por una sesión caducada, el agente se marca como *necesita iniciar sesión* y su tarea te espera. O, para todas las Boxes a la vez: `CLAUDE_CODE_OAUTH_TOKEN` desde el entorno de la oficina (`SAREOFFICE_CLAUDE_TOKEN`: ejecutas tú `claude setup-token`; la oficina nunca lo apunta) o una clave de API de Anthropic.
- **Codex**: lo mismo con `codex login --device-auth` (un enlace y un código de un solo uso, porque nadie puede abrir un navegador en la Box) y `codex login status`, guardado en `~/.codex`; o una clave de API de OpenAI para todas las Boxes.
- **GitHub**: `GH_TOKEN` para cada máquina (un token de grano fino limitado a los repositorios de las plantas, o tu `gh auth token`); más adelante, los tokens de corta duración de una GitHub App.

Otras máquinas fuera de tu ordenador (paso 3 de la hoja de ruta) tendrán sus propias carpetas de configuración (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, las carpetas XDG de OpenCode) con la incorporación y la confianza en la carpeta ya resueltas, y se iniciará sesión de la misma forma.

## Hoja de ruta

1. **Agentes intercambiables** (hecho): sin roles, cargos ni laboratorio de QA; cualquier agente libre coge cualquier tarea; el CEO dimensiona los equipos; candidatos en el vestíbulo con proveedor, modelo y esfuerzo.
2. **Máquinas locales** (hecho): un clon y un worktree propios por agente, con su propia carpeta temporal y puerto.
3. **Inicio de sesión por máquina** (hecho para los agentes en la nube: una comprobación antes de cada tarea, el login propio del agente de código en su terminal): carpetas de sesión propias para otras máquinas, una comprobación de sesión en el doctor de la oficina.
4. **Máquinas en contenedor**: [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`, microVMs, sin necesidad de Docker Desktop; Windows 11 necesita la característica Hypervisor Platform), que llegan a la oficina por `host.docker.internal`.
5. **Máquinas en la nube** (Upstash Box hecho, ver [Agentes en la nube](cloud.md)): la máquina de un agente puede ser una Upstash Box que sigue trabajando con la oficina cerrada. Más adelante: los sandboxes en la nube de Docker, E2B o Daytona tras la misma interfaz, tokens de GitHub App en lugar de tu propia sesión, y la propia oficina en la nube.
