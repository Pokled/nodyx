<svelte:head>
  <title>Nodyx — CERT Detection Methodology</title>
  <meta name="description" content="Technical methodology used by the Nodyx honeypot system to generate qualified threat intelligence reports for CERT-FR and law enforcement." />
  <meta name="robots" content="index, follow" />
</svelte:head>

<div style="
  max-width: 860px; margin: 0 auto; padding: 3rem 1.5rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #e2e8f0; line-height: 1.75;
">

  <!-- Header -->
  <div style="margin-bottom: 3rem; border-bottom: 1px solid rgba(56,78,180,0.3); padding-bottom: 2rem;">
    <div style="font-size: 0.7rem; color: #475569; letter-spacing: 0.15em; margin-bottom: 0.75rem;">
      NODYX SECURITY — DOCUMENT TECHNIQUE
    </div>
    <h1 style="font-size: 1.6rem; font-weight: 800; color: #f1f5f9; margin: 0 0 0.5rem;">
      CERT Detection Methodology
    </h1>
    <div style="font-size: 0.8rem; color: #64748b;">
      Version 1.0 — Nodyx Security Honeypot — <a href="https://nodyx.org" style="color: #3b82f6; text-decoration: none;">nodyx.org</a> — AGPL-3.0
    </div>
    <div style="
      margin-top: 1.25rem; padding: 0.75rem 1rem;
      background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
      border-radius: 6px; font-size: 0.75rem; color: #fca5a5;
    ">
      <strong>TLP:WHITE</strong> — Ce document est public et peut être librement redistribué.
    </div>
  </div>

  <!-- Intro -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// INTRODUCTION</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      Nodyx est une plateforme communautaire open source auto-hébergée (forum + chat + voix),
      publiée sous licence <strong style="color: #e2e8f0;">AGPL-3.0</strong>.
      Chaque instance Nodyx embarque un système honeypot passif qui capture, qualifie et documente
      les tentatives d'intrusion en temps réel.
    </p>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-top: 0.75rem;">
      Ce document décrit la méthodologie employée pour garantir que les rapports transmis aux
      autorités (CERT-FR, ANSSI, hébergeurs) représentent du <strong style="color: #e2e8f0;">signal qualifié</strong>,
      non du bruit — afin de respecter le temps des équipes de réponse.
    </p>
  </section>

  <!-- 1. Fresh Domain Trigger -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 1. CAPTEUR PRÉCOCE — "FRESH DOMAIN TRIGGER"</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      Les botnets surveillent en temps réel les flux de création de noms de domaine via les logs
      <strong style="color: #e2e8f0;">Certificate Transparency (CT)</strong> et les nouvelles zones DNS.
      Un domaine comme <code style="background:rgba(56,78,180,0.15);padding:0.1em 0.4em;border-radius:3px;color:#93c5fd;">instance.nodyx.org</code>
      reçoit typiquement ses premiers scans <strong style="color: #fca5a5;">en moins de 10 minutes</strong> après création.
    </p>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-top: 0.75rem;">
      Cette fenêtre d'exposition capture les <strong style="color: #e2e8f0;">versions les plus récentes</strong> des
      scanners de vulnérabilités et des botnets actifs — souvent avant que leurs signatures ne soient
      intégrées aux bases de données mondiales (AbuseIPDB, VirusTotal, Shodan).
      Chaque instance Nodyx agit donc comme un <strong style="color: #10b981;">capteur d'alerte précoce</strong>
      sur des menaces émergentes.
    </p>
  </section>

  <!-- 2. Qualification -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 2. QUALIFICATION DES INCIDENTS — ZERO FAUX POSITIF</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      Une IP n'est signalée que si elle franchit <strong style="color: #e2e8f0;">au moins un</strong> des critères suivants :
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
      {#each [
        { icon: '🎯', label: 'Honeytoken cliqué', desc: 'L\'attaquant a cliqué sur un lien piège délibérément invisible pour un utilisateur légitime. Confirmation d\'un acteur humain.' },
        { icon: '📄', label: 'Canary file accédé', desc: 'Accès à un fichier "leurre" (faux .env, faux credentials.json) — intention d\'exfiltration caractérisée.' },
        { icon: '🔑', label: 'Credential Harvest', desc: 'Soumission d\'identifiants sur un faux formulaire de login (wp-admin, phpmyadmin, panel…).' },
        { icon: '🖱️', label: 'Fingerprint récurrent', desc: 'Empreinte navigateur (Canvas API) identique sur plusieurs visites ou plusieurs IPs — attaquant persistant.' },
        { icon: '⚡', label: 'Scan de vulnérabilités connu', desc: 'User-Agent ou signature réseau identifiant un outil connu : sqlmap, nuclei, nikto, Metasploit, Burp Suite…' },
      ] as item}
        <div style="
          display: flex; gap: 0.875rem; align-items: flex-start;
          background: rgba(56,78,180,0.06); border: 1px solid rgba(56,78,180,0.15);
          border-radius: 6px; padding: 0.75rem 1rem;
        ">
          <span style="font-size: 1rem; flex-shrink: 0;">{item.icon}</span>
          <div>
            <div style="font-size: 0.78rem; font-weight: 700; color: #e2e8f0; margin-bottom: 0.2rem;">{item.label}</div>
            <div style="font-size: 0.75rem; color: #64748b;">{item.desc}</div>
          </div>
        </div>
      {/each}
    </div>
    <p style="color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
      Les simples erreurs 404, les crawlers SEO légitimes et les bots d'hébergeurs connus sont filtrés
      automatiquement. Le taux de signalement ciblé vise <strong style="color: #e2e8f0;">&lt; 5 rapports / jour / instance</strong>.
    </p>
  </section>

  <!-- 3. Structure rapport -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 3. STRUCTURE DES RAPPORTS</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      Chaque rapport transmis contient deux pièces jointes :
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
      <div style="background: rgba(56,78,180,0.08); border: 1px solid rgba(56,78,180,0.2); border-radius: 6px; padding: 0.875rem;">
        <div style="font-size: 0.7rem; color: #3b82f6; letter-spacing: 0.08em; margin-bottom: 0.5rem;">RAPPORT.md</div>
        <div style="font-size: 0.75rem; color: #64748b;">Lisible par un analyste. Tableaux structurés, headers HTTP complets, fingerprint navigateur, qualification juridique.</div>
      </div>
      <div style="background: rgba(56,78,180,0.08); border: 1px solid rgba(56,78,180,0.2); border-radius: 6px; padding: 0.875rem;">
        <div style="font-size: 0.7rem; color: #10b981; letter-spacing: 0.08em; margin-bottom: 0.5rem;">RAPPORT.json — TLP:AMBER</div>
        <div style="font-size: 0.75rem; color: #64748b;">Ingérable par SIEM/SOAR. Schéma versionné (1.0), champs typés, classification OWASP/CWE, intégration MISP-ready.</div>
      </div>
    </div>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      Chaque rapport est accompagné d'un <strong style="color: #e2e8f0;">hash SHA-256</strong> calculé sur le JSON,
      présent dans le corps du mail et dans le header SMTP (<code style="background:rgba(56,78,180,0.15);padding:0.1em 0.4em;border-radius:3px;color:#93c5fd;">X-Nodyx-SHA256</code>).
      L'intégrité des preuves est vérifiable hors ligne : <code style="background:rgba(56,78,180,0.15);padding:0.1em 0.4em;border-radius:3px;color:#93c5fd;">sha256sum NODYX-CERT-*.json</code>
    </p>
  </section>

  <!-- 4. OSINT enrichissement -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 4. ENRICHISSEMENT OSINT AUTOMATIQUE</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      Avant transmission, chaque IP est croisée avec trois sources indépendantes :
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      {#each [
        { src: 'AbuseIPDB', weight: '55%', desc: 'Score d\'abus 0–100, nombre de signalements, catégories d\'attaque' },
        { src: 'VirusTotal', weight: '35%', desc: 'Analyse par 90+ moteurs AV/sandbox, réputation IP globale' },
        { src: 'Shodan', weight: '10%', desc: 'Ports ouverts, CVEs exposées, bannières de service (optionnel)' },
      ] as src}
        <div style="display:flex; align-items:center; gap:0.75rem; font-size:0.78rem; padding:0.5rem 0; border-bottom:1px solid rgba(56,78,180,0.1);">
          <span style="color:#e2e8f0; min-width:100px;">{src.src}</span>
          <span style="color:#f59e0b; min-width:40px; font-size:0.7rem;">{src.weight}</span>
          <span style="color:#64748b;">{src.desc}</span>
        </div>
      {/each}
    </div>
    <p style="color: #64748b; font-size: 0.78rem; margin-top: 0.875rem;">
      Les résultats sont mis en cache 24h (Redis) pour préserver les quotas API.
      Le score de menace composite (0–100) est inclus dans chaque rapport.
    </p>
  </section>

  <!-- 5. Classification OWASP -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 5. CLASSIFICATION AUTOMATIQUE OWASP / CWE</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      Le path HTTP ciblé et le user-agent sont analysés pour qualifier la vulnérabilité recherchée,
      permettant une classification immédiate dans vos outils :
    </p>
    <div style="overflow-x: auto;">
      <table style="width:100%; border-collapse: collapse; font-size: 0.75rem;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(56,78,180,0.2);">
            {#each ['Pattern détecté','Vulnérabilité','OWASP','CWE'] as col}
              <th style="padding: 0.5rem 0.75rem; text-align: left; color: #334155; font-weight: 600; letter-spacing: 0.06em;">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each [
            { pattern: '?id=\' OR sqlmap UA', vuln: 'Injection SQL', owasp: 'A03:2021', cwe: 'CWE-89' },
            { pattern: '/../../../etc/passwd', vuln: 'Path traversal / LFI', owasp: 'A01:2021', cwe: 'CWE-22' },
            { pattern: '/.env /.git/ /backup/', vuln: 'Fichier sensible exposé', owasp: 'A05:2021', cwe: 'CWE-538' },
            { pattern: '/wp-admin /xmlrpc.php', vuln: 'WordPress brute-force/RCE', owasp: 'A07:2021', cwe: 'CWE-307' },
            { pattern: '/phpmyadmin /adminer', vuln: 'Interface DB exposée', owasp: 'A05:2021', cwe: 'CWE-306' },
            { pattern: 'nuclei / nikto / nmap UA', vuln: 'Scan de vulnérabilités', owasp: 'A06:2021', cwe: 'CWE-200' },
            { pattern: '/api/v1/admin /api/token', vuln: 'Escalade de privilèges API', owasp: 'A01:2021', cwe: 'CWE-285' },
          ] as row, i}
            <tr style="border-bottom: 1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
              <td style="padding:0.45rem 0.75rem; font-family:monospace; color:#64748b; font-size:0.7rem;">{row.pattern}</td>
              <td style="padding:0.45rem 0.75rem; color:#94a3b8;">{row.vuln}</td>
              <td style="padding:0.45rem 0.75rem; color:#f59e0b; font-size:0.7rem;">{row.owasp}</td>
              <td style="padding:0.45rem 0.75rem;"><a href="https://cwe.mitre.org/data/definitions/{row.cwe.replace('CWE-','')}.html" target="_blank" style="color:#3b82f6; text-decoration:none; font-size:0.7rem;">{row.cwe}</a></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- 6. Souveraineté -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">// 6. SOUVERAINETÉ DE L'INSTANCE — OPT-IN TOTAL</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      Le module de signalement CERT est entièrement <strong style="color: #e2e8f0;">opt-in</strong>.
      L'administrateur de chaque instance contrôle via son fichier <code style="background:rgba(56,78,180,0.15);padding:0.1em 0.4em;border-radius:3px;color:#93c5fd;">.env</code> :
    </p>
    <div style="
      margin-top: 0.875rem;
      background: rgba(0,0,0,0.4); border: 1px solid rgba(56,78,180,0.2);
      border-radius: 6px; padding: 0.875rem 1rem;
      font-size: 0.75rem; color: #64748b; line-height: 1.8;
    ">
      <div><span style="color:#6366f1;"># Désactiver tous les rapports CERT</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_TO=</span><span style="color:#94a3b8;">          # vide = aucun envoi</span></div>
      <div style="margin-top:0.5rem;"><span style="color:#6366f1;"># Configurer vers ses propres équipes</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_TO=</span><span style="color:#10b981;">security@mon-organisation.fr</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_MAX_PER_DAY=</span><span style="color:#f59e0b;">3</span></div>
    </div>
    <p style="color: #64748b; font-size: 0.78rem; margin-top: 0.875rem;">
      Nodyx n'envoie aucune donnée à des serveurs centraux.
      Aucune télémétrie. Aucun callback vers nodyx.org.
      Chaque instance est souveraine et autonome — c'est le principe fondateur du projet.
    </p>
  </section>

  <!-- Footer -->
  <div style="
    margin-top: 3rem; padding-top: 1.5rem;
    border-top: 1px solid rgba(56,78,180,0.2);
    font-size: 0.72rem; color: #334155;
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;
  ">
    <span>Nodyx Security Honeypot — <a href="https://nodyx.org" style="color:#3b82f6;text-decoration:none;">nodyx.org</a> — AGPL-3.0</span>
    <span>Contact sécurité : <a href="mailto:security@nodyx.org" style="color:#3b82f6;text-decoration:none;">security@nodyx.org</a></span>
    <span>
      <a href="https://github.com/Pokled/nodyx" target="_blank" style="color:#64748b;text-decoration:none;">GitHub</a>
    </span>
  </div>

</div>
