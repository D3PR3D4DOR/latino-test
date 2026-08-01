// src/pelisplushd/index.js (Nuvio Provider - PelisPlusHD)
var cheerio = require('cheerio');

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var BASE_URL = "https://pelisplushd.bz";

var DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

// --- HTTP HELPER ---
function get(url, extraHeaders) {
  var headers = Object.assign({}, DEFAULT_HEADERS, extraHeaders || {});
  return fetch(url, { headers: headers, redirect: "follow" }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("json") !== -1) return res.json();
    return res.text();
  });
}

// --- NORMALIZATION & SCORING ---
function normalizeTitle(t) {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
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
    score += (matched / wordsToCheck.length) * 30;
  }

  var origWords = normOrig.split(" ").filter(function (w) {
    return (w.length > 3 || /^\d+$/.test(w)) && !STOPWORDS[w];
  });
  if (origWords.length > 0) {
    var origMatched = 0;
    for (var j = 0; j < origWords.length; j++) {
      if (normCand.indexOf(origWords[j]) !== -1) origMatched++;
    }
    score += (origMatched / origWords.length) * 20;
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
    var n = (a << 18) | (b << 12) | (cb << 6) | db;
    result += String.fromCharCode((n >> 16) & 255);
    if (c !== -1) result += String.fromCharCode((n >> 8) & 255);
    if (d !== -1) result += String.fromCharCode(n & 255);
  }
  return result;
}

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

// --- RESOLVERS ---
function resolveHlswish(embedUrl) {
  var embedHostMatch = embedUrl.match(/^(https?:\/\/[^/]+)/);
  var embedHost = embedHostMatch ? embedHostMatch[1] : BASE_URL;

  return get(embedUrl, {
    "Referer": BASE_URL + "/",
    "User-Agent": DEFAULT_HEADERS["User-Agent"]
  }).then(function (data) {
    var fileMatch = data.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch) {
      var url = fileMatch[1];
      if (url.charAt(0) === "/") url = embedHost + url;
      return { url: url, quality: "1080p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": embedHost + "/" } };
    }
    var packMatch = data.match(/eval\(function\(p,a,c,k,e,[a-z]\)\{[^}]+\}\s*\('([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)/);
    if (packMatch) {
      var unpacked = unpackEval(packMatch[1], parseInt(packMatch[2]), packMatch[4].split("|"));
      var m3u8Match = unpacked.match(/["']([^"']{30,}\.m3u8[^"']*)['"]/);
      if (m3u8Match) {
        var mUrl = m3u8Match[1];
        if (mUrl.charAt(0) === "/") mUrl = embedHost + mUrl;
        return { url: mUrl, quality: "1080p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": embedHost + "/" } };
      }
    }
    return null;
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error HLSWish: " + err.message);
    return null;
  });
}

function resolveDoodstream(embedUrl) {
  var embedHost = embedUrl.replace(/\/(d|f)\//, "/e/");
  return get(embedHost, { "Referer": BASE_URL + "/" }).then(function (html) {
    var match = html.match(/\$\.get\(['"](\/pass_md5\/[\w-]+\/([\w-]+))['"]/i);
    if (!match) return null;

    var passPath = match[1];
    var token = match[2];
    var domain = embedHost.match(/^(https?:\/\/[^/]+)/)[1];

    return get(domain + passPath, { "Referer": embedHost }).then(function (videoBaseUrl) {
      if (!videoBaseUrl) return null;
      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      var randomString = "";
      for (var i = 0; i < 10; i++) randomString += chars.charAt(Math.floor(Math.random() * chars.length));
      var finalUrl = videoBaseUrl + randomString + "?token=" + token + "&expiry=" + Date.now();
      return { url: finalUrl, quality: "720p", verified: true, headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": domain + "/" } };
    });
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error DoodStream: " + err.message);
    return null;
  });
}

function resolveVoe(embedUrl) {
  return get(embedUrl, { "Referer": embedUrl }).then(function (data) {
    var re = /(?:mp4|hls)['"\s]*:\s*['"]([^'"]+)['"]/gi;
    var m = re.exec(data);
    if (m && m[1]) {
      var url = m[1];
      if (url.indexOf("aHR0") === 0) {
        try { url = b64decode(url); } catch (e) {}
      }
      return { url: url, quality: "1080p", verified: true, headers: { "Referer": embedUrl } };
    }
    return null;
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error VOE: " + err.message);
    return null;
  });
}

function resolveLacloud(embedUrl) {
  return get(embedUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
    var m = html.match(/const src\s*=\s*["']([^"']+)["']/);
    if (m) {
      return { url: m[1], quality: "1080p", verified: true, headers: { "Referer": embedUrl, "User-Agent": DEFAULT_HEADERS["User-Agent"] } };
    }
    return null;
  }).catch(function () { return null; });
}

function getResolver(url) {
  if (url.indexOf("hlswish") !== -1 || url.indexOf("streamwish") !== -1 || url.indexOf("strwish") !== -1 || url.indexOf("vibuxer") !== -1) return resolveHlswish;
  if (url.indexOf("dood") !== -1 || url.indexOf("d0000d") !== -1 || url.indexOf("ds2video") !== -1 || url.indexOf("ds2play") !== -1 || url.indexOf("dsvplay") !== -1) return resolveDoodstream;
  if (url.indexOf("voe.sx") !== -1) return resolveVoe;
  if (url.indexOf("lacloud.live") !== -1) return resolveLacloud;
  return null;
}

function getServerName(url) {
  if (url.indexOf("hlswish") !== -1 || url.indexOf("streamwish") !== -1 || url.indexOf("vibuxer") !== -1) return "StreamWish";
  if (url.indexOf("dood") !== -1 || url.indexOf("d0000d") !== -1 || url.indexOf("ds2video") !== -1) return "DoodStream";
  if (url.indexOf("voe.sx") !== -1) return "VOE";
  if (url.indexOf("lacloud.live") !== -1) return "Lacloud";
  return "Online";
}

// --- TMDB METADATA ---
function getTmdbInfo(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&language=es-MX";
  return get(url).then(function (data) {
    var title = type === "movie" ? data.title || data.original_title : data.name || data.original_name;
    var originalTitle = type === "movie" ? data.original_title || data.title : data.original_name || data.name;
    var year = (type === "movie" ? data.release_date || "" : data.first_air_date || "").slice(0, 4);
    return { title: title, originalTitle: originalTitle, year: year };
  });
}

// --- PELISPLUSHD SCRAPING LOGIC ---
function parseSearchResults(html) {
  var $ = cheerio.load(html);
  var posts = [];

  $('.Posters .Post, .item-pelicula, .Posters a, .post-item').each(function () {
    var $el = $(this);
    var link = $el.attr('href') || $el.find('a').attr('href');
    var title = $el.find('.PostTitle, .entry-title, .title, h2, h3').text().trim() || $el.find('img').attr('alt') || $el.attr('title') || "";
    var year = $el.find('.Year, .year, .prmtr').text().trim();

    if (link && title) {
      posts.push({ title: title, year: year, url: link });
    }
  });

  return posts;
}

function searchPelisPlusHD(title, originalTitle, year) {
  var url = BASE_URL + "/search?s=" + encodeURIComponent(title);
  return get(url, { "Referer": BASE_URL + "/" }).then(function (html) {
    var posts = parseSearchResults(html);

    if (!posts.length) {
      var urlFallback = BASE_URL + "/?s=" + encodeURIComponent(title);
      return get(urlFallback, { "Referer": BASE_URL + "/" }).then(function (htmlFallback) {
        return parseSearchResults(htmlFallback);
      });
    }
    return posts;
  }).then(function (posts) {
    if (!posts.length && originalTitle && normalizeTitle(originalTitle) !== normalizeTitle(title)) {
      console.log('[PelisPlusHD] Probando titulo original: "' + originalTitle + '"');
      var url2 = BASE_URL + "/search?s=" + encodeURIComponent(originalTitle);
      return get(url2, { "Referer": BASE_URL + "/" }).then(function (html2) {
        return parseSearchResults(html2);
      });
    }
    return posts;
  }).then(function (posts) {
    if (!posts.length) return null;
    var scored = [];
    for (var i = 0; i < posts.length; i++) {
      scored.push({ post: posts[i], score: scoreCandidate(posts[i].title, title, originalTitle, year) });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var best = scored[0];
    if (best.score < 20) {
      console.log("[PelisPlusHD] Coincidencia baja (score: " + best.score.toFixed(1) + ")");
      return null;
    }
    console.log('[PelisPlusHD] Coincidencia OK: "' + best.post.title + '" (score:' + best.score.toFixed(1) + ") url:" + best.post.url);
    return { url: best.post.url };
  }).catch(function (err) {
    console.log("[PelisPlusHD] Error busqueda: " + err.message);
    return null;
  });
}

// --- ENTRY POINT ---
function getStreams(tmdbId, mediaType, season, episode) {
  var resolvedType = mediaType === "series" ? "tv" : mediaType || "movie";
  try {
    console.log("[PelisPlusHD] Buscando TMDB:" + tmdbId + " (" + resolvedType + ")" + (season ? " S" + season + "E" + episode : ""));
    return getTmdbInfo(tmdbId, resolvedType).then(function (info) {
      if (!info || !info.title) return [];

      return searchPelisPlusHD(info.title, info.originalTitle, info.year).then(function (found) {
        if (!found || !found.url) {
          console.log("[PelisPlusHD] No encontrado en la web");
          return [];
        }

        var contentUrl = found.url.startsWith('http') ? found.url : BASE_URL + found.url;

        var targetUrlPromise = Promise.resolve(contentUrl);
        if (resolvedType === "tv" && season && episode) {
          targetUrlPromise = get(contentUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
            var $ = cheerio.load(html);
            var epUrl = null;

            $('.SeasonSerie a, .EpsList a, .list-episodes a, .episodes-list a, a[href*="/episodio/"]').each(function () {
              var href = $(this).attr('href') || "";
              var txt = $(this).text().toLowerCase();

              if (href.includes('-' + season + 'x' + episode) || 
                  href.includes('/episodio-' + episode) || 
                  (txt.includes('t' + season) && txt.includes('e' + episode)) ||
                  (txt.includes('temporada ' + season) && txt.includes('episodio ' + episode))) {
                epUrl = href;
              }
            });

            return epUrl ? (epUrl.startsWith('http') ? epUrl : BASE_URL + epUrl) : null;
          });
        }

        return targetUrlPromise.then(function (targetUrl) {
          if (!targetUrl) return [];

          return get(targetUrl, { "Referer": BASE_URL + "/" }).then(function (html) {
            var $ = cheerio.load(html);
            var embeds = [];

            // 1. Extraer de iFrames directos
            $('iframe[src*="http"], .OptionPayload iframe, #player iframe').each(function () {
              var src = $(this).attr('src');
              if (src) {
                if (src.startsWith('//')) src = "https:" + src;
                embeds.push({ url: src, language: "Latino" });
              }
            });

            // 2. Extraer de elementos de opciones / pestañas con data attributes
            $('[data-video], [data-src], [data-url], .NavOpc li, .TbNav li').each(function () {
              var videoUrl = $(this).attr('data-video') || $(this).attr('data-src') || $(this).attr('data-url');
              var langText = $(this).text().toLowerCase();

              var langLabel = "Latino";
              if (langText.includes('castellano') || langText.includes('español')) langLabel = "Castellano";
              else if (langText.includes('sub')) langLabel = "Subtitulado";

              if (videoUrl) {
                if (videoUrl.startsWith('//')) videoUrl = "https:" + videoUrl;
                embeds.push({ url: videoUrl, language: langLabel });
              }
            });

            if (!embeds.length) return [];
            console.log("[PelisPlusHD] " + embeds.length + " embed(s) detectados");

            var results = [];
            var promises = embeds.map(function (embed) {
              var resolver = getResolver(embed.url);
              if (!resolver) return Promise.resolve();

              return resolver(embed.url).then(function (res) {
                if (res && res.url) {
                  var sName = getServerName(embed.url);
                  var isVerified = res.verified === true;
                  var checkMark = isVerified ? " \u2705" : "";
                  var qualityLabel = res.quality || "1080p";

                  var streamName = "PelisPlusHD - " + qualityLabel + checkMark;
                  var streamTitle = embed.language + " - " + sName + " " + qualityLabel;

                  results.push({
                    name: streamName,
                    title: streamTitle,
                    size: streamTitle, // Compatibilidad con Nuvio Mobile
                    url: res.url,
                    quality: qualityLabel,
                    verified: isVerified,
                    headers: res.headers || { "User-Agent": DEFAULT_HEADERS["User-Agent"], "Referer": BASE_URL + "/" },
                    behaviorHints: { notWebReady: true }
                  });
                }
              }).catch(function (e) {
                console.log("[PelisPlusHD] Skip embed: " + e.message);
              });
            });

            return Promise.all(promises).then(function () {
              console.log("[PelisPlusHD] Total streams extraidos: " + results.length);
              return results;
            });
          });
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
