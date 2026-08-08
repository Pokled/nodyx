# 🚀 Nodyx — Guía de instalación completa

> **TL;DR:** Clona el repositorio en un servidor Linux, ejecuta `bash install.sh` y responde a unas pocas preguntas. Listo. ☕
>
> **Novedad — Nodyx Relay:** ¿Sin dominio y sin puertos abiertos? ¿Raspberry Pi, PC viejo, router doméstico?
> **Elige la opción `[2] Nodyx Relay`** durante la instalación → tu instancia estará disponible desde la dirección `mi-comunidad.nodyx.org` sin ninguna configuración.
> [→ Guía completa de Nodyx Relay](RELAY.md)

---

## Tabla de contenidos

- [Antes de empezar](#-antes-de-empezar)
- [¿Dónde alojar?](#-dónde-alojar)
- [¿Necesito un dominio?](#-necesito-un-dominio) — [Guía completa de dominios →](DOMAIN.md)
- [¿Qué puertos abrir?](#-qué-puertos-abrir)
- [Instalación — La forma fácil](#-instalación--la-forma-fácil-recomendada)
- [Usuarios de Windows — Guía WSL](#-usuarios-de-windows--guía-wsl)
- [Servidor en casa / Detrás de NAT](#-servidor-en-casa--detrás-de-nat)
- [Alojar SIN abrir puertos (Nodyx Relay, Cloudflare Tunnel, Tailscale)](#-alojar-en-casa-sin-abrir-puertos)
- [Detrás de una VPN o WireGuard](#-detrás-de-una-vpn-o-wireguard)
- [Errores comunes y soluciones](#-errores-comunes-y-soluciones)
- [Tras la instalación](#-tras-la-instalación)
- [Trucos y consejos](#-trucos-y-consejos)
- [Configurar el correo →](EMAIL.md)

---

## 📋 Antes de empezar

### Requisitos mínimos de hardware

| Componente | Mínimo | Recomendado |
|---|---|---|
| CPU | 1 vCPU / 1 núcleo | 2 vCPU o más |
| RAM | 1 GB | 2 GB o más |
| Disco | 10 GB SSD | 20 GB SSD |
| Ancho de banda | 10 Mbps | 100 Mbps |
| SO | Ubuntu 22.04 | Ubuntu 24.04 LTS |

> 💡 **Ejemplo real:** Una comunidad de 50 usuarios activos funciona sin problemas en un VPS de €4/mes (Hetzner CX22, 2 vCPU / 4 GB RAM). Las salas de voz son P2P — no consumen ancho de banda del servidor.

### Límites de memoria PM2 — Ajustados automáticamente por el instalador

El instalador detecta la RAM total disponible y configura PM2 en consecuencia. No hace falta ningún ajuste manual.

| RAM total | Límite nodyx-core | Límite nodyx-frontend | Swap automático | Heap Node (build) |
|---|---|---|---|---|
| < 1,5 GB (RPi 1 GB) | 256 MB | 192 MB | Se crean 2 GB | 512 MB |
| 1,5 – 3 GB (RPi 4 / VPS pequeño) | 384 MB | 256 MB | 1 GB si hace falta | 1024 MB |
| ≥ 3 GB (VPS estándar) | 512 MB | 512 MB | 1 GB si hace falta | 1024 MB |

> **Nota para Raspberry Pi:** Usa un **SO de 64 bits** (Raspberry Pi OS 64-bit o Ubuntu 24.04 ARM64). El modo 32 bits no está soportado. En una Pi de 1 GB, la compilación de SvelteKit puede tardar unos 8 minutos — es normal.

### Sistemas operativos compatibles

| SO | Soporte | Notas |
|---|---|---|
| Ubuntu 24.04 LTS | ✅ Recomendado | El más probado |
| Ubuntu 22.04 LTS | ✅ Compatible | Funciona perfectamente |
| Debian 12 (Bookworm) | ✅ Compatible | Totalmente compatible |
| Debian 11 (Bullseye) | ✅ Compatible | Compatible |
| Windows (WSL2) | ✅ Compatible | [Ver sección WSL](#-usuarios-de-windows--guía-wsl) |
| macOS | ⚠️ Solo manual | install.sh es solo para Linux |
| CentOS / RHEL / Fedora | ❌ No soportado | Usa Docker en su lugar |
| Raspberry Pi OS | ✅ Compatible | Usa la versión de 64 bits |

### Solo un requisito previo — Git

El instalador necesita `git` para clonar el repositorio de Nodyx. La mayoría de imágenes de VPS no lo incluyen por defecto. Instálalo primero:

```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y git

# Eso es todo. El instalador se encarga del resto.
```

---

### Qué instala `install.sh` automáticamente

No necesitas instalar nada más manualmente. El script se encarga de:

- **Node.js 20 LTS** — Entorno de ejecución JavaScript
- **PostgreSQL 16** — Base de datos principal
- **Redis 7** — Caché y sesiones en tiempo real
- **Coturn** — Relay TURN/STUN para salas de voz (NAT traversal con WebRTC)
- **Caddy** — Proxy inverso + HTTPS automático (Let's Encrypt)
- **PM2** — Gestor de procesos (reinicio automático, arranque al inicio)

---

## 🖥️ ¿Dónde alojar?

### Opción 1 — VPS (Recomendado para empezar)

Un VPS (Servidor Privado Virtual) es una máquina Linux remota que alquilas por meses. Siempre está encendida, tiene una IP fija y puedes conectarte a ella por SSH desde cualquier sitio.

**Proveedores recomendados:**

| Proveedor | Plan de entrada | Precio mensual | Notas |
|---|---|---|---|
| [Hetzner Cloud](https://hetzner.com/cloud) | CX22 (2 vCPU, 4 GB) | ~€3,5 | Mejor relación calidad-precio en Europa |
| [DigitalOcean](https://digitalocean.com) | Basic (1 vCPU, 1 GB) | $6 | Panel amigable para principiantes |
| [Vultr](https://vultr.com) | Cloud Compute 1 vCPU | $6 | Buena cobertura global |
| [OVH](https://ovh.com) | VPS Starter | ~€3 | Proveedor europeo |

> 💡 **Consejo:** Elige siempre un VPS ubicado cerca de tus usuarios (Europa → Fráncfort o París, Norteamérica → Nueva York o Dallas).

**Cómo crear un VPS (ejemplo con Hetzner):**
1. Crea una cuenta en hetzner.com
2. Ve a **Cloud → Projects → New Project**
3. Haz clic en **Add Server**
4. Elige: Ubicación (ej. Núremberg), Imagen = **Ubuntu 24.04**, Tipo = **CX22**
5. Añade tu clave SSH pública (recomendado) o establece una contraseña de root
6. Haz clic en **Create & Buy**
7. La IP de tu servidor aparece en el panel en unos 30 segundos

**Conectarte a tu VPS:**
```bash
ssh root@IP_DE_TU_VPS
```

---

### Opción 2 — Servidor en casa

Un PC antiguo, un portátil viejo o una Raspberry Pi enchufados en casa. Funciona muy bien, pero requiere:
- Una IP estática **o** un servicio DDNS (ver [sección Servidor en casa](#-servidor-en-casa--detrás-de-nat))
- Redireccionamiento de puertos en tu router
- Que tu máquina esté encendida las 24 horas

> ⚠️ **Aviso:** Muchos ISP bloquean los puertos entrantes 80/443. Compruébalo con tu ISP antes de invertir tiempo. Algunos ISP (especialmente de fibra) pueden darte una IP fija por un pequeño coste adicional.

---

### Opción 3 — Windows con WSL (Pruebas / Desarrollo)

Puedes ejecutar Nodyx en Windows 10/11 usando WSL2 (Subsistema de Windows para Linux). Es ideal para pruebas o desarrollo, pero no es la mejor opción para un servidor en producción 24/7.

→ [Ver la guía detallada de WSL más abajo](#-usuarios-de-windows--guía-wsl)

---

## 🌐 ¿Necesito un dominio?

**Respuesta corta: ¡No!** Para un VPS con `install.sh`, el instalador crea automáticamente un dominio gratuito `203-0-113-10.sslip.io` más unos alias fáciles de recordar `mi-comunidad.nodyx.org`. HTTPS funciona sin comprar nada.

**Para `install_tunnel.sh` (Cloudflare Tunnel)**, sí es necesario un dominio propio — los subdominios gratuitos como No-IP o DuckDNS no son compatibles.

> 📖 **[→ Guía completa de dominios: tipos, compatibilidad, árbol de decisión, dónde comprar](DOMAIN.md)**
>
> Explica por qué No-IP/DuckDNS no son compatibles con Cloudflare Tunnel, y una tabla comparativa completa de todas las opciones.

**Resumen rápido:**

| Situación | Solución |
|---|---|
| VPS, puertos 80/443 abiertos, sin dominio | `install.sh` → sslip.io + nodyx.org gratuito |
| VPS, puertos 80/443 abiertos, dominio propio | `install.sh` → introduce tu dominio |
| Servidor en casa, sin puertos abiertos, dominio CF | `install_tunnel.sh` |
| Servidor en casa, sin puertos abiertos, No-IP/DuckDNS | ❌ no compatible — [ver DOMAIN.md](DOMAIN.md) |
| Servidor en casa, sin puertos abiertos, sin dominio | Compra un dominio ~$1/año — [ver DOMAIN.md](DOMAIN.md) |

> 💡 **Truco para Cloudflare:** Si usas Cloudflare como proveedor DNS, activa la nube naranja (proxy) para HTTP/HTTPS — protección DDoS gratuita. **Desactiva el proxy (nube gris) para cualquier subdominio TURN** — las salas de voz no funcionarán a través del proxy de Cloudflare.

---

## 🔌 ¿Qué puertos abrir?

El script `install.sh` configura el firewall (UFW) automáticamente. Esto es lo que abre:

| Puerto | Protocolo | Servicio | ¿Obligatorio? |
|---|---|---|---|
| 22 | TCP | SSH | ✅ Sí (para gestionar tu servidor) |
| 80 | TCP | HTTP | ✅ Sí (verificación Let's Encrypt) |
| 443 | TCP | HTTPS | ✅ Sí (tu sitio web) |
| 3478 | TCP + UDP | TURN/STUN (relay de voz) | ✅ Sí (salas de voz) |
| 5349 | TCP + UDP | TURN/STUN sobre TLS | ⚠️ Opcional |
| 49152–65535 | UDP | Relay de medios WebRTC | ✅ Sí (salas de voz) |

> ❓ **¿Qué es un relay TURN?** Cuando dos usuarios quieren hablar en una sala de voz, necesitan una conexión directa (P2P). Si uno de ellos está detrás de un NAT (como una conexión 4G o una red corporativa), la conexión no puede establecerse directamente. El relay TURN actúa como intermediario — la voz pasa por tu servidor en lugar de hacerlo de forma directa. Solo se usa como alternativa cuando el P2P falla.

---

## 🚀 Instalación — La forma fácil (Recomendada)

### Paso 1 — Clona el repositorio

En tu servidor Linux (vía SSH):

```bash
git clone https://github.com/Pokled/Nodyx.git /opt/nodyx-install
cd /opt/nodyx-install
```

O descarga solo el script de instalación:

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh -o install.sh
```

### Paso 2 — Ejecuta el instalador

```bash
sudo bash install.sh
```

> 🔐 El script debe ejecutarse como root (o con sudo). Instala paquetes del sistema, configura el firewall y establece los servicios.

### Paso 3 — Responde a las preguntas

El instalador te preguntará:

```
? Nombre de la comunidad (ej. Linux Francia): Mi comunidad
? Identificador único de la URL [mi-comunidad]:
? Idioma principal (fr/en/de/es/it/pt) [en]:

  Dominio de la instancia
  ┌─ Si tienes un dominio (ej. midominio.com), introdúcelo abajo.
  └─ Si no, pulsa Enter → se usará automáticamente el dominio gratuito 203-0-113-10.sslip.io

? Dominio (pulsa Enter para usar un dominio gratuito): midominio.com   ← o Enter para sslip.io

? Nombre de usuario del administrador: alice
? Correo del administrador: alice@ejemplo.com
? Contraseña del administrador: ••••••••
```

> 💡 **¿Sin dominio?** Pulsa Enter — tu instancia estará accesible en `203-0-113-10.sslip.io` con HTTPS automático. Puedes cambiar a tu propio dominio más adelante.

Eso es todo. El script se encarga del resto automáticamente (≈ 3–10 minutos según la velocidad de tu servidor).

### Paso 4 — Espera y disfruta ☕

El instalador te mostrará un resumen al final:

```
╔══════════════════════════════════════════════════╗
║       ✔  ¡Nodyx instalado correctamente!         ║
╚══════════════════════════════════════════════════╝

  Instancia : https://midominio.com
  Admin     : alice / alice@ejemplo.com
  Voz       : Relay TURN en 203.0.113.10:3478

  Credenciales guardadas en: /root/nodyx-credentials.txt
```

> 💡 **El DNS tarda en propagarse por la red.** Tras apuntar tu dominio a la IP de tu servidor, puede tardar hasta 24–48 horas en propagarse por todo el mundo (en la práctica suele ser 5–30 minutos). Caddy obtendrá tu certificado SSL automáticamente en cuanto el DNS resuelva.

---

## 🪟 Usuarios de Windows — Guía WSL

WSL (Subsistema de Windows para Linux) te permite ejecutar Ubuntu directamente dentro de Windows. El `install.sh` de Nodyx funciona perfectamente dentro de WSL2.

### Paso 1 — Activa WSL2

Abre **PowerShell como Administrador** y ejecuta:

```powershell
wsl --install
```

Esto instala WSL2 y Ubuntu automáticamente. **Reinicia el PC** cuando se te indique.

> 💡 Si WSL ya está instalado, actualízalo: `wsl --update`

### Paso 2 — Abre Ubuntu

Tras reiniciar, busca **"Ubuntu"** en el menú Inicio y ábrelo. La primera vez te pedirá que crees un nombre de usuario y contraseña para Linux.

### Paso 3 — Actualiza Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
```

### Paso 4 — Instala Git (si hace falta)

```bash
sudo apt install -y git
```

### Paso 5 — Clona Nodyx

```bash
git clone https://github.com/Pokled/Nodyx.git
cd Nodyx
```

### Paso 6 — Ejecuta el instalador

```bash
sudo bash install.sh
```

> ⚠️ **Limitación de WSL:** Los servicios iniciados dentro de WSL no se reinician automáticamente con Windows. Para un servidor 24/7, usa un VPS o servidor Linux real. WSL es ideal para pruebas y desarrollo.

> 💡 **Acceder desde tu navegador Windows:** Una vez terminada la instalación, abre el navegador y ve a `http://localhost` — Nodyx estará ahí.

### Consejos específicos para WSL

- **Acceso a archivos:** Tus archivos de Windows están en `/mnt/c/Users/TuNombre/` dentro de WSL
- **Atajo para la terminal WSL:** En cualquier carpeta de Windows, escribe `wsl` en la barra de direcciones
- **Integración con VS Code:** Instala la extensión "WSL" para editar archivos directamente
- **Redireccionamiento de puertos:** Si quieres exponer WSL a tu red local, necesitas redirigir los puertos manualmente:
  ```powershell
  # Ejecutar como Administrador en PowerShell
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=80 connectaddress=$(wsl hostname -I)
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$(wsl hostname -I)
  ```

---

## 🏠 Servidor en casa / Detrás de NAT

Ejecutar Nodyx en una máquina en casa (detrás de tu router) requiere algunos pasos adicionales.

### Paso 1 — Encuentra tu IP pública

Ve a [whatismyip.com](https://whatismyip.com) — esta es la IP que ve el mundo exterior.

> ⚠️ **Problema:** La mayoría de ISP domésticos asignan **IPs dinámicas** — tu IP pública puede cambiar. Solución: usa un servicio DDNS.

### Paso 2 — Configura DDNS (si no tienes IP estática)

Un servicio DDNS (DNS Dinámico) asocia un nombre de host a tu IP actual y se actualiza automáticamente.

**Opciones gratuitas:**
- [DuckDNS](https://www.duckdns.org) — completamente gratuito, sencillo y fiable
- [No-IP](https://noip.com) — plan gratuito disponible
- [Dynu](https://dynu.com) — plan gratuito disponible

**Ejemplo con DuckDNS:**
1. Regístrate en duckdns.org
2. Crea un subdominio (ej. `mi-comunidad.duckdns.org`)
3. Instala el cliente de actualización automática en tu servidor:
   ```bash
   # Añadir al crontab (se actualiza cada 5 minutos)
   */5 * * * * curl -s "https://www.duckdns.org/update?domains=mi-comunidad&token=TU_TOKEN&ip=" > /dev/null
   ```

### Paso 3 — Redireccionamiento de puertos en tu router

Necesitas redirigir el tráfico desde tu router hacia tu servidor. El procedimiento varía según el modelo de router.

**Pasos generales:**
1. Entra en el panel de administración de tu router (normalmente `http://192.168.1.1` o `http://192.168.0.1`)
2. Busca la sección **Redireccionamiento de puertos** o **NAT**
3. Añade estas reglas:

| Puerto externo | Protocolo | IP interna | Puerto interno |
|---|---|---|---|
| 80 | TCP | `IP_LOCAL_DE_TU_SERVIDOR` | 80 |
| 443 | TCP | `IP_LOCAL_DE_TU_SERVIDOR` | 443 |
| 3478 | TCP+UDP | `IP_LOCAL_DE_TU_SERVIDOR` | 3478 |
| 49152–65535 | UDP | `IP_LOCAL_DE_TU_SERVIDOR` | 49152–65535 |

> 💡 **Encontrar la IP local de tu servidor:**
> ```bash
> ip addr show | grep 'inet ' | grep -v '127.0.0.1'
> # Normalmente algo como 192.168.1.42
> ```

> 💡 **Asigna una IP local fija a tu servidor:** En los ajustes de tu router, busca **Reserva de IP estática** o **Asignación de dirección fija**. Vincula la dirección MAC de tu servidor a una IP local fija (ej. `192.168.1.100`) para que nunca cambie.

### Paso 4 — CGNAT (NAT de nivel de operador)

Algunos ISP usan CGNAT — tu conexión doméstica comparte una IP pública con cientos de otros clientes. En este caso, el redireccionamiento de puertos es **imposible**.

**Cómo saber si estás detrás de CGNAT:**
```bash
# La IP WAN de tu router (en el panel de administración) vs tu IP pública (whatismyip.com)
# Si son diferentes → estás detrás de CGNAT
```

**Soluciones si estás detrás de CGNAT:**
1. **Pide a tu ISP** una IP pública real (a veces gratuita, a veces por unos €/mes)
2. **Usa un VPS barato como relay** — ejecuta Nginx en el VPS y tuneliza el tráfico a tu servidor doméstico vía SSH:
   ```bash
   # En tu servidor doméstico (crea un túnel inverso)
   ssh -R 80:localhost:80 -R 443:localhost:443 usuario@IP_VPS -N
   ```
3. **Usa Cloudflare Tunnel** — gratuito, sin redireccionamiento de puertos, sin VPS (pero Cloudflare ve tu tráfico)

---

## 🚇 Alojar en casa sin abrir puertos

¿Quieres ejecutar Nodyx en una Raspberry Pi (o un PC viejo) en casa, pero no quieres — o no puedes — abrir los puertos 80/443 en tu router? Sin problema, hay soluciones gratuitas y sencillas.

### ¿Por qué hacen falta puertos? (explicación para principiantes)

Imagina tu servidor como una casa. Para que visitantes de todo el mundo puedan llamar a tu timbre, necesitas:
1. Que tu casa tenga una **dirección visible** (IP pública)
2. Que la **puerta esté abierta** (puertos 80 y 443 redirigidos desde tu router a tu servidor)

Si no quieres abrir esas puertas, usas un **túnel** — un intermediario que recibe a los visitantes por ti y los deja entrar por una entrada de servicio que tú controlas, sin exponer tu casa directamente.

> ⚠️ **Importante:** Sin HTTPS, **las salas de voz no funcionarán** — los navegadores se niegan a acceder al micrófono/cámara en HTTP sin cifrar. Es necesaria una solución con túnel para usar todas las funciones de Nodyx.

---

### ⚡ Solución 0 — Nodyx Relay *(nueva recomendación — sin requisitos previos)*

**Nodyx Relay** es la solución integrada de Nodyx. Sin cuenta de terceros, sin dominio, sin puertos abiertos.

| | Nodyx Relay | Cloudflare Tunnel |
|---|---|---|
| Cuenta de terceros necesaria | ❌ No | ✅ Cloudflare |
| Dominio necesario | ❌ No | ✅ Sí (~€1/año) |
| URL que obtienes | `mi-comunidad.nodyx.org` | `mi-comunidad.midominio.com` |
| Incluido en `install.sh` | ✅ Sí (opción 2) | 🔧 Script separado |
| Código abierto | ✅ Sí | ❌ No |

**Cómo activarlo:** durante la instalación con `install.sh`, elige simplemente la opción `[2] Nodyx Relay`. Eso es todo.

> 📖 [→ Guía completa de Nodyx Relay](RELAY.md)

---

### 🌩️ Solución 1 — Cloudflare Tunnel *(alternativa si ya tienes un dominio en CF)*

Cloudflare Tunnel crea una conexión **saliente** desde tu servidor hacia los servidores de Cloudflare. Sin puertos que abrir. Cloudflare recibe a los visitantes y los reenvía a tu servidor a través de este túnel.

**Lo que necesitas:**
- Una cuenta gratuita de Cloudflare → [dash.cloudflare.com](https://dash.cloudflare.com)
- Un dominio (~$1/año en [Porkbun](https://porkbun.com) o [Namecheap](https://namecheap.com))

> 💡 ¿Sin dominio? Nodyx te da uno gratis: durante la instalación, tu instancia obtiene automáticamente un subdominio **`mi-comunidad.nodyx.org`**. Sin necesidad de comprar nada.

---

> 🚀 **¡`install_tunnel.sh` automatiza toda la configuración!**
>
> Una vez lista tu cuenta de Cloudflare y tu dominio **(solo el Paso 1 de abajo)**, ejecuta simplemente:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh -o install_tunnel.sh
> sudo bash install_tunnel.sh
> ```
>
> El script se encarga de todo:
> - Detecta la arquitectura de tu servidor (arm64, amd64…)
> - Instala Nodyx completamente (PostgreSQL, Redis, coturn, PM2…)
> - Descarga e instala `cloudflared`
> - Te guía paso a paso por el inicio de sesión en Cloudflare (una URL que abrir en el navegador)
> - Crea el túnel, genera `config.yml` y registra el DNS automáticamente
> - Instala el servicio systemd y verifica que todo funciona
>
> **Los pasos 2–9 de abajo son solo de referencia** — útiles para entender qué está pasando, pero no hace falta ejecutarlos manualmente.

---

#### Paso 1 — Crea una cuenta en Cloudflare

1. Ve a [dash.cloudflare.com](https://dash.cloudflare.com) y crea una cuenta gratuita
2. Haz clic en **"Add a site"** e introduce tu dominio
3. Elige el plan **Free** ($0/mes)
4. Cloudflare te da dos **servidores DNS** (ej. `aria.ns.cloudflare.com`)
5. Ve al panel de tu registrador (donde compraste el dominio) y reemplaza los servidores DNS por los de Cloudflare
6. Espera entre 5 y 30 minutos a que se propague (Cloudflare te avisará por correo)

#### Paso 2 — Instala `cloudflared` en tu servidor

En tu Raspberry Pi / servidor Ubuntu/Debian:

```bash
# Descarga cloudflared (comprueba tu arquitectura: arm64 para Raspberry Pi 4, amd64 para PC)
# Raspberry Pi 4 (arm64):
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
     -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# PC normal (amd64):
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
     -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Verifica que funciona:
cloudflared --version
```

#### Paso 3 — Inicia sesión en Cloudflare

```bash
cloudflared tunnel login
```

👆 Este comando muestra una URL. **Cópiala** y ábrela en tu navegador. Inicia sesión en tu cuenta de Cloudflare y autoriza el acceso. Un archivo de certificado se descarga automáticamente en tu servidor (en `~/.cloudflared/cert.pem`).

#### Paso 4 — Crea el túnel

```bash
# Sustituye "mi-comunidad" por el nombre que quieras
cloudflared tunnel create mi-comunidad
```

Esto crea un archivo de configuración en `~/.cloudflared/`. Anota el **ID del túnel** que aparece (ej. `6ff42ae2-765d-4adf-8112-31c55c1551ef`).

#### Paso 5 — Configura el túnel

Crea el archivo de configuración:

```bash
nano ~/.cloudflared/config.yml
```

Pega este contenido (sustituye `ID_DEL_TÚNEL` por tu ID del Paso 4, y `midominio.com` por tu dominio):

```yaml
tunnel: ID_DEL_TÚNEL
credentials-file: /root/.cloudflared/ID_DEL_TÚNEL.json

ingress:
  # El frontend (interfaz web)
  - hostname: midominio.com
    service: http://localhost:4173
  # La API del backend
  - hostname: api.midominio.com
    service: http://localhost:3000
  # Ruta por defecto (obligatoria)
  - service: http_status:404
```

#### Paso 6 — Crea las entradas DNS

```bash
# Apunta midominio.com al túnel
cloudflared tunnel route dns mi-comunidad midominio.com

# Apunta api.midominio.com al túnel
cloudflared tunnel route dns mi-comunidad api.midominio.com
```

Estos comandos crean los registros DNS en Cloudflare automáticamente. No hace falta tocar el panel DNS manualmente.

#### Paso 7 — Inicia el túnel (prueba)

```bash
cloudflared tunnel run mi-comunidad
```

Si todo funciona, verás `INF Connection established` en los logs. Abre `https://midominio.com` en tu navegador — ¡Nodyx debería aparecer!

#### Paso 8 — Inicia el túnel automáticamente al arrancar

Para que el túnel arranque solo cuando tu servidor se reinicie:

```bash
# Instala cloudflared como servicio del sistema
cloudflared service install

# Activa e inicia el servicio
systemctl enable cloudflared
systemctl start cloudflared

# Comprueba que está funcionando
systemctl status cloudflared
```

#### Paso 9 — Configura Nodyx para usar este dominio

Durante la instalación, introduce tu dominio `midominio.com` cuando el instalador lo pida. Caddy se configurará, pero con Cloudflare Tunnel puedes **desactivar Caddy** (Cloudflare gestiona el HTTPS):

```bash
systemctl stop caddy
systemctl disable caddy
```

Luego configura Nodyx para escuchar en HTTP (no HTTPS) en localhost — el túnel de Cloudflare se encarga del cifrado.

> 💡 **Sobre las salas de voz:** Cloudflare Tunnel no soporta UDP, así que **las salas de voz usarán tu relay TURN** en la IP de tu servidor. Para que funcione, el puerto **3478 UDP** debe estar abierto en tu router. Es el único puerto estrictamente necesario para la voz. Si no puedes abrirlo, la voz seguirá funcionando pero en modo relay TCP (latencia ligeramente mayor).

---

### 🦎 Solución 2 — Tailscale Funnel *(gratis, sin dominio)*

Tailscale Funnel expone tu servidor a internet a través de la red de Tailscale, sin abrir puertos. Obtienes una URL HTTPS gratuita del tipo `https://miserv.tail1234.ts.net`.

**Lo que necesitas:**
- Una cuenta gratuita de Tailscale → [tailscale.com](https://tailscale.com)

#### Paso 1 — Instala Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

#### Paso 2 — Inicia sesión

```bash
tailscale up
```

Aparece un enlace → ábrelo en tu navegador e inicia sesión en tu cuenta de Tailscale.

#### Paso 3 — Activa Funnel

```bash
# Expone el frontend (puerto 4173) a internet
tailscale funnel 4173
```

Tailscale te da una URL HTTPS pública (ej. `https://miserv.tail1234.ts.net`). Usa esta URL durante la instalación de Nodyx cuando te pida el dominio.

> ⚠️ **Limitaciones de Tailscale Funnel:** La URL gratuita es en `.ts.net` (no personalizable sin suscripción) y el ancho de banda está limitado en el plan gratuito. Adecuado para una comunidad pequeña o para pruebas.

---

### 🖥️ Solución 3 — Un VPS pequeño *(la más sencilla y fiable)*

Siendo honestos, para una comunidad seria accesible 24/7, **un VPS es la mejor opción**. Cuesta menos que una suscripción a Netflix y evita todos estos líos con túneles.

| Proveedor | Precio/mes | Especificaciones | Ideal para |
|---|---|---|---|
| [Hetzner](https://hetzner.com/cloud) | €3,29 | 2 vCPU, 4 GB RAM | ✅ Comunidad pequeña (recomendado) |
| [Hetzner](https://hetzner.com/cloud) | €5,39 | 2 vCPU, 8 GB RAM | ✅ Comunidad activa |
| [OVH VPS](https://ovhcloud.com/en/vps/) | €3,99 | 1 vCPU, 2 GB RAM | ✅ Principiante, servidor UE |
| [Scaleway](https://scaleway.com) | €3,60 | 2 vCPU, 2 GB RAM | ✅ Centro de datos Francia/Europa |

Con un VPS:
- IP pública fija incluida
- Puertos 80/443 abiertos por defecto
- `bash install.sh` y listo en 10 minutos
- Disponibilidad 24/7 garantizada

---



## 🔒 Detrás de una VPN o WireGuard

### Ejecutar Nodyx detrás de una VPN tradicional (NordVPN, ExpressVPN, etc.)

Si tu servidor se conecta a una VPN (poco habitual, pero posible), todo el tráfico saliente pasa por la VPN. Esto crea dos problemas:
- Tu servidor TURN anuncia la IP de la VPN, no la IP real de tu servidor
- Let's Encrypt no puede llegar a tu servidor para la verificación HTTP

**Solución:** Configura la VPN para excluir el tráfico local y no enrutar los servicios públicos del servidor a través de la VPN.

En la mayoría de los casos, **no ejecutes una VPN personal en la misma máquina que Nodyx**. Úsala solo en los dispositivos cliente.

---

### Malla P2P con WireGuard (Federación Nodyx — Fase 3)

> 🔭 **Esto llegará en la Fase 3** — los nodos Nodyx formarán automáticamente una malla WireGuard, haciendo la red verdaderamente descentralizada y resiliente.

Hoy en día, cada instancia de Nodyx es independiente. En el futuro, las instancias se conectarán mediante túneles WireGuard para:
- Compartir datos de federación (directorio de instancias)
- Enrutar tráfico entre comunidades
- Hacer la red resiliente ante fallos individuales

**Si ya ejecutas WireGuard en tu servidor** (ej. como VPN personal o entre servidores), ten cuidado:

1. **Asegúrate de que los servicios de Nodyx escuchan en la interfaz correcta** — el script escucha en `0.0.0.0` por defecto (todas las interfaces), lo cual es correcto
2. **Reglas del firewall** — UFW está configurado para permitir los puertos necesarios en todas las interfaces. Si usas WireGuard con enrutamiento estricto, puede que necesites añadir reglas para la interfaz WireGuard (`wg0`) manualmente:
   ```bash
   sudo ufw allow in on wg0 to any port 3478
   ```
3. **IP externa del TURN** — `install.sh` detecta automáticamente tu IP pública a través de `api.ipify.org`. Si tu servidor enruta el tráfico saliente por WireGuard, esto podría devolver la IP del par WireGuard en lugar de la IP real de tu servidor. Corrígelo:
   ```bash
   # Edita /etc/turnserver.conf
   # Cambia external-ip= por tu IP pública real
   sudo systemctl restart coturn
   ```

---

## ❌ Errores comunes y soluciones

### 🔴 "Address already in use" en el puerto 80 o 443

Otro servicio está usando el puerto (normalmente Apache u otra instancia de Nginx).

```bash
# Encontrar qué usa el puerto 80
sudo lsof -i :80
sudo lsof -i :443

# Detener Apache si está presente
sudo systemctl stop apache2
sudo systemctl disable apache2

# Luego reiniciar Caddy
sudo systemctl restart caddy
```

---

### 🔴 El dominio no resuelve / El certificado SSL falla

Caddy intenta obtener un certificado SSL de Let's Encrypt al arrancar. Si tu dominio aún no apunta al servidor, esto falla.

```bash
# Comprobar si tu dominio resuelve a tu servidor
dig +short tudominio.com
# Debería devolver la IP de tu servidor

# Revisar los logs de Caddy para ver errores
sudo journalctl -u caddy -f

# Forzar a Caddy a reintentar
sudo systemctl restart caddy
```

> ⏳ **El DNS tarda en propagarse por la red** — si acabas de cambiar el DNS, espera entre 5 y 30 minutos e inténtalo de nuevo.

---

### 🔴 El backend no arranca (puerto 3000)

Consulta los logs de PM2:

```bash
pm2 logs nodyx-core --lines 50
```

Causas frecuentes:
- **Contraseña de base de datos incorrecta** — comprueba `/opt/nodyx/nodyx-core/.env`
- **PostgreSQL no está en ejecución** — `sudo systemctl start postgresql`
- **Redis no está en ejecución** — `sudo systemctl start redis-server`
- **Puerto 3000 ya en uso** — `sudo lsof -i :3000`

---

### 🔴 Las salas de voz muestran "Relay (TURN)" en lugar de "P2P" para algunos usuarios

Esto es **normal y esperado**. Los usuarios detrás de NAT (redes corporativas, 4G, algunos ISP) no pueden establecer conexiones P2P directas. El relay TURN es la alternativa — funciona correctamente, simplemente usa el ancho de banda de tu servidor.

El P2P real solo funciona cuando ambos usuarios tienen IPs públicas accesibles o tipos de NAT compatibles.

---

### 🔴 El relay TURN no funciona en absoluto (las salas de voz fallan completamente)

```bash
# Comprobar que coturn está en ejecución
sudo systemctl status coturn

# Revisar los logs de coturn
tail -f /var/log/coturn.log

# Probar la conectividad TURN (desde tu máquina local)
# Usa https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# Introduce: turn:IP_DE_TU_SERVIDOR:3478 / usuario: nodyx / credencial: TU_CREDENCIAL
```

> 💡 **Usuarios de Cloudflare:** Si tu dominio está proxificado por Cloudflare, el puerto 3478 no funcionará a través del nombre de dominio. `install.sh` usa la **dirección IP directa** de tu servidor para la URL TURN (`turn:IP:3478`) para evitar esto automáticamente.

---

### 🔴 "Failed to fetch" al subir avatar o banner

Comprueba que Caddy enruta `/uploads/*` al puerto 3000:

```bash
cat /etc/caddy/Caddyfile
# Debería contener: reverse_proxy /uploads/* localhost:3000
```

---

### 🔴 El frontend muestra una página en blanco o errores de SvelteKit

```bash
pm2 logs nodyx-frontend --lines 50
```

Causas frecuentes:
- La compilación del frontend falló — recompila: `cd /opt/nodyx/nodyx-frontend && npm run build && pm2 restart nodyx-frontend`
- `PUBLIC_API_URL` incorrecto en `.env` — debe ser `https://tudominio.com` (sin `/api/v1`)

---

## 🎛️ Tras la instalación

### Primer acceso

1. Abre `https://tudominio.com` en tu navegador
2. Inicia sesión con las credenciales de administrador que estableciste durante la instalación
3. Eres el **propietario** de la comunidad — tienes acceso completo al panel de administración

### Panel de administración

Accede a él desde el menú → **Admin** (visible solo para propietarios y administradores).

Desde el panel de administración puedes:
- Subir el logo y el banner de la comunidad
- Crear categorías del foro
- Crear salas de voz
- Gestionar miembros (ascender, expulsar, asignar rangos)
- Configurar la descripción de la comunidad

### Invita a tus primeros miembros

Comparte la URL de tu instancia. Los nuevos usuarios pueden registrarse en `https://tudominio.com/auth/register`.

Para ascender a alguien a moderador o administrador:
1. Panel de administración → **Miembros**
2. Encuentra al usuario → **Editar rol**
3. Elige: `miembro`, `moderador` o `administrador`

---

## 💡 Trucos y consejos

### Comandos útiles

```bash
# Ver el estado de todos los servicios
pm2 list

# Ver logs del backend (en tiempo real)
pm2 logs nodyx-core

# Ver logs del frontend
pm2 logs nodyx-frontend

# Reiniciar todo
pm2 restart all

# Recompilar y reiniciar tras una actualización
cd /opt/nodyx/nodyx-core && npm run build && pm2 restart nodyx-core
cd /opt/nodyx/nodyx-frontend && npm run build && pm2 restart nodyx-frontend

# Comprobar Caddy (HTTPS/proxy)
sudo systemctl status caddy
sudo journalctl -u caddy -f

# Comprobar coturn (relay de voz)
sudo systemctl status coturn
tail -f /var/log/coturn.log

# Comprobar el uso del disco
df -h

# Comprobar el uso de memoria
free -h

# Ver quién está conectado por SSH
who
```

### Protege tu servidor

```bash
# Cambiar el puerto SSH (opcional, reduce el ruido)
# Edita /etc/ssh/sshd_config → Port 2222
sudo systemctl restart sshd

# Deshabilitar el acceso root por SSH (usa un usuario normal + sudo)
# Edita /etc/ssh/sshd_config → PermitRootLogin no

# Comprobar fail2ban (bloquea intentos de fuerza bruta)
sudo apt install -y fail2ban
sudo systemctl enable fail2ban --now
```

### Copias de seguridad

```bash
# Copia de seguridad de la base de datos PostgreSQL
sudo -u postgres pg_dump nodyx > /backup/nodyx_$(date +%Y%m%d).sql

# Copia de seguridad de los archivos subidos (avatares, banners)
tar -czf /backup/uploads_$(date +%Y%m%d).tar.gz /opt/nodyx/nodyx-core/uploads/

# Automatizar con una tarea cron diaria
crontab -e
# Añadir: 0 3 * * * sudo -u postgres pg_dump nodyx > /backup/nodyx_$(date +%Y%m%d).sql
```

### Actualizar Nodyx

```bash
cd /opt/nodyx
git pull

# Recompilar el backend
cd nodyx-core && npm install && npm run build && pm2 restart nodyx-core

# Recompilar el frontend
cd ../nodyx-frontend && npm install && npm run build && pm2 restart nodyx-frontend
```

> 💡 **Las migraciones se aplican automáticamente** — el backend ejecuta las nuevas migraciones SQL al arrancar.

---

## 🗑️ Desinstalación completa

Si quieres eliminar Nodyx completamente de tu servidor:

```bash
# 1. Detener y eliminar los procesos PM2
pm2 delete nodyx-core nodyx-frontend
pm2 save

# 2. Eliminar el arranque automático de PM2
pm2 unstartup systemd

# 3. Eliminar el directorio de Nodyx
rm -rf /opt/nodyx

# 4. Eliminar la base de datos y el usuario de PostgreSQL
sudo -u postgres psql -c "DROP DATABASE IF EXISTS nodyx;"
sudo -u postgres psql -c "DROP ROLE IF EXISTS nodyx_user;"

# 5. Eliminar la configuración de Caddy
sudo rm -f /etc/caddy/Caddyfile
sudo systemctl restart caddy

# 6. Detener y deshabilitar coturn
sudo systemctl stop coturn
sudo systemctl disable coturn
sudo rm -f /etc/turnserver.conf

# 7. Eliminar las reglas del firewall (opcional)
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw --force enable

# 8. Eliminar el archivo de credenciales
rm -f /root/nodyx-credentials.txt
```

> ⚠️ **Los archivos subidos** (avatares, banners, etc.) están en `/opt/nodyx/nodyx-core/uploads/`. Haz una copia de seguridad antes de eliminar si quieres conservar los archivos de los usuarios.

### Desinstalar paquetes del sistema (opcional)

Solo hazlo si instalaste estos paquetes exclusivamente para Nodyx:

```bash
# Eliminar coturn
sudo apt-get remove --purge -y coturn

# Eliminar Caddy
sudo apt-get remove --purge -y caddy
sudo rm -f /etc/apt/sources.list.d/caddy-stable.list

# Eliminar Redis (solo si ningún otro servicio lo usa)
sudo apt-get remove --purge -y redis-server

# Eliminar PostgreSQL (PELIGRO: elimina todas las bases de datos de este servidor)
# sudo apt-get remove --purge -y postgresql postgresql-contrib
# sudo rm -rf /var/lib/postgresql/

# Eliminar Node.js
# sudo apt-get remove --purge -y nodejs
```

---

## 🆘 ¿Sigues atascado?

- Consulta los [Issues abiertos](https://github.com/Pokled/Nodyx/issues)
- Abre una [Discusión](https://github.com/Pokled/Nodyx/discussions)
- Lee la [documentación de arquitectura](./ARCHITECTURE.md) para entender cómo encajan las piezas

---

*Guía de instalación de Nodyx — v0.4.1 — marzo 2026*
