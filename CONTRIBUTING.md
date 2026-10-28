# Contribuir

Cómo ejecutar sareoffice desde el código fuente, probarlo, desplegarlo internamente y traer cambios del proyecto original. Las sesiones de agentes que trabajan en este repositorio siguen también [CLAUDE.md](CLAUDE.md).

sareoffice es un fork interno de [cubefarm](https://github.com/leonvanzyl/cubefarm) (Leon van Zyl, licencia MIT). No se publica en npm (`package.json` tiene `"private": true`).

## Ejecutarlo desde el código fuente

La oficina de empresa incorpora `server/company/`, `server/mail/` y `server/company-social/`, protegidos por
`server/company-security/`. Los permisos históricos de las CLIs no se aplican a ese servicio. Las integraciones
reales requieren el [broker independiente](docs/security-company.md), con identidad y equipo dedicados, HTTPS
y aprobación humana de cada acción externa. La oficina local conserva el recorrido simulado.

Para empezar una empresa vacía sin demo ni conexiones, construye la interfaz y ejecuta
`npm run company:setup-local -- --state-dir <directorio-nuevo> --port 4454`.
Este comando no utiliza el lanzador ni inicia las CLIs. Permite editar la estructura y preparar trabajo;
la ejecución, correo y redes permanecen bloqueados. Su contraseña temporal aparece en la terminal.
Consulta [configuración local](docs/local-company-setup.md) antes de elegir el directorio persistente.

```bash
git clone https://github.com/Saredigital/cubefarm.git
cd cubefarm
npm install
npm run dev    # o: npm run demo
```

Abre http://localhost:5317 (`SWARM_CLIENT_PORT` mueve Vite y `SWARM_PORT` el servidor). El servidor se reinicia cuando cambia código en `server/` o `shared/`, y el cliente se recarga solo.

Para la versión construida, la que usa el equipo: `npm run build && npm start`.

Los tres ejecutan `scripts/office.mjs`, el lanzador: `--dev` ejecuta el servidor desde el código fuente más Vite y, sin él (`npm start`), ejecuta `bin/sareoffice.js` sobre la versión construida. También mantiene el clon al día: cuando la oficina ha terminado su trabajo y hay un commit nuevo en `origin`, o cuando escribes `u` + Enter en su terminal, para la oficina, hace fast-forward, instala y construye lo necesario y la vuelve a arrancar. Ver [Actualizar la oficina](docs/how-it-works.md#actualizar-la-oficina).

## Tests

Para comprobar empresa y proveedores sin cuentas reales:
`npx vitest run server/company-security server/mail server/company server/company-social --maxWorkers=1`.
Los tests nunca crean usuarios del sistema, conectan buzones ni publican. `npm run company:provision` y
`npm run company:broker` son comandos de despliegue en el host independiente; el instalador Windows registra
la tarea sin arrancarla. Consulta el procedimiento y sus límites en la guía de seguridad.

```bash
npm test             # ejecuta todos los tests una vez (Vitest)
npm run test:watch   # vuelve a ejecutarlos mientras editas
npm run typecheck
npm run build
npm run test:e2e     # tests de humo opcionales en navegador (Playwright): construye, arranca una oficina demo y la maneja
```

- Los tests están junto al código que cubren como `*.test.ts`, en cualquier parte de `client/`, `server/`, `shared/` o `scripts/` (p. ej. `shared/issues.test.ts`). Vitest los encuentra con `vitest.config.ts`; `tsc` comprueba sus tipos y la build de Vite los deja fuera, porque nada de la app los importa.
- Que sean rápidos y sin conexión: sin red, sin GitHub (`gh`), sin sesiones de Claude y sin el `~/.sareoffice` real. Prueba la lógica pura directamente, simula todo lo que gastaría uso y usa un `SWARM_HOME` temporal y puertos libres aleatorios para lo que necesite un servidor. `npm test` ya apunta `SWARM_HOME` a una carpeta temporal.
- e2e no forma parte de CI. Antes de una pull request tienen que pasar `typecheck`, `test` y `build`. No ejecutes `test:e2e` salvo que un issue lo pida. Si tu cambio se ve en la oficina, arranca tu propia oficina demo, compruébalo en un navegador real con las herramientas de Playwright y pon capturas en la pull request. Después, QA prueba cada pull request en un navegador real en una oficina demo.
- `npm run test:e2e` es una herramienta local opcional. Ejecuta `e2e/*.spec.ts` sin interfaz con WebGL por software contra una oficina demo en el puerto 4399 (`E2E_PORT` lo cambia) con un `SWARM_HOME` temporal. Usa tu Google Chrome instalado si lo hay y, si no (o con `E2E_BROWSER=chromium`), el Chromium de Playwright. Si falta ese navegador se para al momento y lo dice: ejecuta `npx playwright install chromium` una vez, en la caché compartida (deja `PLAYWRIGHT_BROWSERS_PATH` sin definir). ¿Acabas de construir? `E2E_SKIP_BUILD=1` reutiliza `dist/` en lugar de volver a construir. Espera a lo que muestra la página en lugar de dormir, y no dependas del bloqueo del puntero, que un navegador sin interfaz puede no conceder.
- Un fichero de spec e2e por funcionalidad, compartiendo `e2e/helpers.ts` (el `test` que falla con errores de consola y peticiones fallidas, `enterOffice`, `startAt`). Los tests e2e nuevos van en el spec de su funcionalidad o en uno nuevo, nunca añadidos a `smoke.spec.ts`, que solo mantiene el arranque básico y se ejecuta primero (`playwright.config.ts`). No añadas pruebas de las funciones eliminadas (café, juguetes, perro y ping-pong).
- GitHub Actions (`.github/workflows/ci.yml`) ejecuta `npm ci`, `npm run typecheck`, `npm test` y `npm run build` en cada pull request y cada push a `main`, y después empaqueta el paquete npm, lo instala en una carpeta vacía y lo arranca en modo demo (`scripts/smoke-package.mjs`), solo como comprobación: no se publica. Ese job `check` siempre se ejecuta en Ubuntu, y en Windows y macOS en cada push a `main`, cada ejecución manual y cada pull request que toque algo sensible al sistema operativo (`server/`, `shared/`, `scripts/`, `bin/`, `.github/`, `package.json`, el lockfile o las configuraciones de la raíz); una pull request que solo cambia `client/`, `e2e/` o documentación muestra `check (windows-latest)` y `check (macos-latest)` como omitidos, lo que cuenta como aprobado. CI no ejecuta tests de navegador. No necesita secretos.

### La herramienta de navegador de los agentes

Los agentes prueban en un navegador con el servidor MCP de Playwright, una dependencia fijada (`@playwright/mcp` a una versión exacta en `package.json`) que se arranca como `node <su cli.js>` desde el paquete instalado (`server/browser.ts`), así que una sesión nunca ejecuta npx ni toca el registro de npm. Maneja el Google Chrome instalado. Para actualizarla:

```bash
npm install --save-exact @playwright/mcp@<versión>
node node_modules/@playwright/mcp/cli.js --help   # que las opciones de server/browser.ts sigan existiendo
npm test && npm run build && node scripts/smoke-package.mjs
```

Lee antes sus notas de versión: una versión que pase a un Playwright nuevo puede cambiar qué versiones de Chrome admite.

## Arquitectura

```
client/  Vite + React + zustand
  src/panel/   el panel de control: resumen, proyectos, agentes, lanzar tarea, aprobaciones, CEO, ajustes
  src/pocket/  el modo bolsillo para móviles
  src/ui/      piezas compartidas: terminal, Kanban, chat con el CEO, visor de la app, ajustes, diálogos
bin/sareoffice.js  lo que ejecuta `npm start`: comprueba la máquina, arranca el servidor y abre el navegador
scripts/office.mjs  el lanzador de un clon (npm run dev / demo / start): ejecuta la oficina y la actualiza
server/  Node + Express + ws
  swarm.ts        orquestador: plantas, agentes, planificación, persistencia, difusión por websocket
  agentRunner.ts  el runtime antiguo con el Agent SDK (Ajustes → Cómo se ejecutan los agentes): Claude Code por el SDK, como registro
  cliRunner.ts    el de por defecto: un agente como la CLI real (Claude Code, Codex, OpenCode) en un pseudoterminal: hooks, fin de turno, las herramientas del CEO por MCP
  ptyHost.ts      el guardián de terminales: un proceso propio que mantiene los terminales y hooks de las CLIs durante los reinicios de la oficina
  ptyClient.ts    el lado de la oficina del guardián (ptyProtocol.ts: sus mensajes)
  clis.ts         las CLIs que pueden usar los agentes (Claude Code, Codex, OpenCode): encontrarlas, sus líneas de comando
  terminal.ts     el terminal de cada agente: un espejo xterm sin interfaz, sus espectadores, las teclas hacia la CLI
  github.ts       todo lo de GitHub, con la CLI gh
  workspace.ts    clones + worktrees de git por agente
  previews.ts     una vista previa por planta, y las de la sala de PRs: puertos, estados, arrancar / parar
  previewRunner.ts  checkout, instalación y ejecución de la app de una planta en su worktree de vista previa
  demo.ts         GitHub y agentes simulados para `npm run demo`
shared/types.ts   el contrato websocket / REST
```

El servidor lo envía todo al navegador por un único websocket (`/ws`); un panel de terminal abierto tiene el suyo (`/ws/term?agent=<id>`). Las pantallas de los portátiles y la pizarra son canvas dibujados con esos datos y usados como texturas. Solo se repintan cuando algo cambia, y menos a menudo cuando estás lejos.

## Despliegue interno

No hay releases ni publicación en npm (se eliminaron `.github/workflows/release.yml` y la comprobación de versiones nuevas en npm). Desplegar es fusionar en `main`:

1. Abre una pull request contra `main` en [Saredigital/cubefarm](https://github.com/Saredigital/cubefarm) y espera a que CI esté en verde.
2. Fusiónala.
3. Cada oficina que se ejecuta con `npm start` desde un clon ve el commit nuevo en `origin` y se actualiza sola en cuanto sus agentes terminan (o al escribir `u` + Enter en el terminal del lanzador): fast-forward, `npm install` si cambiaron las dependencias, `npm run build` y reinicio. Si algo falla, vuelve al commit anterior. Ver [Actualizar la oficina](docs/how-it-works.md#actualizar-la-oficina).

`npm pack --dry-run` y `node scripts/smoke-package.mjs` (después de `npm run build`) siguen sirviendo para comprobar que el paquete arranca en modo demo en una carpeta limpia, como hace CI.

## Traer cambios del proyecto original

Para incorporar mejoras de cubefarm:

```bash
git remote add upstream https://github.com/leonvanzyl/cubefarm   # solo la primera vez
git fetch upstream
git checkout -b sareoffice/upstream-sync main
git merge upstream/main
```

Resuelve los conflictos teniendo en cuenta lo que este fork cambia a propósito:

- el nombre (`sareoffice`, `bin/sareoffice.js`, `~/.sareoffice`) y `"private": true` en `package.json`;
- la marca de Saredigital (paleta navy `#0D0D1A` y ámbar `#FFC107`, IBM Plex Sans) y los textos en español, incluidos los prompts de los agentes;
- las funcionalidades eliminadas (juegos del móvil, juguetes, el perro, eventos del cielo, charla de los agentes, rituales, festivos/temas): si upstream las toca, descarta esos cambios;
- sin `.github/workflows/release.yml` ni comprobación de versiones en npm.

Después ejecuta `npm install`, `npm run typecheck`, `npm test` y `npm run build`, prueba en una oficina demo y abre una pull request contra `main`.
