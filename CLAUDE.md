# sareoffice

Un panel de control 2D (React) sobre un orquestador en Node que ejecuta una
sesión de agente de código (Claude Code, Codex u OpenCode) por agente, más el CEO, trabajando issues de GitHub. Los
agentes son intercambiables (sin roles: cualquier agente libre construye, prueba o corrige) y cada uno trabaja en una
máquina propia (docs/agents.md).
Es un fork interno de [cubefarm](https://github.com/leonvanzyl/cubefarm) (Leon van Zyl, MIT) para Saredigital, en
https://github.com/Saredigital/cubefarm. Es la app con la que trabaja la empresa: hay una oficina en vivo ejecutándose
desde un clon de este repositorio. README.md es la guía rápida; docs/how-it-works.md y CONTRIBUTING.md tienen los detalles.
No se publica en npm (`"private": true`): se ejecuta desde un clon con `npm install`, `npm run build` y `npm start`.
Antes se llamaba cubefarm (y antes, Office Swarm). La oficina 3D original se retiró: el cliente es el panel de control
(`client/src/panel/`) y, en móviles, el modo bolsillo.

Los textos que ve una persona, y los prompts de los agentes, están en español de España; los agentes escriben issues y
PRs en español. Identificadores, comandos, rutas, etiquetas de GitHub y convenciones que parsea el código siguen en inglés.

## SEGURIDAD (léelo primero)

- La oficina en vivo se ejecuta desde el clon del responsable, con su estado en `~/.sareoffice` y los puertos 4317
  (servidor) y 5317 (Vite). Nunca uses esos puertos ni ese estado: no edites ni ejecutes nada en ese clon, y nunca
  leas ni escribas `~/.sareoffice` directamente.
- Prueba solo en modo demo (GitHub simulado, agentes simulados, sin uso de Claude), con un `SWARM_HOME` aislado y tu
  `SWARM_PORT` reservado (de las instrucciones de tu tarea):

  ```bash
  npm install
  npm run build
  SWARM_HOME="$PWD/.swarm-home" SWARM_PORT=<tu puerto> node --import tsx server/index.ts --demo
  ```
  ```powershell
  npm install; npm run build
  $env:SWARM_HOME="$PWD\.swarm-home"; $env:SWARM_PORT="<tu puerto>"; node --import tsx server/index.ts --demo
  ```
  Después abre `http://localhost:<tu puerto>` (el servidor sirve el `dist/` construido). El banner de arranque debe
  decir `DEMO MODE` e imprimir una ruta `state:` dentro de tu `SWARM_HOME`. Páralo al terminar; no hagas commit de `.swarm-home`.
- Nunca el modo real (sin `--demo`), y nunca `npm run dev` / `npm run demo` / `npm start` sin tu propio entorno: usan
  por defecto el 4317, y `dev`/`demo` ponen Vite en el 5317. Los tres ejecutan `scripts/office.mjs`, el lanzador, que
  además actualiza su propia carpeta (git fetch + merge, npm install, build) cuando la oficina o tú se lo pedís (`u`).
  Ejecútalo solo en un clon desechable, fuera de la oficina en vivo, con `--demo` y tus `SWARM_HOME`, `SWARM_PORT` y
  `SWARM_CLIENT_PORT`. Lo mismo para `node bin/sareoffice.js` (por defecto, el 4317).
- Los agentes de desarrollo son sesiones normales de CLIs de agentes de código con la configuración del propio responsable, sin
  sandbox, por decisión suya. Las normas de trabajo de la oficina (no subir a la rama por defecto, no fusionar, QA no
  toca GitHub) viven en sus prompts e instrucciones, no en mecanismos que las impongan: no añadas hooks, reglas de
  permisos ni sandboxes que rechacen llamadas a herramientas. `ANTHROPIC_*` / `CLAUDE_*` se eliminan del entorno de
  los agentes y de las vistas previas.
- La política anterior solo corresponde al runtime histórico de desarrollo. Los especialistas de empresa y el
  broker de correo/redes exigen permisos impuestos por el servidor, procedencia acumulativa, aprobación humana
  y separación de identidad, almacenamiento y red. No pueden heredar las CLIs ni sus credenciales. La oficina
  local bloquea integraciones reales; `docs/security-company.md` documenta el servicio independiente Windows.
- `server/originGuard.ts` comprueba `Origin` y `Host` en las rutas HTTP y las conexiones WebSocket de `index.ts`.
  Ese control no es autenticación: las rutas privadas de empresa añaden sesión humana/identidad de especialista,
  CSRF y autorización por recurso. Los datos de correo nunca entran en snapshots, diario, voz o terminales globales.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` sobre client, server, shared, los `.ts` de scripts y las configuraciones |
| `npm test` | Vitest, una vez (`npm run test:watch` para repetir al editar) |
| `npm run build` | typecheck, `vite build` a `dist/` y después el servidor empaquetado en `dist-server/` (`scripts/build-server.mjs`) |
| `npm run test:e2e` | opcional, solo en local: Playwright (`e2e/`, `playwright.config.ts`): construye (`E2E_SKIP_BUILD=1` reutiliza tu `dist/`), arranca una oficina demo en `E2E_PORT` (por defecto 4399; ponlo en tu puerto reservado) con un `SWARM_HOME` temporal y hace tests de humo sin interfaz en un Google Chrome local o, si no, en el Chromium de Playwright. Se para al momento si falta el navegador: nunca lo instales a mitad de tarea |
| `node scripts/smoke-package.mjs` | después de una build: empaqueta el paquete npm, lo instala en una carpeta temporal y arranca su demo (solo comprobación; no se publica) |
| `npm run login` / `npm run doctor` | `node bin/sareoffice.js login` / `doctor`: iniciar sesión en Claude Code / comprobar la máquina |
| `node --import tsx server/index.ts --demo` | una oficina demo (ver SEGURIDAD para el entorno que necesita) |
| `npm run company:provision` / `npm run company:broker` | configuración cifrada y servicio HTTPS independiente; solo en el despliegue dedicado de `docs/security-company.md`, nunca desde el usuario de las CLIs |
| `npm run company:setup-local -- --state-dir <nuevo> --port 4454` | configuración local sin demo, cuentas ni ejecución: loopback, contraseña temporal y estado independiente. Ver `docs/local-company-setup.md` |

CI (`.github/workflows/ci.yml`): Node 24, `npm ci` → `typecheck` → `test` → `build` → test de humo del paquete, en
cada PR y push a `main`, con un `SWARM_HOME` desechable y `SWARM_PORT=0`, siempre en `ubuntu-latest` y en
`windows-latest` y `macos-latest` salvo que una PR no toque nada sensible al sistema operativo (solo `client/`, `e2e/`,
documentación: aparecen como omitidos). e2e no forma parte de CI. En local, `typecheck`, `test` y `build` tienen que
pasar antes de abrir una PR. No ejecutes `test:e2e` salvo que un issue lo pida. Si tu cambio se ve en la oficina,
arranca tu propia oficina demo, compruébalo en un navegador real con las herramientas de Playwright y pon capturas en
la PR. No hay workflow de release ni publicación en npm: desplegar es fusionar en `main`, y las oficinas que se
ejecutan con el lanzador se actualizan solas desde `origin`.

## Mapa del código

Servidor (`server/`, Node + Express 5 + ws, ejecutado con tsx en desarrollo; esbuild lo empaqueta en `dist-server/`):
- `index.ts`: entrada; elige el backend real o el demo, rutas REST bajo `/api`, los websockets `/ws` y `/ws/term`, sirve `dist/`, apagado.
- `company/`: empresa, departamentos, tareas, conocimiento, CRM ligero, entregables y revisiones; estado privado
  separado del flujo GitHub. `company-security/`: sesiones opacas, cifrado, runtime API sin shell y broker independiente.
- `mail/`: Graph e IMAP/SMTP, permisos por buzón, adjuntos limitados y envío con aprobación de una versión exacta.
  `company-social/`: cuentas, piezas, medios y publicaciones revisadas por canal; aprobación independiente del correo.
- `config.ts`: `SWARM_PORT` (por defecto 4317), `SWARM_HOME` (por defecto `~/.sareoffice`), `--demo`, fichero de estado,
  intervalos, la carpeta de proyectos por defecto.
- `swarm.ts`: el orquestador. Plantas, agentes, planificación/autoasignación, el bucle construir → QA → corregir →
  merge, cambios de equipo (el `scale_team` del CEO, aprobaciones en el vestíbulo), cola de trabajos del CEO, mensajes
  del móvil, persistencia (`state.json` / `demo-state.json`), difusión por websocket (a través de `outbox.ts`).
- `outbox.ts`: lo que sale por `/ws`: los cambios de agentes y plantas agrupados en un tick de 250 ms como parches de
  lo que cambió, las líneas de terminal solo para las pestañas que las muestran (`shared/watch.ts`), puestas al día
  cuando cambia lo que mira una pestaña.
- `prompts.ts`, `qaPrompt.ts`: los prompts de los agentes (en español).
- `agentRunner.ts`: una sesión del Agent SDK; opciones, limpieza del entorno, Playwright MCP y conversión del flujo
  del SDK en líneas de terminal.
- `cliRunner.ts`: el runtime de terminal (el de por defecto): un agente como la CLI real en un node-pty, con el mismo
  contrato de sesión que `agentRunner.ts`. Claude Code informa por hooks HTTP (`POST /api/hooks/:token`; PreToolUse
  aprueba todas las llamadas); Codex informa del fin de turno (notify) y, cuando el responsable confía en ellos, de sus
  pasos (`-c hooks.*`); OpenCode solo del fin de turno. Las capturas de Codex/OpenCode se recogen de la carpeta de
  salida de Playwright de la sesión. Esc en un terminal termina la sesión como `interrupted`. Las herramientas de
  oficina del CEO se sirven por MCP (`/api/mcp/:token`).
- `ptyHost.ts`: el guardián de terminales, un proceso independiente (`launch` lo vuelve a lanzar fuera del árbol de
  procesos de la oficina) que mantiene los pseudoterminales de las CLIs y retransmite sus hooks, para que los agentes
  sigan trabajando durante los reinicios de la oficina. `ptyClient.ts` es el lado de la oficina (arrancar/conectar,
  lanzar, adoptar tras un reinicio, alternativa local); `ptyProtocol.ts` sus mensajes en líneas JSON. El
  `office:shutdown` del lanzador dice `restart: false` al salir: entonces las CLIs se paran. La CLI de un agente se
  queda en su prompt después de construir o corregir (`keepAlive`): los seguimientos y lo que se escriba ahí la reutilizan.
- `clis.ts`: las CLIs (Claude Code del binario incluido en el SDK, Codex, OpenCode): detección, desenvolver los shims
  `.cmd` de Windows, la línea de comando de cada una y los scripts auxiliares con los que llaman de vuelta.
- `terminal.ts`: `AgentTerminal`, un espejo xterm sin interfaz por agente (repetición para quien llega tarde, guardado
  en disco), sus espectadores de `/ws/term` y las teclas/redimensiones hacia la CLI en ejecución.
- `ceo.ts`: las herramientas MCP de oficina del CEO (`createOfficeTools`, validadas con zod: `scale_team`,
  `configure_agent`, issues, triaje), `scalePlan` (aritmética del tamaño del equipo), `ceoSystemPrompt`, `ceoJobPrompt`.
- `backend.ts`: la interfaz `Backend` (todo lo que toca GitHub, git, disco y sesiones) y `realBackend`.
- `machines.ts`: las máquinas de los agentes, `MachineProvider`: el clon, el worktree y la carpeta temporal de cada
  agente (el proveedor local son carpetas bajo `<SWARM_HOME>/machines/<machine>/`, en `workspace.ts`; las de los
  agentes en la nube son Upstash Boxes).
- Agentes en la nube (docs/cloud.md, opcional; `PersistedAgent.host === 'box'`): `cloud.ts` es la cuenta (la clave de
  Upstash y las claves pegadas en `secrets.json`, `SAREOFFICE_CLAUDE_TOKEN` leído del entorno y nunca guardado,
  resolución de credenciales, `CloudView`); `box.ts` el único que importa `@upstash/box` (`BoxApi`, que la demo
  simula); `boxMachines.ts` el `MachineProvider` de Box (crear, configurar, preparar, pausar, restos); `boxScripts.ts`
  los scripts de shell que se ejecutan en una Box (puros, con tests); `boxHelpers.ts` los programas que se ponen en una
  Box (lanzador, hooks que escriben en el `events.jsonl` de la sesión); `boxCli.ts` `BoxPty` (la CLI bajo tmux, sus
  eventos leídos desde un offset en bytes, reconectada tras caídas y reinicios). Las credenciales solo viajan como el
  entorno de un comando de Box. Sin una clave para su CLI, la CLI de un agente en la nube usa su propio inicio de
  sesión en la Box: el inicio de sesión de `Swarm` lo comprueba antes de cada tarea (`needsSignIn` retiene la tarea) y
  ejecuta el login propio de la CLI en su terminal (`cliRunner.ts` `startBoxSignIn`); la oficina nunca lee ese login.
- `demo.ts`: `createDemoBackend()`: GitHub simulado, sesiones simuladas (dibujadas en el terminal del agente en el
  runtime de terminal), vistas previas y máquinas simuladas para `--demo`; `--floors N --agents N` (o
  `SWARM_DEMO_FLOORS` / `SWARM_DEMO_AGENTS`) la convierte en una empresa grande para pruebas de escala.
- `github.ts`: todo el acceso a GitHub con la CLI `gh`.
- `workspace.ts`: los checkouts de las plantas, los worktrees de vista previa
  (`<SWARM_HOME>/workspaces/<owner>__<repo>/desks/<name>`), las máquinas locales (clon, worktree, limpieza de ramas,
  borrado con restos), fast-forward de main, un bloqueo de git por clon, parar procesos que un agente dejó en marcha.
- `exec.ts`: `run` / `git` / `gh`: `execFile` sin shell, prompts desactivados, `CommandError` con stderr.
- `previews.ts`: una vista previa por planta: puertos (6300 + planta), estados, validación de la configuración; y las
  vistas previas de PRs de la sala de PRs (`prTheatre.ts`: sus huecos, puertos, desalojo y parada por inactividad,
  puro; `syncProxy.ts`: el desplazamiento sincronizado del modo comparar).
- `qaShots.ts`: las capturas de QA de la última ronda de cada PR, guardadas para el panel de QA del visor de la app.
- `previewRunner.ts`: hace checkout, instala y ejecuta la app de una planta en su worktree de vista previa; mata el árbol de procesos.
- `httpError.ts`: `HttpError(status, message)`.
- `officeUpdate.ts`: la autoactualización de la oficina: la decisión de vaciado, el contrato con el lanzador (IPC, `last-update.json`).
- `pacing.ts`: frenar el trabajo nuevo tras los avisos de uso de Claude: la decisión de empezar/saltar y el estado de uso.
- `voice.ts`: los mensajes del móvil leídos en voz alta (docs/voice.md): la clave de ElevenLabs en `secrets.json`,
  voces, clips en caché; `elevenlabs.ts` es su cliente REST. Las palabras que se dicen salen de `shared/speech.ts`.
  `secrets.ts`: las lecturas y escrituras combinadas de ese fichero.
- `notifier.ts`: notificaciones (docs/pocket.md): el reparto con límite de frecuencia a las pestañas abiertas
  (escritorio), Web Push y los webhooks de las apps de chat (secretos en `secrets.json`, claves push y dispositivos en
  `push.json`), detrás de `Backend.notify`; `notify.ts` es su parte pura (formato, el límite por evento, comprobación
  de webhooks), `webPush.ts` VAPID y el cifrado RFC 8291, `shared/notify.ts` los ajustes. `pwa.ts`: el service worker
  de la app instalable, servido en `/sw.js`.
- `ledger.ts`: lo que el trabajo va dejando (PRs, QA, correcciones, merges, sesiones): las carreras de los agentes que
  muestran Ajustes → Equipo y su terminal, y los logros que se anuncian en el chat.
- `legacyState.ts`: leer ficheros de estado antiguos con la forma de hoy, y los valores con pinta de secreto del entorno.

El comando `sareoffice` (`bin/sareoffice.js`, JS plano; lo ejecuta `npm start` a través del lanzador): comprueba
Node/git/gh/el inicio de sesión de Claude, arranca `dist-server/index.js` y abre el navegador; subcomandos `login` y
`doctor` (`npm run login`, `npm run doctor`). Sus mensajes están en español.

El lanzador (`scripts/office.mjs`, JS plano; `npm run dev` / `demo` / `start`): ejecuta el servidor (más Vite con
`--dev`, vigilando `server/` y `shared/`) con `SWARM_LAUNCHER=1` y un canal IPC, y aplica las actualizaciones de la
oficina: parar, fast-forward, instalar/construir, reiniciar, volver atrás si falla, `<SWARM_HOME>/last-update.json`.
Sus decisiones puras están en `scripts/officeSteps.mjs` (con tests en `officeSteps.test.ts`).

Compartido (`shared/`, importado por ambos lados):
- `types.ts`: el contrato REST/websocket (`WorldSnapshot`, `ServerEvent`, vistas, ajustes).
- `issues.ts`: convenciones de los issues (`swarm:skip`, `Depends on #N`, orden por lo que bloquean).
- `watch.ts`: qué líneas de terminal recibe una pestaña: su planta, los paneles abiertos, las últimas líneas de la lista de trabajadores.
- `looks.ts`: `cleanStyle`, el `style` de un agente guardado en el servidor (de la oficina 3D; el panel no lo edita).
- `careers.ts`, `progress.ts`, `speech.ts`, `notify.ts`, `previewEnv.ts`, `clipLimits.ts`: carreras, logros, el texto
  para la voz, notificaciones, el entorno de las vistas previas, límites de los clips de voz.

Cliente (`client/`, raíz de Vite; React 19, zustand):
- `src/panel/`: el panel de control, la vista por defecto en un ordenador. `ControlPanel.tsx` es la estructura (barra
  lateral, rutas en el hash `#/project/<owner>/<name>/<tab>`, `Ctrl K`, los paneles de la oficina abiertos encima);
  `Overview.tsx`, `Project.tsx`, `Agents.tsx`, `LaunchTask.tsx` (una tarea en palabras → issue o encargo al CEO),
  `Settings.tsx` (las pestañas de `ui/ManagerTabs.tsx`); `panelData.ts` su lógica pura; `panel.css`, todo bajo `.cp`,
  que también da su aspecto a los componentes de `ui/` que reutiliza.
- `src/pocket/`: el modo bolsillo (docs/pocket.md), el panel en pestañas para móviles; `mode.ts` elige entre panel y
  bolsillo (`?view=panel|pocket`). `src/pwa.ts` registra el service worker y Web Push; `src/notifications.ts` muestra
  las notificaciones de escritorio.
- `src/ui/`: piezas compartidas: terminal (`TerminalView.tsx`, `LiveTerminal.tsx`: xterm.js sobre `/ws/term`), Kanban
  (`KanbanView.tsx`), chat con el CEO y cambios de equipo (`Phone.tsx`), visor de la app (`AppViewer.tsx`), conectar
  proyectos (`ProjectPicker.tsx`), configuración inicial (`SetupWizard.tsx`), ajustes (`ManagerTabs.tsx`,
  `AgentSettings.tsx`, `CloudSettings.tsx`, `NotifySettings.tsx`, `VoiceSettings.tsx`), centro de control
  (`MissionConsole.tsx`), diálogos (`Panel.tsx`, `Confirm.tsx`), sonidos de aviso (`sfx.ts`) y voz/micrófono.
- Accesibilidad (Ajustes → Accesibilidad, `ui/a11y.ts`, guardada por navegador con el puro `a11yPrefs.ts`):
  subtítulos (`captions.ts`, reglas en `captionRules.ts`), colores y formas de estado (`statusLook.ts`), escala de la
  interfaz, fuente legible, alto contraste. Los diálogos usan `dialogFocus.ts`; `announce()` habla a los lectores de
  pantalla.
- `src/company/`: la gestión de empresa (`CompanyWorkspace.tsx`), también sola en `/?company=1`.
- `src/store.ts`: el store de zustand; `apply(ServerEvent)` incorpora los eventos del websocket al estado de la interfaz.
- `src/api.ts`: llamadas REST; los errores se convierten en avisos.
- `src/net.ts`: la conexión websocket con reconexión; envía lo que mira la pestaña (`src/watch.ts`) cuando cambia: la
  planta del proyecto abierto (sus líneas de terminal), los paneles abiertos y la última línea de cada agente.

## Convenciones

- TypeScript ESM en todas partes (`"type": "module"`), strict, `noUnusedLocals`/`Parameters`. El servidor se ejecuta
  con tsx e importa con extensión `.ts` (`import { run } from './exec.ts'`); los ficheros del cliente importan sin extensión.
- Pocos comentarios, y que digan por qué: un comentario breve de cabecera por fichero describiendo su papel, `/** */`
  en funciones exportadas y campos de interfaces cuando el nombre no basta, notas en línea por motivos de Windows o de
  seguridad, y separadores `// ---------- sección ----------` en ficheros largos. Nada de código comentado. Los
  comentarios del código siguen en inglés.
- Textos en español de España (tuteando) para todo lo que ve una persona y para los prompts de los agentes; nunca
  traduzcas identificadores, claves, nombres de eventos, valores de enums, comandos, etiquetas de GitHub
  (`swarm:skip`) ni convenciones que parsea el código (`Depends on #N`, `Closes #<n>`).
- Paridad con la demo: cada método nuevo de `Backend`, herramienta del CEO o capacidad tiene su versión simulada en
  `server/demo.ts`, para que `--demo` funcione sin GitHub, sin git/npm y sin uso de Claude.
- El estado de la interfaz viene del servidor: al conectar, el cliente recibe un `snapshot` y después `ServerEvent`s
  tipados (`repo`, `agent`, `qa`, `ceo`, `message`, `toast`, …) desde `Swarm.broadcast`; los cambios frecuentes de
  agentes y plantas llegan agrupados como parches `agents` / `repos` y las líneas de terminal como `logs` / `latest`,
  solo para lo que muestra la pestaña (`server/outbox.ts`). Añade el estado nuevo a `shared/types.ts`, al snapshot y a
  un evento, y trátalo en el `apply` de `store.ts`. REST es para comandos, no para consultar estado periódicamente.
  Una empresa grande tiene que caber en los presupuestos de `server/scale.test.ts`.
- Errores REST: lanza `HttpError(4xx, message)`; el manejador de `index.ts` devuelve JSON `{ error }`, y cualquier
  otra cosa es un 500 registrado. Valida los cuerpos de las peticiones a mano en la ruta o en el swarm.
- Herramientas del CEO: esquemas de entrada con zod, errores redactados para que el CEO pueda actuar, salidas pequeñas.
- Windows primero (la oficina se ejecuta en Windows):
  - construye las rutas con `path.join` / `path.resolve`; las rutas pueden tener espacios, así que pasa los argumentos
    como arrays (`execFile`), nunca comandos de shell construidos como cadenas;
  - `fs.rm` con `maxRetries` para los bloqueos de ficheros EBUSY/EPERM; escribe el estado en un fichero temporal y haz `rename`;
  - mata árboles de procesos, no solo el hijo (`taskkill /T /F` en Windows, grupos de procesos en el resto);
  - `windowsHide: true` al lanzar procesos; npm en Windows pasa por `cmd.exe`.
  - `bin/sareoffice.js` usa finales de línea LF (`.gitattributes`): el shebang falla en macOS y Linux con CRLF.
- Los prompts de los agentes se pagan en cada sesión: mantén su texto corto y concreto.

## Tests

Las pruebas de `server/company-security/`, `server/mail/`, `server/company/` y `server/company-social/` usan
proveedores simulados, claves temporales y puertos efímeros. Nunca deben conectar cuentas, enviar correo ni publicar.
Para verificaciones paralelas entre worktrees, limita cada suite específica con `--maxWorkers=1`.

- Vitest, `*.test.ts` junto al código, en cualquier parte de `client/`, `server/`, `shared/` o `scripts/`
  (p. ej. `shared/issues.test.ts`, `client/src/panel/panelData.test.ts`, `server/ceo.test.ts`). Configuración: `vitest.config.ts`.
- Prueba directamente las funciones puras; extrae la lógica a funciones auxiliares puras en lugar de usar mocks. Sin
  red, sin `gh`, sin sesiones de Claude, sin el `~/.sareoffice` real: `npm test` ya apunta `SWARM_HOME` a una carpeta
  temporal y `SWARM_PORT` a 0.
- Tienen que pasar en los dos runners de CI (ubuntu + windows): no pongas `/` ni `\` fijos en las rutas esperadas.
- Si cambias un texto que un test comprueba, actualiza el test en el mismo cambio.
- E2E: un fichero de spec por funcionalidad, con la preparación de `e2e/helpers.ts`; los tests e2e nuevos van en el
  spec de su funcionalidad o en uno nuevo, nunca añadidos a `smoke.spec.ts`.

## Pull requests

- Un issue por PR, con `Closes #<n>` en la descripción. Mantén el diff pequeño y centrado en el tema.
- Muchas PRs se fusionan en paralelo y el auto-merge devuelve los conflictos: no reformatees, reordenes ni renombres
  código que no estás cambiando, y no toques ficheros no relacionados.
- Antes de abrirla: `typecheck`, `test` y `build`. `test:e2e` solo cuando un issue lo pida; CI no lo ejecuta.
- Explica cómo lo has verificado y enumera tus suposiciones. Los cambios de interfaz llevan capturas de la oficina demo.
- Escribe el título y la descripción de la PR en español.
- Nunca subas a `main`, nunca hagas force-push, nunca fusiones tu propia PR.
