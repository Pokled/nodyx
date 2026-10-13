<div align="center">

<img src="https://nodyx.org/uploads/assets/36644490ed9ac75ec1fb64b027c8cade8c1d0673e695b29d2bc0492102173d8f.webp" alt="Nodyx" width="80"/>

# Nodyx

### *«La red es la gente.»*

**La plataforma comunitaria autoalojada que de verdad es tuya.**<br/>
Foro, chat, voz, pizarra y tu propia página de inicio. Una instalación, en tu servidor, para una comunidad.

[![Versión](https://img.shields.io/github/v/release/Pokled/nodyx?label=versi%C3%B3n&color=7c3aed)](https://github.com/Pokled/nodyx/releases/latest)
[![Licencia: AGPL-3.0](https://img.shields.io/badge/Licencia-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
[![Traducido en directo](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodyx.org%2Ftranslate%2Fprogress.json&query=%24.overallPct&suffix=%25&label=traducido%20en%20directo&color=6d76f5)](https://nodyx.org/translate)
[![Instancias federadas](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodyx.org%2Fapi%2Fdirectory&query=%24.instances.length&label=instancias%20federadas&color=2ece93)](https://nodyx.org/discover)

[![Demo](https://img.shields.io/badge/Demo-nodyx.org-6d76f5?style=flat-square)](https://nodyx.org)
[![Documentación](https://img.shields.io/badge/Documentaci%C3%B3n-nodyx.dev-6d76f5?style=flat-square)](https://nodyx.dev)
[![Descubrir](https://img.shields.io/badge/Descubrir-start.nodyx.org-6d76f5?style=flat-square)](https://start.nodyx.org)
[![English](https://img.shields.io/badge/EN-English-12131b?style=flat-square)](https://github.com/Pokled/nodyx/blob/main/README.md)
[![Français](https://img.shields.io/badge/FR-Fran%C3%A7ais-12131b?style=flat-square)](../fr/README.md)

<br/>

<img src="../img/vitrine/home.webp" alt="La página de inicio de una comunidad Nodyx: artículos destacados, últimos debates, diseño de revista" width="900"/>

<sub>nodyx.org, la comunidad del proyecto, funcionando con el mismo Nodyx que puedes instalar. La interfaz de las capturas está en francés; Nodyx habla ocho idiomas, español incluido.</sub>

</div>

---

## Qué es

Nodyx le da a una comunidad un hogar que le pertenece: un foro que los buscadores saben leer, chat en tiempo real, canales de voz con pantalla compartida, un pizarra colaborativa, eventos, encuestas y una página de inicio pública que montas arrastrando y soltando. Todo funciona en un servidor que controlas tú, desde un VPS barato hasta una Raspberry Pi detrás del router de casa.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Sin Docker, sin cuenta en la nube, sin necesidad de dominio. El instalador lo prepara todo y en pocos minutos te entrega una cuenta de administrador.

> **Antes de seguir.** Nodyx no está aquí para pelearse con Discord, y no es la única alternativa libre. Matrix, Discourse, Stoat, Fluxer, Mattermost, Rocket.Chat, Haven y otros son buenos proyectos, y los presentamos en una página escrita por nosotros: **[Por qué Nodyx, y las alternativas que respetamos](https://nodyx.dev/why-nodyx)** (en inglés). La pelea no es entre nosotros. Es entre los silos cerrados y las comunidades que se pertenecen a sí mismas.

---

## Un recorrido

### Hablar como de verdad habla tu comunidad

<img src="../img/vitrine/forum.webp" alt="El foro de Nodyx: categorías, subforos, último mensaje de cada categoría, estadísticas y actividad reciente" width="900"/>

Un foro de verdad, con categorías, subforos y el último mensaje de cada uno, para ver de un vistazo dónde está la vida. Cada hilo tiene una dirección pública limpia, datos estructurados y su lugar en el mapa del sitio: lo que escribe tu comunidad se puede volver a encontrar, desde un buscador o por el próximo que llegue. Al lado, chat en tiempo real con respuestas, reacciones y mensajes fijados, mensajes privados cifrados de extremo a extremo y canales de voz con pantalla compartida.

<img src="../img/vitrine/voice-screenshare.webp" alt="Un canal de voz con la pantalla de Blender compartida en directo en el Nodyx Stage" width="900"/>

La pantalla compartida se abre en el **Nodyx Stage**, a pantalla completa o en una ventana flotante, y quien entra en la sala a mitad del directo la ve al momento.

### Crear cosas juntos

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/canvas.webp" alt="La pizarra: un tablero colaborativo con marcos, notas, hexágonos y conectores"/></td>
    <td width="50%"><img src="../img/vitrine/tasks.webp" alt="Un tablero de tareas por columnas: pendiente, en curso, terminado"/></td>
  </tr>
  <tr>
    <td><b>Pizarra.</b> Un tablero compartido: marcos, notas, formas, conectores, imágenes. Todos dibujan a la vez y todo se guarda.</td>
    <td><b>Tableros de tareas.</b> Organiza un lanzamiento, un torneo o una quedada por columnas, con prioridades y fechas.</td>
  </tr>
  <tr>
    <td width="50%"><img src="../img/vitrine/calendar.webp" alt="El calendario de la comunidad con tres eventos próximos"/></td>
    <td width="50%"><img src="../img/vitrine/polls.webp" alt="Una encuesta sobre el tema del próximo taller"/></td>
  </tr>
  <tr>
    <td><b>Eventos.</b> Noches de juego, talleres, lanzamientos, con lugar, mapa e inscripciones.</td>
    <td><b>Encuestas.</b> Elección, clasificación o planificación, con los resultados en directo.</td>
  </tr>
</table>

### Tu escaparate, a tu manera

<img src="../img/vitrine/homepage-builder.webp" alt="El editor de la página de inicio: la estructura a la izquierda, la vista previa en directo a la derecha" width="900"/>

La página de inicio la compones tú: filas y columnas sobre una cuadrícula de 12, widgets integrados, un borrador que solo ves tú hasta que publicas y una vista previa en escritorio, tableta y móvil. ¿Te falta algo? El **SDK de extensiones** permite a cualquiera crear un widget o un juego en JavaScript sencillo, y [extensions.nodyx.org](https://extensions.nodyx.org) lo instala con un clic. Las extensiones funcionan aisladas: nunca ven las cuentas reales, su almacenamiento está separado y su acceso a la red pasa por un proxy vigilado.

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/appearance.webp" alt="Ajustes de apariencia: ambientes listos como Matrix, Cyberpunk, Gazette u Océano, con vista previa en oscuro y en claro"/></td>
    <td width="50%"><img src="../img/vitrine/home-light.webp" alt="La misma página de inicio con la interfaz clara"/></td>
  </tr>
  <tr>
    <td><b>Ambientes.</b> Catorce estilos listos para usar, o tus propios colores. El contraste se comprueba por ti, y los miembros no ven nada hasta que publicas.</td>
    <td><b>Claro u oscuro.</b> Cada miembro elige, la identidad de la comunidad se mantiene.</td>
  </tr>
</table>

### Hecho por personas, para personas

<table>
  <tr>
    <td width="50%"><img src="../img/vitrine/translate.webp" alt="La página de traducción: ocho idiomas, su avance y quién ha contribuido"/></td>
    <td width="50%"><img src="../img/vitrine/profile.webp" alt="Un perfil de miembro con nivel, reputación e intereses"/></td>
  </tr>
  <tr>
    <td><b>Ocho idiomas, traducidos por la comunidad.</b> Cada idioma es un simple archivo de texto: sin cuenta, sin herramientas, sin plataforma en medio. <a href="https://nodyx.org/translate">Cómo va cada uno, en directo.</a></td>
    <td><b>Perfiles que cuentan algo.</b> Nivel, reputación, intereses, presencia: un miembro es más que un nombre de usuario.</td>
  </tr>
</table>

### Y el resto de la casa

- **Un servidor en casa, sin abrir puertos.** El relé de Nodyx, escrito en Rust, le da a tu instancia una dirección pública (`tuclub.nodyx.org`) usando solo conexiones salientes. El sitio, el chat y la voz en grupos pequeños funcionan detrás de un router doméstico. Las salas de voz grandes pasan por un servidor de difusión (SFU) que todavía necesita ser accesible desde internet; hacerlo funcionar también detrás de un router es el próximo gran trabajo.
- **Una voz que aguanta.** Las salas pequeñas hablan de igual a igual. Cuando una sala crece o alguien comparte pantalla, pasa al SFU de tu propio servidor: un solo envío por persona que habla, sea cual sea el público.
- **Juegos dentro del canal de voz.** Las actividades se acoplan a la sala de voz para jugar juntos sin colgar.
- **Una red de comunidades.** Cada instancia puede aparecer en un directorio común y buscarse desde las demás, sin ninguna cuenta central.
- **Streamer Hub.** Soundboard con cola de espectadores, stream deck en el móvil, siete overlays para OBS, chat de Twitch integrado. [Guía, en inglés](../en/STREAMER-HUB.md)
- **Biblioteca, música, wiki, jardín de ideas.** Marcos, insignias y banners compartidos por los miembros, un escaparate musical público, un wiki y un jardín donde las ideas crecen con los votos de la comunidad.
- **Herramientas de moderación.** Roles y rangos, registro de moderación, bloqueo de cuentas y de direcciones, y OctoGuard, un automoderador opcional (filtros de palabras, enlaces y flood, mensajes de bienvenida, comandos propios) con cada opción desactivada por defecto.

---

## Cada proyecto tiene su terreno

El panorama de herramientas comunitarias no es una batalla. Cada proyecto optimiza algo distinto, y la elección correcta depende de lo que quieras construir. Así se lo contaríamos a un amigo:

| Proyecto | Lo que mejor hace | Cuándo elegirlo |
|---|---|---|
| **Discord** | Voz y chat en tiempo real para grupos cerrados, pensado para móvil, un enorme ecosistema de bots | Tu comunidad es privada e informal |
| **Matrix** ([Element](https://github.com/element-hq/element-web)) | Un protocolo federado con puentes hacia casi todo | La interoperabilidad no se negocia |
| **[Discourse](https://github.com/discourse/discourse)** | Foros y bases de conocimiento indexados y buscables | El debate de fondo es tu núcleo |
| **[Mattermost](https://github.com/mattermost/mattermost)** / **[Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)** | Cumplimiento empresarial, sustituto de Slack a gran escala | Tienes un departamento de compras |
| **[Haven](https://github.com/ancsemi/Haven)** | Chat centrado en la privacidad, clientes nativos, sin telemetría | Cada byte debe quedarse en tu máquina |
| **[Stoat](https://github.com/stoatchat/self-hosted)** / **[Fluxer](https://github.com/fluxerapp/fluxer)** | Una interfaz al estilo Discord, migración fácil | Tus miembros ya conocen Discord |
| **Lemmy** | Foros federados por hilos, al estilo Reddit | Quieres una presencia nativa en el fediverso |
| **Nodyx** | Foro, chat, voz, pizarra y página de inicio en una instalación, con un relé para servidores caseros | Quieres que una comunidad de muchos formatos sea tuya, en tu propio hardware |

Si solo necesitas uno o dos de estos formatos, quizá otra herramienta de la tabla te encaje mejor. [Nuestra opinión sincera, alternativas incluidas (en inglés).](https://nodyx.dev/why-nodyx)

---

## Seguridad

Autoalojar significa que mantener segura a la comunidad es tarea tuya. Nodyx está hecho para que esa tarea sea más pequeña.

| Superficie | Cómo se trata |
|---|---|
| Contraseñas | Argon2id con los parámetros de OWASP, los hashes bcrypt antiguos se migran sin que nadie lo note |
| Mensajes privados | Cifrados de extremo a extremo (ECDH P-256 y AES-256-GCM). Las claves nunca salen del navegador, el servidor solo guarda texto cifrado |
| Doble factor | Aplicaciones TOTP, o Nodyx Signet, una aplicación de acceso sin contraseña (ECDSA P-256) |
| Cada entrada | Validada con un esquema, solo consultas SQL parametrizadas |
| Cada respuesta | CSP, HSTS, protección contra el enmarcado, HTML saneado |
| Límite de peticiones | Calculado sobre la dirección real del visitante, detrás de Cloudflare, Caddy o un túnel |
| Copias de seguridad | Comprobadas cada noche con una restauración automática, no solo copiadas |

¿Has encontrado una vulnerabilidad? **Por favor, no abras una issue pública.** Escribe a `security@nodyx.org` o usa los [avisos privados de GitHub](https://github.com/Pokled/nodyx/security/advisories/new). Respondemos en 48 horas, evaluamos en 7 días y te damos crédito en las notas de versión si lo deseas. [Política de seguridad completa, en inglés](https://github.com/Pokled/nodyx/blob/main/.github/SECURITY.md)

---

## Instalar

Necesitas una máquina con **Ubuntu 22.04 / 24.04** o **Debian 11 / 12 / 13** (64 bits, ARM64 incluido: una Raspberry Pi 4 o 5 sirve) y `curl`.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

El instalador te pregunta cómo se llegará a tu instancia:

| Modo | Qué necesitas | Qué obtienes |
|---|---|---|
| **Relé Nodyx** (recomendado) | Nada, solo conexiones salientes | `tuclub.nodyx.org`, incluso detrás de un router doméstico |
| **Tu propio dominio** | Un dominio y los puertos 80/443 abiertos | HTTPS con Let's Encrypt, control total |
| **sslip.io** | Los puertos 80/443 abiertos, sin dominio | Una dirección automática y gratuita |

¿Ya estás detrás de un túnel? `install_tunnel.sh` cubre **Cloudflare Tunnel**, **Pangolin** y los túneles caseros (frp, rathole, tu propio proxy inverso).

Instala Node.js, PostgreSQL, Redis, Caddy, PM2 y el relé de voz en Rust, genera todos los secretos, aplica las migraciones de la base de datos y crea tu cuenta de administrador. También funciona sin supervisión (`--yes`, `--network=relay`, `--admin-password-file`).

Una vez instalado:

```bash
sudo nodyx-update    # pasar a la última versión, con copia de la base antes
sudo nodyx-doctor    # comprobar que cada servicio está bien
sudo nodyx-recover   # recuperar el acceso a una cuenta de administrador perdida
```

[Guía de instalación completa](./INSTALL.md) · [Instalación detrás de un túnel, en inglés](../en/INSTALL-TUNNEL.md)

---

## Por dentro

| Capa | Tecnología |
|---|---|
| API | TypeScript, Fastify 5, Socket.IO (`nodyx-core/`) |
| Aplicación web | SvelteKit 5, Tailwind 4, editor TipTap (`nodyx-frontend/`) |
| Datos | PostgreSQL 16 con búsqueda de texto completo, Redis 7 para sesiones y presencia, 125 migraciones aplicadas automáticamente al arrancar |
| Voz | WebRTC de igual a igual para salas pequeñas, un SFU en tu servidor para las grandes y la pantalla compartida |
| Red | `nodyx-relay` (servidores caseros sin puertos abiertos) y `nodyx-turn` (STUN/TURN), ambos en Rust (`nodyx-p2p/`) |
| Acceso sin contraseña | Nodyx Signet, una aplicación ECDSA P-256 (`nodyx-authenticator/`) |
| Procesos y proxy | PM2 con un usuario `nodyx` dedicado, Caddy con HTTPS automático |

<details>
<summary>Cómo se organiza el repositorio</summary>

```
nodyx/
├── nodyx-core/          API, Socket.IO, migraciones de la base de datos
├── nodyx-frontend/      aplicación web SvelteKit
├── nodyx-p2p/           Rust: relé y servidor TURN
├── nodyx-authenticator/ Nodyx Signet, acceso sin contraseña
├── nodyx-docs/          nodyx.dev, el sitio de documentación
├── nodyx-landing/       start.nodyx.org
├── docs/                documentación en Markdown (EN, FR, ES)
├── install.sh           instalador (relé, dominio propio, sslip.io)
└── install_tunnel.sh    instalador detrás de Cloudflare Tunnel, Pangolin o tu propio túnel
```

</details>

<details>
<summary>Cómo se encuentran las instancias</summary>

Cada instancia puede registrarse en un directorio común y compartir de vez en cuando su ficha pública: nombre, dirección, número de miembros. La página `/discover` de cualquier instancia busca en los hilos y eventos públicos de las demás. No hay cuenta global ni dependencia de ActivityPub: el protocolo es pequeño a propósito, y una instancia que sale del directorio sigue funcionando exactamente igual.

</details>

---

## Hacia dónde va

Nodyx nació el 18 de febrero de 2026 y desde entonces ha publicado doce versiones: la base de foro, chat y voz, los mensajes cifrados de extremo a extremo, el editor de página de inicio y su tienda de extensiones, los juegos dentro de los canales de voz, el Streamer Hub, las copias de seguridad verificadas y el SFU en Rust para la voz y la pantalla compartida. El próximo gran paso: que las salas de voz grandes funcionen también desde un servidor casero, para que ningún administrador de Nodyx tenga que abrir nunca un puerto.

[Registro de cambios](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md) · [Hoja de ruta](./ROADMAP.md) · [Manifiesto](./MANIFESTO.md)

---

## Contribuir

Nodyx pertenece a su comunidad. Lee [CONTRIBUTING.md](./CONTRIBUTING.md), echa un vistazo a las [issues](https://github.com/Pokled/Nodyx/issues) o abre una [discusión](https://github.com/Pokled/Nodyx/discussions). La documentación y las ideas (`docs/`, `docs/ideas/`) están abiertas a todo el mundo sin pedir permiso; un cambio en el núcleo empieza con una issue.

**Traducir Nodyx.** El francés y el inglés están completos, el portugués de Brasil casi, y otros cinco idiomas van en camino, el español entre ellos. Elige el tuyo en [nodyx.org/translate](https://nodyx.org/translate), completa las líneas que faltan en un archivo JSON y abre una pull request. La CI comprueba cada variable, así que una traducción no puede romper la aplicación.

### Las Nodyx Stars

Cada contribución externa vale una estrella, y cada estrella entra en [nuestro salón de la fama](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md) con su historia. El código abierto sin reconocimiento es trabajo gratis, y así no hacemos las cosas.

<table>
  <tr>
    <td align="center" width="140">
      <a href="https://github.com/Pranto2003"><img src="https://github.com/Pranto2003.png?size=80" width="64" height="64" alt="Pranto"/></a><br/>
      <b>Pranto Goswamee</b><br/><sub>🌟 Primer contribuidor</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/waazaa-fr"><img src="https://github.com/waazaa-fr.png?size=80" width="64" height="64" alt="waazaa-fr"/></a><br/>
      <b>waazaa-fr</b><br/><sub>🌟🌟 Errores del instalador</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/naranco66"><img src="https://github.com/naranco66.png?size=80" width="64" height="64" alt="naranco66"/></a><br/>
      <b>naranco66</b><br/><sub>🌟🌟🌟 Español (es-ES)</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/forke24x7"><img src="https://github.com/forke24x7.png?size=80" width="64" height="64" alt="forke24x7"/></a><br/>
      <b>forke24x7</b><br/><sub>🌟🌟🌟🌟🌟 Alemán (de)</sub>
    </td>
    <td align="center" width="140">
      <a href="https://github.com/lukasMega"><img src="https://github.com/lukasMega.png?size=80" width="64" height="64" alt="Lukáš Melega"/></a><br/>
      <b>Lukáš Melega</b><br/><sub>🌟🌟 Búsqueda en la doc</sub>
    </td>
  </tr>
</table>

[Todas las historias, todos los contribuidores](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md)

---

## Apoyar Nodyx

Nodyx lo construye un solo desarrollador, sin inversores y sin ataduras. Si te resulta útil, una estrella ayuda a que otros lo encuentren, y [Ko-fi](https://ko-fi.com/Pokled) ayuda a pagar los servidores.

<a href="https://ko-fi.com/Pokled"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Apoyar en Ko-fi"/></a>

---

## Licencia

**AGPL-3.0.** Si ejecutas un Nodyx modificado para otras personas, aunque sea a través de la red, tus cambios siguen siendo abiertos. Y si algún día Nodyx traicionara sus principios, esta licencia permite a cualquiera hacer un fork y seguir con el espíritu del [Manifiesto](./MANIFESTO.md).

<div align="center">
  <br/>
  <p><em>Nacido el 18 de febrero de 2026.</em></p>
  <p><strong>«Haznos un fork si te traicionamos.»</strong></p>
</div>
