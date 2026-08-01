"use strict";

const cheerio = require('cheerio-without-node-native');
const CryptoJS = require('crypto-js');

const PROVIDER_NAME = "PelisplusHD";
let BASE_URL = "https://pelisplushd.bz";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
};

// --- HTTP HELPER ---
async function fetchText(url, extraHeaders) {
  try {
    const headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    const res = await fetch(url, { headers: headers });
    if (res.ok) return await res.text();
  } catch (e) {
    console.log("[PelisplusHD] Fetch error: " + e.message);
  }
  return null;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

// --- HOST FIXER (Equivalente exacto a fixHostsLinks en Kotlin) ---
function fixHostsLinks(url) {
  if (!url) return "";
  return url
    .replace(/^https:\/\/hglink\.to/, "https://streamwish.to")
    .replace(/^https:\/\/swdyu\.com/, "https://streamwish.to")
    .replace(/^https:\/\/cybervynx\.com/, "https://streamwish.to")
    .replace(/^https:\/\/dumbalag\.com/, "https://streamwish.to")
    .replace(/^https:\/\/mivalyo\.com/, "https://vidhidepro.com")
    .replace(/^https:\/\/dinisglows\.com/, "https://vidhidepro.com")
    .replace(/^https:\/\/dhtpre\.com/, "https://vidhidepro.com")
    .replace(/^https:\/\/filemoon\.link/, "https://filemoon.sx")
    .replace(/^https:\/\/sblona\.com/, "https://watchsb.com")
    .replace(/^https:\/\/lulu\.st/, "https://lulustream.com")
    .replace(/^https:\/\/uqload\.io/, "https://uqload.com")
    .replace(/^https:\/\/do7go\.com/, "https://dood.la");
}

// --- CRYPTO / EMBED69 EXTRACTOR (Adaptación de Embed69Extractor.kt) ---
function deriveAesKey(challenge, difficulty, salt) {
  const prefix = "0".repeat(difficulty);
  let nonce = 0;
  const batchSize = 5000;

  while (true) {
    for (let i = 0; i < batchSize; i++) {
      const inputHex = challenge + nonce;
      const hashHex = CryptoJS.SHA256(inputHex).toString(CryptoJS.enc.Hex);
      if (hashHex.startsWith(prefix)) {
        const fullInput = challenge + nonce + salt;
        const hashWords = CryptoJS.SHA256(fullInput);
        return hashWords; // Retorna WordArray de CryptoJS
      }
      nonce++;
    }
  }
}

function decryptAES(encryptedBase64, aesKeyWordArray) {
  try {
    const raw = CryptoJS.enc.Base64.parse(encryptedBase64);
    // Extracción de IV (primeros 16 bytes = 4 words)
    const iv = CryptoJS.lib.WordArray.create(raw.words.slice(0, 4), 16);
    // Extracción del Ciphertext (resto de bytes)
    const ciphertext = CryptoJS.lib.WordArray.create(raw.words.slice(4), raw.sigBytes - 16);
    
    // Tomar primeros 32 bytes de la clave (8 words)
    const key = CryptoJS.lib.WordArray.create(aesKeyWordArray.words.slice(0, 8), 32);

    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: ciphertext },
      key,
      {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
    return decryptedStr || null;
  } catch (e) {
    return null;
  }
}

async function loadEmbed69(url, referer) {
  const html = await fetchText(url, { "Referer": referer });
  if (!html) return [];

  const $ = cheerio.load(html);
  let scriptContent = null;

  $('script').each((i, el) => {
    const content = $(el).html() || "";
    if (content.includes("dataLink = [")) {
      scriptContent = content;
    }
  });

  if (!scriptContent) return [];

  try {
    const powChallenge = scriptContent.split("const POW_CHALLENGE = '")[1].split("';")[0];
    const powDifficulty = parseInt(scriptContent.split("const POW_DIFFICULTY = ")[1].split(";")[0], 10);
    const powSalt = scriptContent.split("const POW_SALT = '")[1].split("';")[0];

    const aesKey = deriveAesKey(powChallenge, powDifficulty, powSalt);

    const jsonStr = scriptContent.split("dataLink = ")[1].split(";")[0];
    const serversByLang = JSON.parse(jsonStr);
    const extractedLinks = [];

    for (const langObj of serversByLang) {
      const lang = langObj.video_language || "Latino";
      const sortedEmbeds = langObj.sortedEmbeds || [];

      for (const embed of sortedEmbeds) {
        if (embed.link) {
          const decrypted = decryptAES(embed.link, aesKey);
          if (decrypted) {
            extractedLinks.push({
              url: fixHostsLinks(decrypted),
              language: lang,
              server: embed.servername || "Server"
            });
          }
        }
      }
    }
    return extractedLinks;
  } catch (e) {
    console.log("[PelisplusHD] Error procesando Embed69: " + e.message);
    return [];
  }
}

// --- REPRODUCTORES ADICIONALES (xupalace / uqlink) ---
function fetchUrlsFromScript(scriptText) {
  const urls = [];
  const regex = /(https?:\/\/[^\s"'<>]+)/g;
  let match;
  while ((match = regex.exec(scriptText)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// --- OBTENER INFORMACIÓN TMDB ---
async function getTmdbTitle(tmdbId, mediaType) {
  const type = (mediaType === "series" || mediaType === "tv") ? "tv" : "movie";
  const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`);
  if (!data) return null;

  return {
    title: type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name),
    year: (type === "movie" ? data.release_date : data.first_air_date || "").slice(0, 4)
  };
}

// --- BÚSQUEDA Y NAVEGACIÓN EN PELISPLUS ---
async function searchPelisplus(query) {
  const html = await fetchText(`${BASE_URL}/search?s=${encodeURIComponent(query)}`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results = [];

  $('a.Posters-link').each((i, el) => {
    const href = $(el).attr('href');
    const title = $(el).find('.listing-content p').text().trim();
    if (href && title) {
      results.push({ title, href });
    }
  });

  return results;
}

async function getEpisodeUrl(seriesUrl, season, episode) {
  const html = await fetchText(seriesUrl);
  if (!html) return null;

  const $ = cheerio.load(html);
  let targetHref = null;

  $('div.tab-pane .btn').each((i, el) => {
    const href = $(el).find('a').attr('href');
    if (!href) return;

    // Lógica portada de CloudStream: extraer "/temporada/X/capitulo/Y"
    const seasonInfo = href.split("temporada/")[1];
    if (seasonInfo) {
      const parts = seasonInfo.replace("/capitulo/", "-").split("-").map(p => parseInt(p, 10));
      if (parts.length >= 2 && parts[0] === Number(season) && parts[1] === Number(episode)) {
        targetHref = href;
      }
    }
  });

  return targetHref;
}

// --- ENTRY POINT PRINCIPAL DE NUVIO ---
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    // 1. Obtener Metadatos
    const meta = await getTmdbTitle(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    // 2. Buscar en PelisplusHD
    const searchResults = await searchPelisplus(meta.title);
    if (!searchResults.length) return [];

    // Seleccionar la mejor coincidencia
    const matched = searchResults.find(r => r.title.toLowerCase().includes(meta.title.toLowerCase())) || searchResults[0];
    let pageUrl = matched.href.startsWith("http") ? matched.href : `${BASE_URL}${matched.href}`;

    // 3. Resolver episodio si es serie TV
    if ((mediaType === "tv" || mediaType === "series") && season && episode) {
      const epHref = await getEpisodeUrl(pageUrl, season, episode);
      if (!epHref) return [];
      pageUrl = epHref.startsWith("http") ? epHref : `${BASE_URL}${epHref}`;
    }

    // 4. Cargar página final y extraer script con "var video = [];"
    const pageHtml = await fetchText(pageUrl);
    if (!pageHtml) return [];

    const $ = cheerio.load(pageHtml);
    let videoScript = null;

    $('script').each((i, el) => {
      const html = $(el).html() || "";
      if (html.includes("var video = [];")) {
        videoScript = html;
      }
    });

    if (!videoScript) return [];

    const embeddedUrls = fetchUrlsFromScript(videoScript);
    const finalStreams = [];

    // 5. Procesar los enlaces extraídos (usando bucle secuencial seguro para QuickJS)
    for (const embedUrl of embeddedUrls) {
      if (embedUrl.includes("embed69.org")) {
        const embed69Results = await loadEmbed69(embedUrl, pageUrl);
        for (const item of embed69Results) {
          const labelInfo = `${item.language} - ${item.server}`;
          finalStreams.push({
            name: `${PROVIDER_NAME} · ${item.server}`,
            title: `${labelInfo} · 1080p`,
            size: `${labelInfo} · 1080p`, // Solución Mobile (ExoPlayer)
            quality: "1080p",
            url: item.url,
            headers: {
              "Referer": `${BASE_URL}/`,
              "User-Agent": DEFAULT_HEADERS["User-Agent"]
            },
            behaviorHints: { notWebReady: true }
          });
        }
      } else if (embedUrl.includes("xupalace.org/video")) {
        const xuHtml = await fetchText(embedUrl);
        if (xuHtml) {
          const regex = /(?:go_to_player|go_to_playerVast)\('(.*?)'/g;
          let m;
          while ((m = regex.exec(xuHtml)) !== null) {
            if (m[1]) {
              const streamUrl = fixHostsLinks(m[1]);
              finalStreams.push({
                name: `${PROVIDER_NAME} · XuPalace`,
                title: `Latino · 720p`,
                size: `Latino · 720p`,
                quality: "720p",
                url: streamUrl,
                headers: { "Referer": `${BASE_URL}/`, "User-Agent": DEFAULT_HEADERS["User-Agent"] },
                behaviorHints: { notWebReady: true }
              });
            }
          }
        }
      } else {
        // Embed directo o fallback (uqlink / iframe)
        const frameHtml = await fetchText(embedUrl);
        if (frameHtml) {
          const $f = cheerio.load(frameHtml);
          const iframeSrc = $f("iframe").attr("src");
          if (iframeSrc) {
            const finalUrl = fixHostsLinks(iframeSrc);
            finalStreams.push({
              name: `${PROVIDER_NAME} · Online`,
              title: `Latino · 720p`,
              size: `Latino · 720p`,
              quality: "720p",
              url: finalUrl,
              headers: { "Referer": `${BASE_URL}/`, "User-Agent": DEFAULT_HEADERS["User-Agent"] },
              behaviorHints: { notWebReady: true }
            });
          }
        }
      }
    }

    return finalStreams;
  } catch (err) {
    console.log("[PelisplusHD] Error general: " + err.message);
    return [];
  }
}

module.exports = { getStreams };