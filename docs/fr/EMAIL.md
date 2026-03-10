# 📧 Nexus — Configurer l'envoi d'emails

> **En bref :** Sans email configuré, Nexus fonctionne parfaitement. Mais si un membre oublie son mot de passe, c'est toi qui dois lui envoyer le lien manuellement. Configurer un email évite ça.

---

## À quoi ça sert ?

Nexus envoie des emails dans deux situations :

- **Mot de passe oublié** — un membre clique sur "Mot de passe oublié" et reçoit un lien sécurisé par email
- **Email de bienvenue** *(optionnel)* — un message de bienvenue à l'inscription

C'est tout. Nexus n'envoie pas de newsletters, pas de spam, pas de notifications par email.

---

## Est-ce obligatoire ?

**Non.** Si tu ne configures pas d'email :
- Nexus fonctionne normalement
- Le reset de mot de passe ne s'envoie pas automatiquement
- En tant qu'admin, tu peux générer un lien de reset depuis le panneau d'administration → Membres → "Réinitialiser le mot de passe"

---

## Comment configurer ?

Tu as besoin de trois informations auprès de ton fournisseur d'email :
- **L'adresse du serveur SMTP** (ex: `smtp.brevo.com`)
- **Ton identifiant** (souvent ton adresse email)
- **Ton mot de passe SMTP** (attention : ce n'est pas forcément ton mot de passe habituel — certains services génèrent un mot de passe spécifique pour les applications)

Ouvre le fichier `.env` dans le dossier `nexus-core` et ajoute ces lignes :

```bash
SMTP_HOST=smtp.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ton@email.com
SMTP_PASS=ton_mot_de_passe_smtp
SMTP_FROM=noreply@ton-domaine.com   # optionnel — utilise SMTP_USER si absent
```

Puis redémarre Nexus :
```bash
pm2 restart nexus-core
```

---

## Quel fournisseur choisir ?

Tu n'as pas besoin d'un serveur mail dédié. Un simple compte chez un fournisseur d'emails transactionnels suffit — la plupart ont un niveau gratuit largement suffisant pour une petite communauté.

### Brevo *(recommandé — gratuit, français)*

**Pourquoi Brevo ?**
Société française, conforme RGPD, 300 emails/jour gratuits. Largement suffisant pour une communauté de quelques centaines de membres.

1. Crée un compte sur [brevo.com](https://www.brevo.com)
2. Va dans **Paramètres → SMTP & API → SMTP**
3. Clique sur **"Générer un nouveau mot de passe SMTP"**
4. Copie les informations affichées dans ton `.env` :

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ton@email.com
SMTP_PASS=le_mot_de_passe_généré
```

---

### Mailjet *(gratuit, français)*

1. Crée un compte sur [mailjet.com](https://www.mailjet.com)
2. Va dans **Paramètres du compte → Paramètres SMTP**
3. Copie la clé API et la clé secrète

```bash
SMTP_HOST=in-v3.mailjet.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ta_clé_api
SMTP_PASS=ta_clé_secrète
```

---

### OVH *(si tu as déjà un hébergement OVH)*

Si tu as un forfait mail OVH (`noreply@tondomaine.fr`), utilise directement ses identifiants :

```bash
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@tondomaine.fr
SMTP_PASS=ton_mot_de_passe_ovh
```

---

### Infomaniak *(suisse, éthique — ~1€/mois)*

Si tu veux une adresse sur ton propre domaine hébergée en Suisse :

1. Commande une adresse mail chez [infomaniak.com](https://www.infomaniak.com)
2. Utilise les paramètres SMTP fournis dans ton espace client

```bash
SMTP_HOST=mail.infomaniak.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@tondomaine.fr
SMTP_PASS=ton_mot_de_passe
```

---

## Tester la configuration

Depuis le panneau d'administration de Nexus → **Paramètres** → **Email**, tu peux envoyer un email de test pour vérifier que tout fonctionne.

Si l'email n'arrive pas :
1. Vérifie les identifiants dans `.env`
2. Vérifie que le port 587 n'est pas bloqué par ton hébergeur (rare, mais possible)
3. Certains fournisseurs exigent de vérifier ton domaine expéditeur — consulte leur documentation

---

## Ce que Nexus ne fera jamais avec tes emails

- Nexus n'envoie jamais d'emails marketing
- Nexus ne partage aucune adresse email avec des tiers
- Nexus n'utilise pas de service d'emailing tiers dans son code (juste SMTP standard)
- Les adresses emails de tes membres ne transitent que par **ton** serveur SMTP
