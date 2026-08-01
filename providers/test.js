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

// --- HTTP HELPERS ---
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

// ============================================================================
// RESOLUCIÓN Y UNPACKER DE REPRODUCTORES (NUEVO: EXTRAE .m3u8 / .mp4 DIRECTO)
// ============================================================================

/**
 * Unpacker para scripts codificados con Dean Edwards Packer: eval(function(p,a,c,k,e,d)...)
 */
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

/**
 * ================================
 * STREAMWISH ADVANCED RESOLVER
 * ================================
 *
 * Elementos copiados/adaptados desde Provider B:
 * - src/resolvers/hlswish.js -> unpackEval (función auxiliar)
 * - src/resolvers/hlswish.js -> lógica de resolve3 (mirrors array, race-resolve, /dl?op=view endpoint, unpack fallback, fileMatch)
 *
 * Adaptaciones realizadas:
 * - getSessionUA() sustituido por DEFAULT_HEADERS["User-Agent"]
 * - Se evita usar new URL(...) para obtener origin (se extrae por regex) para compatibilidad QuickJS
 * - No se copia validateStream: la función devuelve la URL string final (parche mínimo)
 */

// unpackEval copiado/adaptado de src/resolvers/hlswish.js
function unpackEval(payload, radix, symtab) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const unbase = (str) => {
    let result = 0;
    for (let i = 0; i < str.length; i++) {
      const pos = chars.indexOf(str[i]);
      if (pos === -1) return NaN;
      result = result * radix + pos;
    }
    return result;
  };
  return payload.replace(/\b([0-9a-zA-Z]+)\b/g, (match) => {
    const idx = unbase(match);
    if (isNaN(idx) || idx >= symtab.length) return match;
    return symtab[idx] && symtab[idx] !== "" ? symtab[idx] : match;
  });
}

// Detecta hosts de la familia StreamWish (lista tomada literalmente de Provider B)
function isStreamWishHost(url) {
  if (!url) return false;
  const s = url.toLowerCase();
  return s.includes("hanerix.com") ||
         s.includes("embedwish.com") ||
         s.includes("hglink.to") ||
         s.includes("streamwish.to") ||
         s.includes("awish.pro") ||
         s.includes("strwish.com") ||
         s.includes("wishfast.top") ||
         s.includes("sfastwish.com") ||
         s.includes("hlswish");
}

// resolveStreamWish: portado/adaptado de src/resolvers/hlswish.js -> resolve3
// Retorna la URL string final (por ejemplo .m3u8) o null
async function resolveStreamWish(embedUrl, signal = null) {
  try {
    if (!embedUrl) return null;
    const rawId = embedUrl.split("/").pop().replace(/\.html$/, "");
    const mirrors = [
      `https://hanerix.com/e/${rawId}`,
      `https://embedwish.com/e/${rawId}`,
      `https://hglink.to/e/${rawId}`,
      embedUrl,
      `https://streamwish.to/e/${rawId}`,
      `https://awish.pro/e/${rawId}`,
      `https://strwish.com/e/${rawId}`,
      `https://wishfast.top/e/${rawId}`,
      `https://sfastwish.com/e/${rawId}`
    ];

    // Race-resolve mirrors (lógica tomada de Provider B)
    return await new Promise((resolveRace) => {
      let resolved = false;
      let pending = mirrors.length;
      const TIMEOUT = 3500;

      mirrors.forEach((mirror) => (async () => {
        try {
          // Obtener origin sin new URL (compatibilidad QuickJS)
          let mirrorOrigin = null;
          const mo = mirror.match(/^https?:\/\/[^\/]+/i);
          if (mo) mirrorOrigin = mo[0];

          const resp = await fetch(mirror, {
            headers: { "Referer": mirror, "User-Agent": DEFAULT_HEADERS["User-Agent"] },
            signal
          });
          if (!resp.ok) return;
          const html = await resp.text();

          // 1) Buscar hash en la página y llamar al endpoint /dl?op=view...
          const hashMatch = html.match(/[0-9a-f]{32}/i);
          if (hashMatch && mirrorOrigin) {
            const hash = hashMatch[0];
            const dlUrl = `${mirrorOrigin}/dl?op=view&file_code=${rawId}&hash=${hash}&embed=1&referer=&adb=1&hls4=1`;
            try {
              const dlResp = await fetch(dlUrl, {
                headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": mirror, "X-Requested-With": "XMLHttpRequest" }
              });
              if (dlResp.ok) {
                const dlData = await dlResp.text();
                const m = dlData.match(/https?:\/\/[^"']+\.m3u8[^"']*/i);
                if (m && m[0] && !resolved) {
                  resolved = true;
                  resolveRace(m[0].replace(/\\/g, ""));
                  return;
                }
              }
            } catch (e) {}
          }

          // 2) Intentar desempaquetado eval(...) usando unpackEval (fallback)
          const packedMatch = html.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
          if (packedMatch) {
            try {
              const unpacked = unpackEval(packedMatch[1], parseInt(packedMatch[2], 10), packedMatch[4].split("|"));
              const m2 = unpacked.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
              if (m2 && m2[0] && !resolved) {
                resolved = true;
                resolveRace(m2[0].replace(/\\/g, ""));
                return;
              }
            } catch (e) {}
          }

          // 3) Buscar file: "..." o .m3u8 directamente en el HTML
          const fileMatch = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i);
          if (fileMatch && fileMatch[1] && !resolved) {
            let m3u8Url = fileMatch[1].replace(/\\/g, "");
            if (m3u8Url.startsWith("/") && mirrorOrigin) m3u8Url = mirrorOrigin + m3u8Url;
            resolved = true;
            resolveRace(m3u8Url);
            return;
          }
        } catch (e) {
          // Ignorar errores por mirror y continuar
        } finally {
          pending--;
          if (pending === 0 && !resolved) {
            resolveRace(null);
          }
        }
      })());

      // Timeout global (igual que Provider B)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolveRace(null);
        }
      }, TIMEOUT);
    });
  } catch (e) {
    return null;
  }
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
    // 1. Obtener Metadatos desde TMDB
    const meta = await getTmdbTitle(tmdbId, mediaType);
    if (!meta || !meta.title) return [];

    // 2. Buscar en PelisplusHD
    const searchResults = await searchPelisplus(meta.title);
    if (!searchResults.length) return [];

    const matched = searchResults.find(r => r.title.toLowerCase().includes(meta.title.toLowerCase())) || searchResults[0];
    let pageUrl = matched.href.startsWith("http") ? matched.href : `${BASE_URL}${matched.href}`;

    // 3. Resolver episodio si es serie
    if ((mediaType === "tv" || mediaType === "series") && season && episode) {
      const epHref = await getEpisodeUrl(pageUrl, season, episode);
      if (!epHref) return [];
      pageUrl = epHref.startsWith("http") ? epHref : `${BASE_URL}${epHref}`;
    }

    // 4. Cargar la página y extraer script de servidores
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

    // 5. Procesar e inspeccionar reproductores hasta obtener URL de video (.m3u8 / .mp4)
    for (const embedUrl of embeddedUrls) {
      if (embedUrl.includes("embed69.org")) {
        const embed69Results = await loadEmbed69(embedUrl, pageUrl);
        for (const item of embed69Results) {
          
          // RESOLUCIÓN A URL DIRECTA DE VIDEO
          const directStreamUrl = await resolveEmbedToDirectStream(item.url);
          const finalMediaUrl = directStreamUrl || item.url;

          const labelInfo = `${item.language} - ${item.server}`;
          finalStreams.push({
            name: `${PROVIDER_NAME} · ${item.server}`,
            title: `${labelInfo} · 1080p`,
            size: `${labelInfo} · 1080p`,
            quality: "1080p",
            url: finalMediaUrl, // URL física ejecutable por ExoPlayer
            headers: {
              "Referer": item.url, // Referer configurado con el dominio del Embed
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
              const directStreamUrl = await resolveEmbedToDirectStream(rawEmbedUrl);

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
        // Enlaces estándar o iframes
        const frameHtml = await fetchText(embedUrl);
        if (frameHtml) {
          const $f = cheerio.load(frameHtml);
          const iframeSrc = $f("iframe").attr("src");
          if (iframeSrc) {
            const rawEmbedUrl = fixHostsLinks(iframeSrc);
            const directStreamUrl = await resolveEmbedToDirectStream(rawEmbedUrl);

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

async function resolveEmbedToDirectStream(embedUrl) {
  try {
    // 1) Intento avanzado StreamWish (early attempt)
    if (isStreamWishHost(embedUrl)) {
      const resolved = await resolveStreamWish(embedUrl);
      if (resolved) return resolved;
    }

    // 2) Lógica original del Provider A (sin cambios) — solo una llamada a fetchText aquí
    const html = await fetchText(embedUrl, { "Referer": BASE_URL + "/" });
    if (!html) return null;

    let directUrl = null;

    // 1. Detección y desempaquetado de Packer (StreamWish, VidHide, Niramirus, FileLions)
    if (html.includes("eval(function(p,a,c,k,e,")) {
      const unpacked = unpackPacker(html);
      
      const m3u8Match = unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                        unpacked.match(/src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
                        unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
      
      if (m3u8Match) {
        directUrl = m3u8Match[1];
      }
    }

    // 2. Extracción Regex directa si no usa Packer o falló el unpacker
    if (!directUrl) {
      const directMatch = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/i) ||
                          html.match(/(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/i);
      if (directMatch) {
        directUrl = directMatch[1];
      }
    }

    // 3. Extractor específico para VOE u otros servidores variables
    if (!directUrl && embedUrl.includes("voe.sx")) {
      const voeMatch = html.match(/['"]hls['"]\s*:\s*['"]([^'"]+)['"]/i) || 
                       html.match(/href\s*=\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
      if (voeMatch) {
        directUrl = voeMatch[1];
      }
    }

    if (directUrl) {
      return directUrl.replace(/\\/g, ''); // Limpiar barras invertidas escapadas
    }

  } catch (e) {
    console.log("[PelisplusHD] Error resolviendo stream directo desde: " + embedUrl);
  }

  return null;
}

module.exports = { getStreams };