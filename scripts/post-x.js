// scripts/post-x.js
const RSSParser = require('rss-parser');
const { TwitterApi } = require('twitter-api-v2');

const FEED_URL = 'http://eventos.murcia.es/rss/location/espana/lo-1.rss';
const TZ = 'Europe/Madrid';

// ---- Utils ----
function toYMD(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date); // YYYY-MM-DD
}
function toHM(date, timeZone) {
  return new Intl.DateTimeFormat('es-ES', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(date); // "18:30"
}
function cleanText(s = '', max = 240) {
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ---- Main ----
(async () => {
  const parser = new RSSParser();
  const feed = await parser.parseURL(FEED_URL);

  // Fecha "hoy" en Madrid (YYYY-MM-DD) usando pubDate/isoDate del RSS
  const todayYMD = toYMD(new Date(), TZ);

  const itemsToday = (feed.items || []).filter(it => {
    const d = it.isoDate ? new Date(it.isoDate) : (it.pubDate ? new Date(it.pubDate) : null);
    if (!d || isNaN(d)) return false;
    return toYMD(d, TZ) === todayYMD;
  });

  if (!itemsToday.length) {
    console.log('No hay eventos hoy; nada que publicar.');
    return;
  }

  // Autenticación X (OAuth 1.0a user context)
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  // Limita a N tuits por día si quieres (ej. 3)
  const MAX_TWEETS = 5;

  for (const it of itemsToday.slice(0, MAX_TWEETS)) {
    const d = it.isoDate ? new Date(it.isoDate) : new Date(it.pubDate);
    const title = cleanText(it.title, 200);
    const url = it.link || 'https://eventos.murcia.es';
    const hora = toHM(d, TZ);

    // Plantilla del tuit
    const text = `${title} — ${hora}\n${url}\n#Murcia #Eventos`;

    // Publica
    const { data } = await client.v2.tweet(text);
    console.log('Publicado:', data.id, title);
  }

  // (Opcional) Si prefieres 1 solo tuit resumen en lugar de varios:
  // const resumen = itemsToday.slice(0, 4).map(it => `• ${cleanText(it.title, 100)}`).join('\n');
  // await client.v2.tweet(`Planes de hoy en Murcia:\n${resumen}\nMás info: https://eventos.murcia.es\n#Murcia #Eventos`);
})();
