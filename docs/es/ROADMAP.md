# NODYX, Hoja de ruta

> *"Un proyecto que intenta hacerlo todo a la vez no hace nada bien."*
> La hoja de ruta de Nodyx se basa en una regla simple: cada fase debe funcionar
> perfectamente antes de pasar a la siguiente.

> Este documento da el estado actual y la dirección. Para el detalle completo de cada
> función entregada, línea por línea, el
> [CHANGELOG](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md) es la fuente
> de verdad: es el único documento que se actualiza en cada versión.

---

## ESTADO ACTUAL, octubre 2026, v2.13.0 en camino

| Fase | Título | Estado |
|---|---|---|
| **Fase 1** | Foro MVP + Admin | Completa |
| **Fase 2** | Chat en tiempo real + Directorio + Identidad de red | Completa |
| **Fase 2.5** | Personalización de comunidad + Federación ligera | Completa |
| **Fase 3** | Infraestructura P2P + Base en Rust | En curso (ver 3.0-D) |
| **Fase 4** | Enriquecimiento de la plataforma | Completa |
| **Fase 4.5 a 4.16** | Endurecimiento de seguridad, estabilidad, pruebas, OctoGuard | Completas |
| **Fase 4.17** | Streamer Hub, el conjunto completo para streamers | Completa |
| **Fase 4.18** | Voz de nueva generación: el SFU (audio + vídeo) | Completa |
| **Fase 4.19** | Nodyx habla ocho idiomas | Completa (traducción continua) |
| **Fase 4.20** | Personalización avanzada de la instancia | Completa |
| **Fase 4.21** | SDK de extensiones + marketplace | Completa (v1) |
| **Fase 4.22** | Actividades comunitarias en voz | Completa (v1) |
| **Fase 4.23** | Escaparate de música + endurecimiento del escaparate público | Completa |
| **Fase 4.24** | Los ambientes y el contenedor flotante | Completa |
| **Fase 4.25** | Instalador reconstruido, auditoría de seguridad | Completa |
| **Fase 4.26** | Estabilización: cazar errores en uso real | Completa (v2.13) |
| **Fase 4.27** | Tema claro y oscuro en todas partes, una apariencia que se entiende | En curso |
| Fase 5 | Móvil + Nodes + Reputación | En curso |
| **Fase Horizon** | NODYX-ETHER, soberanía de la capa física | Visión |
| **Fase Radio** | NODYX-RADIO, radio por internet + red publicitaria cooperativa | Visión |

Cada entrada da lo esencial. El detalle completo (migraciones, archivos, benchmarks, PRs) vive
en el CHANGELOG, en la versión indicada.

---

## FASE 1, MVP Foro + Admin (completa)

Una comunidad puede instalarse, configurarse y vivir en Nodyx con total autonomía.

- Foro completo: categorías recursivas, hilos, publicaciones, reacciones, etiquetas, búsqueda
  de texto completo, notificaciones, panel de administración
- SEO nativo: renderizado SSR, sitemap, RSS, JSON-LD, `llms.txt` para agentes de IA. Pase de
  endurecimiento SEO/GEO en v2.8 (sitemap, og:image, guías de instalación)
- Autoalojamiento en 15 minutos: `install.sh` (VPS), `install_tunnel.sh` (sin puertos, Raspberry
  Pi), Docker, script para Windows sin Docker, verificación visual de salud tras la instalación

**Criterio de éxito**: instalar, configurar, crear contenido, administrar la comunidad y ser
indexado por los buscadores, sin ser desarrollador. Validado.

---

## FASE 2, Chat en tiempo real + Directorio + Identidad de red (completa)

Los miembros se comunican en vivo, el directorio es real, cada instancia tiene su propia URL.

- Chat por WebSocket (Socket.IO), canales configurables, historial persistido
- Directorio `nodyx.org`: registro automático, ping cada 5 minutos, página `/communities` real
- Identidad de red `slug.nodyx.org`: DNS comodín, Caddy, cero configuración para el admin
- Canales de voz, capa de red: coturn y después `nexus-turn` (Rust), señalización WebRTC

---

## FASE 2.5, Personalización de comunidad + Federación ligera (completa)

Cada instancia se vuelve única, y las instancias pueden compartir lo que crean.

- Biblioteca de assets (marcos, banners, insignias), Jardín (propuestas + voto por semillas)
- Federación de assets entre instancias, Susurros (salas efímeras), URLs clicables

---

## FASE 3, Infraestructura P2P + Base en Rust (en curso)

> *"El P2P es el alma. Rust es el cuerpo."*
> Rust vive debajo, invisible para el usuario, gestionando la red de bajo nivel, el
> cifrado, WireGuard, la DHT. Habla con `nodyx-core` mediante un socket Unix local.

### 3.0-A, `nodyx-relay-client` (validada, marzo 2026)
Reemplaza `install_tunnel.sh` + Cloudflare Tunnel. Cero dominio, cero puerto abierto, probado en
una Raspberry Pi. Binario Rust estático, reconexión automática, integrado en `install.sh`.

### 3.0-B, Browser P2P Nodes (WebRTC DataChannels) (entregada, marzo 2026)
Los navegadores se convierten en nodos activos: malla 1-N, indicadores de escritura P2P
instantáneos, reacciones optimistas, transferencia de assets entre pares por fragmentos.
Reutiliza la señalización existente de `voice.ts`, cero infraestructura de servidor nueva.

### 3.0-C, `nodyx-turn` (reemplaza a coturn) (validada, marzo 2026)
Servidor STUN/TURN en Rust, 2.9 MB, cero dependencias. TURN sobre TCP (RFC 6062), credenciales
dinámicas HMAC, limitación de tasa, cuotas de asignación. Corrección de fondo en v2.9: el rango
de puertos de retransmisión ahora pertenece al propio servidor, no al rango efímero del kernel
(la voz era intermitente para parte de los autoalojados antes de esta corrección).

### 3.0-D, núcleo `nodyx-p2p`, visión a largo plazo (iniciada)
El núcleo distribuido: DHT, malla WireGuard, gossip, CRDTs, replicación, resiliencia sin
servidor central.
- [x] **`nodyx-gossip`** (v2.9): descubrimiento de pares por antientropía epidémica, solo
  biblioteca estándar, registros firmados con Ed25519 (anti-suplantación, anti-repetición)
- [ ] DHT Kademlia, malla WireGuard cifrada, API IPC expuesta a `nodyx-core`, replicación factor 3

### 3.1, Canales de voz, interfaz y modos avanzados
- [x] Barra lateral VoicePanel, panel de interacción de miembro (RTT/jitter/pérdida de paquetes)
- [ ] Modo Anfiteatro (difusión 1→N), Nodes-as-a-Service

### v1.0, Mesa Colaborativa (planificada)
El canal de voz se convierte en un espacio de vida: juegos, archivos, música compartida, todo en
la misma ventana. Base P2P de DataChannels ya operativa (v0.9). Falta construir: mesa SVG,
protocolo `table:*`, jukebox colaborativo, juegos (dados, ajedrez, póker), sistema de plugins
`plugins/table-templates/`.

### 3.2, Red en malla entre instancias
- [ ] Malla WireGuard, DHT de respaldo, federación ligera entre comunidades

---

## FASE 4, Enriquecimiento de la plataforma (completa)

Nodyx se convierte en la plataforma comunitaria completa: NodyxCanvas (pizarra colaborativa
P2P), temas de perfil, interfaz responsive para móvil, respuestas/citas y mensajes fijados en el
chat, DMs cifrados de extremo a extremo, encuestas, sistema de baneos multicapa, calendario de
eventos, Gossip Protocol para búsqueda y descubrimiento entre instancias, panel de admin
enriquecido, anuncios del sistema, registro de auditoría de moderación, tareas estilo Kanban.

Detalle línea por línea en el CHANGELOG, versiones 1.1 a 1.8.

---

## FASE 4.5, Endurecimiento de seguridad (completa, marzo 2026)
Inyección SQL, JWT, SSRF/DNS rebinding, IDOR en Socket.IO, inyección CSS/XSS, limitación de tasa
en auth, validación criptográfica de entradas. Primera auditoría de seguridad completa del
proyecto, antes de abrir la Fase 5.

## FASE 4.6, Defensa activa y seguridad en tiempo de ejecución (completa)
Honeypot (más de 25 rutas trampa, tarpit, fingerprinting, honeytokens), fail2ban (5 jails),
lista negra permanente, Argon2id, antispam de chat, filtro de contenido, escaneo NSFW opcional,
Olympus Hub (centro de mando de seguridad).

## FASE 4.7, Autenticación de dos factores (completa)
TOTP (RFC 6238) y Nodyx Signet como segundo factor, prioridad Signet > TOTP > acceso directo.

## FASE 4.8, Estabilidad en producción y coherencia entre runtimes (completa)
Auditoría quirúrgica en Node.js/Rust/Caddy/PM2/systemd: keyPrefix de Redis unificado, baneos y
límites de tasa coherentes entre ambos runtimes, invalidación de sesión al cambiar la
contraseña, failover automático de Caddy si el servicio Rust cae.

## FASE 4.9, Aislamiento de procesos, cobertura de pruebas y CI (completa)
Todos los procesos bajo el usuario del sistema `nodyx` (nada corre como root salvo systemd),
permisos de archivos endurecidos, primeras pruebas en Rust, dependencias críticas fijadas,
pipeline de CI con dos trabajos en paralelo.

## FASE 4.10 a 4.15 (completas)
Perfil vivo y rediseño del foro (v1.9.5), DMs cifrados de extremo a extremo (v2.0), Homepage
Builder y Widget SDK v1 (v2.1), actualización mayor de NodyxCanvas (v2.2), reproductor
multimedia universal y endurecimiento del túnel (v2.3), sistema de copias de seguridad y modo
de mantenimiento en vivo (v2.4).

## FASE 4.16, OctoGuard Fase 1, auto-moderación nativa (completa, v2.6)
> *"La libertad del admin no es negociable. OctoGuard llega desactivado, cada regla es opt-in."*

Pipeline de auto-moderación bajo 50 ms con fail-open, protección anti-ReDoS (motor `re2`), 6
acciones (delete/warn/mute/kick/ban/report_only), flujo de bienvenida, comandos personalizados,
mutes, cola de reportes, registro de auditoría, webhook HMAC saliente, interruptor de
emergencia. 69 pruebas, p95 medido en 0,2 ms.

Las fases 2 (XP/niveles/leaderboard), 3 (moderación de foros, filtro NSFW local) y 4 (API de bot
externo, SDK en Python) se siguen por separado en `docs/specs/016-Octoguard/`.

---

## FASE 4.17, Streamer Hub, el conjunto completo para streamers (completa, v2.5 → v2.8)

Un puente bidireccional completo entre una instancia Nodyx y Twitch, pensado para que un
streamer deje de repartirse entre tres SaaS distintos.

- **Chat unificado**: puente en tiempo real Twitch ↔ Nodyx (EventSub + Helix, cero IRC), emotes
  e insignias nativos más BTTV/FFZ/7TV, verificado en producción (277 mensajes recibidos en una
  sesión de prueba)
- **Bot de chat**: temporizadores recurrentes, seis comandos nativos (`!nodyx`, `!uptime`,
  `!so`...), comandos personalizados con cooldown configurable
- **Nodyx Deck**: un Stream Deck táctil mobile-first, multipágina, acciones de clip/VOD/chat/
  audio, editor WYSIWYG con plantillas
- **Nodyx Soundboard**: biblioteca de audio con extracción de etiquetas ID3, overlay dedicado
  para OBS, cola pública de espectadores con antispam, comando de chat `!nextsound` con
  coincidencia difusa
- **Playlists y escenas de OBS**: playlists con nombre controlables desde el Deck, compositor
  visual de escenas al estilo OBS

Especificación completa e informes de fase en `docs/specs/015-streamer-hub/`.

---

## FASE 4.18, Voz de nueva generación, el SFU (completa, v2.9 → v2.11)

El problema matemático de la malla P2P (15 espectadores a 3 Mbps cada uno es imposible en una
conexión residencial) ya tenía respuesta escrita en el CDC desde hace tiempo. Ahora está en
producción.

- **`nodyx-sfu`** (Rust, cero `unsafe`): arquitectura hexagonal, `VoiceService` detrás de un
  trait `MediaEngine` listo para intercambiarse, probado con 25 pruebas contra un motor nulo
  antes de cualquier motor real
- **Audio en producción** (v2.10): adaptador de mediasoup, el daemon `nodyx-sfud` con
  autenticación por token en tiempo constante, cambio automático híbrido malla ↔ SFU
- **Vídeo y compartir pantalla** (v2.11): un único flujo de subida distribuido desde el
  servidor, La Escena (pantalla completa con chat e hilo de discusión en los canales de voz), un
  ecualizador real por persona, una ruta TCP de respaldo para ICE
- **Exploración en curso**: un spike de un motor de medios 100% Rust (`str0m`) para levantar la
  última restricción de "cero puertos abiertos" del SFU. El veredicto sobre el atravesamiento
  de NAT sigue pendiente de una prueba real en un router residencial. Detalle en
  `SPECS/NODYX_MEDIA_ENGINE_RUST.md`

---

## FASE 4.19, Nodyx habla ocho idiomas (completa, traducción continua)

La gran auditoría de "nada más codificado a mano" ha terminado: toda la interfaz, pública y de
administración, pasa por claves de traducción, con cinco puertas de CI que impiden cualquier
regresión (una de ellas dedicada a los archivos `.ts`, un punto ciego descubierto en el camino).

- Ocho idiomas en el núcleo de la interfaz, inglés a paridad total (el idioma de respaldo antes
  que el francés), portugués de Brasil como primera lengua comunitaria en llegar al 100% (4567
  claves)
- `nodyx.org/translate`: el estado de las traducciones se calcula directamente desde los
  archivos de idioma, una página que no puede mentir, y reconoce a todos los colaboradores
- Fusionar una traducción ahora despliega automáticamente (antes podía quedar invisible durante
  varios días)

---

## FASE 4.20, Personalización avanzada de la instancia (completa, v2.12)

Nacida de una prueba a gran escala: una comunidad multigaming real chocó con elementos no
configurables desde el primer instinto de su admin.

- Widget "Encabezado" (Homepage Builder): fondo y logo posicionables y redimensionables de forma
  independiente, cada elemento se puede mostrar u ocultar, sin valores de reserva engañosos
- Imagen de fondo para la barra lateral de miembros, visibilidad por rol, oscurecimiento y
  alejamiento ajustables
- Sistema de tema de instancia (v2.9): el owner define la base, cada miembro puede
  sobrescribirla para sí mismo, unos 800 colores tokenizados

---

## FASE 4.21, SDK de extensiones y marketplace (completa, v1)

Nodyx ahora puede ser extendido por terceros sin tocar el núcleo. Cubre buena parte del objetivo
de la Fase 5, "API pública documentada para desarrolladores externos".

- SDK pensado primero en seguridad: superficie aislada, puente con el host bien definido,
  almacenamiento clave/valor aislado por extensión, identidad proyectada (nunca las cuentas
  reales), proxy de red anti-SSRF con anclaje de dirección, pantalla de permisos para el admin
- `extensions.nodyx.org`: escaparate, registro e índice. Una primera extensión real
  (`next-event`) como prueba, respaldada por tests
- Superficies de extensión integradas en la página de inicio y en el Homepage Builder

CDC completo en `SPECS/NODYX_SDK_CDC.md`, `SPECS/NODYX_SDK_SECURITY.md`,
`SPECS/NODYX_SDK_REFERENCE.md`.

---

## FASE 4.22, Actividades comunitarias en voz (completa, v1)

Un canal de voz ahora puede alojar una actividad, un juego multijugador para mientras se habla,
siguiendo el mismo modelo que las extensiones: un paquete de aplicación entregado por la
instancia, un relé en tiempo real dedicado, identidad Nodyx resuelta del lado del host. Una
galería estilo Play Store, un dock a pantalla completa, almacenamiento de aplicación para
puntuaciones y estado de partida.

Detalle en `SPECS/NODYX_ACTIVITIES_CDC.md`.

---

## FASE 4.23, Escaparate de música + endurecimiento del escaparate público (completa)

**Escaparate de música**: un módulo público `/musique` gestionado desde `/admin/music`, nacido
para alojar una banda sonora de videojuego hecha internamente y convertido en genérico (título,
subtítulo y banner editables). Categorías reordenables, subida en un solo paso con escaneo
antimalware, un certificado de licencia en PDF generado al vuelo por categoría.

**Endurecimiento del escaparate público**, a raíz del incidente del 1 de septiembre de 2026
(una cuenta de miembro estándar hizo subir spam a la página de inicio y al directorio federado,
sin ningún fallo de autenticación de por medio): categorías restringibles por rol, el escaparate
y el directorio ahora limitados a los hilos que un admin ha destacado explícitamente, un mensaje
de baneo de IP que dice la verdad cuando no se conoce ninguna dirección pública. CDC completo en
`SPECS/NODYX_DURCISSEMENT_VITRINE_CDC.md`.

En continuación directa de ese incidente, a mediados de septiembre arrancó una auditoría de
seguridad sistemática de todo lo que corre en producción, módulo por módulo: la capa de tiempo
real de Socket.IO, la completitud de las comprobaciones de autorización de admin, y un fallo XSS
no autenticado encontrado y corregido de paso en el título de los hilos del foro. Sigue en curso
mientras se escribe esto.

---

## FASE 4.24, Los ambientes y el contenedor flotante (completa, v2.13)

El aspecto de una instancia, ajustado a fondo por su administrador, sin escribir nunca CSS.

- En pantallas grandes, el contenido flota en paneles de cristal sobre el fondo de la instancia
- Catorce ambientes listos (Matrix, Cyberpunk, Gazette, Océano…) con fotos reales bajo licencia
  libre, o el acento, los fondos, la decoración y la intensidad que elija el administrador
- Un contraste calculado, nunca adivinado (al menos 4,5:1); un borrador en el servidor que nadie ve
  antes de «Publicar», deshacer y rehacer, un código de ambiente para compartir
- Un lápiz directamente en el sitio para dar estilo a cada zona (fondo, desenfoque, esquinas,
  imagen, fuente), con ajustes acotados y revalidados por el núcleo

---

## FASE 4.25, Instalador reconstruido, auditoría de seguridad (completa, v2.13)

`install.sh` e `install_tunnel.sh` revisados línea por línea y reconstruidos en gran parte, a raíz
de un aviso sobre una Debian 13 mínima.

- Una actualización ya no tumba el sitio: la nueva versión se compila al lado, el cambio solo
  ocurre si todo ha salido bien, y la base de datos se respalda y se comprueba antes
- La dirección real del visitante llega a Nodyx en todos los tipos de instalación (el límite de
  peticiones y los bloqueos dependían de ello), el cortafuegos ya no puede dejar fuera al administrador
- Programas descargados verificados por SHA-256, ningún secreto en una línea de comandos ni en
  claro en el disco
- Instalación desatendida (`--yes`, `--network`, archivos de contraseña y de token),
  `nodyx-update`, `nodyx-doctor`, `nodyx-recover`, un `uninstall.sh` reescrito
- Un banco de pruebas para cada camino de los instaladores, ejecutado en la CI

---

## FASE 4.26, Estabilización: cazar errores en uso real (completa, v2.13)

Usar Nodyx a diario en nodyx.org, y hacer las capturas de esta documentación, sacó a la luz
errores que ninguna prueba había visto. Cada corrección llega con una prueba que falla con el
código antiguo, y se comprueba en directo tras el despliegue.

- Lienzo: los marcos, las formas avanzadas y los conectores se perdían al recargar desde la 2.2
- Voz: una pestaña cerrada dejaba un fantasma en la sala; quien entraba durante una pantalla
  compartida nunca la veía
- Una primera visita cargaba cada página dos veces; foro y barra lateral aplastados en escritorio
- Después: que las salas de voz grandes funcionen también desde un servidor casero (el motor
  `str0m`, fase 4.18), para que ningún administrador de Nodyx tenga que abrir nunca un puerto

---

## FASE 4.27, Tema claro y oscuro en todas partes, una apariencia que se entiende (en curso)

Quien elige el tema claro debe encontrarlo en cada página. Y quien administra debe saber dónde se
cambia cada cosa sin tener que adivinar.

- El chat, el muro, los miembros, el foro, la wiki, la agenda y las tareas ya siguen el ambiente de
  la instancia en los dos temas, respetando los ajustes de la hoja (transparencia, imagen) (v2.13)
- Lo siguiente: el perfil, los mensajes privados, el inicio de sesión, la administración
- Una página de inicio en dos versiones: quien administra diseña su cuadrícula una vez, oscura o
  clara, y Nodyx deduce la otra conservando sus colores
- Todos los ajustes de apariencia reunidos en un solo recorrido, de lo general a lo particular, con
  cada color indicando de dónde viene

---

## FASE 5, Móvil y reputación (en curso)
### Nodyx en el bolsillo de todos

- [ ] App iOS vía Capacitor
- [ ] App Android vía Capacitor
- [ ] Escritorio vía Tauri (.exe/.app/.sh de ~10 MB, autónomo)
- [ ] NodyxPoints, sistema de reputación comunitaria entre instancias
- [ ] Insignias y niveles
- [x] **API pública para desarrolladores externos**: cubierta en gran parte por el SDK de
  extensiones, ver Fase 4.21. Queda pendiente: un marketplace de terceros más allá de la primera
  extensión de prueba
- [ ] **Nodes**, conocimiento estructurado duradero, validado a través del Jardín, ver
  [SPEC 013](../en/specs/013-node/SPEC.md)
- [ ] **Galaxy Bar**, selector multi-instancia, SSO descentralizado, ver
  [SPEC 012](../en/specs/012-nodyx-galaxy-bar/SPEC.md)

---

## REGLAS DE LA HOJA DE RUTA

1. No empezamos una fase sin que la anterior esté estable y en uso
2. No rompemos lo que funciona, ofrecemos alternativas (ej: Relay vs CF Tunnel vs puertos abiertos)
3. La complejidad se esconde: el usuario ve un botón, la capa Rust gestiona la complejidad
4. Cada adición debe ser coherente con lo descentralizado y soberano
5. El núcleo se mantiene simple, la complejidad va en los plugins
6. La comunidad puede votar para repriorizar las fases futuras

## LO QUE NUNCA ESTARÁ EN LA HOJA DE RUTA

- Publicidad, venta de datos
- Cualquier función que requiera un servidor central obligatorio (`nodyx.org` es opcional, sin
  él la instancia sigue siendo plenamente funcional en su propio dominio)
- Una puerta trasera de cualquier tipo
- Dependencia permanente de un servicio propietario de terceros
- Reemplazar Node.js o SvelteKit por Rust (cada herramienta en su lugar)

---

## FASE HORIZON, NODYX-ETHER
### La capa física. La última frontera.

> *"Las ondas de radio no necesitan permiso."*

Nodyx descentraliza la capa de aplicación. Pero todavía dependemos de una cosa: la
infraestructura física de internet, cables de fibra y satélites controlados por terceros.
NODYX-ETHER descentraliza la propia capa física, mediante los mismos CRDTs ya en producción en
NodyxCanvas: el mecanismo que sincroniza un trazo de pincel puede sincronizar una publicación de
foro sobre un enlace LoRa de 250 bits por segundo, incluso con dos horas de retraso.

```
Capa 1, Malla local        LoRa / Wi-Fi ad-hoc    0-50 km       sin infraestructura
Capa 2, Radio regional     HF / NVIS              500-3000 km   rebote ionosférico
Capa 3, Ionosfera          HF onda corta          Mundial       sin cable, sin satélite
```

Esto no es una función para mañana, es una llamada a colaboradores: radioaficionados, makers de
LoRa, colaboradores de Meshtastic, desarrolladores de Rust embebido. La arquitectura está ahí,
la base CRDT ya está entregada, la capa de radio espera las manos adecuadas.

→ **[Especificación completa: docs/ideas/NODYX-ETHER.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-ETHER.md)**

---

## FASE RADIO, NODYX-RADIO
### La radio por internet que por fin tiene una razón de ser.

> *"50.000 operadores de radio por internet emitiendo al vacío. Nodyx es la respuesta."*

Menos del 5% de las más de 100.000 estaciones de radio por internet en su apogeo tuvieron alguna
vez más de 10 oyentes simultáneos, no porque la programación fuera mala, sino porque no existía
ninguna estructura para convertir oyentes simultáneos en comunidad. Una instancia Nodyx ES esa
capa comunitaria: un foro indexado, chat en vivo durante la emisión, canales de voz como estudio
abierto, el Jardín para votar los próximos programas.

La red publicitaria cooperativa es el modelo de negocio que faltaba: 200 estaciones Nodyx-Radio
con 80 oyentes cada una suman 16.000 oyentes locales, una escala que un comercio local o un
evento regional sí puede pagar. Segmentación solo geográfica, cero rastreo, cero perfiles de
usuario. El dinero se queda local, la infraestructura se queda libre.

→ **[Visión completa: docs/ideas/NODYX-RADIO.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-RADIO.md)**

---

*Versión 2.12.0, 17 de septiembre de 2026.*
*"El P2P es el alma. Rust es el cuerpo. La radio es la resiliencia. La comunidad es la razón."*
