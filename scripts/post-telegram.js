const https = require('https');
const RSSParser = require('rss-parser');
const parser = new RSSParser();

const FEED_URL = 'http://eventos.murcia.es/rss/location/espana/lo-1.rss';
const TZ = 'Europe/Madrid';
const MAX_POSTS = 12;
const DELAY_MS = 500;         // pausa entre mensajes para evitar rate limiting
const SEND_RETRIES = 3;       // reintentos ante fallos de red o 429

// ── helpers ────────────────────────────────────────────────────────────────

function toYMD(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function toHM(date, timeZone) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function cleanText(s = '', max = 300) {
  const t = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Telegram ────────────────────────────────────────────────────────────────

function sendTG(text) {
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  const data = JSON.stringify({
    chat_id: TG_CHAT_ID,
    text,
    disable_web_page_preview: false,
    parse_mode: 'HTML'
  });
  return new Promise((resolve, reject) => {
    const u = new URL(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => res.statusCode < 300 ? resolve(b) : reject(new Error(`TG ${res.statusCode}: ${b}`)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendWithRetry(text, retries = SEND_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await sendTG(text);
    } catch (e) {
      if (i === retries - 1) throw e;
      const wait = 1000 * 2 ** i; // 1 s → 2 s → 4 s
      console.warn(`⚠️  Reintento ${i + 1}/${retries - 1} en ${wait}ms — ${e.message}`);
      await sleep(wait);
    }
  }
}

// ── main ────────────────────────────────────────────────────────────────────

(async () => {
  // Validar credenciales antes de hacer cualquier petición
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.error('❌ Faltan TG_BOT_TOKEN o TG_CHAT_ID en las variables de entorno');
    process.exit(1);
  }

  const feed = await parser.parseURL(FEED_URL);
  const todayYMD = toYMD(new Date(), TZ);

  const todayItems = (feed.items || []).filter(it => {
    const d = it.isoDate ? new Date(it.isoDate) : (it.pubDate ? new Date(it.pubDate) : null);
    return d && !isNaN(d) && toYMD(d, TZ) === todayYMD;
  });

  if (!todayItems.length) {
    console.log('ℹ️  No hay eventos para hoy.');
    return;
  }

  const items = todayItems.slice(0, MAX_POSTS);
  console.log(`📅 ${items.length} evento(s) encontrado(s) para hoy.`);

  for (const it of items) {
    const d = it.isoDate ? new Date(it.isoDate) : new Date(it.pubDate);
    const hora = isNaN(d) ? '' : toHM(d, TZ);
    const title = cleanText(it.title, 200);
    const desc = cleanText(it.contentSnippet || it.content || '', 150);
    const url = it.link || 'https://eventos.murcia.es';

    const lines = [
      `<b>${title}</b>`,
      hora ? `🕘 ${hora}` : null,
      desc ? desc : null,
      `🔗 ${url}`,
      `#Murcia #Eventos`
    ].filter(Boolean);

    const msg = lines.join('\n');

    await sendWithRetry(msg);
    console.log(`✅ Enviado: ${title}`);
    await sleep(DELAY_MS);
  }

  console.log('🎉 Todos los eventos enviados.');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
