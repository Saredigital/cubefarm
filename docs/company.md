# Gestión de empresa en escritorio y móvil

La oficina incorpora departamentos independientes de GitHub, proyectos entre departamentos, especialistas, tareas con dependencias, entregables versionados, revisiones, conocimiento, marketing y gestión comercial interna.

En escritorio, **Gestionar empresa** abre la consola. En el panel de control, **Gestión de empresa** abre la misma gestión; en modo bolsillo, la pestaña **Empresa**. `/?company=1` abre únicamente la gestión de empresa: no inicia el WebSocket del orquestador, no registra el service worker de la oficina y no requiere el snapshot de Swarm. Este acceso permite al servicio protegido servir el mismo cliente sin ejecutar las CLIs de desarrollo.

## Sesión y privacidad

El acceso del responsable utiliza una cookie HttpOnly del servidor y un token CSRF mantenido exclusivamente en memoria. No hay selectores locales de rol ni contraseñas persistidas en el navegador. Cerrar o caducar una sesión invalida las respuestas pendientes: una petición anterior no puede volver a mostrar contenido privado después del cierre.

La proyección `/api/company/public` contiene exclusivamente el directorio de departamentos y los nombres públicos de sus especialistas. Las plantas, el directorio, el ascensor y la vista del edificio utilizan esa proyección; nunca consultan tareas, contactos, oportunidades, campañas, conversaciones ni borradores privados. Las pizarras y puestos abren la gestión protegida para consultar el trabajo. Los repositorios conservan su planta y sus herramientas de desarrollo, QA y terminal.

Las sesiones humanas y el contenido de trabajo permanecen fuera del store global de la oficina, del diario y de sus notificaciones. La biblioteca identifica la procedencia de cada versión; los datos derivados de correo conservan sus restricciones.

## Trabajo y revisiones

1. Crea un departamento con misión y planta, sin necesitar un repositorio.
2. Crea un proyecto o inicia un flujo de operaciones, marketing o negocio.
3. Revisa la asignación, capacidades, presupuesto, dependencias y criterios de las tareas.
4. Ejecuta las tareas disponibles. En demo, el resultado se genera de forma simulada.
5. Acepta, solicita cambios o rechaza una versión del entregable. Finaliza la tarea desde Trabajo cuando sus resultados estén aceptados; entonces pueden ejecutarse las dependientes.

Los perfiles se pueden editar y el modelo del especialista se configura por separado. Los permisos de correo se conceden por agente y buzón en **Integraciones y correo**. Se pueden revocar sin convertir al coordinador en lector universal.

Marketing ofrece campañas y calendario para X, Instagram, Facebook y TikTok. Las fechas del calendario son propuestas editoriales: la publicación requiere un conector autorizado y aprobación específica. La aceptación de un entregable no publica contenido. Negocio incorpora contactos, oportunidades, etapas comerciales, valor estimado y próximos pasos; no presupone que exista un CRM externo.

En **Marketing → Abrir conectores y publicaciones**, el responsable puede preparar una publicación desde un entregable revisado, elegir cuenta, texto exacto, imágenes JPEG o vídeos MP4 y fecha. La revisión muestra sus archivos y SHA256, versión de origen y huella del envío. Modificar cualquier campo bloquea la publicación hasta guardar y aprobar de nuevo. Los contenidos derivados de correo requieren además autorizar expresamente su divulgación en el canal indicado.

Los conectores de X, Instagram y Facebook muestran la disponibilidad declarada por el servicio protegido y permiten comprobar el resultado. «Aceptado por el proveedor» y «Publicación confirmada» son estados distintos. Ante un resultado incierto se comprueba el intento existente, sin repetir la publicación. Para una fecha futura, **Aprobar y programar publicación** autoriza al programador a ejecutarla a esa fecha; no es un mero visto bueno editorial.

Para TikTok, esta oficina interna utiliza **exportación y publicación manual**. El responsable aprueba el paquete exacto, descarga texto y medios verificados y publica desde la aplicación del canal, donde decide privacidad, interacciones y divulgación comercial. Después puede registrar la URL y una comprobación propia. El estado indica que la evidencia la ha aportado el responsable, sin afirmar que el proveedor haya verificado automáticamente la publicación. Una exportación manual no se programa ni sube contenido por sí sola.

## Correo y envío

La interfaz muestra el estado declarado por el servicio para Microsoft 365 e IMAP/SMTP: simulado, conectado o no disponible. Primero presenta el inventario administrativo; el responsable elige un buzón y el servidor filtra sus mensajes antes de incorporar su procedencia a la sesión. Consultar otro buzón acumula restricciones. Para empezar trabajo general con contexto nuevo hay que cerrar sesión y volver a entrar. El selector de carpeta determina qué carpeta sincroniza el proveedor.

Las conversaciones se representan como texto, sin ejecutar HTML ni cargar imágenes remotas. Los adjuntos de texto UTF-8 que el servicio haya validado pueden descargarse y seleccionarse para un borrador, mostrando nombre, tamaño y SHA256. Los demás permanecen en cuarentena y no se pueden incluir. Desde cada conversación se puede crear un flujo con su contexto autorizado; el flujo comercial incorpora contacto, oportunidad, propuesta y seguimiento, y exige acceso de todos los especialistas participantes a las fuentes utilizadas.

Cada respuesta requiere comprobar remitente, Para, CC, CCO, asunto, texto y adjuntos. El responsable confirma el contenido completo y aprueba una versión y su huella. **Enviar versión aprobada** es una acción posterior. Editar bloquea el envío inmediatamente; guardar genera una versión nueva que requiere otra aprobación. El servidor vuelve a comprobar la aprobación y los permisos.

El estado «Aceptado por el proveedor» no confirma la entrega. La interfaz presenta destinatarios aceptados y rechazados cuando el proveedor informa un resultado parcial. Un resultado incierto ofrece comprobación con el proveedor, sin reenvío automático. La demo no contacta con cuentas reales.

## Verificación local

Para preparar una oficina nueva sin cuentas, inicia `npm run company:setup-local -- --state-dir RUTA_NUEVA --port 4453` y abre la dirección que imprime la terminal, con `?company=1`. La contraseña temporal aparece únicamente en esa terminal. Esta instancia de configuración escucha en loopback y no es un entorno confidencial: no introduzcas credenciales ni datos sensibles.

El rótulo **Configuración local · sin conexiones ni ejecución** distingue esta entrada de la demo y del servicio protegido. Las cinco plantas y los perfiles iniciales son plantillas editables; no hay especialistas, proyectos, tareas, contactos, campañas ni buzones de ejemplo. Puedes preparar la estructura y guardar trabajo, pero los controles de ejecución y publicación permanecen desactivados. No se cargan fuentes externas ni se conecta el WebSocket del orquestador. El escenario `e2e/company-local.spec.ts`, con `playwright.company-local.config.ts`, crea y elimina una instancia temporal independiente para comprobar este recorrido en escritorio y móvil.

Respeta siempre `SWARM_HOME` aislado y puertos propios; no uses 4317, 5317 ni el estado de la oficina en vivo. El escenario `e2e/company.spec.ts` recorre la gestión de departamentos, campañas, revisiones, aprobación de correo en móvil y la exportación del flujo de correo a propuesta. `e2e/company-social.spec.ts` comprueba aprobación social, invalidación al editar, proveedores simulados y exportación manual con medios sintéticos JPEG/MP4. Los tests de `client/src/company/` comprueban dependencias, protección CSRF, errores, aprobación caducada y respuestas tardías tras cerrar sesión.
