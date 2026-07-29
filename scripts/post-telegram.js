const RSSParser = require('rss-parser');
const parser = new RSSParser({ timeout: 10000 }); // Timeout de 10s para la lectura del RSS

const FEED_URL = 'http://eventos.murcia.es/rss/location/espana/lo-1.rss';
const TZ = 'Europe/Madrid';
const MAX_POSTS = 12;
const DELAY_MS = 1000;         // 1 segundo entre envíos es más seguro para Telegram
const SEND_RETRIES = 3;

// Set para controlar duplicados en la misma ejecución
const processedIds = new Set();

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHTML(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

// ── Telegram API (usando Fetch nativo) ──────────────────────────────────────

async function sendTG(text) {
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text,
      disable_web_page_preview: false,
      parse_mode: 'HTML'
    })
  });

  const body = await response.json();

  if (!response.ok) {
    // Manejar el caso específico de Too Many Requests (HTTP 429)
    if (response.status === 429 && body.parameters?.retry_after) {
      const waitSec = body.parameters.retry_after;
      console.warn(`⏳ Telegram Rate Limit. Esperando ${waitSec}s...`);
      await sleep(waitSec * 1000);
    }
    throw new Error(`TG ${response.status}: ${body.description || JSON.stringify(body)}`);
  }

  return body;
}

async function sendWithRetry(text, retries = SEND_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await sendTG(text);
    } catch (e) {
      if (i === retries - 1) throw e;
      const wait = 1000 * 2 ** i;
      console.warn(`⚠️ Reintento ${i + 1}/${retries - 1} en ${wait}ms — ${e.message}`);
      await sleep(wait);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.error('❌ Faltan TG_BOT_TOKEN o TG_CHAT_ID en las variables de entorno');
    process.exit(1);
  }

  console.log('📡 Obteniendo RSS de eventos...');
  let feed;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    throw new Error(`Error al descargar el RSS: ${err.message}`);
  }

  const todayYMD = toYMD(new Date(), TZ);

  const todayItems = (feed.items || []).filter(it => {
    const rawDate = it.isoDate || it.pubDate;
    if (!rawDate) return false;
    const d = new Date(rawDate);
    return !isNaN(d) && toYMD(d, TZ) === todayYMD;
  });

  if (!todayItems.length) {
    console.log('ℹ️ No hay eventos para hoy.');
    return;
  }

  const items = todayItems.slice(0, MAX_POSTS);
  console.log(`📅 ${items.length} evento(s) encontrado(s) para hoy.`);

  for (const it of items) {
    // Evita procesar elementos duplicados dentro del mismo feed
    const itemKey = it.guid || it.link || it.title;
    if (processedIds.has(itemKey)) continue;
    processedIds.add(itemKey);

    const d = new Date(it.isoDate || it.pubDate);
    const hora = isNaN(d) ? '' : toHM(d, TZ);
    
    // Escapar HTML en el contenido dinámico para no romper parse_mode: 'HTML'
    const title = escapeHTML(cleanText(it.title, 200));
    const desc = escapeHTML(cleanText(it.contentSnippet || it.content || '', 150));
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
    console.log(`✅ Enviado: ${it.title}`);
    await sleep(DELAY_MS);
  }

  console.log('🎉 Todos los eventos procesados.');
})().catch(e => { 
  console.error('❌ Error fatal:', e.message); 
  process.exit(1); 
});
