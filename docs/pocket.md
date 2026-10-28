# La oficina en el bolsillo

sareoffice funciona desde el móvil: el **modo bolsillo** es la oficina como app 2D, se instala en la pantalla de
inicio, y la oficina te avisa cuando algo te necesita, en tus dispositivos o en la app ntfy.

## Modo bolsillo

En una pantalla estrecha o táctil la oficina se abre sola en modo bolsillo. En un ordenador, elige **📱 Modo
bolsillo** en la pantalla de inicio. Cada dispositivo recuerda lo último que elegiste; `?pocket=1` o `?pocket=0` en la
dirección decide para una visita. Cinco pestañas, abajo:

| Pestaña | Qué hay |
| --- | --- |
| **Empresa** | El flujo de cada planta: 🔨 en construcción, 🔍 en QA, 🔧 en corrección, ✅ lista para fusionar, ⚠️ te necesita. Avisos cuando el uso de Claude pausa o frena la oficina, o cuando se está actualizando. |
| **Nombre del CEO** | La conversación del móvil con el CEO, con ▶ para volver a escuchar los mensajes en voz alta. |
| **Kanban** | El tablero de cada planta, una columna debajo de otra: asignar, mandar a QA, fusionar, cerrar, abrir issues. |
| **Equipo** | El estado de cada uno y en qué está, con **Mensaje**, **■ Parar**, **↺ Despejar puesto**, asignar un issue (o una PR para probar) y su terminal. |
| **Aprobaciones** | Cambios de equipo que esperan tu decisión (candidatos que configurar y contratar, agentes que se van), PRs atascadas (**Repetir QA**, **Devolver**, **Merge igualmente**, **Cerrar**) y PRs aprobadas en plantas sin auto-merge. |

El modo bolsillo usa la misma conexión en directo y los mismos comandos que el panel de control, que se abre con
**🗂️ Abrir el panel de control** (pestaña Empresa, o ⚙️).

## Instalarla

La oficina es una app web instalable: Chrome y Edge ofrecen **Instalar** en la barra de direcciones (en Android: ⋮ →
**Añadir a pantalla de inicio**), y Safari en iPhone tiene **Compartir → Añadir a pantalla de inicio**. Para
instalarla, la oficina tiene que servirse por HTTPS, o abrirse como `localhost` en su propio PC (ver [acceso desde el
móvil](#entrar-en-la-oficina-desde-el-móvil)).

El service worker de la app solo guarda en caché el esqueleto de la app (la página, sus scripts y estilos, los iconos)
para que abra rápido. Nunca guarda en caché los datos de la oficina: todo lo que ves llega en directo de la oficina.
Cada actualización de la oficina da al worker una versión nueva, que sustituye a la anterior y a su caché, así que la
app nunca ejecuta código viejo.

## Notificaciones

Abre **⚙️ Ajustes → 🔔 Notificaciones** en la consola del responsable (o **⚙️** en el modo bolsillo) y elige de qué
quieres enterarte:

- una pull request te necesita (atascada, y el CEO te la ha pasado)
- un mensaje del CEO
- un cambio de equipo espera tu decisión
- alguien lleva más de 10 minutos atascado en un error
- el límite de uso de Claude pausa la oficina, o un aviso de uso la frena
- cada merge (desactivado salvo que lo actives)

Recibes como mucho una notificación de cada tipo por minuto. Lo demás de ese tipo que pase en ese minuto llega junto
en un resumen ("🔀 9 merges más"), así que una racha de merges son dos notificaciones, no diez.

**Dirección de la oficina para los enlaces:** pon la dirección con la que tu móvil abre la oficina (por ejemplo tu
URL de Tailscale Serve) y cada mensaje de chat terminará con ella, para llegar con un toque.

Cada canal tiene un interruptor **Activado** y un botón **Probar**. Una oficina demo (`--demo`) no envía nada: empieza
con todas las apps de chat configuradas con direcciones falsas e imprime en el registro del servidor lo que recibiría cada una.

### Notificaciones de escritorio

Cualquier navegador con la oficina abierta en una pestaña en segundo plano muestra notificaciones, en cuanto pulsas
**Permitir en este navegador**. Una pestaña que estás mirando no: ahí la oficina suena y muestra el aviso igualmente.

### Push al móvil (Web Push)

Push llega a un dispositivo aunque la oficina no esté abierta en él. En cada móvil o PC, abre la oficina por HTTPS (o
como `localhost` en el propio PC de la oficina), ve a **⚙️ → Notificaciones** y toca **Push a este dispositivo**, y
luego **Enviar prueba**. En un iPhone (iOS 16.4 o posterior), añade primero la oficina a la pantalla de inicio y activa
push desde la app instalada: Safari solo permite Web Push ahí.

La oficina firma sus push con su propio par de claves VAPID, creado la primera vez que se suscribe un dispositivo y
guardado en `<SWARM_HOME>/push.json` con las suscripciones de los dispositivos (permisos de fichero solo para el
propietario). Los mensajes se cifran para cada dispositivo (RFC 8291) y pasan por el servicio push del fabricante del
navegador (Google, Mozilla, Apple), que no puede leerlos. Un dispositivo que se da de baja, o cuyo navegador borra sus
datos, se elimina la siguiente vez que falla un push hacia él.

### ntfy

[ntfy](https://ntfy.sh) envía push a su propia app móvil sin cuenta. Cualquiera que sepa el nombre de un tema puede
leerlo, así que elige uno largo y aleatorio.

1. En la app ntfy, suscríbete a un tema como `sareoffice-7f3k9q2m`.
2. Introduce `https://ntfy.sh/sareoffice-7f3k9q2m` (o la URL del tema en tu propio servidor ntfy) en **ntfy**. Para un
   tema con control de acceso, añade su token de acceso (`tk_…`). **Guardar** y **Probar**.

### Dónde se guardan los secretos

El tema y el token de ntfy se guardan en `<SWARM_HOME>/secrets.json` (`~/.sareoffice/secrets.json` por defecto) junto
a la clave de ElevenLabs: permisos de fichero solo para el propietario, nunca en `state.json`, nunca en los registros,
nunca enviados a un navegador (los ajustes muestran los últimos 4 caracteres) y nunca dados a los agentes. **Quitar**
los borra. Una oficina demo tiene sus propios `demo-secrets.json` y `demo-push.json`.

## Entrar en la oficina desde el móvil

La oficina escucha solo en `127.0.0.1`, a propósito: puede arrancar agentes que ejecutan comandos en tu PC, así que
nunca debe quedar abierta a tu red ni a internet tal cual. Nunca cambia eso ni abre puertos por su cuenta. Para usarla
desde el móvil, pon delante algo que te autentique:

- **Tailscale Serve (recomendado).** Instala [Tailscale](https://tailscale.com) en el PC de la oficina y en tu móvil,
  con la sesión iniciada en la misma tailnet. En el PC ejecuta:

  ```
  tailscale serve --bg 4317
  ```

  Imprime una dirección como `https://office-pc.your-tailnet.ts.net`, con un certificado HTTPS real, accesible solo
  desde tus propios dispositivos. Ábrela en el móvil: el modo bolsillo, la instalación y push funcionan. Pon esa misma
  dirección en **Dirección de la oficina para los enlaces**. `tailscale serve reset` lo para. No uses
  `tailscale funnel`, que publica la oficina para todo internet.
- **Cloudflare Tunnel con Cloudflare Access**, u otro túnel que te obligue a iniciar sesión antes de que nada llegue a
  la oficina, también sirve. Un túnel sin su propio inicio de sesión no es seguro.

Por `http://` normal en tu red local (por ejemplo `http://192.168.1.20:4317`, que necesitaría que la oficina escuchara
ahí, y no lo hace) los navegadores rechazan los service workers y push, así que no hay instalación ni push: otro motivo
para usar HTTPS.

Recuerda también el [problema de seguridad conocido](../README.md#seguridad-problema-conocido-sin-corregir): los
WebSockets de la oficina aún no comprueban el `Origin`, así que no navegues por webs desconocidas en el mismo navegador
con la oficina abierta.
