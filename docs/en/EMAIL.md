# 📧 Nexus — Setting up email

> **Quick summary:** Nexus works perfectly without email configured. But if a member forgets their password, you'll have to manually send them the reset link. Setting up email handles this automatically.

---

## What is it used for?

Nexus sends emails in two situations:

- **Forgot password** — a member clicks "Forgot my password" and receives a secure link by email
- **Welcome email** *(optional)* — a welcome message on registration

That's it. Nexus doesn't send newsletters, spam, or email notifications.

---

## Is it mandatory?

**No.** Without email configured:
- Nexus works normally
- Password resets don't send automatically
- As admin, you can generate a reset link from the admin panel → Members → "Reset password"

---

## How to configure

You need three pieces of information from your email provider:
- **SMTP server address** (e.g. `smtp.brevo.com`)
- **Your login** (usually your email address)
- **Your SMTP password** (note: this may not be your regular password — some services generate a specific app password)

Open the `.env` file in the `nexus-core` folder and add these lines:

```bash
SMTP_HOST=smtp.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=your_smtp_password
SMTP_FROM=noreply@your-domain.com   # optional — uses SMTP_USER if not set
```

Then restart Nexus:
```bash
pm2 restart nexus-core
```

---

## Which provider to choose?

You don't need a dedicated mail server. A simple account with a transactional email provider is enough — most have a free tier that's more than sufficient for a small community.

### Brevo *(recommended — free, French company)*

**Why Brevo?**
French company, GDPR compliant, 300 emails/day for free. More than enough for a community of a few hundred members.

1. Create an account at [brevo.com](https://www.brevo.com)
2. Go to **Settings → SMTP & API → SMTP**
3. Click **"Generate a new SMTP password"**
4. Copy the details into your `.env`:

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@email.com
SMTP_PASS=the_generated_password
```

---

### Mailjet *(free, French company)*

1. Create an account at [mailjet.com](https://www.mailjet.com)
2. Go to **Account settings → SMTP settings**
3. Copy the API key and secret key

```bash
SMTP_HOST=in-v3.mailjet.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_api_key
SMTP_PASS=your_secret_key
```

---

### OVH *(if you already have OVH hosting)*

If you have an OVH mail plan (`noreply@yourdomain.com`), use its credentials directly:

```bash
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your_ovh_password
```

---

### Infomaniak *(Swiss, ethical — ~€1/month)*

If you want an address on your own domain hosted in Switzerland:

1. Order a mail address at [infomaniak.com](https://www.infomaniak.com)
2. Use the SMTP settings from your customer area

```bash
SMTP_HOST=mail.infomaniak.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your_password
```

---

## Testing your configuration

From the Nexus admin panel → **Settings** → **Email**, you can send a test email to verify everything works.

If the email doesn't arrive:
1. Check the credentials in `.env`
2. Check that port 587 isn't blocked by your host (rare, but possible)
3. Some providers require you to verify your sending domain — check their documentation

---

## What Nexus will never do with your emails

- Nexus never sends marketing emails
- Nexus never shares email addresses with third parties
- Nexus doesn't use third-party emailing services in its code (just standard SMTP)
- Your members' email addresses only pass through **your** SMTP server
