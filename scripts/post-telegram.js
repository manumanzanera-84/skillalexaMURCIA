const https = require('https');
const RSSParser = require('rss-parser');
const parser = new RSSParser();

const FEED_URL = 'http://eventos.murcia.es/rss/location/espana/lo-1.rss';
const TZ = 'Europe/Madrid';
const MAX_POSTS = 5;

function toYMD(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function toHM(date, timeZone) {
  return new Intl.DateTimeFormat('es-ES', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function cleanText(s='', max=300) {
  const t = s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  return t.length > max ? t.slice(0, max-1)+'…' : t;
}
function sendTG(text) {
  const data = JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text, disable_web_page_preview: false, parse_mode: 'HTML' });
  return new Promise((resolve, reject) => {
    const u = new URL(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`);
    const req = https.request({ method:'POST', hostname:u.hostname, path:u.pathname+u.search, headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } },
      res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=> res.statusCode<300 ? resolve(b):reject(new Error(`TG ${res.statusCode}: ${b}`))); });
    req.on('error', reject); req.write(data); req.end();
  });
}

(async () => {
  const feed = await parser.parseURL(FEED_URL);
  const todayYMD = toYMD(new Date(), TZ);
  const todayItems = (feed.items||[]).filter(it => {
    const d = it.isoDate ? new Date(it.isoDate) : (it.pubDate ? new Date(it.pubDate) : null);
    return d && !isNaN(d) && toYMD(d, TZ) === todayYMD;
  });

  if (!todayItems.length) { console.log('No hay eventos hoy.'); return; }

  for (const it of todayItems.slice(0, MAX_POSTS)) {
    const d = it.isoDate ? new Date(it.isoDate) : new Date(it.pubDate);
    const hora = isNaN(d) ? '' : toHM(d, TZ);
    const title = cleanText(it.title, 200);
    const url = it.link || 'https://eventos.murcia.es';
    const msg = hora ? `<b>${title}</b>\n🕘 ${hora}\n🔗 ${url}\n#Murcia #Eventos` 
                     : `<b>${title}</b>\n🔗 ${url}\n#Murcia #Eventos`;
    await sendTG(msg);
    console.log('Enviado a Telegram:', title);
  }
})().catch(e=>{ console.error(e); process.exit(1); });
