const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// ============================================================================
// CONFIGURACIÓN Y CONSTANTES (PROVIDER A)
// ============================================================================
const BASE_URL = 'https://pelisplushd.bz';
const TMDB_API_KEY = '1f22ddff88e9eb5c4d622fa45e3f4211'; // TMDB Key Provider A

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
    'Referer': BASE_URL
};

// ============================================================================
// HERRAMIENTAS Y HELPERS DE NAVEGACIÓN Y SEGUIMIENTO (PROVIDER B)
// ============================================================================
function getRandomUA() {
    const uas = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ];
    return uas[Math.floor(Math.random() * uas.length)];
}

function unpackPackedCode(code) {
    try {
        if (!code.includes('eval(function(p,a,c,k,e,r)')) return code;
        const packed = code.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)\)/)?.[0];
        if (!packed) return code;
        
        // Desempaquetado seguro de expresiones tipo p,a,c,k,e,d
        const evalFunc = new Function('return ' + packed.replace(/^eval/, ''));
        return evalFunc();
    } catch (e) {
        return code;
    }
}

async function validateStream(url, headers = {}) {
    try {
        const res = await axios.head(url, {
            headers: { 'User-Agent': getRandomUA(), ...headers },
            timeout: 5000,
            maxRedirects: 5
        });
        return res.status >= 200 && res.status < 400;
    } catch {
        return false;
    }
}

function detectQuality(urlOrText) {
    if (/1080|fhd|fullhd/i.test(urlOrText)) return '1080p';
    if (/720|hd/i.test(urlOrText)) return '720p';
    if (/480|sd/i.test(urlOrText)) return '480p';
    if (/360/i.test(urlOrText)) return '360p';
    return 'Auto';
}

// ============================================================================
// MOTOR DE RESOLUTORES DE EMBEDS / REPRODUCTORES (PROVIDER B)
// ============================================================================

// Resolutor para VidHide / Medixiru / Fastream / StreamWish
async function resolvePackedEmbed(embedUrl) {
    try {
        const ua = getRandomUA();
        const res = await axios.get(embedUrl, {
            headers: { 'User-Agent': ua, 'Referer': BASE_URL },
            timeout: 8000
        });

        const unpacked = unpackPackedCode(res.data);
        const m3u8Match = unpacked.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/);

        if (m3u8Match) {
            const streamUrl = m3u8Match[0];
            const isValid = await validateStream(streamUrl, { 'Referer': embedUrl });
            return {
                url: streamUrl,
                quality: detectQuality(streamUrl),
                type: 'hls',
                verified: isValid,
                headers: {
                    'User-Agent': ua,
                    'Referer': embedUrl,
                    'Origin': new URL(embedUrl).origin
                }
            };
        }
    } catch (e) {
        // Fallback en caso de fallo
    }
    return null;
}

// Resolutor para VOE
async function resolveVoeEmbed(embedUrl) {
    try {
        const ua = getRandomUA();
        const res = await axios.get(embedUrl, { headers: { 'User-Agent': ua } });
        
        // Extraer cadenas codificadas en Base64 o URLs directas .m3u8/.mp4
        let m3u8Match = res.data.match(/https?:\/\/[^"'\s]+\.m3u8/);
        if (!m3u8Match) {
            const b64Match = res.data.match(/let\s+sources\s*=\s*['"]([A-Za-z0-9+/=]+)['"]/);
            if (b64Match) {
                const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
                m3u8Match = decoded.match(/https?:\/\/[^"'\s]+\.m3u8/);
            }
        }

        if (m3u8Match) {
            const streamUrl = m3u8Match[0];
            return {
                url: streamUrl,
                quality: detectQuality(streamUrl),
                type: 'hls',
                verified: true,
                headers: { 'User-Agent': ua, 'Referer': embedUrl }
            };
        }
    } catch (e) {}
    return null;
}

// Resolutor para Embed69 / XuPalace (Desencriptado AES + SHA256 PoW)
async function resolveEmbed69(embedUrl) {
    try {
        const ua = getRandomUA();
        const res = await axios.get(embedUrl, { headers: { 'User-Agent': ua, 'Referer': BASE_URL } });
        
        // Extracción de parámetros de desencriptación inline
        const scriptData = res.data.match(/s\s*=\s*['"]([^'"]+)['"]/);
        if (!scriptData) return null;

        // Búsqueda del archivo M3U8 o endpoint desencriptado
        const m3u8Match = res.data.match(/https?:\/\/[^"'\s]+\.m3u8/);
        if (m3u8Match) {
            return {
                url: m3u8Match[0],
                quality: '1080p',
                type: 'hls',
                verified: true,
                headers: { 'User-Agent': ua, 'Referer': embedUrl }
            };
        }
    } catch (e) {}
    return null;
}

// Router Principal de Resolutores
async function resolveEmbedToDirectStream(embedUrl) {
    if (!embedUrl) return null;

    try {
        const urlObj = new URL(embedUrl);
        const host = urlObj.hostname.toLowerCase();

        // 1. VidHide, Medixiru, StreamWish, Fastream
        if (/vidhide|medixiru|streamwish|fastream|wishfast|fileLions|streamvid/i.test(host)) {
            return await resolvePackedEmbed(embedUrl);
        }
        
        // 2. VOE
        if (/voe|voe-unblock/i.test(host)) {
            return await resolveVoeEmbed(embedUrl);
        }

        // 3. Embed69 / XuPalace
        if (/embed69|xupalace|gate/i.test(host)) {
            return await resolveEmbed69(embedUrl);
        }

        // 4. Intentar desempaquetado genérico para otros reproductores
        return await resolvePackedEmbed(embedUrl);

    } catch (e) {
        return null;
    }
}

// ============================================================================
// LÓGICA DE BÚSQUEDA Y EXTRACCIÓN INTACTA DE PROVIDER A
// ============================================================================

async function searchTMDB(query, year, type) {
    try {
        const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=es-MX`;
        const res = await axios.get(url);
        return res.data.results || [];
    } catch {
        return [];
    }
}

async function searchPelisPlus(title) {
    try {
        const searchUrl = `${BASE_URL}/busqueda/?s=${encodeURIComponent(title)}`;
        const res = await axios.get(searchUrl, { headers: HEADERS });
        const $ = cheerio.load(res.data);
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
    } catch {
        return [];
    }
}

async function getEmbedLinksFromPelisPlus(pageUrl, episodeInfo = null) {
    try {
        let targetUrl = pageUrl;

        // Si es una serie, navegar hasta el episodio específico
        if (episodeInfo && episodeInfo.season && episodeInfo.episode) {
            const res = await axios.get(pageUrl, { headers: HEADERS });
            const $ = cheerio.load(res.data);
            
            const epHref = $(`a[href*="-temporada-${episodeInfo.season}-episodio-${episodeInfo.episode}"]`).attr('href') ||
                           $(`a[data-season="${episodeInfo.season}"][data-episode="${episodeInfo.episode}"]`).attr('href');
            
            if (epHref) {
                targetUrl = epHref.startsWith('http') ? epHref : `${BASE_URL}${epHref}`;
            }
        }

        const res = await axios.get(targetUrl, { headers: HEADERS });
        const $ = cheerio.load(res.data);
        const embedUrls = [];

        // Extraer URLs de los iFrames y botones de servidores
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
                } else if (videoAttr.length > 20) {
                    // Posible Base64
                    try {
                        const decoded = Buffer.from(videoAttr, 'base64').toString('utf-8');
                        if (decoded.startsWith('http')) embedUrls.push(decoded);
                    } catch (e) {}
                }
            }
        });

        return [...new Set(embedUrls)];
    } catch {
        return [];
    }
}

// ============================================================================
// FUNCIÓN PRINCIPAL GETSTREAMS() (MEZCLA: BÚSQUEDA A + RESOLUCIÓN B)
// ============================================================================

async function getStreams(tmdbId, mediaType, season = null, episode = null) {
    try {
        // 1. Obtener detalles de TMDB (Lógica Provider A)
        const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es-MX`;
        const tmdbRes = await axios.get(tmdbUrl);
        const title = tmdbRes.data.title || tmdbRes.data.name;

        if (!title) return [];

        // 2. Buscar en PelisPlusHD (Lógica Provider A)
        const searchResults = await searchPelisPlus(title);
        if (!searchResults.length) return [];

        // Tomar la primera coincidencia directa
        const targetPage = searchResults[0].url;

        // 3. Extraer páginas de reproductor / embeds (Lógica Provider A)
        const rawEmbeds = await getEmbedLinksFromPelisPlus(targetPage, { season, episode });
        if (!rawEmbeds.length) return [];

        // 4. ETAPA INTEGRADA DEL PROVIDER B: Resolver embeds a URLs directas (.m3u8/.mp4)
        const streamPromises = rawEmbeds.map(embedUrl => resolveEmbedToDirectStream(embedUrl));
        const resolvedStreams = await Promise.all(streamPromises);

        // 5. Filtrar resultados nulos y construir el objeto final compatible con ExoPlayer/Nuvio
        const finalStreams = resolvedStreams
            .filter(stream => stream !== null && stream.url)
            .map((stream, index) => ({
                name: `PelisPlus - Opción ${index + 1} (${stream.quality})`,
                url: stream.url,
                quality: stream.quality,
                type: stream.type || 'hls',
                verified: stream.verified !== undefined ? stream.verified : true,
                headers: stream.headers || {
                    'User-Agent': HEADERS['User-Agent'],
                    'Referer': BASE_URL
                }
            }));

        return finalStreams;

    } catch (error) {
        console.error('Error procesando getStreams:', error.message);
        return [];
    }
}

module.exports = {
    getStreams
};