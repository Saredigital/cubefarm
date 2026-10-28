# Servicio protegido de empresa y correo

La oficina local y sus CLIs de desarrollo no son una frontera de seguridad. Un proceso con la misma identidad puede leer los archivos y credenciales del otro. Por eso la oficina normal **bloquea las conexiones reales de empresa**; la demo funciona con datos y proveedores simulados. Una variable de entorno, un prompt, `Origin` o un token que el agente pueda leer no resuelven ese problema.

El servicio independiente de `server/company-security/broker.ts` carga exclusivamente empresa, correo, autenticación y proveedores API. No importa `Swarm`, terminales, herramientas de shell, GitHub, configuración personal ni el lanzador que actualiza el repositorio. Ofrece la interfaz en `/?company=1`; las APIs legacy devuelven 404.

Para configurar una empresa desde cero **sin demo y sin integraciones**, existe
[`company:setup-local`](local-company-setup.md). Su entrada independiente solo permite configuración humana
en loopback, sin proveedores ni ejecución. No requiere el host dedicado porque no puede activar conexiones:
escribe borradores de configuración en texto plano y no está destinada a secretos ni información confidencial.
Este modo no cambia el gate ni los requisitos del broker real.

## Despliegue admitido y comprobaciones

La primera implementación real admite Windows, Node 22+ y una cuenta local `sareoffice-broker`, sin privilegios administrativos. Se ejecuta mediante una tarea programada con inicio no interactivo; no se intenta registrar `node.exe` como servicio SCM. La tarea se registra **sin iniciarla**.

El servicio debe instalarse en un equipo o VM independiente. Los agentes no pueden tener sesión, administración del hipervisor, acceso remoto, Docker/WSL compartido, carpetas compartidas ni permiso para administrar ese equipo. La interfaz del responsable se abre desde un dispositivo de confianza cuyo perfil del navegador no sea accesible a los agentes. Los administradores de ese equipo forman parte de la frontera de confianza.

Al arrancar, el broker consulta Windows para comprobar:

- Identidad real de la cuenta `sareoffice-broker`, SID local, sesión 0 y token sin pertenencia administrativa activa.
- ACL sin herencia en configuración, clave de cifrado, clave TLS y directorio de datos. Solo pueden conceder acceso al SID del broker, SYSTEM y administradores.
- Dueños de confianza, ausencia de junctions/enlaces y ACL de los descendientes. Código, dependencias y directorio del runtime Node solo admiten escritura de SYSTEM y administradores; la cuenta del broker tiene lectura.
- Clave AES de 32 bytes fuera del directorio de datos.
- Configuración cifrada válida, contraseña humana de al menos 20 caracteres y certificado HTTPS.

Estas pruebas **no demuestran que el equipo esté separado de otro equipo**, ni impiden a un administrador tomar posesión de los datos. La independencia del host y del dispositivo de administración se verifica durante la instalación. Las pruebas automatizadas validan los rechazos del gate y las APIs con simuladores; no han creado una cuenta de Windows ni desplegado una tarea real en este entorno.

### Preparación manual

1. En el host dedicado, instalar una copia revisada del código, Node y dependencias (`npm ci`), y ejecutar `npm run build`. Proteger el directorio de código y `node_modules` contra escritura por identidades no administrativas; el broker solo necesita lectura.
2. Preparar DNS y un certificado TLS válido para el origen del broker. Restringir el puerto en la red al dispositivo de administración autorizado; los puestos de desarrollo no deben alcanzarlo.
3. Preparar configuración JSON en memoria desde una consola administrativa. El esquema estricto está en `server/company-security/brokerConfig.ts`. `company:provision` lee JSON de la entrada estándar y escribe exclusivamente configuración cifrada. No incluir secretos en argumentos, historial de consola o repositorio.
4. Ejecutar el instalador con una contraseña de cuenta suministrada como `SecureString`. Revisar antes las rutas y ACL; el script cambia los permisos **en los archivos privados indicados y en toda la copia dedicada de código**. Exige un directorio de datos vacío y Node instalado para todos los usuarios en Program Files. No usar el checkout de desarrollo ni dependencias enlazadas. Verificar manualmente que el broker puede leer el código y TLS público y escribir en los datos.
5. Iniciar la tarea desde el Programador de tareas. Comprobar `/api/company/security/status`, iniciar sesión y realizar las pruebas con buzones de prueba antes de autorizar el piloto.

Ejemplo de forma de configuración (son valores ficticios; no debe guardarse un archivo real sin cifrar):

```json
{
  "publicOrigin": "https://empresa.example.test:4452",
  "listenHost": "0.0.0.0",
  "port": 4452,
  "managerPassword": "SUSTITUIR-POR-UNA-CONTRASENA-LARGA",
  "mailboxes": [
    {
      "id": "operaciones",
      "name": "Operaciones",
      "address": "operaciones@example.test",
      "folders": ["inbox"],
      "connection": {
        "provider": "graph",
        "userId": "operaciones@example.test",
        "tenantId": "TENANT-ID",
        "clientId": "CLIENT-ID",
        "clientSecret": "SECRETO"
      }
    }
  ]
}
```

Comandos de ejecución (rutas de ejemplo; no ejecutan conexiones por sí mismos):

```powershell
# $configurationJson se construye sin almacenar secretos en el historial.
$configurationJson | npm run company:provision -- C:\BrokerPrivate\config.enc C:\BrokerKeys\store.key

.\scripts\install-company-broker.ps1 `
  -Workspace C:\SareofficeBroker `
  -Config C:\BrokerPrivate\config.enc `
  -KeyFile C:\BrokerKeys\store.key `
  -StateDirectory C:\BrokerData `
  -TlsCertificate C:\BrokerTls\certificate.pem `
  -TlsKey C:\BrokerTls\private-key.pem `
  -AccountPassword (Read-Host 'Contraseña de la cuenta del broker' -AsSecureString)
```

La contraseña de la cuenta Windows es distinta de la contraseña de la interfaz. El script registra `SareofficeCompanyBroker` con inicio al arrancar el sistema y nivel limitado. No abre reglas de firewall, conecta cuentas ni envía correo. Cambiar la contraseña de una cuenta existente requiere actualizarla explícitamente en Windows y en la tarea.

El comando subyacente es `npm run company:broker -- --config … --key-file … --state-dir … --tls-cert … --tls-key …`; una consola interactiva normal no supera el gate. No hay modo de arranque real alternativo por variable de entorno. `createBrokerApp` permite composición programática y simuladores para pruebas, pero no certifica un despliegue: solo el entry point con gate es el arranque admitido.

Las cuentas sociales se añaden al campo opcional `socialAccounts` de la configuración cifrada, según el esquema
de `server/company-social/config.ts` y la guía de redes. Se montan en `/api/company/social` con la misma sesión
humana y permisos de fuentes, pero con aprobaciones distintas de las del correo. La subida de medios tiene un
límite JSON específico de 17 MB; el resto de las rutas del broker conserva 256 KB. El origen de medios públicos
debe coincidir con el origen HTTPS del broker. El cierre espera a los intentos sociales en curso antes de liberar
el bloqueo del programador.

El cierre por señal deja de aceptar conexiones y espera a las peticiones y al programador hasta 45 segundos.
Las peticiones sociales tienen un límite de 30 segundos y comprueban el cierre entre pasos. Si se agota el
plazo, el cierre se considera fallido, el proceso termina con error y conserva el bloqueo y el intento durable; no se libera un bloqueo mientras
el intento siga activo. Al reiniciar se comprueba que el proceso anterior ya no existe y se recuperan los intentos
sin repetir una publicación incierta. La oficina demo emplea el mismo margen para su programador.

## Autenticación, permisos y datos derivados

Las sesiones humanas usan cookie `HttpOnly`, `SameSite=Strict`, `Secure` en el broker y token CSRF por sesión. La ruta de la cookie es `/api/company`. El acceso de especialistas utiliza tokens bearer aleatorios distintos, emitidos por el despachador; no existe una ruta pública para pedir tokens ni un header de rol aceptado. La aprobación humana solo acepta una autoridad opaca registrada por el servidor.

Los permisos son `read`, `organize` y `draft` por agente y buzón. Un agente debe poder leer **todos** los buzones que originaron un recurso. Ningún agente dispone de herramienta de envío. La organización inicial solo permite marcar leído/no leído.

Cada lectura de contenido añade sus buzones y fuentes al contexto de sesión del servidor. Las escrituras heredan ese contexto aunque el cliente omita `provenance`. Las búsquedas, tareas, conocimiento, adjuntos, entregables y delegaciones aplican la misma regla. Un resumen no elimina restricciones. Los datos generales creados en una sesión sin fuentes restringidas pueden compartirse entre departamentos.

La lectura de `/mail/state?mailboxId=…` incorpora solo el buzón seleccionado. `/mail/mailboxes` muestra inventario de conexiones autorizado, sin asuntos ni mensajes. El contexto acumula los buzones visitados durante la sesión, también para el responsable. Para crear información general después de revisar correo hay que cerrar la sesión y abrir otra.

Cambiar permisos persiste primero el nuevo estado; después invalida las aprobaciones afectadas, revoca sesiones del agente y cancela sus ejecuciones. Un fallo al guardar no concede permisos. Las cancelaciones impiden guardar resultados tardíos. No se afirma que la revocación borre datos ya procesados por un proveedor de IA.

Las aprobaciones sociales con fuentes de correo incorporan además la huella de las versiones persistidas de
permisos de todos sus buzones. El programador vuelve a comprobarla antes de publicar, también tras reiniciar:
un fallo al guardar la invalidación social no puede restaurar una aprobación anterior a la revocación.

## Custodia y rutas de datos

| Dato | Ubicación y acceso |
| --- | --- |
| Contraseña humana, credenciales Graph/IMAP/SMTP/IA | Configuración AES-256-GCM; solo broker y administración de confianza. |
| Mensajes, borradores, adjuntos permitidos, permisos, intentos y auditoría | `mail.enc`, cifrado autenticado y escritura temporal + fsync + rename. |
| Tareas, conocimiento, oportunidades y entregables derivados | `CompanyStore` cifrado y copias cifradas en el broker. |
| Clave AES y clave TLS | Archivos separados con ACL verificadas. Nunca se entregan al especialista. |
| Contexto del especialista | Memoria de una sesión opaca, API de IA configurada y autorizada. |
| Snapshot global, diario de la oficina, voz, terminales, avisos y pantallas compartidas | No reciben correo, asuntos, destinatarios, fuentes ni textos derivados. |

El almacén verifica integridad GCM y separa finalidades mediante AAD; una configuración cifrada no sirve como base de correo. Las sesiones y aprobaciones de correo no se restauran tras reiniciar. Los intentos que quedaron en `sending` pasan a `uncertain`. Las escrituras auditadas registran identidad, acción, identificador, fecha, versión y hash; no copian cuerpos ni secretos a logs.

La demo puede guardar su clave al lado de sus datos sintéticos. Eso es una comodidad de la simulación y **no** se admite como custodia de claves reales.

Retención actual: datos privados hasta eliminación administrativa de la instalación y últimas 10.000 entradas de auditoría sin cuerpos. Las copias administrativas contienen exclusivamente archivos cifrados. No hay política automática de caducidad del correo ni copia externa automática. Para retirar una instalación, suspender la tarea, conservar o eliminar copias según la política de la empresa y retirar también claves y credenciales del proveedor; borrar archivos no garantiza borrado físico en SSD o copias remotas.

## Proveedores y adjuntos

Las respuestas fijan el `Message-ID` válido del mensaje de origen al crear el borrador; esa cabecera forma
parte de la huella aprobada y no admite cambios desde el cliente. El destinatario inicial utiliza `Reply-To`
cuando existe y queda visible para revisión. Graph recibe un único MIME construido en memoria mediante
`sendMail`; SMTP recibe las mismas opciones cerradas, con `In-Reply-To` y `References` derivados del origen.
No se crea un borrador remoto que pueda cambiar entre la revisión y el envío. El identificador del intento
produce un `Message-ID` estable para reconciliar; un corte antes o durante la solicitud deja el intento incierto
sin reenvío automático. Si el mensaje carece de un identificador válido, se bloquea la respuesta en conversación.
Los borradores antiguos sin esa cabecera deben recrearse desde un mensaje sincronizado.

El formato se apoya en la documentación de [Graph sendMail con MIME](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
y [Nodemailer Stream transport](https://nodemailer.com/transports/stream). Las
[cabeceras de mensajes Graph](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
no se tratan como un campo editable mediante PATCH. La aceptación del proveedor no equivale a entrega ni
garantiza cómo agrupe cada cliente visualmente su conversación.

Microsoft 365 usa OAuth de aplicación del tenant y Microsoft Graph. El administrador debe limitar la aplicación a los buzones designados mediante los controles de Exchange, conceder únicamente permisos necesarios (`Mail.Read`, o `Mail.ReadWrite` para organización, y `Mail.Send` para envíos revisados), y revisar el consentimiento. El broker restringe además cada agente por buzón. No se realiza consentimiento ni conexión automáticamente.

Graph sincroniza carpetas mediante delta y paginación, recupera cursores caducados con una nueva sincronización y rechaza enlaces a otro host/buzón. IMAP usa TLS obligatorio, UIDVALIDITY y UID, lotes limitados, reconciliación de borrados y páginas rotatorias de flags. La lectura IMAP comprueba tamaño antes de descargar MIME; los mensajes grandes se representan como omitidos para que no bloqueen la sincronización.

Los cuerpos se entregan como texto: no se renderiza HTML del proveedor, no se descargan imágenes remotas ni se ejecutan instrucciones o adjuntos. La política inicial de adjuntos libera exclusivamente `text/plain` UTF-8 válido de hasta 200 KB, sin bytes de control. Conserva nombre, tamaño y SHA-256. HTML, ejecutables, PDF, imágenes y otros tipos permanecen en cuarentena visible. Esta política acotada no equivale a un antivirus general.

Los adjuntos liberados pueden descargarse mediante una ruta autenticada con `Content-Disposition: attachment`, `nosniff` y CSP sin ejecución. Se almacenan cifrados y pueden incluirse en un borrador; su identidad liga fuente, nombre, tipo y hash de los bytes. Cada envío verifica de nuevo esos bytes. Cambiar la selección de adjuntos cambia la versión y exige una nueva aprobación.

Toda respuesta requiere una aprobación humana de remitente, destinatarios, CC/CCO, asunto, cuerpo y adjuntos de una versión exacta. Caduca a los 15 minutos. Una revisión de entregable no sustituye esa aprobación. El broker consume la aprobación y guarda el intento antes de llamar al proveedor.

Un resultado `accepted` significa aceptado por el proveedor, no entregado. SMTP conserva destinatarios aceptados y rechazados cuando la aceptación es parcial. Un corte de conexión produce `uncertain`: no se reintenta automáticamente. La reconciliación solo cambia a aceptado cuando encuentra evidencia; la ausencia de un mensaje en enviados no demuestra un fallo. IMAP requiere configurar la carpeta de enviados y que el proveedor conserve copia para poder reconciliar; en otro caso se mantiene incierto.

Referencias verificadas: [Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [sincronización delta](https://learn.microsoft.com/en-us/graph/delta-query-messages), [IMAP RFC 9051](https://www.rfc-editor.org/rfc/rfc9051.html), [IMAPFlow](https://imapflow.com/docs/api/imapflow-client), [Nodemailer SMTP](https://nodemailer.com/smtp).

## Especialistas y límites de ejecución

El runtime solo llama a una API Anthropic u OpenAI configurada por la administración. No expone shell, sistema de archivos, navegador, conectores heredados ni herramientas ejecutables del modelo. Las fuentes se resuelven en el servidor con la identidad del especialista antes de construir el contexto. La salida es un entregable para revisión.

Sin proveedor, modelo, clave, precios de entrada/salida y límite de tokens explícitos, la ejecución real está bloqueada. El presupuesto debe cubrir una cota conservadora del contexto y salida antes de enviar la solicitud. El despachador reserva ese coste y lo conserva ante una respuesta incierta, en vez de liberar presupuesto para reintentos ilimitados. Hay límites de contexto, tiempo, concurrencia global y por agente. Las instrucciones maliciosas en un mensaje pueden influir en un texto generado, pero no conceden permisos ni crean herramientas.

## Verificación y límites pendientes

Ejecutar `npm run typecheck` y `npx vitest run server/company-security server/mail --maxWorkers=1`. Las pruebas cubren suplantación, canales de identidad, CSRF, aislamiento de buzones, procedencia, revocación, cifrado, manipulación de versiones, doble clic, reinicio, respuesta incierta, proveedores simulados, adjuntos y runtime sin herramientas. Ninguna prueba utiliza buzones reales.

El piloto necesita un host dedicado, administración y red verificadas, certificado TLS, identidad Windows creada, buzones de prueba designados y consentimiento del tenant. La instalación del Programador de tareas y las conexiones reales no se han ejecutado en este trabajo. El producto no debe presentarse como un piloto ya validado. Otras plataformas, formatos de adjuntos, retención automática y reconciliación exhaustiva de enviados requieren ampliaciones explícitas.
