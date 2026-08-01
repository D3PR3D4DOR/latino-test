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

// --- HTTP HELPERS (TEMPORAL CON LOGS DETALLADOS DE DEPURACIÓN) ---
async function fetchText(url, extraHeaders) {
  try {
    const headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
    console.log(`\n[DEBUG FETCH] ----------------------------------------`);
    console.log(`[DEBUG FETCH] URL Solicitada: ${url}`);
    console.log(`[DEBUG FETCH] Cabeceras Enviadas:`, JSON.stringify(headers, null, 2));

    const res = await fetch(url, { headers: headers });
    
    console.log(`[DEBUG FETCH] Código de Estado HTTP: ${res.status} ${res.statusText}`);

    if (res.status === 403) {
      console.log(`[DEBUG FETCH] ⚠️ ALERTA EXPLÍCITA: La respuesta es 403 Forbidden.`);
    }

    if (!res.ok) {
      console.log(`[DEBUG FETCH] ❌ Petición no exitosa (status >= 400). Retornando null.`);
      return null;
    }

    const text = await res.text();
    const snippet = text ? text.substring(0, 300).replace(/\s+/g, ' ') : '';
    console.log(`[DEBUG FETCH] Primeros 300 caracteres del HTML:\n"${snippet}"`);

    if (text.includes("Just a moment...") || text.includes("cloudflare") || text.includes("cf-challenge") || text.includes("Attention Required!")) {
      console.log(`[DEBUG FETCH] ⚠️ ALERTA: La respuesta contiene una página de Cloudflare / Captcha.`);
    } else if (text.includes("eval(function(p,a,c,k,e,") || text.includes(".m3u8") || text.includes("jwplayer") || text.includes("Player")) {
      console.log(`[DEBUG FETCH] ✅ ÉXITO: La respuesta contiene la estructura del reproductor.`);
    } else {
      console.log(`[DEBUG FETCH] ℹ️ Respuesta recibida, pero no contiene patrones claros de reproductor.`);
    }

    return text;
  } catch (e) {
    console.log(`[DEBUG FETCH] ❌ Excepción en fetchText: ${e.message}. Retornando null.`);
    return null;
  }
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

// ============================================================================
// RESOLUCIÓN Y UNPACKER DE REPRODUCTORES
// ============================================================================

function unpackPacker(packedCode) {
  try {
    const reg = /eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\('([^']*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)\)\)/s;
    const match = reg.exec(packedCode);
    if (!match) return packedCode;

    let [_, p, aStr, cStr, kStr] = match;
    let a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    let k = kStr.split('|');

    function e(c) {
      return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
    }

    while (c--) {
      if (k[c]) {
        p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
      }
    }
    return p;
  } catch (err) {
    return packedCode;
  }
}

async function resolveEmbedToDirectStream(embedUrl) {
  try {
    console.log(`\n[DEBUG RESOLVER BASE] Evaluando embed: ${embedUrl}`);
    const html = await fetchText(embedUrl, { "Referer": BASE_URL + "/" });
    if (!html) {
      console.log(`[DEBUG RESOLVER BASE] Falló la obtención de HTML para: ${embedUrl}`);
      return null;
    }

    let directUrl = null;

    if (html.includes("eval(function(p,a,c,k,e,")) {
      const unpacked = unpackPacker(html);
      const m3u8Match = unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                        unpacked.match(/src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                        unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
      
      if (m3u8Match) {
        directUrl = m3u8Match[1];
      }
    }

    if (!directUrl) {
      const directMatch = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i) ||
                          html.match(/(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i);
      if (directMatch) {
        directUrl = directMatch[1];
      }
    }

    if (!directUrl && embedUrl.includes("voe.sx")) {
      const voeMatch = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i) || 
                       html.match(/href\s*=\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
      if (voeMatch) {
        directUrl = voeMatch[1];
      }
    }

    if (directUrl) {
      const cleanUrl = directUrl.replace(/\\/g, '');
      console.log(`[DEBUG RESOLVER BASE] ✅ Extracción exitosa: ${cleanUrl}`);
      return cleanUrl;
    }

  } catch (e) {
    console.log("[PelisplusHD] Error resolviendo stream directo desde: " + embedUrl);
  }

  console.log(`[DEBUG RESOLVER BASE] ❌ No se pudo encontrar URL de video directa.`);
  return null;
}

// --- CRYPTO / EMBED69 EXTRACTOR ---
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
        return hashWords;
      }
      nonce++;
    }
  }
}

function decryptAES(encryptedBase64, aesKeyWordArray) {
  try {
    const raw = CryptoJS.enc.Base64.parse(encryptedBase64);
    const iv = CryptoJS.lib.WordArray.create(raw.words.slice(0, 4), 16);
    const ciphertext = CryptoJS.lib.WordArray.create(raw.words.slice(4), raw.sigBytes - 16);
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

function fetchUrlsFromScript(scriptText) {
  const urls = [];
  const regex = /(https?:\/\/[^\s"'<>]+)/g;
  let match;
  while ((match = regex.exec(scriptText)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// --- BÚSQUEDA Y METADATOS ---
async function getTmdbTitle(tmdbId, mediaType) {
  const type = (mediaType === "series" || mediaType === "tv") ? "tv" : "movie";
  const data = await fetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`);
  if (!data) return null;

  return {
    title: type === "movie" ? (data.title || data.original_title) : (data.name || data.original_name),
    year: (type === "movie" ? data.release_date : data.first_air_date || "").slice(0, 4)
  };
}

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
    const meta = await getTmdbTitle(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    const searchResults = await searchPelisplus(meta.title);
    if (!searchResults.length) return [];

    const matched = searchResults.find(r => r.title.toLowerCase().includes(meta.title.toLowerCase())) || searchResults[0];
    let pageUrl = matched.href.startsWith("http") ? matched.href : `${BASE_URL}${matched.href}`;

    if ((mediaType === "tv" || mediaType === "series") && season && episode) {
      const epHref = await getEpisodeUrl(pageUrl, season, episode);
      if (!epHref) return [];
      pageUrl = epHref.startsWith("http") ? epHref : `${BASE_URL}${epHref}`;
    }

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

    for (const embedUrl of embeddedUrls) {
      if (embedUrl.includes("embed69.org")) {
        const embed69Results = await loadEmbed69(embedUrl, pageUrl);
        for (const item of embed69Results) {
          
          const directStreamUrl = await resolveEmbedToDirectStreamModular(item.url);
          const finalMediaUrl = directStreamUrl || item.url;

          const labelInfo = `${item.language} - ${item.server}`;
          finalStreams.push({
            name: `${PROVIDER_NAME} · ${item.server}`,
            title: `${labelInfo} · 1080p`,
            size: `${labelInfo} · 1080p`,
            quality: "1080p",
            url: finalMediaUrl,
            headers: {
              "Referer": item.url,
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
              const rawEmbedUrl = fixHostsLinks(m[1]);
              const directStreamUrl = await resolveEmbedToDirectStreamModular(rawEmbedUrl);

              finalStreams.push({
                name: `${PROVIDER_NAME} · XuPalace`,
                title: `Latino · 720p`,
                size: `Latino · 720p`,
                quality: "720p",
                url: directStreamUrl || rawEmbedUrl,
                headers: { 
                  "Referer": rawEmbedUrl, 
                  "User-Agent": DEFAULT_HEADERS["User-Agent"] 
                },
                behaviorHints: { notWebReady: true }
              });
            }
          }
        }
      } else {
        const frameHtml = await fetchText(embedUrl);
        if (frameHtml) {
          const $f = cheerio.load(frameHtml);
          const iframeSrc = $f("iframe").attr("src");
          if (iframeSrc) {
            const rawEmbedUrl = fixHostsLinks(iframeSrc);
            const directStreamUrl = await resolveEmbedToDirectStreamModular(rawEmbedUrl);

            finalStreams.push({
              name: `${PROVIDER_NAME} · Server`,
              title: `Latino · 720p`,
              size: `Latino · 720p`,
              quality: "720p",
              url: directStreamUrl || rawEmbedUrl,
              headers: { 
                "Referer": rawEmbedUrl, 
                "User-Agent": DEFAULT_HEADERS["User-Agent"] 
              },
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

// ============================================================================
// RESOLVERS CON LOGS ADICIONALES
// ============================================================================

function unpackPackedCode(packedJS) {
  try {
    if (!packedJS || !packedJS.includes('eval(function(p,a,c,k,e,')) return packedJS;
    const reg = /eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\('([^']*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/s;
    const match = packedJS.match(reg);
    if (!match) return packedJS;

    let [_, p, aStr, cStr, kStr] = match;
    let a = parseInt(aStr, 10);
    let c = parseInt(cStr, 10);
    let k = kStr.split('|');

    const e = function (val) {
      return (val < a ? '' : e(parseInt(val / a))) + ((val = val % a) > 35 ? String.fromCharCode(val + 29) : val.toString(36));
    };

    while (c--) {
      if (k[c]) {
        const regWord = new RegExp('\\b' + e(c) + '\\b', 'g');
        p = p.replace(regWord, k[c]);
      }
    }
    return p;
  } catch (err) {
    return packedJS;
  }
}

async function resolvePackedEmbedQuickJS(embedUrl) {
  try {
    console.log(`\n[DEBUG PACKED RESOLVER] Solicitando embed: ${embedUrl}`);
    const html = await fetchText(embedUrl, { "Referer": BASE_URL + "/" });
    if (!html) {
      console.log(`[DEBUG PACKED RESOLVER] HTML nulo devuelto para: ${embedUrl}`);
      return null;
    }

    const unpacked = unpackPackedCode(html);
    const m3u8Match = unpacked.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/) || html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);

    if (m3u8Match) {
      const streamUrl = m3u8Match[0].replace(/\\/g, '');
      console.log(`[DEBUG PACKED RESOLVER] ✅ Stream m3u8 encontrado: ${streamUrl}`);
      return streamUrl;
    }
  } catch (e) {
    console.log(`[DEBUG PACKED RESOLVER] Error: ${e.message}`);
  }
  console.log(`[DEBUG PACKED RESOLVER] ❌ No se encontró coincidencia m3u8.`);
  return null;
}

async function resolveVoeEmbedQuickJS(embedUrl) {
  try {
    console.log(`\n[DEBUG VOE RESOLVER] Solicitando embed: ${embedUrl}`);
    const html = await fetchText(embedUrl);
    if (!html) {
      console.log(`[DEBUG VOE RESOLVER] HTML nulo devuelto para: ${embedUrl}`);
      return null;
    }

    let m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8/);
    if (!m3u8Match) {
      const b64Match = html.match(/let\s+sources\s*=\s*['"]([A-Za-z0-9+/=]+)['"]/);
      if (b64Match) {
        const decoded = CryptoJS.enc.Base64.parse(b64Match[1]).toString(CryptoJS.enc.Utf8);
        m3u8Match = decoded.match(/https?:\/\/[^"'\s]+\.m3u8/);
      }
    }

    if (m3u8Match) {
      console.log(`[DEBUG VOE RESOLVER] ✅ Stream m3u8 encontrado: ${m3u8Match[0]}`);
      return m3u8Match[0];
    }
  } catch (e) {
    console.log(`[DEBUG VOE RESOLVER] Error: ${e.message}`);
  }
  console.log(`[DEBUG VOE RESOLVER] ❌ No se encontró coincidencia m3u8.`);
  return null;
}

async function resolveEmbedToDirectStreamModular(embedUrl) {
  if (!embedUrl) return null;

  try {
    console.log(`\n======================================================`);
    console.log(`[DEBUG MODULAR ROUTER] Procesando URL Embed: ${embedUrl}`);
    
    const directUrlOriginal = await resolveEmbedToDirectStream(embedUrl);
    if (directUrlOriginal) return directUrlOriginal;

    if (/vidhide|medixiru|streamwish|fastream|wishfast|filelions/i.test(embedUrl)) {
      return await resolvePackedEmbedQuickJS(embedUrl);
    }

    if (/voe|voe-unblock/i.test(embedUrl)) {
      return await resolveVoeEmbedQuickJS(embedUrl);
    }

    return await resolvePackedEmbedQuickJS(embedUrl);
  } catch (e) {
    return null;
  }
}

module.exports = { getStreams };