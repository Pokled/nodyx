# 🌐 Nodyx — Guía completa de dominios

> Esta guía responde a la pregunta que todo el mundo hace al instalar Nodyx:
> **"¿Necesito un dominio? ¿Cuál? ¿Por qué no me funciona mi No-IP?"**

---

## Tabla de contenidos

- [Los 3 tipos de "dominio"](#-los-3-tipos-de-dominio)
- [Tabla de compatibilidad](#-tabla-de-compatibilidad)
- [Árbol de decisión](#-árbol-de-decisión--qué-script-debo-usar)
- [Por qué No-IP y DuckDNS no funcionan con CF Tunnel](#-por-qué-no-ip-duckdns-etc-no-funcionan-con-cloudflare-tunnel)
- [Dónde comprar un dominio barato](#-dónde-comprar-un-dominio-barato)
- [Configuración DNS](#-configuración-dns)

---

## 🧩 Los 3 tipos de "dominio"

Detrás de la palabra "dominio" se esconden tres realidades muy distintas, y confundirlas es la causa de la mayoría de los problemas.

### Tipo 1 — Dominio real (TLD)

> `micomunidad.com`, `clubdetejer.net`, `asociacion.org`

**Compras** este dominio a un registrador (Namecheap, OVH, Porkbun…). Es tuyo. Puedes cambiar sus **servidores DNS** libremente — es decir, controlas quién gestiona su DNS.

- ✅ Compatible con `install.sh`
- ✅ Compatible con `install_tunnel.sh` (Cloudflare Tunnel)
- ✅ Compatible con nodyx.org
- ✅ Estable, profesional, portable
- 💰 ~$1/año (`.xyz`, `.site`) a ~$15/año (`.com`, `.org`)

---

### Tipo 2 — Subdominio DNS dinámico gratuito (DDNS)

> `miserv.ddns.net` (No-IP), `micomunidad.duckdns.org` (DuckDNS), `miweb.mooo.com` (Afraid.org)

Obtienes un **subdominio** de un dominio que pertenece a No-IP, DuckDNS, etc. **No** eres propietario del dominio raíz (`ddns.net`, `duckdns.org`). Estos servicios están diseñados para apuntar un nombre de host a una IP que cambia frecuentemente (IP dinámica residencial).

- ✅ Compatible con `install.sh` *(solo con configuración manual de Caddy — no automatizado)*
- ❌ **Incompatible con `install_tunnel.sh`** — [ver por qué más abajo](#-por-qué-no-ip-duckdns-etc-no-funcionan-con-cloudflare-tunnel)
- ⚠️ Inestable si tu IP cambia (residencial sin IP estática)
- 🆓 Gratuito

---

### Tipo 3 — Subdominio proporcionado por Nodyx

> `mi-comunidad.nodyx.org` (a través del directorio Nodyx)
> `203-0-113-10.sslip.io` (a través de la IP pública del servidor)

> 💡 **¿Qué es sslip.io?** Un servicio DNS público que convierte IPs en dominios automáticamente: `203-0-113-10.sslip.io` resuelve a `203.0.113.10` sin ninguna cuenta ni configuración. Si tu IP pública es `203.0.113.10`, ese es tu dominio gratuito instantáneo.

Estos subdominios los proporciona **automáticamente** `install.sh`. Sin configuración necesaria.

- ✅ Compatible con `install.sh` (puertos 80/443 abiertos)
- ❌ **Incompatible con `install_tunnel.sh`** — `nodyx.org` es nuestra zona DNS, no la tuya
- ✅ Certificado HTTPS automático a través de Let's Encrypt (Caddy)
- 🆓 100% gratuito, sin configuración

---

## 📊 Tabla de compatibilidad

| Solución | `install.sh` | `install_tunnel.sh` | HTTPS automático | Estable en producción |
|---|:---:|:---:|:---:|:---:|
| **Dominio real de pago** (~$1/año) | ✅ | ✅ | ✅ | ✅ |
| **nodyx.org** (proporcionado por Nodyx) | ✅ | ❌ | ✅ | ✅ |
| **sslip.io** (automático desde la IP) | ✅ | ❌ | ✅ | ✅ (IP estática) |
| **No-IP / DuckDNS / Afraid** | ⚠️ manual | ❌ | ⚠️ manual | ⚠️ IP dinámica |
| **Freenom (.tk, .ml, .ga…)** | ❌ servicio cerrado | ❌ | ❌ | ❌ |
| **CF Quick Tunnel** (`trycloudflare.com`) | — | ⚠️ solo para pruebas | ✅ | ❌ URL cambia |

> **Leyenda:**
> ✅ Compatible y automatizado
> ⚠️ Posible pero con limitaciones o configuración manual
> ❌ Incompatible o no recomendado

---

## 🗺️ Árbol de decisión — ¿Qué script debo usar?

```
Quiero instalar Nodyx en mi servidor
│
├── ¿Puedo abrir los puertos 80 y 443 en mi router?
│   │
│   ├── SÍ → bash install.sh
│   │          │
│   │          ├── Tengo un dominio → introdúcelo durante la instalación
│   │          └── Sin dominio → sslip.io + nodyx.org gratuito
│   │                         → totalmente automático ✅
│   │
│   └── NO → bash install_tunnel.sh
│              │
│              ├── Tengo un dominio real gestionado por Cloudflare
│              │   → introdúcelo durante la instalación ✅
│              │
│              ├── Tengo un subdominio de No-IP / DuckDNS
│              │   → ❌ incompatible (no soy propietario del dominio raíz)
│              │   → Solución: compra un dominio real (~$1/año)
│              │
│              └── Sin dominio
│                  → Opción 1: compra un dominio (~$1/año) + CF Tunnel
│                  → Opción 2: abre los puertos 80/443 + install.sh
```

---

## ❓ Por qué No-IP, DuckDNS, etc. no funcionan con Cloudflare Tunnel

Es la pregunta más frecuente. La explicación es técnica pero fácil de entender.

### Cómo funciona Cloudflare Tunnel con el DNS

Cuando ejecutas `cloudflared tunnel route dns mi-tunel micomunidad.com`, el comando:

1. Se conecta a tu cuenta de Cloudflare
2. Accede a la **zona DNS** de `micomunidad.com` *(que gestionas en CF)*
3. Crea automáticamente un registro **CNAME**:
   ```
   micomunidad.com  →  CNAME  →  abc123.cfargotunnel.com
   ```
4. Los visitantes que van a `micomunidad.com` llegan a Cloudflare, que los redirige a través de tu túnel

### Por qué un subdominio DDNS lo bloquea todo

Imagina que tienes `micomunidad.duckdns.org`.

- La zona DNS de `duckdns.org` pertenece a **DuckDNS**, no a ti
- Tu cuenta de Cloudflare **no tiene acceso** a esa zona
- `cloudflared tunnel route dns` fallará con un error como:
  ```
  Error: failed to add route: code: 1003, reason: You do not own this domain
  ```

Es así de simple: **debes ser propietario del dominio raíz** para que Cloudflare pueda escribir registros DNS en él.

### El mismo problema con nodyx.org

`nodyx.org` es nuestro dominio. Su DNS lo gestiona nuestra instancia de Cloudflare, no la tuya. Aunque intentaras añadir una ruta de túnel, Cloudflare te diría que no eres su propietario.

### Por qué sslip.io tampoco funciona con CF Tunnel

`sslip.io` funciona mediante un mecanismo DNS especial: `203-0-113-10.sslip.io` resuelve automáticamente a `203.0.113.10`. Es un dominio público gestionado por sus creadores — tú no eres su propietario. El mismo razonamiento.

### La única solución real

Para `install_tunnel.sh`, necesitas un **dominio real que hayas comprado** y cuyos servidores DNS hayas transferido a Cloudflare. Es el requisito innegociable.

La buena noticia: los dominios se han vuelto muy asequibles.

---

## 💰 Dónde comprar un dominio barato

| Registrador | Extensiones | Precio orientativo | Ventaja |
|---|---|---|---|
| [Porkbun](https://porkbun.com) | `.xyz`, `.site`, `.app`, `.net`… | **~$0,95/año** (primer año) | El más barato, interfaz limpia |
| [Namecheap](https://namecheap.com) | `.com`, `.net`, `.org`… | ~$2–$10/año | Promociones frecuentes, privacidad WHOIS gratuita |
| [Cloudflare Registrar](https://cloudflare.com/products/registrar/) | `.com`, `.net`, `.org`… | A precio de coste (~$8/año) | Sin margen, DNS de CF nativo |
| [OVH](https://ovh.com) | `.com`, `.net`, `.eu`… | ~$7–$12/año | Proveedor europeo, soporte en español |
| [Gandi](https://gandi.net) | `.com`, `.org`, `.net`… | ~$15/año | Ético, centrado en la privacidad |

> 💡 **Truco:** Si vas a comprar un dominio para CF Tunnel, cómpralo directamente en **Cloudflare Registrar** — te saltarás el paso de "cambiar los servidores DNS" ya que se gestiona de forma nativa.

### Las extensiones más baratas para empezar

- `.xyz` → a menudo **< $1/año** el primer año
- `.site` → a menudo **< $1/año** el primer año
- `.app` → ~$1/año, ventaja añadida: Google exige HTTPS de forma nativa
- `.com` → ~$8–10/año, la extensión más reconocida

---

## 🛠️ Configuración DNS

### Con `install.sh` — Registro A clásico

Una vez que tienes un dominio, añade estos registros en el panel DNS de tu registrador:

```
Tipo   Nombre   Valor          TTL
A      @        IP_SERVIDOR    300
A      www      IP_SERVIDOR    300
```

Sustituye `IP_SERVIDOR` por la IP pública de tu servidor (que aparece al inicio de `install.sh`).

> ⚠️ Si tu dominio está proxificado por Cloudflare (nube naranja), el puerto TURN 3478 no será accesible por nombre de dominio. `install.sh` usa la IP directa para la URL TURN — esto es intencionado y correcto.

### Con `install_tunnel.sh` — CNAME automático

**No hay que configurar nada manualmente.** El script crea el CNAME automáticamente mediante `cloudflared tunnel route dns`. Lo único que debes hacer es añadir tu dominio a Cloudflare con sus servidores DNS (Paso 1 de la guía de CF Tunnel).

---

## 📎 Enlaces útiles

- [Guía de instalación completa](INSTALL.md)
- [Sección Cloudflare Tunnel en INSTALL.md](INSTALL.md#-alojar-en-casa-sin-abrir-puertos)
- [Cloudflare Registrar](https://cloudflare.com/products/registrar/)
- [Porkbun — dominios asequibles](https://porkbun.com)
- [¿Qué es sslip.io?](https://sslip.io)
