# ✻ sareoffice

El panel de control de Saredigital: un equipo de agentes de código con IA trabaja los issues de GitHub de todos nuestros proyectos, y desde un solo sitio ves cada proyecto y cada agente, lanzas tareas, sigues sus terminales en directo y apruebas lo que importa.

> **sareoffice es un fork interno de [cubefarm](https://github.com/leonvanzyl/cubefarm)**, de Leon van Zyl, publicado con licencia [MIT](LICENSE). Saredigital lo ha adaptado (marca, español, y un panel de control en lugar de la oficina 3D original) para uso interno. El fork vive en [Saredigital/cubefarm](https://github.com/Saredigital/cubefarm).

Cada agente es un agente de código de verdad, **Claude Code, Codex u OpenCode**, que se ejecuta en su propio terminal en tu máquina con tus sesiones iniciadas, tus ajustes, skills y servidores MCP. Puedes poner a todo el equipo en uno o dar a cada agente el suyo. La oficina reparte el trabajo, hace que cada pull request se revise y se pruebe en un navegador real, y fusiona lo que pasa.

Los agentes reciben sus instrucciones en español y escriben los issues, las PRs y los informes de QA en español.

## Puesta en marcha

sareoffice es de uso interno: no se publica en npm. Se ejecuta desde un clon de este repositorio.

```bash
git clone https://github.com/Saredigital/cubefarm
cd cubefarm
npm install
npm run build
npm start
```

`npm start` arranca el lanzador (`scripts/office.mjs`): comprueba tu máquina, arranca la oficina y abre el panel en el navegador. El lanzador también mantiene el clon al día desde `origin` (ver [Actualizar](#actualizar)).

### Qué necesitas

- **Node.js 22 o posterior**: [nodejs.org](https://nodejs.org)
- **git**
- **La CLI de GitHub** con la sesión iniciada: instálala desde [cli.github.com](https://cli.github.com) y ejecuta `gh auth login`
- **Claude Code con la sesión iniciada**: viene con sareoffice (lo instala `npm install`), así que no hay nada más que instalar. Ejecuta `npm run login` una vez para iniciar sesión con tu suscripción de Claude. Es el agente de código por defecto, y el CEO siempre lo usa.
- **Codex u OpenCode** (opcional): si los tienes instalados y con la sesión iniciada, cualquier agente puede usarlos (ver [Agentes de código](#agentes-de-código)).
- **Google Chrome**, para los agentes que prueban tu app en un navegador.

Funciona en Windows, macOS y Linux. ¿No sabes si lo tienes todo? `npm run doctor` lo comprueba.

### ¿Solo quieres echar un vistazo?

```bash
node bin/sareoffice.js --demo
```

El modo demo simula GitHub y los agentes, así que no cuesta nada ni cambia nada.

## Tus primeros cinco minutos

1. **Monta tu empresa.** Un asistente corto te pregunta tu nombre, pone nombre a la empresa y te presenta al CEO.
2. **Conecta un proyecto.** Elige una de tus carpetas de proyecto o un repositorio de GitHub, o empieza uno nuevo. Aparece en la barra lateral del panel. Todo proyecto tiene que estar en GitHub, porque el equipo trabaja con issues y pull requests.
3. **Deja que el CEO planifique.** El CEO estudia el proyecto, escribe su lista de comprobación de QA y dimensiona el equipo del proyecto. El trabajo nuevo solo sale de ti: pulsa **Lanzar tarea** (o `Ctrl K`) para crear un issue que coja un agente libre o pedirle al CEO que lo planifique, o escríbele en su chat. El CEO nunca abre issues por su cuenta. Los cambios de equipo que propone esperan en **Aprobaciones**, donde puedes ajustar el agente de código, el modelo y el esfuerzo antes de aceptarlos.
4. **Mira cómo trabajan.** Los agentes son intercambiables: un agente libre coge el siguiente issue, lo construye en su propia rama y abre una pull request. Otro agente la revisa y la prueba en una sesión nueva y en un navegador real, y publica un informe con capturas en la PR. Si QA falla, el autor la corrige y vuelve a pasar por QA. Con el auto-merge activado, la PR se fusiona sola en cuanto QA la aprueba y los checks de GitHub están en verde. Cada agente trabaja en una máquina propia (su propio clon, worktree y carpeta temporal; ver [Agentes](docs/agents.md)).

## Agentes de código

Cada agente, incluido el CEO, es la CLI del agente de código de verdad, en un terminal de tu máquina. Haz clic en un agente del panel para ver su terminal en directo, haz clic en el terminal para escribirle o pulsa `Esc` dentro para interrumpirle. Cargan tu configuración igual que tus propias sesiones de terminal: tus ajustes, `CLAUDE.md` o `AGENTS.md`, skills, plugins y servidores MCP.

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Instalación | viene con sareoffice: `npm run login` | la tuya, con la sesión iniciada | la tuya, con la sesión iniciada |
| Qué ve la oficina | cada paso, más coste y uso | cada paso, cuando confías en sus hooks | cada turno terminado |
| Estado | por defecto; el CEO lo usa | experimental | experimental |

- **Uno para todos o uno para cada uno.** En **Ajustes** eliges el agente de código por defecto, su modelo y el esfuerzo de razonamiento (de serie: Claude Code con Claude Opus 5.5 y esfuerzo medio). La ⚙️ Configuración de un agente, la pestaña Equipo de Ajustes o un cambio de equipo en Aprobaciones los cambian para un solo agente. Con una suscripción basta; mezclarlas (por ejemplo, agentes de Codex probando lo que escribieron agentes de Claude Code) es cosa tuya.
- **Los hooks de Codex.** La primera vez, Codex te pide revisar los hooks de la oficina: escribe `/hooks` en el terminal de un agente de Codex y pulsa `t` para confiar en ellos. Hasta entonces la oficina muestra la tarea de un agente de Codex, no cada paso.
- **Uso.** Los agentes que usan el mismo agente de código comparten sus límites de uso. Cuando Claude avisa de que el uso está alto, la oficina frena el trabajo nuevo hasta que se reinicia la ventana. Para limitar cuántos agentes trabajan a la vez, pon un límite de sesiones en Ajustes.
- **Reinicios.** Los agentes siguen trabajando mientras la oficina se reinicia (una actualización, un fallo): sus terminales viven en un pequeño proceso aparte y se reconectan cuando la oficina vuelve.
- **Agentes en la nube.** Opcionalmente, cada agente trabaja en una [Upstash Box](docs/cloud.md) en lugar de en tu ordenador, así que termina su tarea aunque la oficina esté cerrada o el portátil apagado. Conecta tu cuenta de Upstash en Ajustes → Agentes en la nube; tu suscripción de Claude, las claves de API y GitHub se configuran una sola vez para todas las Boxes.

Más en [Cómo funciona](docs/how-it-works.md#los-terminales-de-los-agentes).

## Qué hay en el panel

- **Resumen**: los agentes trabajando, las PRs en QA, lo que espera tu aprobación y los merges de hoy; la tabla de proyectos con su flujo (pendientes, en curso, en QA, corrigiendo, listas), sus agentes y su vista previa; la actividad reciente y los agentes.
- **Proyecto**: su tablero Kanban, del backlog a fusionada (con las dependencias `Depends on #N`), sus agentes y sus ajustes (asignación automática, auto-merge, QA en el navegador, misión). Desde aquí sincronizas con GitHub, abres la vista previa de la app, pides al CEO que planifique o lanzas una tarea.
- **Lanzar tarea** (`Ctrl K`, desde cualquier página): escribe lo que hay que hacer como se lo dirías a una persona; se convierte en un issue para el primer agente libre o para el que elijas, o va al CEO para que lo divida en issues.
- **Agentes**: cada agente con su agente de código, su estado y su última línea de terminal. Haz clic para abrir su terminal real en directo, con la última captura del navegador, y para asignarle trabajo, escribirle, pararlo o cambiar su configuración y ver "Qué se le dice".
- **Aprobaciones**: cambios de equipo que propone el CEO, PRs atascadas que te necesitan (repetir QA, devolver, fusionar, cerrar) y PRs listas para fusionar.
- **CEO**: el chat con el CEO, que coordina todos los proyectos.
- **Gestión de empresa**: departamentos, tareas, conocimiento, CRM, correo y redes (ver [Empresa](docs/company.md)).
- **Ajustes**: agentes y CEO por defecto, cómo se ejecutan los agentes, la empresa, agentes en la nube, voz, notificaciones, proyectos y la actualización de la oficina, el equipo con sus trayectorias, el centro de control y la accesibilidad.
- **Uso de Claude**: el medidor de la barra lateral; tras un aviso de uso, la oficina frena el trabajo nuevo.
- **Modo bolsillo**: en un móvil, el panel se abre como una app de pestañas con el flujo, el chat con el CEO, el Kanban, el equipo y las aprobaciones. Se instala en la pantalla de inicio y puede avisarte cuando algo te necesita. Ver [La oficina en el bolsillo](docs/pocket.md).
- **Voz**: escucha en voz alta los mensajes del CEO y habla en lugar de escribir con 🎙️. Ver [Mensajes de voz](docs/voice.md).

`?view=panel` o `?view=pocket` en la dirección eligen la vista para esa visita.

## Comandos

Desde la carpeta del clon:

| Comando | Qué hace |
| --- | --- |
| `npm start` | arranca la oficina con el lanzador (que la mantiene actualizada) y abre el panel en el navegador |
| `npm run login` | inicia sesión en Claude Code, que viene con sareoffice (Codex y OpenCode usan su propio inicio de sesión) |
| `npm run doctor` | comprueba que tu máquina está lista |
| `npm run build` | construye el cliente y el servidor (necesario antes del primer `npm start`) |
| `node bin/sareoffice.js --demo` | GitHub y agentes simulados |
| `node bin/sareoffice.js --demo --floors 10 --agents 15` | una empresa demo grande: 10 proyectos de 15 agentes, para ver el panel a escala |
| `node bin/sareoffice.js --port 4400` | usar otro puerto (por defecto, 4317) |
| `node bin/sareoffice.js --no-open` | no abrir el navegador |

`node bin/sareoffice.js` arranca la oficina construida sin el lanzador, así que no se actualiza sola. `npm start -- --demo` y `npm start -- --no-open` también funcionan con el lanzador.

## Actualizar

Al ejecutarse desde el clon con `npm start`, el lanzador se encarga: cuando hay un commit nuevo en `origin` y los agentes han terminado su trabajo, para la oficina, hace fast-forward, ejecuta `npm install` si cambiaron las dependencias, vuelve a construir y la arranca de nuevo. También puedes escribir `u` + Enter en su terminal para actualizar en ese momento. Solo actualiza si el clon está en la rama por defecto, sin cambios locales ni commits propios. Más en [Actualizar la oficina](docs/how-it-works.md#actualizar-la-oficina).

A mano:

```bash
git pull
npm install
npm run build
npm start
```

## Bueno saber

- **Funciona con tus propias suscripciones.** Cada agente usa la sesión del agente de código que ejecuta, y los agentes que usan el mismo agente de código comparten sus límites de uso.
- **Los agentes trabajan como los agentes de código que ejecutas tú**: sin sandbox, con tus skills, servidores MCP y ajustes, cada uno en su propia copia del repositorio. No tiene por qué haber nadie para aprobar una llamada a una herramienta, así que la oficina las aprueba todas: ejecútala donde ejecutarías tus propios agentes de código. Las normas de la oficina están en las instrucciones de los agentes: sube tu propia rama y abre una pull request, nunca subas a la rama principal ni fusiones. La oficina fusiona, después de QA.
- **Tu oficina vive en `~/.sareoffice`**: ajustes, clones de tus repositorios y una máquina (un clon y un worktree) por agente. Define `SWARM_HOME` para usar otra carpeta. Las máquinas que ya nadie usa se limpian cada 30 minutos, y el trabajo sin subir que tuvieran se guarda como parche en `~/.sareoffice/leftovers`.
- **Solo está abierta a tu propio ordenador.** La oficina escucha en `127.0.0.1`. Para entrar desde el móvil, pon delante algo que te pida iniciar sesión, como Tailscale Serve: ver [Entrar en la oficina desde el móvil](docs/pocket.md#entrar-en-la-oficina-desde-el-móvil).

### Seguridad: problema conocido (sin corregir)

Aunque el servidor escucha solo en `127.0.0.1`, los WebSockets `/ws` y `/ws/term` **no comprueban la cabecera `Origin`**. Una web cualquiera abierta en el mismo navegador podría conectarse a la oficina y, a través de `/ws/term`, **escribir en el terminal de un agente**, que ejecuta comandos en tu máquina sin pedir permiso.

Hasta que se corrija: **no navegues por webs desconocidas en el mismo navegador mientras la oficina está abierta.** Usa un navegador o perfil aparte para la oficina, o ciérrala cuando no la estés usando.

## Más información

- [Cómo funciona](docs/how-it-works.md): la vida de un issue, QA, auto-merge, modelos y uso, los terminales de los agentes, el modelo de seguridad y las vistas previas de cada proyecto
- [Agentes](docs/agents.md): agentes intercambiables, el tamaño de los equipos y los cambios de equipo del CEO, la máquina de cada agente y cómo inicia sesión
- [Agentes en la nube](docs/cloud.md): agentes en Upstash Boxes que siguen trabajando con la oficina cerrada: configuración, inicio de sesión, costes y límites
- [La oficina en el bolsillo](docs/pocket.md): el modo bolsillo en el móvil, instalar la app, notificaciones (escritorio, push, ntfy) y cómo entrar en la oficina de forma segura desde el móvil
- [Mensajes de voz](docs/voice.md): los mensajes del CEO leídos en voz alta, voces de ElevenLabs y hablar en lugar de escribir
- [Contribuir](CONTRIBUTING.md): ejecutarlo desde el código fuente, tests, arquitectura, despliegue interno y cómo traer cambios del proyecto original

## Licencia

[MIT](LICENSE). Basado en [cubefarm](https://github.com/leonvanzyl/cubefarm) © Leon van Zyl; modificaciones © Saredigital.
