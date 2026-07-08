<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" doctype-system="about:legacy-compat" encoding="UTF-8" indent="yes"/>

<xsl:template match="/">
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title><xsl:value-of select="/rss/channel/title"/> — Flux RSS</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:-apple-system,system-ui,'Segoe UI',sans-serif;
      background:#f6f7fb;
      color:#111118;
      line-height:1.5;
      min-height:100vh;
      padding:40px 20px;
    }
    .wrap{max-width:720px;margin:0 auto}
    .banner{
      background:#fff;
      border:1px solid rgba(16,16,24,.14);
      border-radius:10px;
      padding:24px 28px;
      margin-bottom:28px;
      box-shadow:0 18px 44px rgba(17,17,24,.07);
    }
    .banner-badge{
      font-family:monospace;
      font-size:10px;
      letter-spacing:4px;
      text-transform:uppercase;
      color:#4f46e5;
      margin-bottom:12px;
      display:flex;
      align-items:center;
      gap:10px;
    }
    .banner-badge::before{
      content:'';
      display:inline-block;
      width:6px;height:6px;
      background:#4f46e5;
      border-radius:50%;
      animation:pulse 2s ease-in-out infinite;
    }
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .banner h1{
      font-size:clamp(22px,5vw,30px);
      font-weight:400;
      line-height:1.2;
      letter-spacing:-.5px;
      margin-bottom:8px;
    }
    .banner p{
      font-size:13px;
      color:rgba(17,17,24,.58);
      line-height:1.6;
      max-width:480px;
    }
    .banner p a{color:rgba(17,17,24,.58);text-decoration:none}
    .banner p a:hover{color:#111118}
    .meta-bar{
      display:flex;
      align-items:center;
      gap:12px;
      margin-top:14px;
      font-family:monospace;
      font-size:11px;
      color:rgba(17,17,24,.52);
    }
    .meta-bar .sep{width:1px;height:12px;background:rgba(16,16,24,.12)}
    .items{display:flex;flex-direction:column;gap:12px}
    .card{
      background:#fff;
      border:1px solid rgba(16,16,24,.14);
      border-radius:10px;
      padding:16px;
      box-shadow:0 18px 44px rgba(17,17,24,.07);
    }
    .card-top{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:12px;
      margin-bottom:10px;
    }
    .card-title{
      font-size:15px;
      font-weight:400;
      line-height:1.3;
      color:rgba(17,17,24,.92);
    }
    .card-title a{color:inherit;text-decoration:none}
    .card-title a:hover{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
    .pill{
      font-family:monospace;
      font-size:11px;
      color:rgba(17,17,24,.72);
      background:rgba(79,70,229,.07);
      border:1px solid rgba(79,70,229,.16);
      padding:6px 10px;
      border-radius:999px;
      white-space:nowrap;
      flex-shrink:0;
    }
    .card-meta{
      display:flex;
      align-items:center;
      flex-wrap:wrap;
      gap:8px;
      font-size:12px;
      color:rgba(17,17,24,.78);
    }
    .mk{
      font-family:monospace;
      font-size:10px;
      letter-spacing:1px;
      text-transform:uppercase;
      color:rgba(17,17,24,.52);
    }
    .mv{font-weight:300}
    .card-links{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:10px;
    }
    .link-btn{
      font-family:monospace;
      font-size:10px;
      letter-spacing:2px;
      text-transform:uppercase;
      text-decoration:none;
      color:rgba(17,17,24,.78);
      border:1px solid rgba(16,16,24,.14);
      border-radius:999px;
      padding:8px 12px;
      background:rgba(17,17,24,.02);
      transition:border-color .2s;
    }
    .link-btn:hover{border-color:rgba(79,70,229,.34)}
    .copy-hint{
      margin-top:28px;
      text-align:center;
      font-family:monospace;
      font-size:11px;
      color:rgba(17,17,24,.42);
    }
    .copy-hint code{
      background:rgba(79,70,229,.07);
      border:1px solid rgba(79,70,229,.16);
      padding:3px 8px;
      border-radius:4px;
      font-size:11px;
      color:rgba(17,17,24,.72);
    }
    @media(max-width:520px){
      .card-top{flex-direction:column;align-items:flex-start}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <div class="banner-badge">Flux RSS</div>
      <h1><xsl:value-of select="/rss/channel/title"/></h1>
      <p><xsl:value-of select="/rss/channel/description"/></p>
      <div class="meta-bar">
        <span><xsl:value-of select="count(/rss/channel/item)"/> concours</span>
        <span class="sep"></span>
        <span>Mis à jour : <xsl:value-of select="/rss/channel/lastBuildDate"/></span>
      </div>
    </div>

    <div class="items">
      <xsl:for-each select="/rss/channel/item">
        <div class="card">
          <div class="card-top">
            <h2 class="card-title">
              <a href="{link}" target="_blank" rel="noopener noreferrer">
                <xsl:value-of select="title"/>
              </a>
            </h2>
            <xsl:if test="pubDate">
              <span class="pill"><xsl:value-of select="pubDate"/></span>
            </xsl:if>
          </div>
          <div class="card-links">
            <a class="link-btn" href="{link}" target="_blank" rel="noopener noreferrer">Voir le concours</a>
          </div>
        </div>
      </xsl:for-each>
    </div>

    <p class="copy-hint">
      Copiez l'URL du flux dans votre lecteur RSS : <code><xsl:value-of select="/rss/channel/link"/>/feed.xml</code>
    </p>
  </div>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
