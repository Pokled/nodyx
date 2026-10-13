# Installing Nodyx

One command, a few questions, and your community has a home. This guide walks you through it, from choosing a machine to your first evening with your members.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

That's really all it takes. The rest of this page explains what happens, the choices you'll be asked to make, and what to do when something goes wrong.

---

## In short

| Step | What you do | Time |
|---|---|---|
| 1. A machine | A small VPS, a Raspberry Pi, a spare laptop | 10 minutes to rent one |
| 2. The command | Run the line above as root | A few seconds |
| 3. The questions | Name, admin account, how people reach you | About 2 minutes |
| 4. The wait | The installer builds and starts everything | A few minutes, longer on a Raspberry Pi |
| 5. Your community | Log in, pick an ambiance, invite people | As long as you like |

---

## 1. Pick a machine

Nodyx runs on **Ubuntu 22.04 or 24.04**, or **Debian 11, 12 or 13**, in 64 bits (x86 or ARM64). You need `curl`, and root access (`sudo` is not even required).

| Machine | RAM | Good for |
|---|---|---|
| Raspberry Pi 4 or 5, old laptop | 1 to 2 GB | A small community, at home |
| Small VPS | 2 to 4 GB | Most communities |
| Larger VPS | 4 GB and more | Busy voice rooms, many members |

With less than 1.5 GB of RAM, the installer switches to an economy mode on its own: lower memory limits, and a swap file if there isn't enough. On a Raspberry Pi, use a **64-bit** system (Raspberry Pi OS 64-bit or Ubuntu ARM64).

> **Tip.** A fresh server is the easiest path. Nodyx installs its own web server (Caddy), database (PostgreSQL) and cache (Redis); if a web server like nginx or Apache already runs on the machine, the installer tells you and asks before touching anything.

---

## 2. Decide how people will reach you

This is the one real choice. The installer asks it, but it helps to know the answer before you start.

| If... | Choose | You get |
|---|---|---|
| The machine is at home, behind a box or router | **Nodyx Relay** (recommended) | `yourclub.nodyx.org`, no port to open, no domain to buy |
| You have a domain and a server with ports 80 and 443 open | **Your own domain** | `yourcommunity.com`, HTTPS from Let's Encrypt, full control |
| Ports 80 and 443 are open but you have no domain | **sslip.io** | A free automatic address based on your IP |
| You already use Cloudflare Tunnel or Pangolin | The **tunnel installer** | Your domain, through your tunnel, no port open |

**Nodyx Relay**, written in Rust, connects your server to the relay with outbound connections only: nothing to configure on your router. Website, chat and small-group voice all work. Large voice rooms and screen sharing for many people go through an SFU that still needs a server reachable from the internet; making that work from home too is the next big piece of work on the roadmap.

For a tunnel, follow the dedicated guide instead: **[Install behind a tunnel](./INSTALL-TUNNEL.md)**.

---

## 3. Run the installer

As root, or with `sudo`:

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Prefer to read the script first? Clone the repository and run it from there:

```bash
git clone https://github.com/Pokled/nodyx.git
cd nodyx
sudo bash install.sh
```

### The questions it asks

| Question | What to answer |
|---|---|
| Community name | What your members will see, e.g. *The Night Owls* |
| Identifier (slug) | Short, lowercase, used in addresses, e.g. `nightowls`. In relay mode it becomes `nightowls.nodyx.org`, and the installer checks it is free before going further |
| Language, description, country | Language of the community; description and country are optional, press Enter to skip |
| Network mode | Relay, your own domain, or sslip.io (see above) |
| Domain | Only for "your own domain" |
| Admin account | Username, email, and a password of at least 8 characters, typed twice |
| Email (SMTP) | Optional. Without it, Nodyx works, it just doesn't send emails (password resets go through `nodyx-recover`, see below) |
| Public directory | Optional. Say yes to appear on [nodyx.org/discover](https://nodyx.org/discover) and be searchable from other communities |

Every confirmation understands yes and no (`y/n`, `o/n`, `yes/no`, `oui/non`), and asks again if the answer is unclear. Nothing destructive ever happens on a stray Enter.

### Then it gets to work

It installs Node.js, PostgreSQL, Redis, Caddy, PM2 and the Rust voice components, generates every secret, creates the database, builds Nodyx, creates your admin account and configures the firewall. The firewall rule for SSH is put in place **before** the firewall is turned on, on the port your SSH really uses, so you can't be locked out of your own server.

At the end, a summary shows your address and a health check of every service. A green banner means everything answered; a red one means something needs a look, with the exact command to run.

> **Note.** Your admin password is **not** written to disk. Keep it somewhere safe. If you lose it, `sudo nodyx-recover` gets you back in.

---

## 4. Your first evening

Open your address, log in with the admin account, and make the place yours:

1. **Pick an ambiance.** Administration → Appearance: fourteen ready-made looks, or your own colors. Nobody sees anything until you press Publish.
2. **Shape the homepage.** Administration → Homepage: rows, columns and widgets, with a preview on desktop, tablet and mobile.
3. **Open the doors.** Create a few forum categories, a text channel, a voice channel.
4. **Write the first post.** An announcement that says what this place is for.
5. **Invite people.** Share the address. That's the moment it stops being a server and becomes a community.

---

## Unattended install

For scripts, Ansible or a CI job, every question has an option:

```bash
sudo bash install.sh --yes \
  --network=relay \
  --name="The Night Owls" --slug=nightowls \
  --admin-user=admin --admin-email=admin@example.com \
  --admin-password-file=/root/admin-password.txt
```

- `--yes` accepts the default answers; a question with no default and no option stops the installer cleanly and names it.
- `--network=direct|relay|sslip`; `--domain=...` alone implies `direct`.
- Give secrets through files (`--admin-password-file`), not in the command line, where any user of the server could read them.
- `--no-turn`, `--no-sfu`, `--no-subdomain`, `--lang=en|fr`: see `bash install.sh --help` for the full list.

---

## Living with your instance

Three commands cover almost everything:

```bash
sudo nodyx-update    # update to the latest version
sudo nodyx-doctor    # check that every service is healthy
sudo nodyx-recover   # get back into a lost admin account
```

**Updating** backs up and checks the database first, then builds the new version next to the running one. The site only switches over once everything has built; if anything fails, it keeps running the previous version, untouched. Two updates can't run at once. The five most recent update backups are kept in `/root/nodyx-db-backup-upgrade-*.sql.gz`.

**Logs**, when you want to see what's going on:

```bash
sudo -u nodyx pm2 logs nodyx-core       # the API
sudo -u nodyx pm2 logs nodyx-frontend   # the web app
sudo journalctl -u caddy -n 50          # HTTPS and the reverse proxy
sudo systemctl status nodyx-turn nodyx-sfud nodyx-relay-client
```

Nodyx runs under its own `nodyx` system user: use `sudo -u nodyx pm2 ...`, not `pm2` as root.

**Uninstalling** removes Nodyx and only Nodyx: a Caddyfile that also serves other sites is not modified, other applications' Redis keys and your firewall rules are left alone. It offers to back up the database, uploads and configuration first, and stops without deleting anything if that backup fails. Try it without changing anything first:

```bash
sudo bash /opt/nodyx/uninstall.sh --dry-run
```

---

## Ports, if you manage your own firewall

With **Nodyx Relay**, nothing is opened: the installer only makes sure SSH stays allowed.

With **your own domain** or **sslip.io**, the installer opens:

| Port | Protocol | Used by |
|---|---|---|
| 80, 443 | TCP | The website (HTTPS) |
| 3478, 5349 | TCP and UDP | Voice relay (TURN), for members behind strict networks |
| 49152 to 65535 | UDP | Voice relay media |
| 40000 to 40999 | UDP and TCP | The SFU: large voice rooms and screen sharing |

If your server sits behind a provider firewall (Hetzner, OVH, AWS security groups...), open the same ports there too.

---

## When something goes wrong

Start with `sudo nodyx-doctor`. It checks every service and tells you which one is unhappy. Then:

**"Address already in use" on port 80 or 443.** Another web server holds the port. The installer detects nginx and Apache and asks before stopping them; if you said no, either stop it yourself or choose Nodyx Relay, which needs neither port.

**The HTTPS certificate doesn't come.** Check that your domain points to the server (`getent hosts yourdomain.com` must print its IP), then read `sudo journalctl -u caddy -n 50`. A domain bought minutes ago may need some time before it resolves everywhere.

**The relay name is taken.** The installer checks it before starting and asks for another one: pick a different slug.

**The site shows an error after an update.** It shouldn't: a failed update keeps the previous version running. Run `sudo nodyx-doctor`, then look at `sudo -u nodyx pm2 logs nodyx-core`.

**Some members can't join voice.** Voice uses peer-to-peer first, then the TURN relay. With your own domain, check that the TURN and SFU ports above are open, including at your hosting provider.

**A minimal Debian (no `sudo`, no `curl`).** Install `curl` first (`apt install curl` as root); the installer takes care of the rest, `sudo` included.

---

## Still stuck?

Open an issue on [GitHub](https://github.com/Pokled/nodyx/issues) with the output of `sudo nodyx-doctor`, or come and ask on [nodyx.org](https://nodyx.org). People who reported installer bugs are in our [Hall of Fame](https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md): a good bug report is a contribution.
