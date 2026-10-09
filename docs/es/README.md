# NODYX

> *"La red es la gente."*

**Nodyx** es una plataforma de comunicación comunitaria descentralizada, de código abierto y libre.

Es el internet de los años 2000 reconstruido con las herramientas de 2026.

---

## Por qué existe Nodyx

Discord, Facebook y las grandes plataformas han encerrado a millones de comunidades en plataformas herméticas.
Debates, tutoriales, conocimiento colectivo — invisibles para Google, inaccesibles sin cuenta, condenados a desaparecer el día que la plataforma cierre.

**Nodyx lo soluciona.**

- Foros públicos **indexados por todos los motores de búsqueda** (Google, Bing, Brave, Qwant...)
- Reacciones, agradecimientos, etiquetas, búsqueda de texto completo
- **Chat** comunitario en tiempo real (Socket.IO)
- **Voz** + compartir pantalla (WebRTC P2P)
- **Autoalojable** en cualquier servidor
- **Red P2P** — los usuarios son la red
- **Código abierto** — AGPL-3.0

---

## Una instancia = una comunidad

Nodyx no se despliega como plataforma multicomunitaria.
**Cada instalación de Nodyx es una comunidad soberana**, configurada vía `.env`:

```env
NODYX_COMMUNITY_NAME=Linux y Código Abierto
NODYX_COMMUNITY_DESCRIPTION=La comunidad hispanohablante de software libre.
NODYX_COMMUNITY_LANGUAGE=es
NODYX_COMMUNITY_COUNTRY=ES
NODYX_COMMUNITY_SLUG=linux
```

Las instancias se descubren entre sí a través del **nodyx-directory** — el registro global *(Fase 2)*.

---

## Estado del proyecto

**v2.0.0 — Comunicaciones privadas y soberanas**

```
Foro                        ✓  Categorías, hilos, publicaciones, reacciones, agradecimientos, etiquetas
Búsqueda de texto completo  ✓  PostgreSQL tsvector/GIN, extractos resaltados
Panel de administración     ✓  Panel, miembros, rangos, bloqueos, moderación
SEO                         ✓  Sitemap, RSS, robots.txt, JSON-LD, URLs canónicas
Chat en tiempo real         ✓  Socket.IO — canales, respuestas, anclados, previsualizaciones, @menciones
Salas de voz                ✓  Malla WebRTC P2P — silenciar, sin sonido, PTT, filtro de ruido
Compartir pantalla          ✓  Compartir pantalla WebRTC + grabación de clips
P2P DataChannels            ✓  Escritura instantánea, reacciones optimistas, transferencia de archivos
NodyxCanvas                 ✓  Pizarra colaborativa P2P en salas de voz
Notificaciones              ✓  respuesta, agradecimiento, @mención — insignia, centro, purga auto 30d
Mensajes directos           ✓  MDs 1:1 — cifrado E2E (ECDH P-256 + AES-256-GCM + capa ESY)
  ↳ Escudo E2E              ✓  Indicador en vivo (verde/naranja), tooltip de huella ESY
  ↳ Animación de barbarización ✓  Cifrado visualizado — glifos se mezclan y revelan en tiempo real
  ↳ Editar y eliminar       ✓  Edición inline con recifrado, eliminación en tiempo real para todos
Encuestas                   ✓  Elección / planificación / clasificación — en chat y foro
Sistema de bloqueo          ✓  Bloqueo de usuario, IP y email
Biblioteca de recursos      ✓  Marcos, banners, insignias, pegatinas, sonidos, temas, fuentes
Temas de perfil             ✓  6 preajustes, CSS por usuario en toda la app, editor en vivo
UI móvil                    ✓  Navegación inferior, drawer de chat, voz en móvil
Calendario / Eventos        ✓  CRUD, RSVP, mapas OSM, portada, fragmentos enriquecidos
Búsqueda global             ✓  Índice FTS entre instancias, UI /discover
Federación                  ✓  Directorio de instancias, Galaxy Bar (selector multi-instancia)
Protocolo Gossip            ✓  Indexación de eventos/hilos entre instancias
Nodyx Signet                ✓  PWA de autenticación ECDSA P-256 sin contraseña
2FA (TOTP + Signet)         ✓  TOTP RFC 6238 + Signet como 2.º factor, cadena de prioridad
nodyx-relay                 ✓  Túnel TCP en Rust — servidor en casa, sin puertos abiertos
nodyx-turn                  ✓  STUN/TURN en Rust — reemplaza coturn, voz a través de VPNs
Suite honeypot              ✓  Tarpit, archivos canario, logins falsos, píxel, huella, honeytokens, slowloris
Hub Olimpo                  ✓  Centro de control de seguridad — panel en vivo, recolección de credenciales, lista negra distribuida
```

---

## Instalación

### Opción A — Docker (recomendado)

El método más sencillo. Requiere Docker Desktop o Docker Engine.

```bash
git clone https://github.com/Pokled/Nodyx
cd Nodyx/nodyx-core
cp .env.example .env
# Edita .env con la información de tu comunidad
docker-compose up -d
```

La API arranca en `http://localhost:3000`

---

### Opción B — Windows Server sin Docker (PowerShell Easy-Install)

Un script de PowerShell automatiza la instalación completa en menos de 15 minutos:
Node.js, PostgreSQL, Redis, configuración de la base de datos, migraciones y registro como servicio de Windows.

```powershell
# Ejecuta PowerShell como Administrador, luego:
.\scripts\Install-Nodyx.ps1

# O con una ruta de instalación personalizada:
.\scripts\Install-Nodyx.ps1 -NodyxPath "D:\Apps\Nodyx"
```

El script instala y configura automáticamente:
- **Chocolatey** (gestor de paquetes para Windows)
- **Node.js LTS** + **PostgreSQL 16** + **Redis**
- **NSSM** para registrar Nodyx como servicio de Windows (arranque automático)
- Regla de firewall para el puerto de la API

---

### Opción C — Instalación manual (Linux/Mac/Windows)

**Requisitos previos:** Node.js 22+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/Pokled/Nodyx
cd Nodyx/nodyx-core
npm install
cp .env.example .env
```

Edita `.env` con tus datos, luego crea la base de datos:

```sql
-- Como superusuario de PostgreSQL
CREATE ROLE nodyx_user LOGIN PASSWORD 'tu_contraseña';
CREATE DATABASE nodyx OWNER nodyx_user;
GRANT ALL PRIVILEGES ON DATABASE nodyx TO nodyx_user;
```

Aplica las migraciones:

```bash
# Linux/Mac (autenticación peer o por contraseña)
PGPASSWORD=tu_contraseña psql -U nodyx_user -d nodyx -f src/migrations/001_initial.sql
# Las migraciones se aplican automáticamente al arrancar — no se necesita SQL manual

# Windows
$env:PGPASSWORD="tu_contraseña"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U nodyx_user -d nodyx -f src\migrations\001_initial.sql
# Las migraciones se aplican automáticamente al arrancar — no se necesita SQL manual
```

Arrancar:

```bash
npm run dev       # desarrollo (tsx, puerto 3000)
npm run build     # compilación TypeScript
npm start         # producción (node dist/)
```

---

## Proxy inverso HTTPS — Caddy (recomendado)

[Caddy](https://caddyserver.com) es un proxy inverso que gestiona automáticamente los certificados SSL a través de Let's Encrypt. Sin configuración SSL manual.

```bash
# Instalar Caddy
choco install caddy       # Windows
apt install caddy         # Debian/Ubuntu
brew install caddy        # macOS

# Ejecutar con la configuración de ejemplo (desde la raíz del repo)
caddy run --config nodyx-core/scripts/Caddyfile.example
```

Un ejemplo está disponible en [`nodyx-core/scripts/Caddyfile.example`](https://github.com/Pokled/nodyx/blob/main/nodyx-core/scripts/Caddyfile.example).

---

## Variables de entorno

Consulta [`nodyx-core/.env.example`](https://github.com/Pokled/nodyx/blob/main/nodyx-core/.env.example) para la lista completa.

| Variable | Obligatoria | Descripción |
|---|---|---|
| `NODYX_COMMUNITY_NAME` | Sí | Nombre visible de la comunidad |
| `NODYX_COMMUNITY_SLUG` | Sí | Identificador de URL (letras minúsculas, guiones) |
| `NODYX_COMMUNITY_LANGUAGE` | No | Idioma (por defecto: `en`) |
| `JWT_SECRET` | Sí | Secreto JWT — **32+ caracteres aleatorios en producción** |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | Sí | Conexión PostgreSQL |
| `DB_USER` / `DB_PASSWORD` | Sí | Credenciales PostgreSQL |
| `REDIS_HOST` / `REDIS_PORT` | No | Redis (por defecto: `localhost:6379`) |
| `PORT` | No | Puerto de la API (por defecto: `3000`) |
| `NODE_ENV` | No | `development` o `production` |

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| API | TypeScript + Fastify |
| Base de datos | PostgreSQL 16 |
| Caché / Limitación de peticiones | Redis 7 |
| Búsqueda de texto completo | PostgreSQL tsvector + GIN |
| Frontend | SvelteKit + Tailwind v4 |
| Editor | Tiptap (WYSIWYG) |
| P2P | WebRTC DataChannels + nodyx-relay (Rust) |

---

## Cuentas de demostración

Tras `npm run seed`:

| Email | Contraseña | Rol |
|---|---|---|
| `bob@nodyx.demo` | `demo1234` | miembro |
| `charlie@nodyx.demo` | `demo1234` | propietario (gaming) |

---

## Documentación

- [ROADMAP.md](./ROADMAP.md) — El camino hacia la visión completa
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Cómo está construido Nodyx
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Cómo contribuir
- [MANIFESTO.md](./MANIFESTO.md) — Los principios fundadores

---

## Contribuir

Nodyx pertenece a su comunidad. Todas las contribuciones son bienvenidas.

Lee [CONTRIBUTING.md](./CONTRIBUTING.md) antes de empezar.

```
nodyx-plugins/    →  Crear plugins
nodyx-themes/     →  Crear temas
i18n/             →  Traducir a tu idioma
nodyx-docs/       →  Mejorar la documentación
```

---

## Licencia

AGPL-3.0 — El código pertenece a su comunidad.

Si Nodyx traiciona sus principios, el Manifiesto autoriza explícitamente
a cualquiera a hacer un fork del proyecto y continuar.

---

## Supervisora jefa

**Iris** — Aprueba cada commit desde el 18 de febrero de 2026. 🐱

---

*Nacido el 18 de febrero de 2026 a las 23:37.*
*"Haz un fork si te traicionamos."*
