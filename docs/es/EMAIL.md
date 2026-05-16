# 📧 Nodyx — Configurar el correo electrónico

> **Resumen rápido:** Nodyx funciona perfectamente sin correo configurado. Pero si un miembro olvida su contraseña, tendrás que enviarle manualmente el enlace de restablecimiento. Configurar el correo lo hace automáticamente.

---

## ¿Para qué sirve?

Nodyx envía correos en dos situaciones:

- **Contraseña olvidada** — un miembro hace clic en "Olvidé mi contraseña" y recibe un enlace seguro por correo
- **Correo de bienvenida** *(opcional)* — un mensaje de bienvenida al registrarse

Eso es todo. Nodyx no envía boletines, spam ni notificaciones por correo.

---

## ¿Es obligatorio?

**No.** Sin correo configurado:

- Nodyx funciona con normalidad
- Los restablecimientos de contraseña no se envían automáticamente
- Como administrador, puedes generar un enlace de restablecimiento desde el panel de administración → Miembros → "Restablecer contraseña"

---

## Cómo configurarlo

Necesitas tres datos de tu proveedor de correo:

- **Dirección del servidor SMTP** (ej. `smtp.brevo.com`)
- **Tu usuario** (normalmente tu dirección de correo)
- **Tu contraseña SMTP** (atención: puede no ser tu contraseña habitual — algunos servicios generan una contraseña específica para aplicaciones)

Abre el archivo `.env` en la carpeta `nodyx-core` y añade estas líneas:

```bash
SMTP_HOST=smtp.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu@correo.com
SMTP_PASS=tu_contraseña_smtp
SMTP_FROM=noreply@midominio.com   # opcional — usa SMTP_USER si no se define
```

Luego reinicia Nodyx:

```bash
pm2 restart nodyx-core
```

---

## ¿Qué proveedor elegir?

No necesitas un servidor de correo dedicado. Una cuenta con un proveedor de correo transaccional es suficiente — la mayoría tienen un plan gratuito más que suficiente para una comunidad pequeña.

### Brevo *(recomendado — gratuito, empresa francesa)*

**¿Por qué Brevo?**
Empresa francesa, conforme con el RGPD, 300 correos/día gratis. Más que suficiente para una comunidad de unos cientos de miembros.

1. Crea una cuenta en [brevo.com](https://www.brevo.com)
2. Ve a **Configuración → SMTP & API → SMTP**
3. Haz clic en **"Generar una nueva contraseña SMTP"**
4. Copia los datos en tu `.env`:

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu@correo.com
SMTP_PASS=la_contraseña_generada
```

---

### Mailjet *(gratuito, empresa francesa)*

1. Crea una cuenta en [mailjet.com](https://www.mailjet.com)
2. Ve a **Configuración de cuenta → Configuración SMTP**
3. Copia la clave API y la clave secreta

```bash
SMTP_HOST=in-v3.mailjet.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu_clave_api
SMTP_PASS=tu_clave_secreta
```

---

### OVH *(si ya tienes alojamiento en OVH)*

Si tienes un plan de correo de OVH (`noreply@midominio.com`), usa sus credenciales directamente:

```bash
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@midominio.com
SMTP_PASS=tu_contraseña_ovh
```

---

### Infomaniak *(suizo, ético — ~€1/mes)*

Si quieres una dirección con tu propio dominio alojada en Suiza:

1. Contrata una dirección de correo en [infomaniak.com](https://www.infomaniak.com)
2. Usa la configuración SMTP de tu área de cliente

```bash
SMTP_HOST=mail.infomaniak.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@midominio.com
SMTP_PASS=tu_contraseña
```

---

## Probar la configuración

Desde el panel de administración de Nodyx → **Ajustes** → **Correo electrónico**, puedes enviar un correo de prueba para verificar que todo funciona.

Si el correo no llega:

1. Comprueba las credenciales en `.env`
2. Comprueba que el puerto 587 no esté bloqueado por tu servidor (poco frecuente, pero posible)
3. Algunos proveedores requieren que verifiques tu dominio de envío — consulta su documentación

---

## Lo que Nodyx nunca hará con tus correos

- Nodyx nunca envía correos de marketing
- Nodyx nunca comparte direcciones de correo con terceros
- Nodyx no usa servicios de envío de correo de terceros en su código (solo SMTP estándar)
- Las direcciones de correo de tus miembros solo pasan por **tu** servidor SMTP
