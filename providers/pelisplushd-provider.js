// src/pelisplushd/index.js (v1.0.0)
//
// ============================================================================
// PROVIDER: PelisPlusHD (https://pelisplushd.bz) para Nuvio
// Basado en el plugin LaMovie (src/lamovie/index.js) — se reutiliza toda la
// lógica de matching TMDB/búsqueda difusa y los resolvers de hosting que son
// compatibles, ya que ambos sitios comparten el mismo ecosistema de embeds.
// ============================================================================
//
// -------------------------- RESUMEN DE LA INVESTIGACIÓN --------------------
// Confirmado en vivo (fetch real a pelisplushd.bz + trazas de red públicas):
//   - Rutas estables y predecibles, sin necesidad de scrapear listados:
//       Película : /pelicula/{slug}-{id}
//       Serie    : /serie/{slug}-{id}/temporada/{n}/capitulo/{m}
//       Anime    : /anime/{slug}-{id}/temporada/{n}/capitulo/{m}
//   - El sitio NO aloja sus propios servers (a diferencia de LaMovie). Delega
//     TODO el reproductor a un servicio externo compartido: EMBED69
//     (https://embed69.org/f/{IMDB_ID}/  y  .../f/{IMDB_ID}-{S}x{E}/ para
//     episodios). Confirmado por fetch real + un issue público de GitHub
//     (consumet/consumet.ts#640) que documenta exactamente ese patrón de URL.
//   - Embed69 es el MISMO servicio que ya usa LaMovie internamente (su
//     resolveHlswish ya manda Referer "https://embed69.org/"), por lo que
//     gran parte del motor de resolución de LaMovie aplica sin cambios.
//   - Traza de red real (urlquery.net) sobre embed69.org confirma iconos de
//     servidor reales: vidhide.ico, streamwish.ico, filemoon.ico,
//     download.ico, y tráfico real hacia voe.sx en una sesión capturada.
//   - Embed69 carga crypto-js (AES) y su UI dice literalmente "Descifrando
//     servidores disponibles..." → la lista de servidores se arma con JS en
//     el cliente, no está en texto plano dentro del HTML inicial.
//
// NO se pudo verificar (se indica explícitamente en vez de inventar):
//   - El endpoint exacto del buscador interno del sitio (el buscador de la
//     UI es un widget JS sin URL estática visible). Se usa `/?s=` (patrón
//     WordPress estándar) como mejor esfuerzo — MARCADO como no confirmado.
//   - El algoritmo exacto de descifrado del payload de Embed69 (clave/AES):
//     la herramienta de análisis disponible no ejecuta JS y descarta las
//     etiquetas <script>, por lo que no se pudo extraer el payload cifrado
//     real ni la clave. Ver `resolveEmbed69()` para el detalle de qué se
//     intenta igual (patrones en texto plano) y qué queda pendiente.
//   - Si el iframe/tab de Embed69 en la página de PelisPlusHD es estático o
//     se carga por AJAX (patrón `doo_player_ajax`, típico de temas DooPlay).
//     Se implementaron AMBOS caminos con fallback, marcados como tales.
// ============================================================================

var cheerio = require('cheerio');
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://pelisplushd.bz";
var ANIME_COUNTRIES = ["JP", "CN", "KR"];
var GENRE_ANIMATION = 16;
var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

function get(url, extraHeaders) {
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  return fetch(url, { headers, redirect: "follow" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("json") !== -1) return res.json();
    return res.text();
  });
}

// ---------------------------------------------------------------------------
// Utilidades de matching TMDB <-> título del sitio.
// Reutilizadas TAL CUAL del plugin LaMovie: son genéricas y no dependen de
// la estructura específica de un sitio.
// ---------------------------------------------------------------------------
function normalizeTitle(t) {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function buildSlug(title, year) {
  var slug = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return year ? slug + "-" + year : slug;
}
function getPostTypes(mediaType, genres, originCountries) {
  if (mediaType === "movie") return ["pelicula"];
  var isAnimation = (genres || []).indexOf(GENRE_ANIMATION) !== -1;
  if (!isAnimation) return ["serie"];
  var isAnimeCountry = false;
  for (var i = 0; i < (originCountries || []).length; i++) {
    if (ANIME_COUNTRIES.indexOf(originCountries[i]) !== -1) {
      isAnimeCountry = true;
      break;
    }
  }
  return isAnimeCountry ? ["anime"] : ["anime", "serie"];
}
var STOPWORDS = { las: 1, los: 1, una: 1, uno: 1, del: 1, con: 1, que: 1, por: 1, para: 1, the: 1, and: 1, for: 1, from: 1, with: 1 };
function scoreCandidate(candidateTitle, tmdbTitle, originalTitle, year) {
  var normCand = normalizeTitle(candidateTitle);
  var normTmdb = normalizeTitle(tmdbTitle);
  var normOrig = normalizeTitle(originalTitle || tmdbTitle);
  var score = 0;
  if (year && normCand.indexOf(year) !== -1) score += 50;
  var wordsToCheck = normTmdb.split(" ").filter(function (w) {
    return (w.length > 3 || /^\d+$/.test(w)) && !STOPWORDS[w];
  });
  if (wordsToCheck.length > 0) {
    var matched = 0;
    for (var i = 0; i < wordsToCheck.length; i++) {
      if (normCand.indexOf(wordsToCheck[i]) !== -1) matched++;
    }
    score += matched / wordsToCheck.length * 30;
  }
  var origWords = normOrig.split(" ").filter(function (w) {
    return (w.length > 3 || /^\d+$/.test(w)) && !STOPWORDS[w];
  });
  if (origWords.length > 0) {
    var origMatched = 0;
    for (var j = 0; j < origWords.length; j++) {
      if (normCand.indexOf(origWords[j]) !== -1) origMatched++;
    }
    score += origMatched / origWords.length * 20;
  }
  var sequelNum = normTmdb.match(/\b(\d+)\s*$/);
  if (sequelNum && normCand.split(" ").indexOf(sequelNum[1]) === -1) {
    score -= 100;
  }
  return score;
}
function b64decode(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var result = "";
  var i = 0;
  var s = str.replace(/[^A-Za-z0-9+/]/g, "");
  while (i < s.length) {
    var a = chars.indexOf(s[i++]);
    var b = chars.indexOf(s[i++]);
    var c = i < s.length ? chars.indexOf(s[i++]) : -1;
    var d = i < s.length ? chars.indexOf(s[i++]) : -1;
    var cb = c === -1 ? 0 : c;
    var db = d === -1 ? 0 : d;
    var n = a << 18 | b << 12 | cb << 6 | db;
    result += String.fromCharCode(n >> 16 & 255);
    if (c !== -1) result += String.fromCharCode(n >> 8 & 255);
    if (d !== -1) result += String.fromCharCode(n & 255);
  }
  return result;
}

// ---------------------------------------------------------------------------
// RESOLVERS DE HOSTING
// Reutilizados de LaMovie sin cambios: VOE, StreamWish/HLSwish (genérico
// JWPlayer+packer), Doodstream y el des-empacador P.A.C.K.E.R. genérico.
// Confirmado que PelisPlusHD, vía Embed69, puede entregar enlaces de estos
// mismos hosts (VOE y StreamWish confirmados por traza de red real).
// ---------------------------------------------------------------------------
function voeDecode(ct, luts) {
  try {
    var rawLuts = luts.replace(/^\[|\]$/g, "").split("','").map(function (s) {
      return s.replace(/^'+|'+$/g, "");
    });
    var escapedLuts = rawLuts.map(function (i) {
      return i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    var txt = "";
    for (var ci = 0; ci < ct.length; ci++) {
      var x = ct.charCodeAt(ci);
      if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
      else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
      txt += String.fromCharCode(x);
    }
    for (var pi = 0; pi < escapedLuts.length; pi++) txt = txt.replace(new RegExp(escapedLuts[pi], "g"), "_");
    txt = txt.split("_").join("");
    var decoded1 = b64decode(txt);
    if (!decoded1) return null;
    var step4 = "";
    for (var si = 0; si < decoded1.length; si++) step4 += String.fromCharCode((decoded1.charCodeAt(si) - 3 + 256) % 256);
    var revBase64 = step4.split("").reverse().join("");
    var finalStr = b64decode(revBase64);
    if (!finalStr) return null;
    return JSON.parse(finalStr);
  } catch (e) {
    return null;
  }
}
function resolveVoe(embedUrl) {
  return get(embedUrl, { "Referer": embedUrl }).then(function (data) {
    if (data.indexOf("window.location.href") !== -1 && data.length < 2000) {
      var rm = data.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
      if (rm) return resolveVoe(rm[1]);
    }

    var jsonMatch = data.match(/<script type="application\/json">([\s\S]*?)<\/script>/);
    if (jsonMatch) {
      try {
        var parsed = JSON.parse(jsonMatch[1].trim());
        var encText = Array.isArray(parsed) ? parsed[0] : parsed;
        if (typeof encText === "string") {
          var decoded = encText.replace(/[a-zA-Z]/g, function (c) {
            var code = c.charCodeAt(0);
            var limit = c <= "Z" ? 90 : 122;
            var shifted = code + 13;
            return String.fromCharCode(limit >= shifted ? shifted : shifted - 26);
          });

          var noise = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
          for (var i = 0; i < noise.length; i++) {
            decoded = decoded.split(noise[i]).join("");
          }

          var b64_1 = b64decode(decoded);
          if (b64_1) {
            var shiftedStr = "";
            for (var j = 0; j < b64_1.length; j++) {
              shiftedStr += String.fromCharCode(b64_1.charCodeAt(j) - 3);
            }
            var reversed = shiftedStr.split("").reverse().join("");
            var decrypted = b64decode(reversed);
            if (decrypted) {
              var finalData = JSON.parse(decrypted);
              if (finalData && (finalData.source || finalData.direct_access_url)) {
                return {
                  url: finalData.source || finalData.direct_access_url,
                  quality: "1080p",
                  verified: true,
                  headers: { "Referer": embedUrl, "User-Agent": DEFAULT_HEADERS["User-Agent"] }
                };
              }
            }
          }
        }
      } catch (ex) { console.log("[VOE] Decrypt error: " + ex.message); }
    }

    var re = /(?:mp4|hls)['"\s]*:\s*['"]([^'"]+)['"]/gi;
    var m;
    while ((m = re.exec(data)) !== null) {
      var candidate = m[1];
      if (!candidate) continue;
      var url = candidate;
      if (url.indexOf("aHR0") === 0) {
        try {
          url = b64decode(url);
        } catch (e) {
        }
      }
      return { url, quality: "1080p", verified: true, headers: { "Referer": embedUrl } };
    }
    return null;
  }).catch(function (err) {
    console.log("[VOE] Error: " + err.message);
    return null;
  });
}
var HLSWISH_DOMAIN_MAP = { "hglink.to": "vibuxer.com" };
function unpackEval(payload, radix, symtab) {
  var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return payload.replace(/\b([0-9a-zA-Z]+)\b/g, function (match) {
    var result = 0;
    for (var i = 0; i < match.length; i++) {
      var pos = chars.indexOf(match[i]);
      if (pos === -1) return match;
      result = result * radix + pos;
    }
    if (isNaN(result) || result >= symtab.length) return match;
    return symtab[result] && symtab[result] !== "" ? symtab[result] : match;
  });
}
// resolveHlswish: genérico para hosts basados en JWPlayer + eval P.A.C.K.E.R
// con configuración `file: "..."`. LaMovie ya lo usa para streamwish/hlswish.
// EXTENSIÓN respecto a LaMovie: se agregan los dominios "vidhide" y
// "filemoon", detectados como opciones reales de servidor en Embed69
// (iconos vidhide.ico / filemoon.ico confirmados por traza de red real).
// Esta extensión se basa en que VidHide y Filemoon son, según información
// pública ampliamente documentada en la comunidad de scrapers, clones del
// mismo motor JWPlayer+packer que StreamWish — NO se pudo confirmar de forma
// directa contra tráfico real de PelisPlusHD (el payload no llegó a
// capturarse), así que si algún día falla, es el primer punto a revisar.
function resolveHlswish(embedUrl) {
  var fetchUrl = embedUrl;
  var keys = Object.keys(HLSWISH_DOMAIN_MAP);
  for (var ki = 0; ki < keys.length; ki++) {
    if (fetchUrl.indexOf(keys[ki]) !== -1) fetchUrl = fetchUrl.replace(keys[ki], HLSWISH_DOMAIN_MAP[keys[ki]]);
  }
  var embedHostMatch = fetchUrl.match(/^(https?:\/\/[^/]+)/);
  var embedHost = embedHostMatch ? embedHostMatch[1] : "https://hlswish.com";
  return get(fetchUrl, {
    "Referer": "https://embed69.org/",
    "Origin": "https://embed69.org",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-MX,es;q=0.9"
  }).then(function (data) {
    var fileMatch = data.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch) {
      var url = fileMatch[1];
      if (url.charAt(0) === "/") url = embedHost + url;
      return { url, quality: "1080p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": embedHost + "/" } };
    }
    var packMatch = data.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[^}]+\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (packMatch) {
      var unpacked = unpackEval(packMatch[1], parseInt(packMatch[2]), packMatch[4].split("|"));
      var m3u8Match = unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/);
      if (m3u8Match) {
        var url = m3u8Match[1];
        if (url.charAt(0) === "/") url = embedHost + url;
        return { url, quality: "1080p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": embedHost + "/" } };
      }
    }
    var rawM3u8 = data.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
    if (rawM3u8) return { url: rawM3u8[0], quality: "1080p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": embedHost + "/" } };
    return null;
  }).catch(function (err) {
    console.log("[HLSWish/VidHide/Filemoon] Error: " + err.message);
    return null;
  });
}
function resolvePacker(embedUrl) {
  return get(embedUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
    try {
      var packedMatch = html.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[\s\S]*?\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*[']([\s\S]+?)[']\.split\([']\|[']\)/);
      if (!packedMatch) return null;
      var unpacked = unpackEval(packedMatch[1], parseInt(packedMatch[2]), packedMatch[4].split('|'));
      var streamMatch = unpacked.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
        unpacked.match(/["'](\/[^"']+\.m3u8[^"']*)["']/) ||
        unpacked.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/);
      if (streamMatch) {
        var hlsLink = streamMatch[1];
        if (hlsLink.startsWith('/')) {
          var baseUrl = embedUrl.match(/^(https?:\/\/[^/]+)/)[1];
          hlsLink = baseUrl + hlsLink;
        }
        return { url: hlsLink, quality: "1080p", verified: true, headers: { "Referer": embedUrl, "User-Agent": DEFAULT_HEADERS["User-Agent"] } };
      }
    } catch (e) { console.log("[PelisPlusHD] Error unpacker: " + e.message); }
    return null;
  });
}
function resolveDoodstream(embedUrl) {
  var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  var embedHost = embedUrl.replace(/\/(d|f)\//, "/e/").replace("dsvplay.com", "d0000d.com");
  return get(embedHost, {
    "User-Agent": UA,
    "Referer": BASE_URL + "/",
    "Origin": BASE_URL
  }).then(function (html) {
    var match = html.match(/\$\.get\(['"](\/pass_md5\/[\w-]+\/([\w-]+))['"]/i);
    if (!match) return null;
    var passPath = match[1];
    var token = match[2];
    var domain = new URL(embedHost).origin;
    return get(domain + passPath, { "User-Agent": UA, "Referer": embedHost }).then(function (videoBaseUrl) {
      if (!videoBaseUrl) return null;
      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      var randomString = "";
      for (var i = 0; i < 10; i++) randomString += chars.charAt(Math.floor(Math.random() * chars.length));
      var finalUrl = videoBaseUrl + randomString + "?token=" + token + "&expiry=" + Date.now();
      return { url: finalUrl, quality: "720p", verified: true, headers: { "User-Agent": UA, "Referer": domain + "/" } };
    });
  }).catch(function (err) {
    console.log("[DoodStream] Error: " + err.message);
    return null;
  });
}

// ---------------------------------------------------------------------------
// resolveEmbed69: PUERTA DE ENTRADA principal para PelisPlusHD.
//
// CONFIRMADO: la página inicial de embed69.org/f/{id}/ muestra en texto
// "Descifrando servidores disponibles..." y carga crypto-js (AES) — la
// lista real de servidores se arma vía JS en el cliente, no viene en texto
// plano dentro del HTML servido inicialmente.
//
// NO SE PUDO VERIFICAR: el algoritmo exacto (clave AES / nombre de variable
// del payload cifrado), porque la herramienta de análisis usada elimina las
// etiquetas <script> al convertir la página a texto legible. Esto es una
// limitación real del proceso de investigación, no una suposición.
//
// ESTRATEGIA IMPLEMENTADA (honesta, sin inventar el cifrado):
//   1) Buscar enlaces de servidores YA EN TEXTO PLANO dentro del HTML (por
//      si algún servidor no pasa por el cifrado, o si el sitio cambia y dejó
//      de cifrar). Esto cubre voe.sx, streamwish/hlswish/vibuxer, filemoon,
//      vidhide, dood/d0000d — todos confirmados como opciones reales del
//      lado de Embed69.
//   2) Si no se encuentra nada en texto plano (lo más probable, dado que el
//      contenido está cifrado), se registra un log explícito indicando que
//      hace falta ingeniería inversa adicional (con un navegador real /
//      devtools) para extraer la clave y el esquema AES exactos, y se
//      retorna una lista vacía en lugar de simular datos.
// ---------------------------------------------------------------------------
var KNOWN_HOST_PATTERNS = [
  { re: /https?:\/\/[^"'\s\\<>]*voe\.sx[^"'\s\\<>]*/gi, name: "VOE" },
  { re: /https?:\/\/[^"'\s\\<>]*(?:hlswish|streamwish|strwish|vibuxer)\.[^"'\s\\<>]*/gi, name: "StreamWish" },
  { re: /https?:\/\/[^"'\s\\<>]*filemoon\.[^"'\s\\<>]*/gi, name: "Filemoon" },
  { re: /https?:\/\/[^"'\s\\<>]*vidhide[^"'\s\\<>]*/gi, name: "VidHide" },
  { re: /https?:\/\/[^"'\s\\<>]*(?:dsvplay|d0000d|dood|ds2video|ds2play)\.[^"'\s\\<>]*/gi, name: "DoodStream" }
];
function resolveEmbed69(embedUrl) {
  return get(embedUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
    var found = [];
    for (var i = 0; i < KNOWN_HOST_PATTERNS.length; i++) {
      var pattern = KNOWN_HOST_PATTERNS[i];
      var matches = html.match(pattern.re);
      if (matches) {
        for (var j = 0; j < matches.length; j++) {
          // Evita duplicados y assets estáticos obvios (.ico/.png/.css/.js)
          if (/\.(ico|png|jpg|jpeg|css|js)(\?|$)/i.test(matches[j])) continue;
          found.push({ url: matches[j], server: pattern.name });
        }
      }
    }
    if (!found.length) {
      console.log("[PelisPlusHD/Embed69] La lista de servidores de " + embedUrl + " está cifrada en el cliente (crypto-js/AES) y no se encontró ningún enlace en texto plano. No es posible extraer los servidores sin ejecutar el JS de la página o sin conocer la clave de descifrado exacta — este punto queda pendiente de investigación adicional con un navegador real (devtools de red).");
      return [];
    }
    // dedupe
    var seen = {};
    var unique = [];
    for (var k = 0; k < found.length; k++) {
      if (!seen[found[k].url]) { seen[found[k].url] = true; unique.push(found[k]); }
    }
    return unique;
  }).catch(function (err) {
    console.log("[PelisPlusHD/Embed69] Error: " + err.message);
    return [];
  });
}

function getResolver(url) {
  if (url.indexOf("hlswish") !== -1 || url.indexOf("streamwish") !== -1 || url.indexOf("strwish") !== -1 || url.indexOf("vibuxer") !== -1) return resolveHlswish;
  if (url.indexOf("filemoon") !== -1) return resolveHlswish; // ver nota de extensión arriba (no verificado en vivo)
  if (url.indexOf("vidhide") !== -1) return resolveHlswish; // ver nota de extensión arriba (no verificado en vivo)
  if (url.indexOf("voe.sx") !== -1) return resolveVoe;
  if (url.indexOf("dood") !== -1 || url.indexOf("d0000d") !== -1 || url.indexOf("ds2video") !== -1 || url.indexOf("ds2play") !== -1 || url.indexOf("dsvplay") !== -1) return resolveDoodstream;
  if (url.indexOf("earnvids.com") !== -1 || url.indexOf("hglink.to") !== -1 || url.indexOf("earnl.one") !== -1 || url.indexOf("vidnova.online") !== -1 || url.indexOf("streamfort.online") !== -1) return resolvePacker;
  return null;
}
function getServerName(url) {
  if (url.indexOf("hlswish") !== -1 || url.indexOf("streamwish") !== -1 || url.indexOf("strwish") !== -1 || url.indexOf("vibuxer") !== -1) return "StreamWish";
  if (url.indexOf("filemoon") !== -1) return "Filemoon";
  if (url.indexOf("vidhide") !== -1) return "VidHide";
  if (url.indexOf("voe.sx") !== -1) return "VOE";
  if (url.indexOf("dsvplay.com") !== -1 || url.indexOf("dood") !== -1 || url.indexOf("d0000d") !== -1 || url.indexOf("ds2video") !== -1 || url.indexOf("ds2play") !== -1) return "DoodStream";
  if (url.indexOf("earnvids.com") !== -1 || url.indexOf("earnl.one") !== -1 || url.indexOf("vidnova.online") !== -1) return "EarnVids";
  if (url.indexOf("hglink.to") !== -1 || url.indexOf("streamfort.online") !== -1) return "StreamHG";
  return "Online";
}

// ---------------------------------------------------------------------------
// TMDB — idéntico a LaMovie (endpoint universal, no depende del sitio).
// ---------------------------------------------------------------------------
function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=es-MX";
  return get(url).then(function (data) {
    var title = type === "movie" ? data.title || data.original_title : data.name || data.original_name;
    var originalTitle = type === "movie" ? data.original_title || data.title : data.original_name || data.name;
    var year = (type === "movie" ? data.release_date || "" : data.first_air_date || "").slice(0, 4);
    var genres = (data.genres || []).map(function (g) { return g.id; });
    var originCountries = data.origin_country || (data.production_countries || []).map(function (c) { return c.iso_3166_1; }) || [];
    return { title, originalTitle, year, genres, originCountries };
  });
}

// ---------------------------------------------------------------------------
// Búsqueda en pelisplushd.bz
//
// CONFIRMADO: existen enlaces reales con los prefijos /pelicula/, /serie/ y
// /anime/ en todo el sitio (home, listados, etc.) — por eso el parseo de
// resultados se hace filtrando <a href> por esos prefijos en vez de una
// clase CSS específica que no se pudo verificar.
//
// NO CONFIRMADO: el endpoint exacto del buscador. La UI usa un input de
// búsqueda con JS (ícono con "javascript:void(0);"), no se localizó una URL
// de búsqueda estática en el HTML servido. Se usa `/?s=` (patrón de
// búsqueda estándar de WordPress) como mejor esfuerzo. Si el sitio no
// responde resultados por esta vía, este es el primer punto a corregir
// (ver DEV_NOTES al final del archivo).
// ---------------------------------------------------------------------------
function searchPelisPlusHD(title, originalTitle, year) {
  var url = BASE_URL + "/?s=" + encodeURIComponent(title);
  return get(url, { "Referer": BASE_URL + "/" }).then(function (html) {
    var $ = cheerio.load(html);
    var posts = [];
    $('a[href*="/pelicula/"], a[href*="/serie/"], a[href*="/anime/"]').each(function () {
      var $el = $(this);
      var href = $el.attr('href');
      if (!href) return;
      // Evita capturar enlaces de temporada/capítulo o de listados de género
      if (/\/temporada\/|\/generos\/|\/populares|\/pais\//.test(href)) return;
      var text = $el.text().trim();
      var imgAlt = $el.find('img').attr('alt');
      var t = (text || imgAlt || '').replace(/^VER\s+/i, '').replace(/Online Gratis HD.*$/i, '').trim();
      if (!t) return;
      var yearMatch = t.match(/\((\d{4})\)/);
      posts.push({
        title: t.replace(/\(\d{4}\)/, '').trim(),
        year: yearMatch ? yearMatch[1] : '',
        url: href
      });
    });
    return posts;
  }).then(function (posts) {
    if (!posts.length) return null;
    var scored = [];
    for (var i = 0; i < posts.length; i++) {
      scored.push({ post: posts[i], score: scoreCandidate(posts[i].title || "", title, originalTitle, year) });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var best = scored[0];
    if (best.score < 20) {
      console.log("[PelisPlusHD] Sin coincidencias (score: " + best.score.toFixed(1) + ")");
      return null;
    }
    console.log('[PelisPlusHD] Busqueda OK: "' + best.post.title + '" (score:' + best.score.toFixed(1) + ") url:" + best.post.url);
    return { url: best.post.url };
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error busqueda: " + err.message);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Extracción del/los embed(s) desde la página de película o episodio.
//
// CONFIRMADO (fetch real): la página de película mostró un tab "Embed69" y,
// en ese caso puntual, el enlace directo a embed69.org/f/{imdb}/ apareció
// también en el HTML. En la página de un episodio probado, el tab "Embed69"
// apareció PERO sin el enlace directo visible — inconsistencia real
// observada, no asumida.
//
// Por eso se implementan DOS estrategias, en orden:
//   1) Escaneo directo del HTML (iframe[src] + regex por URLs de embed69.org
//      u otros hosts conocidos ya en texto plano). Es lo que funcionó en la
//      prueba real sobre la página de película.
//   2) Fallback al patrón AJAX estándar del tema DooPlay
//      (`action=doo_player_ajax` contra /wp-admin/admin-ajax.php), que es el
//      mecanismo público y ampliamente documentado que usan los temas
//      DooPlay para cargar el iframe de cada pestaña de servidor bajo
//      demanda. ESTE PASO NO SE PUDO CONFIRMAR EN VIVO contra
//      pelisplushd.bz (no se logró capturar el data-post/data-nume reales
//      necesarios) — se deja implementado y documentado como mejor esfuerzo.
// ---------------------------------------------------------------------------
function extractEmbedsFromHtml(html) {
  var $ = cheerio.load(html);
  var embeds = [];

  // Estrategia 1a: iframes estáticos
  $('iframe[src]').each(function () {
    var src = $(this).attr('src');
    if (src) embeds.push(src);
  });

  // Estrategia 1b: cualquier URL de embed69 (u otros hosts conocidos) en
  // texto plano dentro del HTML completo, por si no viene en un <iframe>
  // sino en un <a href> o en un atributo data-*.
  var raw = html;
  var embed69Matches = raw.match(/https?:\/\/embed69\.org\/f\/[A-Za-z0-9\-]+\/?/gi);
  if (embed69Matches) {
    for (var i = 0; i < embed69Matches.length; i++) embeds.push(embed69Matches[i]);
  }
  for (var p = 0; p < KNOWN_HOST_PATTERNS.length; p++) {
    var m = raw.match(KNOWN_HOST_PATTERNS[p].re);
    if (m) {
      for (var q = 0; q < m.length; q++) {
        if (!/\.(ico|png|jpg|jpeg|css|js)(\?|$)/i.test(m[q])) embeds.push(m[q]);
      }
    }
  }

  // dedupe
  var seen = {};
  var unique = [];
  for (var k = 0; k < embeds.length; k++) {
    if (embeds[k] && !seen[embeds[k]]) { seen[embeds[k]] = true; unique.push(embeds[k]); }
  }
  return unique;
}

// Fallback AJAX estilo DooPlay — NO VERIFICADO EN VIVO para pelisplushd.bz.
// Se intenta solo si la estrategia de escaneo directo no encontró nada.
function tryDooplayAjaxFallback(pageHtml, pageUrl) {
  var $ = cheerio.load(pageHtml);
  var options = [];
  $('[data-post][data-nume], .dooplay_player_option, li[data-type]').each(function () {
    var $el = $(this);
    var post = $el.attr('data-post');
    var nume = $el.attr('data-nume') || '1';
    var type = $el.attr('data-type') || 'movie';
    if (post) options.push({ post, nume, type });
  });
  if (!options.length) {
    console.log("[PelisPlusHD] No se encontraron atributos data-post/data-nume en " + pageUrl + " — no es posible intentar el fallback AJAX de DooPlay. Este mecanismo no pudo confirmarse en vivo; si el escaneo directo tampoco entrega resultados, hace falta inspeccionar el sitio con devtools reales.");
    return Promise.resolve([]);
  }
  var promises = options.map(function (opt) {
    var body = "action=doo_player_ajax&post=" + encodeURIComponent(opt.post) + "&nume=" + encodeURIComponent(opt.nume) + "&type=" + encodeURIComponent(opt.type);
    return fetch(BASE_URL + "/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: Object.assign({}, DEFAULT_HEADERS, {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": pageUrl
      }),
      body: body
    }).then(function (res) { return res.ok ? res.json().catch(function () { return null; }) : null; })
      .then(function (data) {
        if (!data) return null;
        var embedHtml = data.embed_url || data.url || "";
        var m = embedHtml.match(/src=["']([^"']+)["']/);
        return m ? m[1] : (typeof embedHtml === 'string' && embedHtml.indexOf('http') === 0 ? embedHtml : null);
      }).catch(function () { return null; });
  });
  return Promise.all(promises).then(function (results) {
    return results.filter(Boolean);
  });
}

// ---------------------------------------------------------------------------
// Construcción directa de la URL de contenido (sin necesidad de scrapear
// listados de episodios, a diferencia de LaMovie) — CONFIRMADO por fetch
// real sobre varias series/animes distintos.
// ---------------------------------------------------------------------------
function buildContentUrl(baseSlugUrl, mediaType, season, episode) {
  var fullUrl = baseSlugUrl.startsWith('http') ? baseSlugUrl : BASE_URL + baseSlugUrl;
  if (mediaType === "tv" && season && episode) {
    fullUrl = fullUrl.replace(/\/+$/, '') + "/temporada/" + season + "/capitulo/" + episode;
  }
  return fullUrl;
}

function processEmbedUrl(embedUrl, seriesFallbackUrl) {
  if (/embed69\.org/i.test(embedUrl)) {
    return resolveEmbed69(embedUrl).then(function (subEmbeds) {
      var promises = subEmbeds.map(function (sub) {
        var resolver = getResolver(sub.url);
        if (!resolver) return Promise.resolve(null);
        return resolver(sub.url).then(function (result) {
          if (!result || !result.url) return null;
          return {
            name: "PelisPlusHD",
            title: sub.server + " · " + (result.quality || "1080p") + (result.verified ? " ✅" : ""),
            url: result.url,
            quality: result.quality || "1080p",
            verified: result.verified === true,
            headers: result.headers || {}
          };
        }).catch(function () { return null; });
      });
      return Promise.all(promises).then(function (r) { return r.filter(Boolean); });
    });
  }
  var resolver = getResolver(embedUrl);
  if (!resolver) {
    console.log("[PelisPlusHD] Sin resolver para: " + embedUrl);
    return Promise.resolve([]);
  }
  return resolver(embedUrl).then(function (result) {
    if (!result || !result.url) return [];
    var serverName = getServerName(embedUrl);
    return [{
      name: "PelisPlusHD",
      title: serverName + " · " + (result.quality || "1080p") + (result.verified ? " ✅" : ""),
      url: result.url,
      quality: result.quality || "1080p",
      verified: result.verified === true,
      headers: result.headers || {}
    }];
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error resolviendo " + embedUrl + ": " + err.message);
    return [];
  });
}

// ---------------------------------------------------------------------------
// Punto de entrada del provider
// ---------------------------------------------------------------------------
function getStreams(tmdbId, mediaType, season, episode) {
  var resolvedType = mediaType === "series" ? "tv" : mediaType || "movie";
  try {
    console.log("[PelisPlusHD] Buscando TMDB:" + tmdbId + " (" + resolvedType + ")" + (season ? " S" + season + "E" + episode : ""));
    return getTmdbInfo(tmdbId, resolvedType).then(function (info) {
      if (!info || !info.title) return [];
      console.log('[PelisPlusHD] TMDB: "' + info.title + '" (' + info.year + ")");
      return searchPelisPlusHD(info.title, info.originalTitle, info.year).then(function (found) {
        if (!found || !found.url) {
          console.log("[PelisPlusHD] No encontrado");
          return [];
        }
        var targetUrl = buildContentUrl(found.url, resolvedType, season, episode);
        return get(targetUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
          var embeds = extractEmbedsFromHtml(html);
          if (!embeds.length) {
            console.log("[PelisPlusHD] Escaneo directo no encontró embeds, probando fallback AJAX estilo DooPlay (no verificado en vivo)...");
            return tryDooplayAjaxFallback(html, targetUrl).then(function (fallbackEmbeds) {
              embeds = fallbackEmbeds;
              if (!embeds.length) {
                console.log("[PelisPlusHD] No se encontraron embeds en " + targetUrl);
                return [];
              }
              return resolveAllEmbeds(embeds);
            });
          }
          return resolveAllEmbeds(embeds);
        });
      });
    }).catch(function (err) {
      console.log("[PelisPlusHD] Error: " + err.message);
      return [];
    });
  } catch (err) {
    console.log("[PelisPlusHD] Error fatal: " + err.message);
    return Promise.resolve([]);
  }
}

function resolveAllEmbeds(embeds) {
  console.log("[PelisPlusHD] " + embeds.length + " embed(s) encontrados, resolviendo...");
  var promises = embeds.map(function (embedUrl) { return processEmbedUrl(embedUrl); });
  return Promise.all(promises).then(function (results) {
    var flat = [].concat.apply([], results);
    console.log("[PelisPlusHD] Total final: " + flat.length + " streams");
    return flat;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams
  };
} else {
  global.getStreams = getStreams;
}

// ============================================================================
// DEV_NOTES — puntos pendientes de verificación en un entorno con navegador
// real (no cubiertos por las herramientas de análisis usadas para investigar
// este sitio), a revisar antes de considerar el provider 100% listo:
//
// 1) Endpoint de búsqueda: confirmar si `/?s=` devuelve resultados reales o
//    si el sitio usa un endpoint AJAX propio (revisar con devtools > Network
//    mientras se escribe en el buscador de la UI).
// 2) Confirmar el atributo/selector real del tab "Embed69" en episodios
//    (no solo películas) — en la prueba real, apareció el tab pero no el
//    enlace directo, a diferencia de la página de película.
// 3) Descifrado de Embed69: capturar con devtools el payload cifrado real
//    (variable JS + clave AES) para poder implementar un `resolveEmbed69`
//    que no dependa de encontrar URLs en texto plano.
// 4) Confirmar si existen más "tabs" de servidor además de Embed69 en
//    títulos con múltiples idiomas (Latino/Castellano/Subtitulado) — en las
//    páginas revisadas solo apareció una opción de servidor.
// ============================================================================
