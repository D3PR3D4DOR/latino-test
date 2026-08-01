/**
 * Latino-ALL
 * Provider: PelisPlusHD
 *
 * Primera versión (v0.1)
 * Base del plugin.
 */

const cheerio = require("cheerio-without-node-native");

const PROVIDER = "PelisPlusHD";
const BASE_URL = "https://pelisplushd.bz";

async function getStreams(tmdbId, mediaType, season, episode) {

    console.log(`[${PROVIDER}] ===============================`);
    console.log(`[${PROVIDER}] Plugin iniciado`);
    console.log(`[${PROVIDER}] TMDB ID: ${tmdbId}`);
    console.log(`[${PROVIDER}] Tipo: ${mediaType}`);
    console.log(`[${PROVIDER}] Temporada: ${season}`);
    console.log(`[${PROVIDER}] Episodio: ${episode}`);
    console.log(`[${PROVIDER}] Base URL: ${BASE_URL}`);
    console.log(`[${PROVIDER}] ===============================`);

    // Por ahora no hacemos scraping.
    // Solo verificamos que Nuvio ejecute correctamente el plugin.

    return [];
}

module.exports = {
    getStreams
};
