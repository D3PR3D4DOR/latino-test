/**
 * PelisPlusHD - Plugin Nuvio
 * Arquitectura unificada bundle
 */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// --- Modulo TMDB ---
var require_tmdb = __commonJS({
  "src/shared/utils/tmdb.js"(exports2, module2) {
    function getTmdbApiKey() {
      const settings = typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS || {};
      const appKey = settings.tmdb_api_key || settings.tmdbApiKey || (typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY : null);
      return appKey || "439c478a771f35c05022f9feabcca01c";
    }
    var NUVIO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    function getDetails(tmdbId, mediaType) {
      return __async(this, null, function* () {
        try {
          const type = String(mediaType || "").toLowerCase().includes("movie") ? "movie" : "tv";
          const apiKey = getTmdbApiKey();
          const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}&language=es-MX`;
          const response = yield fetch(url, { headers: { "User-Agent": NUVIO_UA } });
          if (!response.ok) return null;
          return yield response.json();
        } catch (e) {
          console.error("[TMDB] Error obteniendo detalles:", e.message);
          return null;
        }
      });
    }
    module2.exports = { getDetails };
  }
});

// --- Modulo Unpacker ---
var require_unpacker = __commonJS({
  "src/shared/utils/unpacker.js"(exports2, module2) {
    function unpack(code) {
      try {
        const match = code.match(/eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\s*\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
        if (!match) return code;
        let [, p, a, c, k] = match;
        a = parseInt(a);
        c = parseInt(c);
        let kArr = k.split("|");
        const result = p.replace(/\b\w+\b/g, (e) => {
          const index = parseInt(e, 36);
          let word = kArr[index];
          if (!word) {
            const altIndex = parseInt(e, a);
            word = kArr[altIndex];
          }
          return word || e;
        });
        return result;
      } catch (e) {
        return code;
      }
    }
    module2.exports = { unpack };
  }
});

// --- Resolvers ---
var require_voe = __commonJS({
  "src/shared/resolvers/voe.js"(exports2, module2) {
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    function resolveVoe(url) {
      return __async(this, null, function* () {
        try {
          const response = yield fetch(url, { headers: { "User-Agent": USER_AGENT, "Referer": url } });
          const html = yield response.text();
          const m3u8Match = html.match(/["'](https?:\/\/[^"']+?\.m3u8[^"']*?)["']/i);
          if (m3u8Match) {
            return { url: m3u8Match[1], quality: "HD", headers: { "Referer": url, "User-Agent": USER_AGENT } };
          }
          return null;
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = resolveVoe;
  }
});

var require_streamwish = __commonJS({
  "src/shared/resolvers/streamwish.js"(exports2, module2) {
    var { unpack } = require_unpacker();
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    function resolveStreamwish(url) {
      return __async(this, null, function* () {
        try {
          const res = yield fetch(url, { headers: { "User-Agent": USER_AGENT, "Referer": "https://pelisplushd.bz/" } });
          if (!res.ok) return null;
          let html = yield res.text();
          const evalMatch = html.match(/eval\(function\(p,a,c,k,e,[rd]\)[\s\S]*?\.split\('\|'\)[^\)]*\)\)/);
          if (evalMatch) html += "\n" + unpack(evalMatch[0]);
          
          const fileMatch = html.match(/(?:file|source|src|hls)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)['"]/i);
          if (fileMatch) {
            return { url: fileMatch[1], quality: "Auto", headers: { "Referer": url } };
          }
          return null;
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = resolveStreamwish;
  }
});

var require_generic_packer = __commonJS({
  "src/shared/resolvers/generic_packer.js"(exports2, module2) {
    var { unpack } = require_unpacker();
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    function resolveGenericPacker(url, referer) {
      return __async(this, null, function* () {
        try {
          const response = yield fetch(url, { headers: { "User-Agent": USER_AGENT, "Referer": referer || "https://pelisplushd.bz/" } });
          if (!response.ok) return null;
          let html = yield response.text();
          const evalMatches = html.match(/eval\(function\(p,a,c,k,e,[rd]\)[\s\S]*?\.split\('\|'\)[^\)]*\)\)/g);
          if (evalMatches) {
            for (const em of evalMatches) html += "\n" + unpack(em);
          }
          const fileMatch = html.match(/(?:file|source|src|hls|stream_url|url)\s*[=:]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)['"]/i);
          if (fileMatch) {
            return { url: fileMatch[1], quality: "Auto", headers: { "Referer": url, "User-Agent": USER_AGENT } };
          }
          return null;
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = resolveGenericPacker;
  }
});

// --- Extractor Principal de PelisPlusHD ---
var require_extractor = __commonJS({
  "src/pelisplushd/extractor.js"(exports2, module2) {
    var cheerio = require("cheerio");
    var tmdb = require_tmdb();
    var resolveVoe = require_voe();
    var resolveStreamwish = require_streamwish();
    var resolveGenericPacker = require_generic_packer();

    var baseURL = "https://pelisplushd.bz";
    var NUVIO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    function getResolverForUrl(url) {
      const lower = url.toLowerCase();
      if (lower.includes("voe.sx") || lower.includes("voe.")) return { fn: resolveVoe, name: "VOE" };
      if (lower.includes("streamwish") || lower.includes("wishem") || lower.includes("awish.pro")) return { fn: resolveStreamwish, name: "StreamWish" };
      if (lower.includes("filemoon") || lower.includes("mixdrop") || lower.includes("streamtape")) return { fn: resolveGenericPacker, name: "Player" };
      return null;
    }

    function searchInSite(query) {
      return __async(this, null, function* () {
        try {
          const searchUrl = `${baseURL}/search?s=${encodeURIComponent(query)}`;
          const response = yield fetch(searchUrl, { headers: { "User-Agent": NUVIO_UA, "Referer": `${baseURL}/` } });
          if (!response.ok) return null;
          const html = yield response.text();
          const $ = cheerio.load(html);
          
          let foundUrl = null;
          const cleanQuery = query.toLowerCase().trim();

          $("a[href*='/pelicula/'], a[href*='/serie/']").each((i, el) => {
            const href = $(el).attr("href");
            if (href && !foundUrl) {
              const slug = href.split("/").pop().replace(/-/g, " ");
              if (slug.includes(cleanQuery) || cleanQuery.includes(slug)) {
                foundUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
              }
            }
          });

          if (!foundUrl) {
            const first = $("a[href*='/pelicula/'], a[href*='/serie/']").first().attr("href");
            if (first) foundUrl = first.startsWith("http") ? first : `${baseURL}${first}`;
          }

          return foundUrl;
        } catch (e) {
          console.error("[PelisPlusHD] Error en búsqueda:", e.message);
          return null;
        }
      });
    }

    function extractStreamsFromUrl(url) {
      return __async(this, null, function* () {
        try {
          console.log(`[PelisPlusHD] Extrayendo reproductores de: ${url}`);
          const response = yield fetch(url, { headers: { "User-Agent": NUVIO_UA, "Referer": baseURL } });
          if (!response.ok) return [];
          const html = yield response.text();
          const $ = cheerio.load(html);
          const streams = [];

          const embedPromises = [];

          $("iframe").each((i, el) => {
            let src = $(el).attr("data-src") || $(el).attr("src");
            if (!src) return;
            if (src.startsWith("//")) src = "https:" + src;

            if (src.includes("facebook") || src.includes("ads") || src.includes("disqus")) return;

            const resolver = getResolverForUrl(src);
            if (resolver) {
              embedPromises.push((() => __async(this, null, function* () {
                const resolved = yield resolver.fn(src, url);
                if (resolved && resolved.url) {
                  return {
                    name: `PelisPlusHD (${resolver.name})`,
                    url: resolved.url,
                    quality: resolved.quality || "HD",
                    language: "Latino",
                    headers: resolved.headers || { "User-Agent": NUVIO_UA, "Referer": url }
                  };
                }
                return null;
              }))());
            } else {
              // Si no tiene des-empaquetador activo, se entrega el iframe listo para la app
              embedPromises.push(Promise.resolve({
                name: "PelisPlusHD (Embed)",
                url: src,
                quality: "HD",
                language: "Latino",
                headers: { "User-Agent": NUVIO_UA, "Referer": url }
              }));
            }
          });

          const results = yield Promise.all(embedPromises);
          return results.filter(r => r !== null);
        } catch (e) {
          console.error("[PelisPlusHD] Error extrayendo streams:", e.message);
          return [];
        }
      });
    }

    function getStreams2(tmdbId, mediaType, season, episode) {
      return __async(this, null, function* () {
        console.log(`[PelisPlusHD] Procesando ID:${tmdbId} | Tipo:${mediaType}`);
        try {
          const isTv = String(mediaType || "").toLowerCase().includes("tv") || String(mediaType || "").toLowerCase().includes("series");
          const type = isTv ? "tv" : "movie";

          const tmdbDetails = yield tmdb.getDetails(tmdbId, type);
          if (!tmdbDetails) return [];

          const title = tmdbDetails.title || tmdbDetails.name || tmdbDetails.original_title;
          let contentUrl = yield searchInSite(title);
          if (!contentUrl) return [];

          if (isTv) {
            contentUrl = `${contentUrl.replace(/\/$/, "")}/temporada/${season}/episodio/${episode}`;
          }

          return yield extractStreamsFromUrl(contentUrl);
        } catch (e) {
          console.error("[PelisPlusHD] Error general:", e.message);
          return [];
        }
      });
    }

    module2.exports = { getStreams: getStreams2 };
  }
});

// --- Exportación Final Nuvio ---
var { getStreams } = require_extractor();
module.exports = {
  getStreams
};