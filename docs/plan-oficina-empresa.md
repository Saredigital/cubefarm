# Plan de implementación: oficina de agentes para Saredigital

Estado: implementación autorizada y en verificación local, sin commits ni conexión a cuentas reales. El servicio integrado permite la demo; los datos reales requieren el broker protegido en un equipo separado de las CLIs. La existencia del código no acredita un piloto ni un despliegue real.

## 1. Objetivo y acuerdos

Convertir sareoffice en una oficina para gestionar una empresa con departamentos de dirección, operaciones, marketing, desarrollo de negocio y desarrollo técnico. Mantener las vistas 3D y móvil, adaptando su información al trabajo de cada departamento.

Acuerdos confirmados:

- Una empresa, varios buzones de Microsoft 365 e IMAP.
- El responsable elige los buzones y acciones permitidos para cada agente.
- La información del correo solo se comparte con agentes autorizados para el mismo buzón. Los resultados que combinan varios buzones requieren acceso a todos.
- El conocimiento general de la empresa puede compartirse entre departamentos.
- Toda respuesta por correo pasa por el responsable. No existe envío autónomo.
- Seguridad aplicada por el servidor y por el entorno de ejecución, no únicamente mediante prompts.
- Conservar el desarrollo de software como una capacidad de la oficina.
- Implementar y verificar localmente sin commits ni acciones externas reales.
- Canales sociales: X, Instagram, Facebook y TikTok. X, Instagram y Facebook tienen conectores API configurables, sin cuentas reales activadas en esta entrega. TikTok automático permanece bloqueado para esta herramienta interna; dispone de exportación de vídeo/texto aprobados y registro de evidencia manual. Cada salida requiere autorización humana propia; una revisión de contenido no equivale a permiso para publicar.
- No hay un CRM existente: la oficina incorpora contactos, oportunidades, propuestas y próximos pasos internos.

## 2. Modelo de producto

| Elemento | Comportamiento propuesto |
| --- | --- |
| Empresa | Objetivos, prioridades, servicios, marca, conocimiento general y conexiones. |
| Departamento | Misión, especialistas, trabajos, métricas y una planta asignada. Puede existir sin repositorios. |
| Proyecto | Agrupa trabajo de uno o varios departamentos: campaña, oportunidad comercial, operación interna o producto. |
| Agente | Especialidad, instrucciones, herramientas, fuentes autorizadas, carga y presupuesto. El modelo de IA es una configuración separada de su función. |
| Tarea | Objetivo, responsable, colaboradores, prioridad, plazo, dependencias, contexto permitido y criterio de finalización. |
| Entregable | Documento, borrador de correo, publicación, propuesta comercial, informe, código u otro resultado versionado. |
| Revisión | Aceptar, solicitar cambios o rechazar un entregable. La aprobación para ejecutar una acción externa es un registro adicional. |
| Conexión | Cuenta corporativa administrada por el responsable; sus credenciales nunca se entregan al agente. |

Flujo común: **pendiente → asignada → en curso → en revisión → finalizada**. Estados adicionales: bloqueada y cancelada. Cada departamento puede añadir pasos propios sin forzar que todo sea un issue o una PR.

Los proyectos no equivalen a plantas. Un departamento puede atender varios proyectos y un proyecto puede necesitar marketing, negocio y desarrollo.

## 3. Departamentos y alcance funcional

| Departamento inicial | Especialistas propuestos | Primeras capacidades |
| --- | --- | --- |
| Dirección | Coordinador general | Convertir objetivos en trabajo, asignar responsables, detectar bloqueos y presentar decisiones. |
| Operaciones | Asistente ejecutivo y de correo | Clasificar mensajes, preparar respuestas y mantener tareas y seguimientos. |
| Marketing | Estrategia, contenidos y redes sociales | Encargos de campaña, calendario editorial, piezas por canal y revisión de resultados. |
| Desarrollo de negocio | Investigación comercial y propuestas | Fichas de oportunidades, próximos pasos, propuestas y seguimientos. |
| Desarrollo técnico | Desarrollo y QA | Mantener repositorios, issues, PRs, pruebas y revisiones actuales. |

Los departamentos serán configurables: crear, renombrar, ordenar y archivar. Los perfiles de especialista serán plantillas editables, no una lista cerrada de roles.

El coordinador tampoco tendrá acceso universal al correo. Para coordinar trabajos restringidos necesitará los permisos correspondientes; los avisos generales no incluirán asuntos, clientes ni detalles que revelen su contenido.

## 4. Arquitectura y límites

La base actual vincula `RepoView` a una planta, limita `AgentTask` a `issue/qa/fix` y concentra la planificación en `server/swarm.ts`. Se propone una migración gradual:

- Añadir contratos de departamentos, tareas, entregables, permisos y revisiones en `shared/`.
- Extraer servicios de empresa, trabajo, conocimiento, integraciones y autorización en módulos de `server/`; evitar seguir acumulando todas las funciones en `swarm.ts`.
- Encapsular el flujo GitHub existente como adaptador de desarrollo. No sustituirlo de golpe.
- Adaptar `store.ts`, `api.ts`, eventos y vistas para representar trabajo general. Los datos sensibles se solicitan y entregan solo a sesiones autorizadas; no se añaden al snapshot global.
- Implementar un entorno de ejecución para especialistas con herramientas limitadas a sus capacidades y sin heredar credenciales, conectores o configuración personal.
- Mantener una implementación simulada de cada capacidad, sin correo real ni consumo de agentes.

**Dependencia de seguridad:** las CLIs actuales tienen acceso amplio al equipo. No pueden compartir identidad de sistema, archivos sensibles ni credenciales con el servicio de correo si se pretende impedir accesos entre agentes. Seleccionar y verificar una separación real de procesos, almacenamiento y red antes del piloto. También debe impedirse que los agentes de desarrollo alcancen el servicio privilegiado por otra vía.

`CLAUDE.md` documenta una política histórica de agentes sin restricciones. Los requisitos nuevos de permisos prevalecen para este diseño; habrá que actualizar esa documentación al implementar el entorno nuevo. El control de `Origin` ya existe en el código actual, aunque la documentación aún lo describe como pendiente: verificar su cobertura, sin confundirlo con autenticación.

## 5. Fases y criterios de aceptación

### Fase 0 — Diseño verificable y frontera de seguridad

- Definir contratos, identificadores, persistencia y migraciones versionadas.
- Diseñar autenticación del responsable y de cada agente, sesiones revocables y autorización por recurso.
- Separar permisos de administración, aprobación humana y ejecución de herramientas.
- Elegir el aislamiento y la custodia de secretos, adecuados para Windows y para el despliegue previsto.
- Documentar rutas de datos: memoria, búsquedas, archivos, registros, notificaciones, terminales y proveedores de IA.

**Aceptación:** diseño revisable y pruebas definidas para demostrar que un agente no puede suplantar al responsable, leer otro buzón ni acceder directamente a las credenciales. No se conectan cuentas reales.

### Fase 1 — Empresa, departamentos y migración

- Crear departamentos con misión, responsable, planta y configuración propia.
- Separar proyecto, repositorio y departamento.
- Migrar el estado existente sin perder agentes, repositorios, tareas ni historial; proponer un departamento de desarrollo y permitir revisar su distribución.
- Incorporar versionado, copia previa y recuperación ante fallos de migración.

**Aceptación:** crear un departamento sin GitHub; mantener funcional el ciclo de desarrollo existente; comprobar migración y restauración con copias sintéticas.

### Fase 2 — Trabajo y entregables generales

- Implementar tareas, dependencias, responsables, plazos, comentarios y estados.
- Incorporar entregables versionados, revisiones y solicitudes de cambios.
- Relacionar tareas con proyectos y con referencias externas opcionales.
- Persistir transiciones de forma consistente y recuperar trabajos tras reinicios sin duplicar acciones.

**Aceptación:** completar en demo una propuesta comercial y una pieza de marketing sin crear issues ni PRs; seguir probando el flujo de desarrollo.

### Fase 3 — Especialistas y coordinación

- Crear perfiles de agente editables: especialidad, instrucciones, herramientas, fuentes, límites y criterios de calidad.
- Implementar ejecución restringida, identidad por sesión, cancelación y límites de coste y concurrencia.
- Adaptar el coordinador para planificar tareas generales y delegar según capacidades, carga y permisos.
- Permitir colaboración entre departamentos y evitar bucles de delegación.

**Aceptación:** un objetivo produce tareas para varios especialistas, con responsables y entregables visibles. Un agente sin permisos no recibe contexto restringido, aunque lo pida el coordinador.

### Fase 4 — Conocimiento y control de información

- Crear una biblioteca general: servicios, procedimientos, tono de marca y documentos corporativos.
- Añadir procedencia, versiones y alcance de acceso a documentos, tareas, mensajes y entregables.
- Separar el conocimiento general del derivado de correo. Combinar fuentes acumula sus restricciones; resumir no las elimina.
- Aplicar autorización a búsquedas, memoria, adjuntos, colaboración y recuperación de sesiones.
- Al revocar acceso, cancelar trabajos afectados e invalidar contextos, cachés y sesiones que contengan esos datos. No afirmar que una revocación borra información ya procesada por un modelo.

**Aceptación:** pruebas de lectura directa, búsqueda y delegación entre agentes autorizados y no autorizados. No aparecen datos de correo en el diario global, métricas, notificaciones, voz o pantallas 3D.

### Fase 5 — Oficina 3D, consola y móvil

- Adaptar directorio, ascensor, plantas y puestos a departamentos.
- Mostrar tareas y entregables en pizarras; mantener vistas de código donde correspondan.
- Incorporar secciones Empresa, Departamentos, Proyectos, Trabajo, Conocimiento, Integraciones y Revisiones.
- Añadir a la ficha del agente sus capacidades y accesos; ofrecer la misma gestión esencial en móvil.
- Sustituir métricas generales basadas en PRs por pendientes, bloqueos, plazos, revisiones y costes; conservar métricas específicas por departamento.

**Aceptación:** recorrido completo en español, escritorio y móvil; estados vacíos y errores claros; las pantallas compartidas no muestran contenido restringido. Capturas y pruebas de navegador en demo.

### Fase 6 — Correo Microsoft 365 e IMAP

- Definir un adaptador común e implementar Microsoft 365 mediante Graph y cuentas IMAP; configurar SMTP donde sea necesario para el envío.
- Verificar documentación oficial vigente, permisos disponibles y características del proveedor antes de elegir bibliotecas y flujos de autenticación.
- Conectar varios buzones, sincronizar carpetas y conversaciones, procesar adjuntos de forma segura y gestionar reconexiones.
- Incorporar concesiones por agente y buzón: lectura, organización y creación de borradores. Sin herramienta de envío para agentes.
- Limitar operaciones de organización en la primera versión a acciones reversibles; excluir borrado permanente.
- Proteger HTML, bloquear recursos remotos por defecto y no ejecutar adjuntos ni seguir instrucciones incrustadas en mensajes.

**Aceptación:** los dos proveedores funcionan contra simuladores; no hay secretos en logs o snapshots; acceso denegado consistente y sincronización sin duplicados. Las pruebas reales requieren buzones de prueba designados por el responsable.

### Fase 7 — Revisión humana y envío controlado

- Crear una bandeja de revisión con conversación original, borrador, remitente, destinatarios, CC/CCO y adjuntos.
- Registrar aprobación humana de una versión inmutable del envío completo.
- Invalidar la aprobación si cambian el contenido, destinatarios, adjuntos, remitente o permisos relevantes.
- Separar el servicio de envío del entorno de agentes; comprobar aprobación y permisos al ejecutar, no solo al encolar.
- Registrar resultado, caducidad, cancelación y reintentos. Ante un resultado incierto del proveedor, reconciliar o pedir revisión, sin reenviar a ciegas.

**Aceptación:** ningún envío sin aprobación; una aprobación no se reutiliza para otro mensaje. Probar modificaciones concurrentes, doble clic, reinicios y cortes de red. Distinguir «aceptado por el proveedor» de «entregado».

### Fase 8 — Flujos completos de negocio y marketing

- Negocio: correo entrante → oportunidad → propuesta → respuesta revisada → seguimiento.
- Marketing: objetivo → propuesta de campaña → calendario → textos y piezas → revisión → programación/publicación.
- Operaciones: petición → tareas y responsables → recordatorios → cierre con evidencia.
- Añadir conectores de redes, CRM, calendario y documentos según las aplicaciones y canales que se elijan.
- Medir resultados específicos: entregables aprobados, tareas vencidas, oportunidades y rendimiento de campañas cuando existan datos.

**Aceptación:** cada flujo se puede demostrar de principio a fin. La publicación en redes y otras acciones externas tendrán una política de autorización definida antes de habilitarlas; la autorización de correo no sirve para publicar contenido.

### Fase 9 — Piloto y ampliación

- Empezar con pocos agentes y buzones de prueba, primero en lectura y borradores.
- Habilitar envíos revisados solo después de superar las pruebas de autorización e integridad.
- Probar recuperación, restauración de copias, revocación y suspensión inmediata.
- Revisar costes, calidad, ruido de notificaciones y utilidad diaria antes de ampliar departamentos y conexiones.

**Aceptación:** escenarios acordados superados, sin acceso cruzado ni envíos no aprobados; procedimiento operativo y de recuperación documentado.

## 6. Orden de entrega

1. **Oficina general en demo:** fases 0–5. Departamentos, especialistas, proyectos, tareas, conocimiento y vistas adaptadas.
2. **Correo controlado:** fases 6–7, sobre la base anterior. Microsoft 365 e IMAP con revisión humana.
3. **Empresa operativa:** fases 8–9. Marketing, negocio y operaciones con sus integraciones reales y piloto gradual.

El diseño visual de la fase 5 puede avanzar junto al modelo de trabajo. No se habilita información real antes de verificar aislamiento, autenticación, permisos y tratamiento de datos.

## 7. Verificación y tareas transversales

- Vitest: autorización por recurso, herencia de restricciones, estados de aprobación, migraciones, asignación y recuperación.
- Integración: proveedores simulados, expiración de credenciales, límites, reconexiones, adjuntos y envíos inciertos.
- Seguridad: identidades manipuladas, acceso por identificador ajeno, aprobación falsificada, instrucciones maliciosas en correo y accesos directos fuera de las herramientas permitidas.
- Playwright: gestión de departamentos, tareas, permisos y revisiones en escritorio y móvil, incluidos rechazos.
- Regresión: conservar GitHub, QA, terminales, demo y presupuestos de escala.
- Para cada entrega de código: `npm run typecheck`, `npm test`, `npm run build` y pruebas específicas correspondientes.
- Datos de correo fuera del estado global y del diario general; definir cifrado, retención, borrado y copias también para cachés, adjuntos y memoria.
- Auditar acciones con identidad, recurso, fecha, decisión y versión; evitar copiar cuerpos o secretos al registro. Proteger la auditoría frente a modificación por agentes.
- Actualizar documentación y demo con cada entrega. No conectar servicios reales, enviar mensajes ni publicar como efecto de un test.

## 8. Configuración y decisiones del piloto pendientes

No se han resuelto mediante pruebas con servicios reales y se revisan antes de activar la capacidad correspondiente:

- Departamentos y especialistas que compondrán el primer equipo.
- Dónde se ejecutará el servicio protegido y quién accederá a la aplicación, además del responsable.
- Buzones de prueba, buzones compartidos, configuración del tenant de Microsoft 365 y proveedores IMAP/SMTP.
- Cuentas concretas de X, Instagram y Facebook, responsables del flujo manual de TikTok y servicios externos de documentos/calendario. Los cuatro canales y el CRM interno ya están decididos.
- Documentos iniciales de la empresa y política de retención y tratamiento por proveedores de IA.
- Límites de gasto, horarios, prioridades y autorización para acciones externas distintas del correo.

La implementación se verifica por componentes y después de forma integrada. Las credenciales, los buzones de prueba y el despliegue del broker requieren configuración del responsable; ninguna prueba de esta entrega debe enviar correo ni publicar contenido real.

## 9. Evidencias y límites de la implementación actual

La siguiente matriz distingue el código implementado de las pruebas ejecutadas. Las pruebas de dominio se ejecutan con estado temporal, servicios simulados y `--maxWorkers=1`. Los contratos, restricciones y pasos de instalación están documentados en [security-company.md](security-company.md) y [company-social.md](company-social.md). Ningún resultado de simulación acredita una cuenta conectada, una autorización del proveedor, una instalación Windows o un piloto real.

| Fase | Implementación | Evidencia disponible | Pendiente de validación operativa |
| --- | --- | --- | --- |
| 0 — Frontera | Autoridad registrada, identidad propia del especialista, contexto acumulativo y rutas privadas separadas del WebSocket. El host de las CLIs bloquea el modo real. Broker Windows con cuenta dedicada, tarea programada no interactiva, comprobaciones de ACL/identidad, HTTPS y almacenes cifrados. | Pruebas de autoridad falsificada, CSRF, canales de identidad, permisos de todas las fuentes, cifrado y gate de despliegue. No se ha instalado una cuenta ni una tarea Windows real. | Desplegar en equipo o VM independiente; comprobar aislamiento del host y del dispositivo humano, red, certificado y custodia de claves. El gate local no demuestra por sí solo que los equipos estén separados. |
| 1 — Empresa | Departamentos sin repositorio, proyectos entre departamentos, plantillas editables y distribución de repositorios existentes por sus plantas. Estado separado, versión, copia previa y restauración. | Copia idempotente tras fallo parcial, formato inválido, referencias rotas, restauración, cifrado y manipulación detectada. El archivo legacy no se reescribe. | Revisar la distribución migrada con el responsable; las tareas y el historial GitHub siguen conservados y operativos en su archivo y adaptador originales. |
| 2 — Trabajo | Tareas, prioridad, plazos, responsables, colaboradores, dependencias, comentarios, entregables versionados y revisión humana de la versión actual. | Ciclos rechazados, dependencias bloqueadas, aprobación invalidada por versión nueva, última decisión vigente y flujos completos sin issues ni PR. | Evaluar volúmenes, retención y restauración con las copias del despliegue elegido. |
| 3 — Especialistas | Ejecutor API con autoridad del agente, fuentes autorizadas, contexto de dependencias aprobadas, presupuesto y cancelación. Workflows coordinados con asignación por especialidad y carga. | Resultado de dependencia recibido por el siguiente especialista; identidad humana nunca enviada como agente; rechazo tras revocación. | Configurar proveedor y precios autorizados, validar límites de gasto con uso real de prueba. La reserva conservadora de todo el saldo puede serializar trabajos de un mismo agente. |
| 4 — Conocimiento | Biblioteca con categorías, versiones y procedencia; búsqueda y lecturas filtradas. Los resúmenes conservan las restricciones. Una sesión humana nueva muestra información general y revela la restringida solo tras seleccionar su contexto. Datos privados fuera de diario y pantallas comunes. | Búsqueda sin acceso, varios buzones, delegación denegada, cierre/nueva sesión sin contaminación, métricas/costes/actividad privados ocultos y documento completo oculto si su última versión es restringida. | Acordar retención y tratamiento por proveedores. Renovar sesión explícitamente para volver a crear información general; la revocación no borra lo ya procesado por un modelo. |
| 5 — Vistas | Consola, móvil y proyección 3D de departamentos con metadatos generales. Gestión de empresa, trabajo, conocimiento, correo y redes conectada a APIs privadas. | 8 pruebas de interfaz y 2 escenarios sociales de navegador aprobados. Los 18 escenarios de regresión quedan cubiertos entre la ejecución amplia y la repetición de smoke/móvil descritas debajo. Capturas base/sociales revisadas; build final y typecheck aprobados. | Validar la experiencia en los puestos del piloto. El funcionamiento en demo no acredita un despliegue real ni una conexión a cuentas corporativas. |
| 6 — Correo | Adaptadores HTTP Graph y transporte IMAP/SMTP, sincronización acotada, conservación de MIME/hilos y permisos por buzón. Fuentes resueltas en servidor con identidad delegada. Texto sin HTML remoto y política inicial de adjuntos `text/plain` UTF-8; otros formatos en cuarentena. | Incrementos de correo integrados en la raíz y verificación focalizada conjunta aprobada con simuladores. Se mantienen los rechazos de permisos, procedencia, revocación, cifrado y runtime; no se utiliza una cuenta real. | Validar OAuth, buzones, hilos y carpeta de enviados con cuentas de prueba designadas. No hay conexiones reales activadas; los formatos de adjunto no admitidos siguen en cuarentena. |
| 7 — Envío | Entregable aprobado → borrador con cuerpo/asunto resueltos en servidor, versión exacta y conversación de origen. Hilos/MIME integrados en los adaptadores. Una aprobación humana adicional cubre remitente, destinatarios, CC/CCO, contenido y adjuntos; intención persistida antes del proveedor. | Puente y adaptadores verificados con simuladores, incluidos rechazo de versión distinta/texto del cliente/identidad agente, doble clic, reinicio y resultado incierto. `accepted` se distingue de entrega al destinatario. | Comprobar comportamiento del proveedor con buzones de prueba. Los resultados inciertos requieren conciliación, sin reenvío automático. No se ha realizado un envío real. |
| 8 — Negocio y marketing | CRM interno, propuestas, seguimientos, campañas/calendario y operaciones. X, Instagram y Facebook: conectores API configurables, aprobación social independiente, programación, consulta de estado y conciliación. Módulo social montado en el broker con cierre que drena intentos. TikTok automático bloqueado: exportación exacta de MP4/texto aprobados y evidencia humana `manual_recorded`, nunca publicación API verificada. | 41 pruebas sociales con simuladores/contratos HTTP, verificación focalizada conjunta y 2 escenarios sociales de navegador aprobados. Montaje y apagado del broker comprobados; flujos demo sin issues/PRs ni acciones reales. | Configurar cuentas, revisiones y permisos exigidos por cada proveedor; Instagram requiere exponer únicamente su ruta temporal de medios bajo HTTPS. TikTok no dispone de interruptor para habilitar Direct Post interno. Medir rendimiento solo con fuentes reales. |
| 9 — Piloto | Recuperación tras reinicio sin repetir llamadas, cancelación y reservas conservadoras de coste ante resultados inciertos. | Reinicio cancela y bloquea el trabajo; copia cifrada y restauración verificadas. | Piloto con pocos agentes y buzones de prueba, revisión de costes/calidad y procedimiento de suspensión. No ejecutado contra servicios reales. |

Verificación final sobre la raíz integrada: `npm test -- --maxWorkers=2` aprobó **2338 de 2338 pruebas en 216 archivos**, en 249,65 segundos. `npm run build` final aprobó también el typecheck. Las ejecuciones específicas previas aprobaron 112 pruebas focalizadas en 16 archivos de empresa, seguridad, correo, redes e interfaz; 2 de aprovisionamiento y 24 de apagado del broker/adaptadores. Estas ejecuciones se solapan y sus cifras no se suman.

Navegador: los 2 escenarios sociales aprobaron. La regresión amplia aprobó 17 de 18; la única aserción fallida esperaba el botón transitorio «Mensaje» después de que los agentes demo acabaran su trabajo. Se cambió el test al acceso estable «Terminal» y se repitieron smoke y móvil: **3 de 3 aprobados**, en 58,4 segundos. Los 18 escenarios de regresión quedan cubiertos entre esas ejecuciones; no se afirma una única ejecución de 18 de 18. Las capturas base/sociales se revisaron y los procesos de prueba propios se cerraron.

Comandos de verificación: `npm test -- server/company --maxWorkers=1`, `npm test -- server/company-security server/mail --maxWorkers=1`, `npm test -- server/company-social --maxWorkers=1`, `npm run typecheck` y `npm run build`. Los controles globales se ejecutan sobre el árbol final integrado. La demo produce documentos deterministas rotulados «SIMULACIÓN DEMO»; no se presenta como trabajo autónomo de un modelo ni como una acción externa realizada.

Decisión de entrega: código integrado aceptado en la revisión técnica con las evidencias y límites indicados, disponible para revisión del responsable. El piloto, el despliegue protegido, la configuración de credenciales y las conexiones/publicaciones reales permanecen pendientes; no se han ejecutado ni se autorizan implícitamente al aceptar el código. No se han creado commits ni se han enviado cambios a un remoto.
