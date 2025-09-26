const RSSParser = require('rss-parser');
const { TwitterApi } = require('twitter-api-v2');

const FEED_URL = 'http://eventos.murcia.es/rss/location/espana/lo-1.rss';
const TZ = 'Europe/Madrid';
const MAX_TWEETS = 3;

// ---- Utils ----
function toYMD(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function toHM(date, timeZone) {
  return new Intl.DateTimeFormat('es-ES', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
function cleanText(s = '', max = 240) {
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

(async () => {
  const parser = new RSSParser();
  const feed = await parser.parseURL(FEED_URL);

  const todayYMD = toYMD(new Date(), TZ);
  const itemsToday = (feed.items || []).filter(it => {
    const d = it.isoDate ? new Date(it.isoDate) : (it.pubDate ? new Date(it.pubDate) : null);
    return d && !isNaN(d) && toYMD(d, TZ) === todayYMD;
  });

  if (!itemsToday.length) {
    console.log('No hay eventos hoy; nada que publicar.');
    return;
  }

  // OAuth 1.0a (user context)
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });

  // Diagnóstico: quién soy
  try {
    const me = await client.v2.me();
    console.log('Autenticado como @' + me.data.username + ' (id ' + me.data.id + ')');
  } catch (e) {
    console.error('Fallo autenticación v2.me():', e?.data || e);
    process.exit(1);
  }

  // Intento v2 → si 401, pruebo v1.1
  for (const it of itemsToday.slice(0, MAX_TWEETS)) {
    const d = it.isoDate ? new Date(it.isoDate) : new Date(it.pubDate);
    const hora = isNaN(d) ? '' : toHM(d, TZ);
    const title = cleanText(it.title, 200);
    const url = it.link || 'https://eventos.murcia.es';
    const text = hora ? `${title} — ${hora}\n${url}\n#Murcia #Eventos`
                      : `${title}\n${url}\n#Murcia #Eventos`;

    try {
      const { data } = await client.v2.tweet(text);
      console.log('Publicado v2:', data.id, title);
    } catch (e) {
      const code = e?.code || e?.data?.status || 'unknown';
      console.warn('Fallo v2.tweet (code ' + code + '), probando v1.1…');
      try {
        const res = await client.v1.tweet(text);
        console.log('Publicado v1.1:', res.id_str, title);
      } catch (e2) {
        console.error('También falló v1.1:', e2?.data || e2);
        process.exit(1);
      }
    }
  }
})().catch(err => { console.error(err); process.exit(1); });
