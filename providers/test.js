"use strict";

const cheerio = require('cheerio-without-node-native');
const PROVIDER_NAME = "PelisPlusHD";
let BASE_URL = "https://pelisplushd.bz";

const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

async function fetchText(url, opts) {
  try {
    const res = await fetch(url, opts ?? {});
    if (res.ok) return await res.text();
  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Fetch error: ${e.message}`);
  }
  return null;
}

async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// Quality detection based on filename/text
function parseQuality(text) {
  const t = String(text ?? '').toUpperCase();
  const QUALITY_RULES = [
    ['2160', '2160p'], ['4K', '2160p'], ['UHD', '2160p'],
    ['1080', '1080p'], ['FHD', '1080p'],
    ['720', '720p'], ['HD', '720p'],
    ['480', '480p'], ['SD', '480p']
  ];
  for (const [keyword, quality] of QUALITY_RULES) {
    if (t.includes(keyword)) return quality;
  }
  return "HD";
}

// Extract badges from filename/text
function extractBadges(text) {
  const t = String(text ?? '').toUpperCase();
  const BADGE_RULES = [
    ['HDR', 'HDR'], ['DV', 'DV'], ['DOLBY VISION', 'DV'],
    ['REMUX', 'REMUX'], ['BLURAY', 'BD'], ['WEB-DL', 'WEB-DL'],
    ['HEVC', 'HEVC'], ['H.265', 'HEVC'], ['X265', 'HEVC'],
    ['IMAX', 'IMAX']
  ];
  const found = [];
  for (const [keyword, badge] of BADGE_RULES) {
    if (t.includes(keyword) && !found.includes(badge)) found.push(badge);
  }
  return found;
}

// Format badges into display string
function formatBadges(badges) {
  return badges.length > 0 ? ' [' + badges.join(' ') + ']' : '';
}

// Extract size from text (e.g., "4.5 GB", "1.2 GB")
function extractSize(text) {
  const match = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*(?:GB|MB)/i);
  return match ? match[0] : '';
}

async function searchSite(query) {
  const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
  console.log(`[${PROVIDER_NAME}] Searching: ${searchUrl}`);
  
  const html = await fetchText(searchUrl, {
    headers: { "User-Agent": UA }
  });
  if (!html) {
    console.log(`[${PROVIDER_NAME}] Search failed - no HTML`);
    return null;
  }

  const $ = cheerio.load(html);
  
  // Look for movie/show cards - common selectors for this type of site
  const firstResult = $('article, .post, .item, .movie-card, .contenedor').first();
  if (!firstResult.length) {
    console.log(`[${PROVIDER_NAME}] No results found`);
    return null;
  }

  // Try to get the link from the card
  const link = firstResult.find('a').first().attr('href') || 
               firstResult.attr('href') ||
               firstResult.find('h2 a').first().attr('href');

  if (!link) {
    console.log(`[${PROVIDER_NAME}] Found result but no link`);
    return null;
  }

  console.log(`[${PROVIDER_NAME}] Found result: ${link}`);
  return link;
}

async function scrapePage(pageUrl) {
  if (!pageUrl) return [];

  const fullUrl = pageUrl.startsWith('http') ? pageUrl : BASE_URL + pageUrl;
  console.log(`[${PROVIDER_NAME}] Scraping page: ${fullUrl}`);

  const html = await fetchText(fullUrl, {
    headers: { "User-Agent": UA, "Referer": BASE_URL + "/" }
  });
  if (!html) {
    console.log(`[${PROVIDER_NAME}] Page scrape failed`);
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  // Look for download sections - common patterns
  // Try multiple selectors for different site layouts
  const sections = $('[id*="descarga"], [class*="descarga"], [class*="download"], .links, .mirrors, .servidores');
  
  if (sections.length === 0) {
    console.log(`[${PROVIDER_NAME}] No download sections found`);
    return [];
  }

  sections.each((i, section) => {
    // Look for links within each section
    $(section).find('a, [onclick*="window.open"], [data-url], .enlace, .link').each((j, el) => {
      const link = $(el).attr('href') || 
                  $(el).attr('data-url') || 
                  $(el).data('url');
      
      if (!link) return;

      const text = $(el).text().trim() || $(el).attr('title') || '';
      if (!text) return;

      const quality = parseQuality(text);
      const badges = extractBadges(text);
      const size = extractSize(text);

      results.push({
        url: link,
        quality: quality,
        size: size,
        badges: badges,
        name: text,
        text: text
      });
    });
  });

  console.log(`[${PROVIDER_NAME}] Found ${results.length} streams`);
  return results;
}

// Remove duplicate URLs
function deduplicateStreams(streams) {
  const seen = new Set();
  return streams.filter(s => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

// Sort streams by quality
function sortByQuality(streams) {
  const qualityOrder = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, 'HD': 4 };
  return streams.sort((a, b) => {
    const qA = qualityOrder[a.quality] ?? 999;
    const qB = qualityOrder[b.quality] ?? 999;
    return qA - qB;
  });
}

async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[${PROVIDER_NAME}] getStreams called: tmdbId=${tmdbId}, mediaType=${mediaType}, season=${season}, episode=${episode}`);

  try {
    // Step 1: Try to get title from TMDB API (fallback if fails)
    let title = null;
    try {
      const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}&language=es`;
      const tmdbRes = await fetchJson(tmdbUrl);
      if (tmdbRes) {
        title = tmdbRes.title || tmdbRes.name;
        if (season && episode && mediaType === 'tv') {
          // For TV episodes, also fetch season/episode title
          const seasonUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}&language=es`;
          const episodeRes = await fetchJson(seasonUrl);
          if (episodeRes?.name) {
            title = `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} ${episodeRes.name}`;
          }
        }
      }
    } catch (e) {
      console.log(`[${PROVIDER_NAME}] TMDB lookup failed: ${e.message}`);
    }

    if (!title) {
      console.log(`[${PROVIDER_NAME}] No title found, cannot search`);
      return [];
    }

    console.log(`[${PROVIDER_NAME}] Title: ${title}`);

    // Step 2: Search the site
    const pageUrl = await searchSite(title);
    if (!pageUrl) {
      console.log(`[${PROVIDER_NAME}] Search returned no results`);
      return [];
    }

    // Step 3: Scrape the page for streams
    const items = await scrapePage(pageUrl);
    if (!items.length) {
      console.log(`[${PROVIDER_NAME}] No streams found on page`);
      return [];
    }

    // Step 4: Format stream objects for Nuvio
    let streams = items.map(item => {
      const badgeStr = formatBadges(item.badges);
      const sizeStr = item.size ? ` · ${item.size}` : '';
      
      return {
        name: `${PROVIDER_NAME} ${item.name}${badgeStr}`,
        title: `${item.quality}${badgeStr}${sizeStr}`,
        size: `${item.quality}${badgeStr}${sizeStr}`,
        quality: item.quality,
        url: item.url,
        headers: {
          "Referer": BASE_URL + "/",
          "User-Agent": UA
        },
        behaviorHints: {
          notWebReady: true
        }
      };
    });

    // Step 5: Deduplicate and sort
    streams = deduplicateStreams(streams);
    streams = sortByQuality(streams);

    console.log(`[${PROVIDER_NAME}] Returning ${streams.length} streams`);
    return streams;

  } catch (e) {
    console.log(`[${PROVIDER_NAME}] Error in getStreams: ${e.message}`);
    return [];
  }
}

module.exports = { getStreams };
