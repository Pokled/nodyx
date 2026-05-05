(function () {
  /* ── nodyx-widget-video-player v1.1.0 ──
     Lecteur universel : YouTube, Vimeo, Dailymotion, Twitch (live/VOD/clip),
     SoundCloud, Spotify, et fichier vidéo direct (MP4 / WebM / MOV / HLS).

     L'URL est auto-détectée. Aucun script tiers chargé : tout est rendu via
     un iframe dont le src pointe sur l'embed officiel de la plateforme. */

  var STYLE = `
    :host { display: block; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      background: #0d0d12;
      border: 1px solid rgba(255,255,255,.08);
      overflow: hidden;
      font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
    }

    .header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid rgba(255,255,255,.05);
    }

    .header-icon {
      width: 24px; height: 24px;
      background: rgba(167,139,250,.12);
      border: 1px solid rgba(167,139,250,.2);
      border-radius: 3px;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px;
      flex-shrink: 0;
    }

    .header-title {
      font-size: 12px; font-weight: 700;
      color: #e2e8f0;
      flex: 1;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .header-badge {
      font-size: 9px; font-weight: 700;
      padding: 2px 6px;
      background: rgba(167,139,250,.1);
      border: 1px solid rgba(167,139,250,.18);
      color: #a78bfa;
      text-transform: uppercase;
      letter-spacing: .06em;
      flex-shrink: 0;
    }

    .video-wrap {
      position: relative;
      padding-bottom: 56.25%; /* 16:9 */
      background: #000;
    }
    .video-wrap--audio-152 { padding-bottom: 0; height: 152px; }
    .video-wrap--audio-352 { padding-bottom: 0; height: 352px; }
    .video-wrap--audio-166 { padding-bottom: 0; height: 166px; background: transparent; }

    .video-wrap iframe,
    .video-wrap video {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      border: none;
    }

    .placeholder {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px;
      background: linear-gradient(145deg, #0d0d12 0%, #12121e 100%);
    }

    .play-btn {
      width: 56px; height: 56px; border-radius: 50%;
      background: rgba(167,139,250,.1);
      border: 1px solid rgba(167,139,250,.25);
      display: flex; align-items: center; justify-content: center;
    }

    .placeholder-label {
      font-size: 11px; color: #374151;
      font-weight: 500;
      text-align: center;
      padding: 0 12px;
    }
    .placeholder-hint {
      font-size: 10px; color: #1f2937;
      max-width: 80%;
      text-align: center;
    }

    .footer {
      padding: 7px 14px;
      display: flex; align-items: center; justify-content: space-between;
      border-top: 1px solid rgba(255,255,255,.04);
    }

    .footer-id {
      font-size: 9px; color: #1f2937;
      font-family: monospace;
    }

    .footer-badge {
      font-size: 9px; font-weight: 700;
      color: #374151; text-transform: uppercase; letter-spacing: .05em;
    }
  `;

  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // Plateforme: { kind, embed, allow, label, aspect?, direct? }
  // aspect: undefined (default 16:9) | 'audio-152' | 'audio-352' | 'audio-166'
  function detectPlatform(url, opts) {
    var u = String(url).trim();
    var ap = opts.autoplay ? 1 : 0;
    var ct = opts.controls ? 1 : 0;
    var m;

    // YouTube (watch / youtu.be / embed / shorts)
    m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
    if (m) {
      return {
        kind:  'youtube',
        embed: 'https://www.youtube-nocookie.com/embed/' + m[1] +
               '?autoplay=' + ap + '&controls=' + ct + '&rel=0&modestbranding=1',
        allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture',
        label: 'YouTube',
      };
    }

    // Vimeo (basique, showcase, event, channels)
    m = u.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
    if (m) {
      return {
        kind:  'vimeo',
        embed: 'https://player.vimeo.com/video/' + m[1] +
               '?autoplay=' + ap + '&dnt=1',
        allow: 'autoplay; fullscreen; picture-in-picture',
        label: 'Vimeo',
      };
    }

    // Dailymotion (dailymotion.com/video/ID, dai.ly/ID)
    m = u.match(/dailymotion\.com\/video\/(\w+)/) || u.match(/dai\.ly\/(\w+)/);
    if (m) {
      return {
        kind:  'dailymotion',
        embed: 'https://geo.dailymotion.com/player.html?video=' + m[1] +
               '&autoplay=' + (ap ? 'true' : 'false') +
               '&controls=' + (ct ? 'true' : 'false'),
        allow: 'autoplay; fullscreen; picture-in-picture; web-share',
        label: 'Dailymotion',
      };
    }

    // Twitch — `parent` est imposé par Twitch, on prend le hostname courant
    var parent = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';

    // Twitch clip via clips.twitch.tv/SLUG ou twitch.tv/USER/clip/SLUG
    m = u.match(/clips\.twitch\.tv\/([\w-]+)/) ||
        u.match(/twitch\.tv\/[\w]+\/clip\/([\w-]+)/);
    if (m) {
      return {
        kind:  'twitch-clip',
        embed: 'https://clips.twitch.tv/embed?clip=' + m[1] +
               '&parent=' + encodeURIComponent(parent) +
               '&autoplay=' + (ap ? 'true' : 'false'),
        allow: 'autoplay; fullscreen',
        label: 'Twitch Clip',
      };
    }
    // Twitch VOD
    m = u.match(/twitch\.tv\/videos\/(\d+)/);
    if (m) {
      return {
        kind:  'twitch-vod',
        embed: 'https://player.twitch.tv/?video=' + m[1] +
               '&parent=' + encodeURIComponent(parent) +
               '&autoplay=' + (ap ? 'true' : 'false'),
        allow: 'autoplay; fullscreen',
        label: 'Twitch VOD',
      };
    }
    // Twitch live (channel) — match strict, après VOD/clip pour ne pas avaler /videos/* ou /clip/*
    m = u.match(/^https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{4,25})\/?(?:\?.*)?$/);
    if (m) {
      return {
        kind:  'twitch-live',
        embed: 'https://player.twitch.tv/?channel=' + m[1] +
               '&parent=' + encodeURIComponent(parent) +
               '&autoplay=' + (ap ? 'true' : 'false'),
        allow: 'autoplay; fullscreen',
        label: 'Twitch Live',
      };
    }

    // SoundCloud (track ou playlist) — l'iframe officiel encode l'URL
    if (/soundcloud\.com\//.test(u)) {
      return {
        kind:  'soundcloud',
        embed: 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(u) +
               '&color=%23a78bfa' +
               '&auto_play=' + (ap ? 'true' : 'false') +
               '&hide_related=false&show_comments=true&show_user=true',
        allow: 'autoplay',
        label: 'SoundCloud',
        aspect: 'audio-166',
      };
    }

    // Spotify (track/episode = 152px, autres = 352px)
    m = u.match(/(?:open\.)?spotify\.com\/(track|episode|playlist|album|show|artist)\/(\w+)/);
    if (m) {
      var compact = (m[1] === 'track' || m[1] === 'episode');
      return {
        kind:  'spotify',
        embed: 'https://open.spotify.com/embed/' + m[1] + '/' + m[2],
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        label: 'Spotify',
        aspect: compact ? 'audio-152' : 'audio-352',
      };
    }

    // Fichier direct (mp4 / webm / mov / m3u8 / ogg)
    if (/^https?:\/\//.test(u)) {
      return { kind: 'direct', direct: u, label: 'Vidéo' };
    }

    return null;
  }

  class NodyxVideoPlayer extends HTMLElement {
    connectedCallback() { this._render(); }
    static get observedAttributes() { return ['data-config', 'data-title']; }
    attributeChangedCallback() { this._render(); }

    _render() {
      var cfg = {};
      try { cfg = JSON.parse(this.dataset.config || '{}'); } catch (e) {}

      var title    = this.dataset.title || cfg.title || 'Lecteur Vidéo';
      var url      = (cfg.url || '').trim();
      var autoplay = !!cfg.autoplay;
      var controls = cfg.show_controls !== false;

      var media   = '';
      var badge   = 'vidéo';
      var wrapCls = 'video-wrap';

      if (url) {
        var p = detectPlatform(url, { autoplay: autoplay, controls: controls });

        if (!p) {
          media = `
            <div class="placeholder">
              <div class="play-btn">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(248,113,113,.7)">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <span class="placeholder-label">URL non reconnue</span>
              <span class="placeholder-hint">Formats acceptés : YouTube, Vimeo, Dailymotion, Twitch, SoundCloud, Spotify, ou fichier .mp4 / .webm direct.</span>
            </div>`;
        } else if (p.kind === 'direct') {
          media = '<video src="' + escAttr(p.direct) + '"' +
                  (autoplay ? ' autoplay'  : '') +
                  (controls ? ' controls'  : '') +
                  ' playsinline></video>';
          badge = 'vidéo';
        } else {
          media = '<iframe src="' + escAttr(p.embed) + '"' +
                  ' allow="' + escAttr(p.allow) + '"' +
                  ' allowfullscreen loading="lazy"></iframe>';
          badge = p.label.toLowerCase();
          if (p.aspect) wrapCls += ' video-wrap--' + p.aspect;
        }
      } else {
        media = `
          <div class="placeholder">
            <div class="play-btn">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(167,139,250,.8)">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
            <span class="placeholder-label">Aucune URL configurée</span>
          </div>`;
      }

      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <div class="root">
          <div class="header">
            <div class="header-icon">🎬</div>
            <span class="header-title">${escAttr(title)}</span>
            <span class="header-badge">${escAttr(badge)}</span>
          </div>
          <div class="${wrapCls}">${media}</div>
          <div class="footer">
            <span class="footer-id">nodyx-widget-video-player</span>
            <span class="footer-badge">Nodyx Widget</span>
          </div>
        </div>`;
    }
  }

  if (!customElements.get('nodyx-widget-video-player')) {
    customElements.define('nodyx-widget-video-player', NodyxVideoPlayer);
  }
})();
