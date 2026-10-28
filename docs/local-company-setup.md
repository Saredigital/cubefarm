# Configurar una empresa local desde cero

Esta instancia permite preparar una empresa sin demo, sin conectar cuentas y sin ejecutar agentes.
Empieza con cinco departamentos y perfiles editables como plantillas de estructura. No contiene agentes,
proyectos, tareas, clientes, oportunidades, correos, entregables ni publicaciones de ejemplo.

La consola de empresa se sirve en `/?company=1` desde el mismo servidor local; no carga el estado ni los WebSockets
de la oficina histórica.

## Arranque

Desde el código fuente, con Node 22+ y dependencias instaladas:

```powershell
npm run build
npm run company:setup-local -- --state-dir (Join-Path $env:LOCALAPPDATA 'Sareoffice\LocalSetup\mi-empresa') --port 4454
```

Elige una carpeta nueva. Se recomienda una ubicación persistente fuera del checkout y de las carpetas
sincronizadas. Si prefieres variables, el comando acepta exclusivamente `SWARM_HOME` para esta carpeta y
`SWARM_PORT` para su puerto; los argumentos explícitos tienen prioridad. No lee credenciales, claves de IA,
configuración personal de las CLIs ni otras variables de integración. El puerto predeterminado es 4454.
Rechaza los puertos de la oficina existente 4317 y 5317 y cualquier opción distinta de `--state-dir` y `--port`.

Abre `http://127.0.0.1:4454/?company=1`. En la consola, inicia sesión con la **contraseña temporal**
que muestra la terminal del arranque. Se genera aleatoriamente, no se guarda en archivos ni se devuelve en
las APIs y cambia al reiniciar. No es la contraseña de la demo ni una credencial de proveedor. Las sesiones
caducan en una hora. Cerrar sesión revoca esa sesión; reiniciar invalida todas las anteriores.

La sesión utiliza una cookie local distinta de la oficina normal, `HttpOnly` y `SameSite=Strict`, con token
CSRF para cambios. El servidor escucha exclusivamente en `127.0.0.1`, verifica Host y Origin y rechaza el
canal bearer. No debe exponerse mediante proxy, túnel ni reenvío de puertos. La página evita fuentes externas
y su política de contenido permite conexiones únicamente al mismo origen.

## Qué puedes configurar

- Nombre y objetivo de la empresa, departamentos, plantas, perfiles y especialistas sin modelo.
- Proyectos, tareas planificadas, procedimientos, documentos de trabajo, CRM y calendarios.
- Revisiones y organización manual del trabajo.

El correo y las redes muestran inventarios vacíos. Las rutas de sincronización, credenciales, modelos,
publicación, envío, fuentes externas y ejecución devuelven un bloqueo explícito, aunque se invoquen a mano.
No existe un mecanismo para activar esas funciones dentro de esta instancia. Ningún especialista recibe
una sesión ejecutable. La preparación de un flujo puede crear tareas, pero ejecutarlo permanece bloqueado.

## Objetivos, coordinación y teléfono

Desde la consola de empresa, abre **Objetivos y coordinación**. El **Teléfono** abre la misma sección autenticada, sin el chat, los modelos ni las cuentas de
la oficina histórica. Los objetivos y las propuestas se muestran dentro de la sesión; no en los carteles
públicos de la oficina.

La leyenda inferior muestra tus teclas configuradas. Por defecto, **E** interactúa con el puesto que estás
mirando, **P** abre o cierra el teléfono, **Esc** cierra el panel y **H** abre la ayuda. También puedes usar
los botones y hacer clic en el puesto. El atajo del teléfono no interrumpe la escritura en los formularios.

En **Coordinación**:

1. Incorpora los especialistas que requiere el flujo desde **Configurar especialistas**. Operaciones
   necesita los perfiles de operaciones y coordinación; marketing, marketing y operaciones; una propuesta
   comercial, negocio y operaciones. En esta instancia puedes dejar el modelo vacío.
2. Elige **Tipo de objetivo**, escribe el **Objetivo para coordinación** y pulsa **Crear plan de tareas**.
   Se crea un proyecto con tareas mediante una plantilla predefinida. No es una conversación con IA ni
   genera propuestas automáticamente; puedes preparar los entregables manualmente desde **Trabajo**.
3. Revisa las propuestas de los departamentos: acepta, solicita cambios o rechaza con un comentario.
   La decisión corresponde a la versión exacta mostrada; una nueva versión necesita otra revisión.
4. Usa **Finalizar tarea revisada** para cerrar una tarea después de aceptar las últimas versiones de
   todos sus entregables. Aceptar una propuesta no finaliza la tarea por sí solo.

Estos pasos no conectan cuentas, ejecutan especialistas ni autorizan envíos de correo o publicaciones.

## Datos, reinicio y cierre

El directorio contiene `setup-local.json`, un bloqueo de instancia y `company/company-state.json`, con sus
copias locales. **El estado se guarda en texto plano**: úsalo para borradores de configuración, sin secretos,
credenciales ni información confidencial. La autenticación evita accesos web no autorizados; no aísla los
archivos frente a otros procesos ejecutados con tu misma cuenta del sistema.

Una carpeta de demo, producción o de la oficina existente no se importa: el arranque rechaza directorios
no vacíos sin el marcador específico y nunca usa `~/.sareoffice`. No sigue enlaces de directorios ni migra
repositorios o datos antiguos. Reiniciar con la misma carpeta marcada conserva tus cambios y genera otra
contraseña; elegir una nueva carpeta crea otra empresa limpia.

Cierra con Ctrl+C. Se detienen las nuevas conexiones y se esperan las peticiones en curso; a los cinco
segundos se cierran las conexiones restantes. El bloqueo se libera después del cierre HTTP. Si el proceso
se mata de forma abrupta, el siguiente arranque conserva y rechaza el bloqueo: comprueba en Windows que
la instancia anterior ha terminado y elimina únicamente `setup-local.lock` de esa carpeta específica.
No borres los datos ni el marcador. No se elimina automáticamente un bloqueo observado para evitar
carreras entre dos arranques.

No hay migración automática de esta configuración al broker real. Activar integraciones requiere preparar
el [servicio protegido independiente](security-company.md), verificar su administración y revisar qué
configuración trasladar. Este arranque local no modifica la oficina que ya esté funcionando.

## Pruebas

`npx vitest run server/company-security/setupLocal.test.ts server/company-security/security.test.ts server/company/store.test.ts --maxWorkers=1`
comprueba inicio vacío, sesión/CSRF, bloqueo de ejecución e integraciones, aislamiento del directorio,
persistencia, rechazo de opciones y ausencia de llamadas a proveedores. No conecta cuentas.
