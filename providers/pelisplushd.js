/**
 * PelisPlusHD Provider - v1.0.0 (Embed69 only)
 *
 * Fuente: https://pelisplushd.bz
 *
 * Flujo:
 *   TMDB (titulo) -> Search pelisplushd -> Pagina de la pelicula/serie
 *   -> arreglo video[] -> tab "Embed69" -> resolver embed69 -> streams
 *
 * v1: solo se soporta el servidor "Embed69". El resto de servidores
 * (Xupalace, Voe/StreamWish/Filemoon como tabs directos) se ignoran
 * por ahora y se agregaran en una version futura.
 */

"use strict";

const cheerio = require('cheerio-without-node-native');

const PROVIDER_NAME = "PelisPlusHD";
const BASE_URL = "https://pelisplushd.bz";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* Helpers genericos de red                                           */
/* ------------------------------------------------------------------ */

// fetch de texto, nunca tira excepcion (patron del tutorial oficial)
async function fetchText(url, opts) {
  try {
    const res = await fetch(url, opts || { headers: { "User-Agent": UA } });
    if (res.ok) return await res.text();
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] fetchText error (${url}): ${e.message}`);
  }
  return null;
}

async function fetchJson(url, opts) {
  const raw = await fetchText(url, opts);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* TMDB: resolver titulo + año a partir del tmdbId                    */
/* ------------------------------------------------------------------ */

async function getTmdbInfo(tmdbId, mediaType) {
  const type = ["movie", "film"].includes(String(mediaType).toLowerCase()) ? "movie" : "tv";
  const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
  const data = await fetchJson(url, { headers: { "User-Agent": UA } });
  if (!data) return null;

  const title = data.title || data.name || data.original_title || data.original_name;
  const dateStr = data.release_date || data.first_air_date || "";
  const year = dateStr ? dateStr.substring(0, 4) : "";

  if (!title) return null;
  return { title, year, type };
}

/* ------------------------------------------------------------------ */
/* Normalizacion de texto para comparar titulos                       */
/* (mismo patron usado en allcalidad.js)                              */
/* ------------------------------------------------------------------ */

function normalize(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Paso 1: buscar en pelisplushd.bz                                   */
/* ------------------------------------------------------------------ */

async function searchPelisplushd(title, type) {
  const searchUrl = `${BASE_URL}/search?s=${encodeURIComponent(title)}`;
  console.log(`[${PROVIDER_NAME}] Buscando: ${searchUrl}`);

  const html = await fetchText(searchUrl, { headers: { "User-Agent": UA } });
  if (!html) return null;

  const $ = cheerio.load(html);
  const wantedClass = type === "movie" ? "movies" : "series";
  const targetNorm = normalize(title);

  let bestHref = null;

  $("a.Posters-link").each((i, el) => {
    if (bestHref) return; // ya encontramos coincidencia, no seguir

    const classAttr = $(el).attr("class") || "";
    if (!classAttr.includes(wantedClass)) return;

    const href = $(el).attr("href");
    if (!href) return;

    // Titulo limpio viene en .listing-content p, ej: "Avatar: Fuego y ceniza (2025)"
    const rawText = $(el).find(".listing-content p").text().trim();
    const candidateNorm = normalize(rawText.replace(/\(\d{4}\)/, ""));

    if (candidateNorm && (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm))) {
      bestHref = href;
      console.log(`[${PROVIDER_NAME}] Match encontrado: "${rawText}" -> ${href}`);
    }
  });

  return bestHref;
}

/* ------------------------------------------------------------------ */
/* Paso 2: abrir la pagina y extraer el arreglo video[]                */
/* ------------------------------------------------------------------ */

async function getEmbed69Url(pageUrl) {
  const html = await fetchText(pageUrl, { headers: { "User-Agent": UA, "Referer": BASE_URL + "/" } });
  if (!html) return null;

  const $ = cheerio.load(html);

  // Mapear data-id -> nombre de servidor desde las pestañas .TbVideoNv
  const serverNames = {};
  $(".TbVideoNv li[data-id]").each((i, el) => {
    const dataId = $(el).attr("data-id");
    const label = $(el).find("a").text().trim();
    if (dataId) serverNames[dataId] = label;
  });

  // Extraer todas las entradas video[N] = 'URL'; del <script> de la pagina
  const videoMap = {};
  const videoRegex = /video\[(\d+)\]\s*=\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = videoRegex.exec(html)) !== null) {
    videoMap[match[1]] = match[2];
  }

  console.log(`[${PROVIDER_NAME}] Servidores detectados: ${JSON.stringify(serverNames)}`);

  // Buscar el data-id cuyo nombre sea "Embed69" (unico servidor soportado en v1)
  for (const dataId in serverNames) {
    if (serverNames[dataId].toLowerCase().includes("embed69")) {
      const embedUrl = videoMap[dataId];
      if (embedUrl) {
        console.log(`[${PROVIDER_NAME}] Embed69 encontrado: ${embedUrl}`);
        return embedUrl;
      }
    }
  }

  console.log(`[${PROVIDER_NAME}] No se encontro servidor Embed69 en esta pagina.`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Resolver de Embed69 (reutilizado tal cual de embed69.js)           */
/* ------------------------------------------------------------------ */

function unpack(code) {
  try {
    const m = code.match(/eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
    if (!m) return code;
    let [, p, a, c, k] = m;
    a = parseInt(a);
    c = parseInt(c);
    const kArr = k.split("|");
    return p.replace(/\b\w+\b/g, (e) => kArr[parseInt(e, a)] || e);
  } catch (e) {
    return code;
  }
}

function safeAtob(input) {
  if (!input) return "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let str = String(input).replace(/=+$/, "").replace(/[\s\n\r\t]/g, "");
  let output = "";
  if (str.length % 4 === 1) return "";
  for (let bc = 0, bs, buffer, idx = 0; (buffer = str.charAt(idx++)); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)))) : 0) {
    buffer = chars.indexOf(buffer);
  }
  return output;
}

function voeDecode(encText) {
  try {
    let decoded = encText.replace(/[a-zA-Z]/g, (c) => {
      const code = c.charCodeAt(0);
      const limit = c <= "Z" ? 90 : 122;
      const shifted = code + 13;
      return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
    });
    const noise = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    for (const n of noise) decoded = decoded.split(n).join("");
    const b64_1 = safeAtob(decoded);
    if (!b64_1) return null;
    let shiftedStr = "";
    for (let j = 0; j < b64_1.length; j++) shiftedStr += String.fromCharCode(b64_1.charCodeAt(j) - 3);
    const decrypted = safeAtob(shiftedStr.split("").reverse().join(""));
    return decrypted ? JSON.parse(decrypted) : null;
  } catch (e) {
    return null;
  }
}

async function resolveVoe(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": url } });
    const html = await res.text();

    if (html.includes("window.location.href") && html.length < 2000) {
      const rm = html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
      if (rm) return resolveVoe(rm[1]);
    }

    const jsonMatch = html.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (jsonMatch) {
      let data = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(data)) data = data[0];
      const decoded = voeDecode(data);
      if (decoded && decoded.source) {
        return { url: decoded.source, quality: "1080p", headers: { "User-Agent": UA, "Referer": url } };
      }
    }

    const m3u8 = html.match(/["'](https?:\/\/[^"']+?\.m3u8[^"']*?)["']/i);
    if (m3u8 && !m3u8[1].includes("test-videos")) {
      return { url: m3u8[1], quality: "Auto", headers: { "User-Agent": UA, "Referer": url } };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveStreamwish(url) {
  const domains = ["vibuxer.com", "awish.pro", "dwish.pro", "streamwish.to", "embedwish.com", "strish.com", "wishembed.pro"];
  for (const domain of domains) {
    try {
      const res = await fetch(url.replace(/[^/]+\.(?:com|to|pro|net|org)/, domain), {
        headers: { "User-Agent": UA, "Referer": "https://embed69.org/" }
      });
      if (!res.ok) continue;
      let html = await res.text();
      if (html.includes("eval(function")) html += "\n" + unpack(html);
      const m3u8 = html.match(/(?:file|source|src|hls)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
      if (m3u8) return { url: m3u8[1] || m3u8[0], quality: "Auto", headers: { "User-Agent": UA, "Referer": `https://${domain}/` } };
    } catch (e) {}
  }
  return null;
}

async function resolveFilemoon(url) {
  try {
    const videoId = url.split("/").pop();
    const domain = new URL(url).origin;

    const detailsRes = await fetch(`${domain}/api/videos/${videoId}/embed/details`, { headers: { "User-Agent": UA } });
    const details = await detailsRes.json();

    if (details.embed_frame_url) {
      const pbDomain = new URL(details.embed_frame_url).origin;

      const challengeRes = await fetch(`${pbDomain}/api/videos/access/challenge`, {
        method: "POST",
        headers: { "Referer": details.embed_frame_url, "Origin": pbDomain, "User-Agent": UA }
      });
      const challenge = await challengeRes.json();

      const sig = typeof __crypto_ecdsa_sign_secp256r1 === "function" ? __crypto_ecdsa_sign_secp256r1(challenge.nonce) : "{}";
      const attestJson = JSON.parse(sig);

      if (attestJson.signature) {
        const uuid = () => "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => (c === "x" ? (Math.random() * 16) | 0 : (((Math.random() * 16) | 0) & 0x3) | 0x8).toString(16));
        const vId = uuid();
        const dId = uuid();
        const attestResObj = await (
          await fetch(`${pbDomain}/api/videos/access/attest`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Referer": details.embed_frame_url, "Origin": pbDomain, "User-Agent": UA },
            body: JSON.stringify({
              viewer_id: vId,
              device_id: dId,
              challenge_id: challenge.challenge_id,
              nonce: challenge.nonce,
              signature: attestJson.signature,
              public_key: { crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC", x: attestJson.x, y: attestJson.y },
              client: { user_agent: UA, platform: "Windows", platform_version: "10.0.0" },
              storage: { cookie: vId, local_storage: vId, indexed_db: `${vId}:${dId}`, cache_storage: `${vId}:${dId}` },
              attributes: { entropy: "high" }
            })
          })
        ).json();

        const pbRes = await (
          await fetch(`${pbDomain}/api/videos/${videoId}/embed/playback`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Referer": details.embed_frame_url, "Origin": pbDomain, "User-Agent": UA, "X-Embed-Parent": url },
            body: JSON.stringify({
              fingerprint: {
                token: attestResObj.token,
                viewer_id: attestResObj.viewer_id || vId,
                device_id: attestResObj.device_id || dId,
                confidence: attestResObj.confidence
              }
            })
          })
        ).json();

        const dec = typeof __crypto_aes_gcm_decrypt === "function" ? __crypto_aes_gcm_decrypt(JSON.stringify(pbRes.playback.key_parts), pbRes.playback.iv, pbRes.playback.payload) : "";
        if (dec && !dec.includes("error")) {
          const final = JSON.parse(dec);
          return { url: final.sources[0].url, quality: final.sources[0].label || "1080p", headers: { "User-Agent": UA, "Referer": domain + "/", "Origin": domain } };
        }
      }
    }

    // Fallback: scraping directo del HTML
    let html = await (await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://embed69.org/" } })).text();
    if (html.includes("eval(function")) html += "\n" + unpack(html);
    const m3u8 = html.match(/(?:file|source|src|hls|url)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (m3u8) return { url: m3u8[1], quality: "Auto", headers: { "User-Agent": UA, "Referer": url } };
    return null;
  } catch (e) {
    return null;
  }
}

async function resolveVidhide(url) {
  try {
    let html = await (await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://embed69.org/" } })).text();
    if (html.includes("eval(function")) html += "\n" + unpack(html);
    const m3u8 = html.match(/(?:file|source|src|hls)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i) || html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    if (m3u8) return { url: m3u8[1] || m3u8[0], quality: "1080p", headers: { "User-Agent": UA, "Referer": new URL(url).origin + "/" } };
    return null;
  } catch (e) {
    return null;
  }
}

// Dado un link de embed69.org, extrae y resuelve cada sub-servidor Latino
async function resolveEmbed69(embed69Url) {
  const results = [];

  const html = await fetchText(embed69Url, { headers: { "User-Agent": UA } });
  if (!html) {
    console.log(`[${PROVIDER_NAME}] No se pudo abrir Embed69: ${embed69Url}`);
    return results;
  }

  const match = html.match(/dataLink\s*=\s*([\[\{][\s\S]*?[\]\}]);/);
  if (!match) {
    console.log(`[${PROVIDER_NAME}] No se encontro dataLink en Embed69.`);
    return results;
  }

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Error parseando dataLink: ${e.message}`);
    return results;
  }
  if (!Array.isArray(data)) {
    data = Object.keys(data).map((k) => ({ video_language: k, sortedEmbeds: data[k] }));
  }

  const lat = data.find((i) => ["LAT", "LATINO"].includes(String(i.video_language).toUpperCase()));
  if (!lat) {
    console.log(`[${PROVIDER_NAME}] Embed69 sin audio Latino.`);
    return results;
  }

  const rawServers = lat.sortedEmbeds.filter((e) => e.link && e.servername !== "download");

  const embedsToResolve = [];
  for (const embed of rawServers) {
    try {
      const b64 = embed.link.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(safeAtob(b64));
      embedsToResolve.push({ server: embed.servername.toLowerCase(), url: payload.link });
    } catch (e) {}
  }

  console.log(`[${PROVIDER_NAME}] Sub-servidores de Embed69: ${embedsToResolve.map((e) => e.server).join(", ")}`);

  for (const embed of embedsToResolve) {
    const sName = embed.server;
    try {
      let res = null;
      if (sName === "filemoon") res = await resolveFilemoon(embed.url);
      else if (sName === "voe") res = await resolveVoe(embed.url);
      else if (sName === "streamwish") res = await resolveStreamwish(embed.url);
      else if (sName === "vidhide") res = await resolveVidhide(embed.url);

      if (res) {
        results.push({ server: sName, quality: res.quality || "HD", url: res.url, headers: res.headers });
      }
    } catch (e) {
      console.log(`[${PROVIDER_NAME}] Fallo resolviendo ${sName}: ${e.message}`);
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                        */
/* ------------------------------------------------------------------ */

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const type = ["movie", "film"].includes(String(mediaType).toLowerCase()) ? "movie" : "tv";

    // 1) TMDB -> titulo
    const info = await getTmdbInfo(tmdbId, mediaType);
    if (!info) {
      console.log(`[${PROVIDER_NAME}] No se pudo resolver titulo TMDB para ${tmdbId}`);
      return [];
    }
    console.log(`[${PROVIDER_NAME}] Titulo: "${info.title}" (${info.year})`);

    // 2) Buscar en pelisplushd.bz
    let pageUrl = await searchPelisplushd(info.title, type);
    if (!pageUrl) {
      console.log(`[${PROVIDER_NAME}] Sin resultados de busqueda para "${info.title}"`);
      return [];
    }

    // 3) Si es serie, construir URL de episodio (mismo patron usado en
    // pelisplushd bajo su dominio anterior .la)
    if (type === "tv") {
      if (!season || !episode) {
        console.log(`[${PROVIDER_NAME}] Falta season/episode para serie.`);
        return [];
      }
      if (pageUrl.endsWith("/")) pageUrl = pageUrl.slice(0, -1);
      pageUrl = `${pageUrl}/temporada/${season}/capitulo/${episode}`;
    }

    console.log(`[${PROVIDER_NAME}] Pagina objetivo: ${pageUrl}`);

    // 4-6) Abrir la pagina y extraer el link de Embed69 desde video[]
    const embed69Url = await getEmbed69Url(pageUrl);
    if (!embed69Url) {
      console.log(`[${PROVIDER_NAME}] Esta pagina no tiene servidor Embed69.`);
      return [];
    }

    // 7) Resolver Embed69 (voe/streamwish/filemoon/vidhide internos)
    const resolved = await resolveEmbed69(embed69Url);
    if (!resolved.length) {
      console.log(`[${PROVIDER_NAME}] Embed69 no devolvio streams reproducibles.`);
      return [];
    }

    // 8) Formatear streams para Nuvio
    const streams = resolved.map((r) => {
      const label = `${r.quality} · Latino [Embed69-${r.server}]`;
      return {
        name: `${PROVIDER_NAME} - ${r.server.toUpperCase()}`,
        title: label,
        size: label,
        quality: r.quality,
        url: r.url,
        headers: r.headers,
        behaviorHints: { notWebReady: true }
      };
    });

    console.log(`[${PROVIDER_NAME}] ${streams.length} stream(s) listos.`);
    return streams;
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Error critico en getStreams: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams };
