<script lang="ts">
  import { t } from '$lib/i18n';
  const tFn = $derived($t);
</script>

<svelte:head>
  <title>{tFn('cert.meta.title')}</title>
  <meta name="description" content={tFn('cert.meta.desc')} />
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
      {tFn('cert.eyebrow')}
    </div>
    <h1 style="font-size: 1.6rem; font-weight: 800; color: #f1f5f9; margin: 0 0 0.5rem;">
      {tFn('cert.h1')}
    </h1>
    <div style="font-size: 0.8rem; color: #64748b;">
      {@html tFn('cert.subtitle')}
    </div>
    <div style="
      margin-top: 1.25rem; padding: 0.75rem 1rem;
      background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
      border-radius: 6px; font-size: 0.75rem; color: #fca5a5;
    ">
      {@html tFn('cert.tlp')}
    </div>
  </div>

  <!-- Intro -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.intro')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      {@html tFn('cert.intro.p1')}
    </p>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-top: 0.75rem;">
      {@html tFn('cert.intro.p2')}
    </p>
  </section>

  <!-- 1. Fresh Domain Trigger -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.trigger')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      {@html tFn('cert.trigger.p1')}
    </p>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-top: 0.75rem;">
      {@html tFn('cert.trigger.p2')}
    </p>
  </section>

  <!-- 2. Qualification -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.qualif')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      {@html tFn('cert.qualif.p1')}
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
      {#each [
        { icon: '🎯', labelKey: 'cert.trig.honeytoken.label', descKey: 'cert.trig.honeytoken.desc' },
        { icon: '📄', labelKey: 'cert.trig.canary.label', descKey: 'cert.trig.canary.desc' },
        { icon: '🔑', labelKey: 'cert.trig.credential.label', descKey: 'cert.trig.credential.desc' },
        { icon: '🖱️', labelKey: 'cert.trig.fingerprint.label', descKey: 'cert.trig.fingerprint.desc' },
        { icon: '⚡', labelKey: 'cert.trig.scan.label', descKey: 'cert.trig.scan.desc' },
      ] as item}
        <div style="
          display: flex; gap: 0.875rem; align-items: flex-start;
          background: rgba(56,78,180,0.06); border: 1px solid rgba(56,78,180,0.15);
          border-radius: 6px; padding: 0.75rem 1rem;
        ">
          <span style="font-size: 1rem; flex-shrink: 0;">{item.icon}</span>
          <div>
            <div style="font-size: 0.78rem; font-weight: 700; color: #e2e8f0; margin-bottom: 0.2rem;">{tFn(item.labelKey)}</div>
            <div style="font-size: 0.75rem; color: #64748b;">{tFn(item.descKey)}</div>
          </div>
        </div>
      {/each}
    </div>
    <p style="color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
      {@html tFn('cert.qualif.note')}
    </p>
  </section>

  <!-- 3. Structure rapport -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.report')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      {tFn('cert.report.p1')}
    </p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
      <div style="background: rgba(56,78,180,0.08); border: 1px solid rgba(56,78,180,0.2); border-radius: 6px; padding: 0.875rem;">
        <div style="font-size: 0.7rem; color: #3b82f6; letter-spacing: 0.08em; margin-bottom: 0.5rem;">{tFn('cert.report.md_label')}</div>
        <div style="font-size: 0.75rem; color: #64748b;">{tFn('cert.report.md_desc')}</div>
      </div>
      <div style="background: rgba(56,78,180,0.08); border: 1px solid rgba(56,78,180,0.2); border-radius: 6px; padding: 0.875rem;">
        <div style="font-size: 0.7rem; color: #10b981; letter-spacing: 0.08em; margin-bottom: 0.5rem;">{tFn('cert.report.json_label')}</div>
        <div style="font-size: 0.75rem; color: #64748b;">{tFn('cert.report.json_desc')}</div>
      </div>
    </div>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      {@html tFn('cert.report.p2')}
    </p>
  </section>

  <!-- 4. OSINT enrichissement -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.osint')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      {tFn('cert.osint.p1')}
    </p>
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      {#each [
        { src: 'AbuseIPDB', weight: '55%', descKey: 'cert.osint.abuseipdb.desc' },
        { src: 'VirusTotal', weight: '35%', descKey: 'cert.osint.virustotal.desc' },
        { src: 'Shodan', weight: '10%', descKey: 'cert.osint.shodan.desc' },
      ] as src}
        <div style="display:flex; align-items:center; gap:0.75rem; font-size:0.78rem; padding:0.5rem 0; border-bottom:1px solid rgba(56,78,180,0.1);">
          <span style="color:#e2e8f0; min-width:100px;">{src.src}</span>
          <span style="color:#f59e0b; min-width:40px; font-size:0.7rem;">{src.weight}</span>
          <span style="color:#64748b;">{tFn(src.descKey)}</span>
        </div>
      {/each}
    </div>
    <p style="color: #64748b; font-size: 0.78rem; margin-top: 0.875rem;">
      {tFn('cert.osint.note')}
    </p>
  </section>

  <!-- 5. Classification OWASP -->
  <section style="margin-bottom: 2.5rem;">
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.owasp')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
      {tFn('cert.owasp.p1')}
    </p>
    <div style="overflow-x: auto;">
      <table style="width:100%; border-collapse: collapse; font-size: 0.75rem;">
        <thead>
          <tr style="border-bottom: 1px solid rgba(56,78,180,0.2);">
            {#each [tFn('cert.owasp.th.pattern'), tFn('cert.owasp.th.vuln'), 'OWASP', 'CWE'] as col}
              <th style="padding: 0.5rem 0.75rem; text-align: left; color: #334155; font-weight: 600; letter-spacing: 0.06em;">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each [
            { pattern: '?id=\' OR sqlmap UA', vulnKey: 'cert.owasp.vuln.sqli', owasp: 'A03:2021', cwe: 'CWE-89' },
            { pattern: '/../../../etc/passwd', vulnKey: 'cert.owasp.vuln.lfi', owasp: 'A01:2021', cwe: 'CWE-22' },
            { pattern: '/.env /.git/ /backup/', vulnKey: 'cert.owasp.vuln.sensitive', owasp: 'A05:2021', cwe: 'CWE-538' },
            { pattern: '/wp-admin /xmlrpc.php', vulnKey: 'cert.owasp.vuln.wp', owasp: 'A07:2021', cwe: 'CWE-307' },
            { pattern: '/phpmyadmin /adminer', vulnKey: 'cert.owasp.vuln.db', owasp: 'A05:2021', cwe: 'CWE-306' },
            { pattern: 'nuclei / nikto / nmap UA', vulnKey: 'cert.owasp.vuln.scan', owasp: 'A06:2021', cwe: 'CWE-200' },
            { pattern: '/api/v1/admin /api/token', vulnKey: 'cert.owasp.vuln.priv', owasp: 'A01:2021', cwe: 'CWE-285' },
          ] as row, i}
            <tr style="border-bottom: 1px solid rgba(56,78,180,0.06); {i % 2 === 0 ? '' : 'background:rgba(56,78,180,0.03)'}">
              <td style="padding:0.45rem 0.75rem; font-family:monospace; color:#64748b; font-size:0.7rem;">{row.pattern}</td>
              <td style="padding:0.45rem 0.75rem; color:#94a3b8;">{tFn(row.vulnKey)}</td>
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
    <h2 style="font-size: 0.75rem; color: #475569; letter-spacing: 0.12em; margin: 0 0 1rem;">{tFn('cert.s.sovereign')}</h2>
    <p style="color: #94a3b8; font-size: 0.88rem;">
      {@html tFn('cert.sovereign.p1')}
    </p>
    <div style="
      margin-top: 0.875rem;
      background: rgba(0,0,0,0.4); border: 1px solid rgba(56,78,180,0.2);
      border-radius: 6px; padding: 0.875rem 1rem;
      font-size: 0.75rem; color: #64748b; line-height: 1.8;
    ">
      <div><span style="color:var(--nx-accent);">{tFn('cert.sovereign.code.disable')}</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_TO=</span><span style="color:#94a3b8;">          {tFn('cert.sovereign.code.empty')}</span></div>
      <div style="margin-top:0.5rem;"><span style="color:var(--nx-accent);">{tFn('cert.sovereign.code.configure')}</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_TO=</span><span style="color:#10b981;">security@mon-organisation.fr</span></div>
      <div><span style="color:#475569;">CERT_EMAIL_MAX_PER_DAY=</span><span style="color:#f59e0b;">3</span></div>
    </div>
    <p style="color: #64748b; font-size: 0.78rem; margin-top: 0.875rem;">
      {tFn('cert.sovereign.note')}
    </p>
  </section>

  <!-- Footer -->
  <div style="
    margin-top: 3rem; padding-top: 1.5rem;
    border-top: 1px solid rgba(56,78,180,0.2);
    font-size: 0.72rem; color: #334155;
    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;
  ">
    <span>{@html tFn('cert.footer.left')}</span>
    <span>{@html tFn('cert.footer.contact')}</span>
    <span>
      <a href="https://github.com/Pokled/nodyx" target="_blank" style="color:#64748b;text-decoration:none;">GitHub</a>
    </span>
  </div>

</div>
