// ============================================================================
// PROVIDER: PelisPlusHD (Soporte de Reproducción QuickJS / Nuvio)
// ============================================================================

const cheerio = require("cheerio-without-node-native");
const CryptoJS = require("crypto-js");

// Constantes del Provider A
const BASE_URL = "https://pelisplushd.bz";
const TMDB_API_KEY = "1f22ddff88e9eb5c4d622fa45e3f4211";

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": BASE_URL
};

// ============================================================================
// RESOLVER DE REPRODUCTORES (VERIFICADO Y COMPATIBLE CON QUICKJS)
// ============================================================================

// Algoritmo de desempaquetado Dean Edwards puro (sin eval ni Node APIs)
function unpackPackedCode(packedJS) {
    try {
        if (!packedJS || !packedJS.includes('eval(function(p,a,c,k,e,')) return packedJS;
        const reg = /eval\(function\(p,a,c,k,e,[rd]\)\{.*?\}\('([^']*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/s;
        const match = packedJS.match(reg);
        if (!match) return packedJS;

        let [_, p, a, c, k] = match;
        a = parseInt(a, 10);
        c = parseInt(c, 10);
        k = k.split('|');

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

// Resolver para Medixiru / VidHide / StreamWish / Fastream
async function resolvePackedEmbed(embedUrl) {
    try {
        const response = await fetch(embedUrl, {
            headers: {
                "User-Agent": DEFAULT_HEADERS["User-Agent"],
                "Referer": BASE_URL
            }
        });
        const html = await response.text();

        // 1. Desempaquetar el JS del reproductor
        const unpacked = unpackPackedCode(html);

        // 2. Extraer la URL del manifiesto .m3u8 con sus tokens de sesión de la Query String
        const m3u8Match = unpacked.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/) || html.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);

        if (m3u8Match) {
            const streamUrl = m3u8Match[0].replace(/\\/g, '');
            const urlObj = new URL(embedUrl);

            // Inyección de las cabeceras requeridas para evitar el error 403 en ExoPlayer
            return {
                url: streamUrl,
                quality: "HD",
                type: "hls",
                headers: {
                    "User-Agent": DEFAULT_HEADERS["User-Agent"],
                    "Referer": embedUrl,
                    "Origin": urlObj.origin
                }
            };
        }
    } catch (e) {}
    return null;
}

// Resolver para VOE
async function resolveVoeEmbed(embedUrl) {
    try {
        const response = await fetch(embedUrl, {
            headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }
        });
        const html = await response.text();

        let m3u8Match = html.match(/https?:\/\/[^"'\s]+\.m3u8/);
        
        if (!m3u8Match) {
            const b64Match = html.match(/let\s+sources\s*=\s*['"]([A-Za-z0-9+/=]+)['"]/);
            if (b64Match) {
                const decoded = CryptoJS.enc.Base64.parse(b64Match[1]).toString(CryptoJS.enc.Utf8);
                m3u8Match = decoded.match(/https?:\/\/[^"'\s]+\.m3u8/);
            }
        }

        if (m3u8Match) {
            return {
                url: m3u8Match[0],
                quality: "HD",
                type: "hls",
                headers: {
                    "User-Agent": DEFAULT_HEADERS["User-Agent"],
                    "Referer": embedUrl
                }
            };
        }
    } catch (e) {}
    return null;
}

// Router principal para resolver enlaces embed a streams directos
async function resolveEmbedToDirectStream(embedUrl) {
    if (!embedUrl) return null;

    try {
        const host = new URL(embedUrl).hostname.toLowerCase();

        if (/vidhide|medixiru|streamwish|fastream|wishfast|filelions/i.test(host)) {
            return await resolvePackedEmbed(embedUrl);
        }
        if (/voe|voe-unblock/i.test(host)) {
            return await resolveVoeEmbed(embedUrl);
        }

        return await resolvePackedEmbed(embedUrl);
    } catch (e) {
        return null;
    }
}

// ============================================================================
// LÓGICA DE BÚSQUEDA Y NAVEGACIÓN ORIGINAL DEL PROVIDER A (SIN CAMBIOS)
// ============================================================================

async function searchTMDB(query, type) {
    try {
        const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=es-MX`;
        const res = await fetch(url);
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        return [];
    }
}

async function searchPelisPlus(title) {
    try {
        const searchUrl = `${BASE_URL}/busqueda/?s=${encodeURIComponent(title)}`;
        const res = await fetch(searchUrl, { headers: DEFAULT_HEADERS });
        const html = await res.text();
        const $ = cheerio.load(html);
        const results = [];

        $('.Posters a.Post').each((_, el) => {
            const href = $(el).attr('href');
            const itemTitle = $(el).find('.Title').text().trim();
            if (href && itemTitle) {
                results.push({
                    title: itemTitle,
                    url: href.startsWith('http') ? href : `${BASE_URL}${href}`
                });
            }
        });
        return results;
    } catch (e) {
        return [];
    }
}

async function getEmbedLinksFromPelisPlus(pageUrl, episodeInfo = null) {
    try {
        let targetUrl = pageUrl;

        if (episodeInfo && episodeInfo.season && episodeInfo.episode) {
            const res = await fetch(pageUrl, { headers: DEFAULT_HEADERS });
            const html = await res.text();
            const $ = cheerio.load(html);
            
            const epHref = $(`a[href*="-temporada-${episodeInfo.season}-episodio-${episodeInfo.episode}"]`).attr('href') ||
                           $(`a[data-season="${episodeInfo.season}"][data-episode="${episodeInfo.episode}"]`).attr('href');
            
            if (epHref) {
                targetUrl = epHref.startsWith('http') ? epHref : `${BASE_URL}${epHref}`;
            }
        }

        const res = await fetch(targetUrl, { headers: DEFAULT_HEADERS });
        const html = await res.text();
        const $ = cheerio.load(html);
        const embedUrls = [];

        $('iframe[src]').each((_, el) => {
            const src = $(el).attr('src');
            if (src && !src.includes('facebook') && !src.includes('twitter')) {
                embedUrls.push(src.startsWith('//') ? `https:${src}` : src);
            }
        });

        $('[data-video], .options li[data-server]').each((_, el) => {
            const videoAttr = $(el).attr('data-video') || $(el).attr('data-server');
            if (videoAttr) {
                if (videoAttr.startsWith('http') || videoAttr.startsWith('//')) {
                    embedUrls.push(videoAttr.startsWith('//') ? `https:${videoAttr}` : videoAttr);
                }
            }
        });

        return Array.from(new Set(embedUrls));
    } catch (e) {
        return [];
    }
}

// ============================================================================
// FUNCIÓN PRINCIPAL GETSTREAMS()
// ============================================================================

async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    try {
        // 1. TMDB (Inalterado)
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
        const tmdbRes = await fetch(tmdbUrl);
        const tmdbData = await tmdbRes.json();
        const title = tmdbData.title || tmdbData.name;

        if (!title) return [];

        // 2. Búsqueda en PelisPlusHD (Inalterado)
        const searchResults = await searchPelisPlus(title);
        if (!searchResults.length) return [];

        const targetPage = searchResults[0].url;

        // 3. Extracción de URLs de reproductores/embeds (Inalterado)
        const rawEmbeds = await getEmbedLinksFromPelisPlus(targetPage, { season, episode });
        if (!rawEmbeds.length) return [];

        // 4. ETAPA DE RESOLUCIÓN: Transforma embeds HTML en URLs finales .m3u8 con sus cabeceras
        const streamPromises = rawEmbeds.map(embedUrl => resolveEmbedToDirectStream(embedUrl));
        const resolvedStreams = await Promise.all(streamPromises);

        // 5. Devolución de array con URLs reproducibles para ExoPlayer/Nuvio
        const finalStreams = [];
        resolvedStreams.forEach((stream, index) => {
            if (stream && stream.url) {
                finalStreams.push({
                    name: `PelisPlus - Opción ${index + 1}`,
                    url: stream.url,
                    quality: stream.quality || "HD",
                    type: stream.type || "hls",
                    headers: stream.headers
                });
            }
        });

        return finalStreams;

    } catch (error) {
        return [];
    }
}

module.exports = {
    getStreams
};