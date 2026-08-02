/**
 * pelisplushd - Built from src/pelisplushd/
 * Generated: 2026-08-02T09:35:06.811Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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

// src/pelisplushd/http.js
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
  // Add other common headers like 'Referer' if needed
};
function fetchText(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    console.log(`[Template] Fetching: ${url}`);
    const response = yield fetch(url, __spreadValues({
      headers: __spreadValues(__spreadValues({}, HEADERS), options.headers)
    }, options));
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status} for ${url}`);
    }
    return yield response.text();
  });
}
function fetchJson(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    const raw = yield fetchText(url, options);
    return JSON.parse(raw);
  });
}

// src/pelisplushd/search.js
var import_cheerio_without_node_native = __toESM(require("cheerio-without-node-native"));
var BASE_URL = "https://pelisplushd.bz";
function searchMovie(title) {
  return __async(this, null, function* () {
    return search(title, "a.Posters-link.movies");
  });
}
function searchSeries(title) {
  return __async(this, null, function* () {
    return search(title, "a.Posters-link.series, a.Posters-link.animes");
  });
}
function search(title, selector) {
  return __async(this, null, function* () {
    const url = `${BASE_URL}/search?s=${encodeURIComponent(title)}`;
    console.log(`[PelisPlusHD] Searching: ${url}`);
    const html = yield fetchText(url);
    const $ = import_cheerio_without_node_native.default.load(html);
    const results = [];
    $(selector).each((_, element) => {
      const card = $(element);
      const url2 = card.attr("href");
      const poster = card.find("img").attr("src");
      const rawTitle = card.find("p").text().trim();
      const rating = card.find(".rating span").text().trim();
      let title2 = rawTitle;
      let year = null;
      const match = rawTitle.match(/^(.*)\((\d{4})\)$/);
      if (match) {
        title2 = match[1].trim();
        year = Number(match[2]);
      }
      results.push({
        title: title2,
        year,
        rating: Number.parseFloat(rating),
        poster,
        url: url2
      });
    });
    return results;
  });
}

// src/pelisplushd/movie.js
function loadMovie(url) {
  return __async(this, null, function* () {
    console.log(`[PelisPlusHD] Loading: ${url}`);
    return yield fetchText(url);
  });
}

// src/pelisplushd/pow.js
function sha256Hex(text) {
  return __async(this, null, function* () {
    const data = new TextEncoder().encode(text);
    const hash = yield crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
  });
}
function sha256Bytes(text) {
  return __async(this, null, function* () {
    const data = new TextEncoder().encode(text);
    const hash = yield crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hash);
  });
}
function solvePow(challenge, difficulty, salt) {
  return __async(this, null, function* () {
    const prefix = "0".repeat(difficulty);
    let nonce = 0;
    while (true) {
      const hash = yield sha256Hex(challenge + nonce);
      if (hash.startsWith(prefix)) {
        const aesKey = yield sha256Bytes(
          challenge + nonce + salt
        );
        return {
          nonce,
          aesKey
        };
      }
      nonce++;
    }
  });
}

// src/pelisplushd/crypto.js
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function decryptAES(encryptedBase64, aesKey) {
  return __async(this, null, function* () {
    try {
      const raw = base64ToBytes(encryptedBase64);
      const iv = raw.slice(0, 16);
      const ciphertext = raw.slice(16);
      const key = yield crypto.subtle.importKey(
        "raw",
        aesKey.slice(0, 32),
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      const decrypted = yield crypto.subtle.decrypt(
        {
          name: "AES-CBC",
          iv
        },
        key,
        ciphertext
      );
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.error("[AES]", err);
      return null;
    }
  });
}

// src/pelisplushd/embed69.js
function resolveEmbed69(url) {
  return __async(this, null, function* () {
    console.log(`[Embed69] Opening: ${url}`);
    const html = yield fetchText(url);
    const challenge = extractChallenge(html);
    const difficulty = extractDifficulty(html);
    const salt = extractSalt(html);
    const dataLink = extractDataLink(html);
    if (!challenge || !Number.isInteger(difficulty) || difficulty < 0 || !salt) {
      throw new Error("[Embed69] No se pudieron extraer los datos de Proof of Work.");
    }
    if (!Array.isArray(dataLink)) {
      throw new Error("[Embed69] No se pudo extraer dataLink.");
    }
    const { aesKey } = yield solvePow(challenge, difficulty, salt);
    for (const file of dataLink) {
      for (const embedsKey of ["sortedEmbeds", "downloadEmbeds"]) {
        const embeds = file == null ? void 0 : file[embedsKey];
        if (!Array.isArray(embeds)) {
          continue;
        }
        for (const embed of embeds) {
          if (!(embed == null ? void 0 : embed.link) || typeof embed.link !== "string") {
            continue;
          }
          const link = yield decryptAES(embed.link, aesKey);
          if (link) {
            embed.link = link;
          }
        }
      }
    }
    return dataLink;
  });
}
function extractChallenge(html) {
  const match = html.match(
    /const\s+POW_CHALLENGE\s*=\s*['"]([^'"]+)['"]/
  );
  return match ? match[1] : "";
}
function extractDifficulty(html) {
  const match = html.match(
    /const\s+POW_DIFFICULTY\s*=\s*(\d+)/
  );
  return match ? Number(match[1]) : 0;
}
function extractSalt(html) {
  const match = html.match(
    /const\s+POW_SALT\s*=\s*['"]([^'"]+)['"]/
  );
  return match ? match[1] : "";
}
function extractDataLink(html) {
  const match = html.match(
    /let\s+dataLink\s*=\s*(\[[\s\S]*?\]);/
  );
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`[Embed69] Error parseando dataLink: ${err.message}`);
  }
}

// src/pelisplushd/resolvers/vidhide.js
function resolveVidhide(url) {
  return __async(this, null, function* () {
    console.log(`[Vidhide] Opening ${url}`);
    const html = yield fetchText(url);
    const unpacked = unpackPacker(html);
    const sources = extractSources(unpacked, url);
    if (sources.length === 0) {
      throw new Error("[Vidhide] No se encontr\xF3 la configuraci\xF3n de JWPlayer.");
    }
    const streams = [];
    for (const source of sources) {
      try {
        console.log("[Vidhide] Master:", source.url);
        const response = yield fetch(source.url, {
          headers: __spreadProps(__spreadValues({}, HEADERS), {
            Referer: url,
            Origin: new URL(url).origin
          })
        });
        console.log("[Vidhide] HTTP status:", response.status);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} for ${source.url}`);
        }
        const playlist = yield response.text();
        console.log("[Vidhide] Playlist length:", playlist.length);
        console.log("[Vidhide] First line:", playlist.split("\n")[0]);
        console.log("[Vidhide] Is HLS:", playlist.trimStart().startsWith("#EXTM3U"));
        const variants = extractHlsVariants(playlist, source.url);
        console.log("[Vidhide] Variant count:", variants.length);
        console.log("[Vidhide] Variants:", variants);
        if (variants.length > 0) {
          streams.push(...variants);
          continue;
        }
      } catch (error) {
        console.warn(`[Vidhide] No se pudo leer el playlist ${source.url}:`, error.message);
      }
      streams.push({ url: source.url, quality: source.quality });
    }
    const result = removeDuplicates(streams);
    console.log("[Vidhide] Returning:", result);
    return result;
  });
}
function unpackPacker(html) {
  const match = html.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:\\.|[^'])*)',(\d+),(\d+),'((?:\\.|[^'])*)'\.split\('\|'\)\)\)/
  );
  if (!match) {
    return html;
  }
  let source = decodePackedString(match[1]);
  const base = Number(match[2]);
  const count = Number(match[3]);
  const dictionary = decodePackedString(match[4]).split("|");
  for (let index = count - 1; index >= 0; index--) {
    const replacement = dictionary[index];
    if (!replacement) {
      continue;
    }
    const token = index.toString(base);
    source = source.replace(
      new RegExp(`\\b${token}\\b`, "g"),
      replacement
    );
  }
  return source;
}
function decodePackedString(value) {
  return value.replace(/\\(x[\da-fA-F]{2}|u[\da-fA-F]{4}|.)/g, (match, escape) => {
    var _a;
    if (escape.startsWith("x")) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    if (escape.startsWith("u")) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    const escapes = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "	",
      v: "\v"
    };
    return (_a = escapes[escape]) != null ? _a : escape;
  });
}
function extractSources(source, pageUrl) {
  const sources = [];
  const matches = source.matchAll(
    /["'](hls4|hls3|hls2)["']\s*:\s*["']([^"']+)["']/g
  );
  for (const match of matches) {
    const url = new URL(match[2], pageUrl).href;
    if (!url.includes(".m3u8")) {
      continue;
    }
    sources.push({
      url,
      quality: "auto",
      priority: Number(match[1].slice(-1))
    });
  }
  return sources.sort((left, right) => right.priority - left.priority).slice(0, 1);
}
function extractHlsVariants(playlist, playlistUrl) {
  const lines = playlist.split(/\r?\n/);
  const streams = [];
  for (let index = 0; index < lines.length; index++) {
    const attributes = lines[index];
    if (!attributes.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const location = lines.slice(index + 1).find((line) => {
      return line.trim() && !line.startsWith("#");
    });
    if (!location) {
      continue;
    }
    const resolution = attributes.match(/RESOLUTION=\d+x(\d+)/i);
    const name = attributes.match(/NAME="?([^",]+)/i);
    streams.push({
      url: new URL(location.trim(), playlistUrl).href,
      quality: resolution ? `${resolution[1]}p` : name ? name[1] : "auto"
    });
  }
  return streams;
}
function removeDuplicates(streams) {
  const seen = /* @__PURE__ */ new Set();
  return streams.filter((stream) => {
    if (seen.has(stream.url)) {
      return false;
    }
    seen.add(stream.url);
    return true;
  });
}

// src/pelisplushd/tmdb.js
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
function getMovie(tmdbId) {
  return __async(this, null, function* () {
    const data = yield fetchJson(
      `${TMDB_BASE_URL}/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`
    );
    return {
      title: data.title,
      originalTitle: data.original_title,
      year: getYear(data.release_date)
    };
  });
}
function getTv(tmdbId) {
  return __async(this, null, function* () {
    const data = yield fetchJson(
      `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-ES`
    );
    return {
      title: data.name,
      originalTitle: data.original_name,
      year: getYear(data.first_air_date)
    };
  });
}
function getYear(date) {
  const match = typeof date === "string" ? date.match(/^\d{4}/) : null;
  return match ? Number(match[0]) : null;
}

// src/pelisplushd/series.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio-without-node-native"));
function getEpisodeUrl(seriesUrl, season, episode) {
  return __async(this, null, function* () {
    const html = yield fetchText(seriesUrl);
    const $ = import_cheerio_without_node_native2.default.load(html);
    const requestedSeason = Number(season);
    const requestedEpisode = Number(episode);
    let episodeUrl = null;
    $("a[href]").each((_, element) => {
      if (episodeUrl) {
        return;
      }
      const href = $(element).attr("href");
      if (!href) {
        return;
      }
      const url = new URL(href, seriesUrl);
      const match = url.pathname.match(
        /\/(?:temporada|season)\/(\d+)\/(?:capitulo|episode)\/(\d+)\/?$/i
      );
      if (match && Number(match[1]) === requestedSeason && Number(match[2]) === requestedEpisode) {
        episodeUrl = url.href;
      }
    });
    return episodeUrl;
  });
}

// src/pelisplushd/extractor.js
function extractStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    var _a;
    console.log(`[PelisPlusHD] Searching TMDB ID: ${tmdbId}`);
    const media = yield getMedia(tmdbId, mediaType);
    console.log("[PelisPlusHD] TMDB:", media);
    const results = yield searchPelisPlus(media, mediaType);
    if (results.length === 0) {
      return [];
    }
    const selected = selectResult(results, media);
    const contentUrl = yield getContentUrl(selected.url, mediaType, season, episode);
    if (!contentUrl) {
      return [];
    }
    console.log(`[PelisPlusHD] Selected: ${contentUrl}`);
    const html = yield loadMovie(contentUrl);
    const matches = [
      ...html.matchAll(/video\[\d+\]\s*=\s*['"]([^'"]+)['"]/g)
    ];
    const streams = [];
    for (const match of matches) {
      const embedUrl = match[1];
      if (!embedUrl.includes("embed69.org")) {
        continue;
      }
      const languages = yield resolveEmbed69(embedUrl);
      for (const language of languages) {
        if (!Array.isArray(language.sortedEmbeds)) {
          continue;
        }
        for (const server of language.sortedEmbeds) {
          if (((_a = server.servername) == null ? void 0 : _a.toLowerCase()) !== "vidhide" || !server.link) {
            continue;
          }
          const variants = yield resolveVidhide(server.link);
          for (const variant of variants) {
            streams.push({
              name: "PelisPlusHD",
              language: language.video_language,
              quality: variant.quality,
              url: variant.url
            });
          }
        }
      }
    }
    return streams;
  });
}
function getMedia(tmdbId, mediaType) {
  return __async(this, null, function* () {
    if (mediaType === "movie") {
      return getMovie(tmdbId);
    }
    if (mediaType === "tv") {
      return getTv(tmdbId);
    }
    throw new Error(`[PelisPlusHD] Unsupported media type: ${mediaType}`);
  });
}
function searchPelisPlus(media, mediaType) {
  return __async(this, null, function* () {
    var _a;
    const search2 = mediaType === "tv" ? searchSeries : searchMovie;
    let results = yield search2(media.title);
    if (results.length === 0 && media.originalTitle && media.originalTitle.toLowerCase() !== ((_a = media.title) == null ? void 0 : _a.toLowerCase())) {
      results = yield search2(media.originalTitle);
    }
    return results;
  });
}
function getContentUrl(url, mediaType, season, episode) {
  return __async(this, null, function* () {
    if (mediaType === "movie") {
      return url;
    }
    if (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode))) {
      throw new Error("[PelisPlusHD] A TV request requires season and episode numbers.");
    }
    const episodeUrl = yield getEpisodeUrl(url, season, episode);
    if (!episodeUrl) {
      console.warn(`[PelisPlusHD] Episode S${season}E${episode} was not found.`);
    }
    return episodeUrl;
  });
}
function selectResult(results, media) {
  const sameYear = media.year === null ? [] : results.filter((result) => result.year === media.year);
  const candidates = sameYear.length > 0 ? sameYear : results;
  const titles = [media.title, media.originalTitle].filter(Boolean).map(normalizeTitle);
  const exactMatch = candidates.find((result) => {
    return titles.includes(normalizeTitle(result.title));
  });
  return exactMatch || candidates[0];
}
function normalizeTitle(title) {
  return title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// src/pelisplushd/index.js
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      console.log(`[PelisPlusHD] Request: ${mediaType} ${tmdbId}`);
      const streams = yield extractStreams(tmdbId, mediaType, season, episode);
      return streams;
    } catch (error) {
      console.error(`[PelisPlusHD] Error: ${error.message}`);
      return [];
    }
  });
}
module.exports = { getStreams };
