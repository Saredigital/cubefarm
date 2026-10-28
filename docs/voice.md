# Mensajes de voz

La oficina puede leer en voz alta los mensajes del CEO en el móvil en cuanto llegan, con la voz que elijas, sin abrir
el móvil. Hay dos voces disponibles:

- **Navegador:** la síntesis de voz propia de tu navegador. Gratis, sin conexión, robótica.
- **ElevenLabs:** voces naturales de [ElevenLabs](https://elevenlabs.io), con tu propia clave de API. Cuesta un poco
  por mensaje (ver más abajo).

Las notas de la oficina (merges, errores, decisiones) solo se leen si activas **Leer las notas de la oficina**.

También escucha: puedes hablar con el CEO y con los agentes en lugar de escribir ([Hablar en lugar de escribir](#hablar-en-lugar-de-escribir)).

Los datos sobre ElevenLabs de esta página se comprobaron en su documentación y su página de precios en octubre de 2026.

## Conseguir una clave de ElevenLabs

1. Regístrate en [elevenlabs.io](https://elevenlabs.io). Las voces de la biblioteca, incluida la lista de abajo,
   necesitan un plan de pago para usarse por la API (las voces de la Voice Library no están disponibles por la API en
   el plan gratuito).
2. Abre **Developers → API Keys** y crea una clave. Si la restringes, permite **Text to Speech** y **Voices (read)**.
   Ahí también puedes darle una cuota de créditos, como límite de gasto para la oficina.
3. Pégala en los ajustes de voz de la oficina. La oficina la comprueba con una llamada (listando una voz) antes de guardarla.

Dónde se guarda la clave: `<SWARM_HOME>/secrets.json` (`~/.sareoffice/secrets.json` por defecto), legible solo por ti
donde el sistema operativo tiene permisos de fichero. Nunca se escribe en `state.json`, nunca se envía al navegador
(los ajustes muestran sus últimos 4 caracteres), nunca aparece en los registros y nunca se da a los agentes. Una
oficina demo tiene su propio `demo-secrets.json`. Borra la clave en los ajustes para eliminarla.

Si ElevenLabs responde alguna vez con 401 (la clave se revocó o se borró), la oficina te avisa una vez en el móvil y
deja de llamar a ElevenLabs hasta que introduzcas una clave nueva.

## Modelo y coste

El modelo por defecto es **`eleven_flash_v2_5`** (Flash v2.5): el modelo de menor latencia de ElevenLabs (~75 ms antes
del tiempo de red), 32 idiomas y la mitad de precio por carácter que Multilingual v2. Otros modelos que puedes elegir:

| Modelo | Por qué |
| --- | --- |
| `eleven_flash_v2_5` (por defecto) | el más rápido y barato; de sobra para avisos cortos |
| `eleven_v4_turbo` | más nuevo y expresivo, todavía en tiempo real (~100 ms) |
| `eleven_multilingual_v2`, `eleven_v4` | la mayor calidad; más lentos y más caros |

Lo que cuesta un mensaje: con los precios de la API de ElevenLabs, Flash cuesta unos **0,04 $ por 1.000 caracteres**
(Multilingual v2 y v3: 0,08 $). Una actualización típica del CEO son 300–800 caracteres de voz una vez quitados el
markdown, los emojis y los enlaces, así que **1–3 céntimos**; la oficina nunca lee más de unos 1.500 caracteres de un
mensaje (unos 6 céntimos). En un plan de suscripción, el mismo texto gasta créditos de tu cuota mensual. Cada mensaje
se sintetiza una vez y se guarda en caché (`<SWARM_HOME>/voice/`, como mucho 200 clips, 7 días por defecto), así que
volver a escucharlo es gratis. El botón **Probar** de los ajustes lee una frase corta (unos 60 caracteres) y también la guarda.

## Voces preseleccionadas

Las antiguas voces Default de ElevenLabs (Rachel, Sarah, George, …) **caducan el 31 de diciembre de 2026**, y las
cuentas creadas después de marzo de 2026 nunca las tuvieron. Por eso la lista sale de las voces nuevas que ElevenLabs
recomienda como sustitutas, que se pueden usar para siempre. Están en la Voice Library y se pueden usar por id sin
guardarlas; guarda una en **My Voices** para verla también en elevenlabs.io. La oficina las marca como `recommended`
en la lista de voces y las muestra primero, seguidas de las voces de tu cuenta.

| Voz | Id | Por qué le va a un CEO tranquilo y cercano |
| --- | --- | --- |
| Talia: Warm Soft Guide | `OZ0L6eISlOejga3XjDFt` | suave y cálida; las buenas y las malas noticias llegan con delicadeza. La de por defecto. |
| Eddie: Helpful and Comforting | `l7kNoIfnJKPg7779LI2t` | tranquilizadora, nunca insistente: ideal para "esto es lo que está bloqueado y por qué". |
| Caleb: Trusted Guide | `AaOhDHYJ1XLZk74lXhdE` | firme y creíble; suena a alguien que tiene el plan bajo control. |
| Darian: Warm Grounded Storyteller | `gOupLcAkjEnguROwi4oS` | relajada y con los pies en el suelo; convierte un resumen de avances en una historia. |
| Alicia: Polished Global Anchor | `BFd5oBc2DDna33pSi4Gf` | dicción clara de presentadora; fácil de seguir con música o ruido de oficina. |
| Maisie: Friendly Casual Neighbor | `QtY3JBOUKEB5xzrRfOKc` | charlatana e informal, para una startup que no va de corporativa. |
| Wyatt: Seasoned Mentor | `FrS6cKLB1wg4WYgPa9GW` | mayor, tranquila y sin prisas; un CEO que lo ha visto todo. |
| Eldrin: Crisp British Baritone | `6WwXjDDEMyNmFG95zycZ` | grave y serena, con acento británico. |

Sustituyen respectivamente a Sarah, Eric, Chris, Roger, Alice, Matilda, Bill y George. Escúchalas (el botón Probar, o
la Voice Library de ElevenLabs) antes de elegir: el tono importa más que la descripción. Para mensajes en español,
prueba especialmente cómo suenan con un modelo multilingüe.

## Qué se lee

Antes de hablar, el mensaje se adapta para el oído (`shared/speech.ts`, usado por las dos voces): se quitan el markdown
y los emojis, `#123` pasa a "número 123", una URL pasa a "un enlace", y los mensajes largos se cortan al final de una
frase pasados unos 1.500 caracteres.

## En la oficina

Un mensaje se lee al llegar, esté el móvil abierto o no, y también con la pestaña de la oficina en segundo plano. Los
navegadores solo permiten sonido después de tu primer clic o tecla en la pestaña, así que lo que llegó antes de eso, y
lo que ya estaba en el móvil al cargar la página, se queda en silencio. Los mensajes se leen de uno en uno, en orden;
como mucho 3 esperan su turno y los de hace más de 2 minutos se saltan. Con varias pestañas de la oficina abiertas,
solo una lee cada mensaje (la que estás mirando, si hay alguna).

El control **Voz** de los ajustes de sonido (Ayuda, **H**) fija su nivel por debajo del volumen general, y **M** la
silencia como cualquier otro sonido. Los demás sonidos de la oficina bajan unos 8 dB mientras se lee un mensaje. Un 🔊
en el icono del móvil indica que está hablando; haz clic en él para pararlo. Si el clip no se puede obtener (sin clave,
ElevenLabs caído), oyes en su lugar el sonido habitual de mensaje. `window.__swarmVoice` lista los mensajes leídos
(`id`, `provider`, `start`, `end`, `volume`, y `replay: true` en una repetición).

## Volver a escuchar un mensaje

Cada mensaje del CEO que se leyó en voz alta tiene un ▶ en el chat del móvil. Reproduce el clip guardado cuando llegó
el mensaje, nunca uno nuevo: `clips.json`, en la carpeta de caché, registra qué clips son de qué mensaje, así que un
mensaje conserva su clip aunque después elijas otra voz u otro modelo. Un mensaje leído con la voz del navegador lo
vuelve a decir el navegador (gratis). Mientras suena, el botón muestra ⏹; repetir para lo que se esté leyendo, y un
mensaje nuevo para una repetición. Cuando un clip se ha borrado, el ▶ aparece en gris con "El audio ya no está
guardado". Los mensajes que llegaron con la voz desactivada no tienen botón.

La caché se ordena al arrancar la oficina y con su temporizador de mantenimiento (cada 15 minutos): primero se van los
clips más antiguos que **Guardar los clips de voz N días** (Ajustes → Voz, 1–90, 7 por defecto), luego los más
antiguos por encima de 200, pero los clips de los 20 mensajes más recientes del CEO se quedan siempre. Ajustes → Voz
también muestra el tamaño de la caché y tiene **Borrar clips guardados**.

## Hablar en lugar de escribir

Cada cuadro de mensaje tiene un 🎙️ junto a Enviar: el chat del móvil con el CEO, el panel de un agente y la pestaña
CEO de la consola del responsable. **Mantenlo pulsado**, o mantén **V** con el cursor en el cuadro (o en cualquier
parte de ese móvil o panel fuera de otro campo), y habla: las palabras llenan el cuadro mientras hablas, y al soltar se
quedan ahí para que las edites antes de enviar. Un toque rápido de V sigue escribiendo una "v"; solo una pulsación
mantenida 0,3 s habla, y V nunca habla en otros campos. Un **toque** en el 🎙️ escucha hasta que dejas de hablar (unos
1,2 s de silencio) o hasta que vuelves a tocarlo; si nadie habla, se rinde a los 8 s. **Esc** deja de escuchar (sin
cerrar el móvil ni el panel), escribir en el cuadro toma el relevo al micrófono, y enviar a mano también lo para.
Escribir funciona exactamente igual que antes.

Ajustes → Voz → **Hablar en lugar de escribir** elige quién convierte la voz en texto:

- **Navegador** (por defecto): el reconocimiento de voz del propio navegador (el `SpeechRecognition` de la Web Speech
  API), gratis. Lo tienen Chrome, Edge y Safari; donde el navegador no lo tiene (Firefox), el 🎙️ aparece atenuado y lo
  dice al pulsarlo. La transcripción en directo aparece mientras hablas. Chrome y Edge envían el audio a los servicios
  de voz de sus fabricantes para reconocerlo.
- **ElevenLabs Speech to Text**: el navegador graba el clip (MediaRecorder, WebM/Opus en Chromium) y lo envía a la
  oficina, que lo envía a ElevenLabs (`POST /v1/speech-to-text`, modelo `scribe_v2`, etiquetas de eventos de audio
  desactivadas) con la clave de arriba; el texto vuelve al soltar. Un clip dura como mucho 60 segundos y 5 MB.
  ElevenLabs cobra por la duración del audio; una clave restringida necesita el permiso **Speech to Text**. La clave se
  trata exactamente igual que la de la voz: nunca llega al navegador, a los registros ni al snapshot.
- **Desactivado**: ningún 🎙️ en ninguna parte.

**Enviar automáticamente al dejar de hablar** (desactivado por defecto) envía lo que dijiste tras unos 1,2 s de
silencio, en lugar de dejarlo en el cuadro; soltar una pulsación mantenida también lo envía.

**Manos libres** (el 🎧 del chat del móvil, desactivado por defecto; también en Ajustes → Voz) es una conversación sin
tocar nada: cuando la respuesta del CEO se ha leído en voz alta, suena un aviso suave y el móvil escucha hasta 8 s con
un 🎙️ que palpita. Di algo y se envía cuando terminas; no digas nada y se cierra (con un aviso descendente). **Esc** o
**M** lo cierran al momento. Necesita la voz del CEO activada, el móvil abierto en el chat en la pestaña que estás
mirando y un cuadro de mensaje vacío; nunca pide el micrófono por su cuenta (al activarlo lo pide, desde ese clic).

Buenas maneras: el navegador pide el micrófono la primera vez que pulsas el 🎙️ (o activas manos libres), y una
negativa se explica en una línea. El micrófono solo está encendido mientras mantienes el botón o V, o mientras se ve el
🎙️ palpitando (un toque, manos libres). Mientras escucha, la jukebox y los demás sonidos bajan, un mensaje que se está
leyendo baja unos 15 dB (la voz del navegador se pausa), los sonidos de la oficina (merge, QA, errores) esperan a que
se cierre, y el gong de merge no suena.

`window.__swarmMic` muestra el `state` del 🎙️ (`idle`, `listening`, `transcribing` o `error`), el `mode` (`hold`,
`tap`, `handsfree`), si el micrófono está `live`, el último `transcript`, el `provider`, el último `error`, lo que este
navegador admite (`supported`), el estado de manos libres y un `history` de sesiones con su resultado. Los navegadores
sin interfaz no tienen micrófono: `__swarmMic.fake()` cambia el reconocimiento del navegador por un sustituto, y
`__swarmMic.say(text, final = true)` es lo que oye (con ElevenLabs, `say()` marca voz para el detector de silencio).
Las reglas son puras y tienen tests: `client/src/ui/micSilence.ts` (cuándo has dejado de hablar), `handsFree.ts`,
`micKeys.ts`, `micText.ts` y `shared/clipLimits.ts`.

## API

| Ruta | Qué hace |
| --- | --- |
| `PUT /api/voice/key` `{ key }` | comprueba y guarda la clave; `""` la quita. 400 si ElevenLabs la rechaza |
| `GET /api/voice/voices` | `[{ id, name, category, labels: { accent, gender, age, description, use_case }, previewUrl, recommended }]`, en caché 10 minutos; 409 sin clave |
| `GET /api/voice/messages/:id` | `audio/mpeg` de un mensaje del CEO (o de una nota de la oficina con Leer las notas de la oficina activado); 404 cuando la voz no es ElevenLabs o no existe ese mensaje, 502 cuando falla ElevenLabs |
| `GET /api/voice/messages/:id?cached=1&part=N` | el ▶ del móvil: la parte N de los clips guardados del mensaje (`X-Voice-Parts` dice cuántas hay), o 404 si no hay ninguno guardado. Nunca llama a ElevenLabs |
| `DELETE /api/voice/cache` | borra todos los clips guardados |
| `GET /api/voice/sample?voiceId=…` | la frase de Probar con esa voz (por defecto, la elegida) |
| `POST /api/voice/transcribe` | el 🎙️ con ElevenLabs: el clip grabado como cuerpo (`Content-Type` su tipo de audio, `X-Clip-Ms` su duración) → `{ text }`. 409 cuando ElevenLabs no es el proveedor o no hay clave, 413 por encima de 60 s o 5 MB, 415 para cualquier cosa que no sea WebM, Ogg, MP4, MP3 o WAV, 502 cuando falla ElevenLabs |

Los ajustes viajan en `settings.voice` (`PATCH /api/settings`): `{ provider: 'off' | 'browser' | 'elevenlabs',
voiceId, voiceName, model, speakOffice, keepDays }`, y la escucha en `settings.listen`: `{ provider: 'off' | 'browser'
| 'elevenlabs', autoSend, handsFree }`. El snapshot tiene `voiceKeySet`, `voiceKeyHint` y `voiceCache` (`{ clips,
bytes, saved }`, siendo `saved` los ids de mensaje que el ▶ puede repetir); un evento `voiceKey` sigue a cada cambio de
clave y un evento `voiceCache` a cada cambio de la caché. El `voice` de un mensaje del móvil dice quién lo leyó al
llegar. Se crea un clip cada vez (20 s de tiempo límite); las peticiones de un clip que se está creando comparten esa llamada.

La oficina demo (`--demo`) lo simula todo sin red: acepta cualquier clave salvo una que contenga "bad", tiene tres
voces, y cada mensaje es un sonido corto generado (un WAV), con el tono según la voz, guardado y repetido como un clip
real. Su Speech to Text oye "¿En qué está trabajando todo el mundo?" en cualquier grabación. El servidor registra `voice: made a
new clip …` por cada clip que crea y `voice: transcribed a 2.4 s clip (30 KB)` por cada transcripción (nunca las palabras).
