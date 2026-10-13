# Instalar Nodyx

Un comando, unas cuantas preguntas, y tu comunidad tiene casa. Esta guía te acompaña desde la elección de la máquina hasta tu primera noche con tus miembros.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

De verdad, eso es todo. El resto de la página explica lo que ocurre, las decisiones que te van a pedir y qué hacer si algo se atasca.

---

## En resumen

| Paso | Lo que haces | Tiempo |
|---|---|---|
| 1. Una máquina | Un VPS pequeño, una Raspberry Pi, un portátil viejo | 10 minutos para alquilar uno |
| 2. El comando | Ejecutar la línea de arriba como root | Unos segundos |
| 3. Las preguntas | El nombre, la cuenta de administrador, cómo te encuentran | Unos 2 minutos |
| 4. La espera | El instalador construye y arranca todo | Unos minutos, más en una Raspberry Pi |
| 5. Tu comunidad | Entrar, elegir un ambiente, invitar a gente | Todo el tiempo que quieras |

---

## 1. Elegir una máquina

Nodyx funciona en **Ubuntu 22.04 o 24.04**, o **Debian 11, 12 o 13**, de 64 bits (x86 o ARM64). Necesitas `curl` y acceso root (ni siquiera hace falta `sudo`).

| Máquina | Memoria | Para quién |
|---|---|---|
| Raspberry Pi 4 o 5, portátil viejo | 1 a 2 GB | Una comunidad pequeña, en casa |
| VPS pequeño | 2 a 4 GB | La mayoría de las comunidades |
| VPS más grande | 4 GB o más | Salas de voz animadas, muchos miembros |

Con menos de 1,5 GB de memoria, el instalador pasa solo a un modo económico: límites de memoria más bajos y un archivo de intercambio si no hay suficiente. En una Raspberry Pi, usa un sistema de **64 bits** (Raspberry Pi OS de 64 bits o Ubuntu ARM64).

> **Consejo.** Un servidor recién estrenado es lo más sencillo. Nodyx instala su propio servidor web (Caddy), su base de datos (PostgreSQL) y su caché (Redis); si ya hay un servidor web como nginx o Apache en la máquina, el instalador te avisa y te pregunta antes de tocar nada.

---

## 2. Cómo te van a encontrar

Es la única decisión de verdad. El instalador te la pregunta, pero conviene saber la respuesta antes de empezar.

| Si... | Elige | Obtienes |
|---|---|---|
| La máquina está en casa, detrás de un router | **Relé Nodyx** (recomendado) | `tuclub.nodyx.org`, sin abrir puertos, sin comprar dominio |
| Tienes un dominio y un servidor con los puertos 80 y 443 abiertos | **Tu propio dominio** | `tucomunidad.com`, HTTPS con Let's Encrypt, control total |
| Los puertos 80 y 443 están abiertos pero no tienes dominio | **sslip.io** | Una dirección automática y gratuita a partir de tu IP |
| Ya usas Cloudflare Tunnel o Pangolin | El **instalador de túnel** | Tu dominio, por tu túnel, sin abrir puertos |

El **relé Nodyx**, escrito en Rust, conecta tu servidor con el relé usando solo conexiones salientes: nada que configurar en el router. El sitio, el chat y la voz en grupos pequeños funcionan. Las salas de voz grandes y la pantalla compartida para mucha gente pasan por un servidor de difusión (SFU) que todavía tiene que ser accesible desde internet; que funcione también desde casa es el próximo gran trabajo de la hoja de ruta.

Para un túnel, sigue mejor la guía dedicada: **[Instalar detrás de un túnel](../en/INSTALL-TUNNEL.md)** (en inglés).

---

## 3. Lanzar el instalador

Como root, o con `sudo`:

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

¿Prefieres leer el script antes? Clona el repositorio y ejecútalo desde ahí:

```bash
git clone https://github.com/Pokled/nodyx.git
cd nodyx
sudo bash install.sh
```

### Las preguntas que hace

| Pregunta | Qué responder |
|---|---|
| Nombre de la comunidad | Lo que verán tus miembros, por ejemplo *Los Búhos* |
| Identificador (slug) | Corto, en minúsculas, se usa en las direcciones, por ejemplo `buhos`. En modo relé se convierte en `buhos.nodyx.org`, y el instalador comprueba que esté libre antes de seguir |
| Idioma, descripción, país | El idioma de la comunidad; descripción y país son opcionales, pulsa Intro para saltarlos |
| Modo de red | Relé, tu propio dominio o sslip.io (ver arriba) |
| Dominio | Solo para «tu propio dominio» |
| Cuenta de administrador | Nombre de usuario, correo y una contraseña de al menos 8 caracteres |
| Correo (SMTP) | Opcional. Sin él, Nodyx funciona, solo que no envía correos (una contraseña perdida se recupera con `nodyx-recover`, ver más abajo) |
| Directorio público | Opcional. Di que sí para aparecer en [nodyx.org/discover](https://nodyx.org/discover) y que te encuentren desde otras comunidades |

Cada confirmación entiende sí y no (`y/n`, `o/n`, `yes/no`, `oui/non`) y vuelve a preguntar si la respuesta no está clara. Un Intro despistado nunca destruye nada.

### Y se pone a trabajar

Instala Node.js, PostgreSQL, Redis, Caddy, PM2 y los componentes de voz en Rust, genera todos los secretos, crea la base de datos, construye Nodyx, crea tu cuenta de administrador y configura el cortafuegos. La regla que permite SSH se pone **antes** de encender el cortafuegos, en el puerto que tu SSH usa de verdad: es imposible quedarte fuera de tu propio servidor.

Al final, un resumen muestra tu dirección y el estado de cada servicio. Banner verde: todo ha respondido. Banner rojo: algo merece un vistazo, con el comando exacto que hay que lanzar.

> **Importante.** Tu contraseña de administrador **no** se guarda en el disco. Apúntala en un lugar seguro. Si la pierdes, `sudo nodyx-recover` te devuelve el acceso.

---

## 4. Tu primera noche

Abre tu dirección, entra con la cuenta de administrador y haz tuyo el sitio:

1. **Elige un ambiente.** Administración → Apariencia: catorce estilos listos, o tus propios colores. Nadie ve nada hasta que publicas.
2. **Monta la página de inicio.** Administración → Homepage: filas, columnas y widgets, con vista previa en escritorio, tableta y móvil.
3. **Abre las puertas.** Unas categorías de foro, un canal de texto, un canal de voz.
4. **Escribe el primer mensaje.** Un anuncio que diga para qué es este lugar.
5. **Invita a gente.** Comparte la dirección. Es el momento en que un servidor se convierte en comunidad.

---

## Instalación desatendida

Para un script, Ansible o una CI, cada pregunta tiene su opción:

```bash
sudo bash install.sh --yes \
  --network=relay \
  --name="Los Búhos" --slug=buhos \
  --admin-user=admin --admin-email=admin@ejemplo.com \
  --admin-password-file=/root/contrasena-admin.txt
```

- `--yes` acepta las respuestas por defecto; una pregunta sin valor por defecto ni opción detiene el instalador limpiamente y dice cuál es.
- `--network=direct|relay|sslip`; `--domain=...` solo implica `direct`.
- Pasa los secretos por archivo (`--admin-password-file`), no en la línea de comandos, donde cualquier usuario del servidor podría leerlos.
- `--no-turn`, `--no-sfu`, `--no-subdomain`, `--lang=en|fr`: la lista completa con `bash install.sh --help`.

---

## Vivir con tu instancia

Tres comandos cubren casi todo:

```bash
sudo nodyx-update    # pasar a la última versión
sudo nodyx-doctor    # comprobar que cada servicio está bien
sudo nodyx-recover   # recuperar el acceso a una cuenta de administrador perdida
```

**La actualización** primero respalda y comprueba la base de datos, y luego construye la nueva versión al lado de la que está funcionando. El sitio solo cambia cuando todo se ha construido; si algo falla, sigue funcionando con la versión anterior, intacta. No pueden ejecutarse dos actualizaciones a la vez. Las cinco copias de actualización más recientes se guardan en `/root/nodyx-db-backup-upgrade-*.sql.gz`.

**Los registros**, cuando quieras ver qué pasa:

```bash
sudo -u nodyx pm2 logs nodyx-core       # la API
sudo -u nodyx pm2 logs nodyx-frontend   # la aplicación web
sudo journalctl -u caddy -n 50          # HTTPS y el proxy
sudo systemctl status nodyx-turn nodyx-sfud nodyx-relay-client
```

Nodyx funciona con su propio usuario del sistema, `nodyx`: usa `sudo -u nodyx pm2 ...`, no `pm2` como root.

**La desinstalación** quita Nodyx, y solo Nodyx: un Caddyfile que sirve también otros sitios no se modifica, las claves Redis de otras aplicaciones y tus reglas de cortafuegos no se tocan. Primero ofrece respaldar la base de datos, los archivos subidos y la configuración, y se detiene sin borrar nada si ese respaldo falla. Pruébala primero en seco:

```bash
sudo bash /opt/nodyx/uninstall.sh --dry-run
```

---

## Los puertos, si gestionas tu cortafuegos

Con el **relé Nodyx** no se abre nada: el instalador solo se asegura de que SSH siga permitido.

Con **tu propio dominio** o **sslip.io**, el instalador abre:

| Puerto | Protocolo | Para |
|---|---|---|
| 80, 443 | TCP | El sitio (HTTPS) |
| 3478, 5349 | TCP y UDP | El relé de voz (TURN), para miembros detrás de redes estrictas |
| 49152 a 65535 | UDP | El tráfico del relé de voz |
| 40000 a 40999 | UDP y TCP | El SFU: salas de voz grandes y pantalla compartida |

Si tu servidor está detrás del cortafuegos del proveedor (Hetzner, OVH, grupos de seguridad de AWS…), abre también allí esos puertos.

---

## Cuando algo se atasca

Empieza por `sudo nodyx-doctor`: comprueba cada servicio y te dice cuál falla. Después:

**«Address already in use» en el puerto 80 o 443.** Otro servidor web ocupa el puerto. El instalador detecta nginx y Apache y te pregunta antes de pararlos; si dijiste que no, páralo tú, o elige el relé Nodyx, que no necesita ninguno de los dos puertos.

**El certificado HTTPS no llega.** Comprueba que tu dominio apunta al servidor (`getent hosts tudominio.com` debe mostrar su IP) y lee `sudo journalctl -u caddy -n 50`. Un dominio comprado hace unos minutos puede tardar un poco en conocerse en todas partes.

**El nombre del relé ya está cogido.** El instalador lo comprueba antes de empezar y te pide otro: elige otro identificador.

**El sitio muestra un error después de una actualización.** No debería: una actualización fallida mantiene la versión anterior en línea. Lanza `sudo nodyx-doctor` y mira `sudo -u nodyx pm2 logs nodyx-core`.

**Algunos miembros no pueden entrar en la voz.** La voz pasa primero en directo entre los participantes, y después por el relé TURN. Con tu propio dominio, comprueba que los puertos TURN y SFU de arriba están abiertos, también en tu proveedor.

**Una Debian mínima (sin `sudo`, sin `curl`).** Instala primero `curl` (`apt install curl` como root); el instalador se encarga del resto.

---

## ¿Sigues atascado?

Abre una issue en [GitHub](https://github.com/Pokled/nodyx/issues) con la salida de `sudo nodyx-doctor`, o ven a preguntar a [nodyx.org](https://nodyx.org). Quienes han avisado de errores del instalador están en nuestro [salón de la fama](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md): un buen aviso de error es una contribución.
