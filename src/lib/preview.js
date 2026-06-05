const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const youtubedl = require('youtube-dl-exec');
const { YT_OPTS, AUDIO_FORMAT, PLAYER_CLIENTS, STREAM_HEADERS } = require('./youtube');

const previewUrlCache = new Map();
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;

function getCachedPreviewUrl(videoUrl) {
    const hit = previewUrlCache.get(videoUrl);
    if (hit && hit.expires > Date.now()) return hit.url;
    if (hit) previewUrlCache.delete(videoUrl);
    return null;
}

function setCachedPreviewUrl(videoUrl, url) {
    previewUrlCache.set(videoUrl, { url, expires: Date.now() + PREVIEW_CACHE_TTL_MS });
}

async function getYouTubePreviewUrl(videoUrl) {
    const cached = getCachedPreviewUrl(videoUrl);
    if (cached) return cached;

    let lastError = null;
    for (const client of PLAYER_CLIENTS) {
        try {
            const url = await youtubedl(videoUrl, {
                ...YT_OPTS,
                format: AUDIO_FORMAT,
                getUrl: true,
                noPlaylist: true,
                extractorArgs: `youtube:player_client=${client}`
            });

            const streamUrl = String(url).trim();
            if (streamUrl.startsWith('http')) {
                setCachedPreviewUrl(videoUrl, streamUrl);
                return streamUrl;
            }
        } catch (error) {
            lastError = error;
            console.warn(`Preview URL failed (${client}):`, error.stderr || error.message);
        }
    }

    throw lastError || new Error('Could not resolve preview stream.');
}

async function proxyYouTubeAudio(req, res, videoUrl) {
    const streamUrl = await getYouTubePreviewUrl(videoUrl);
    const headers = { ...STREAM_HEADERS };

    if (req.headers.range) {
        headers.Range = req.headers.range;
    }

    const upstream = await fetch(streamUrl, { headers });
    if (!upstream.ok && upstream.status !== 206) {
        throw new Error(`Preview stream failed (HTTP ${upstream.status})`);
    }

    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
        const val = upstream.headers.get(name);
        if (val) res.setHeader(name, val);
    }
    if (!upstream.headers.get('content-type')) {
        res.setHeader('Content-Type', 'audio/mp4');
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
}

module.exports = { getYouTubePreviewUrl, proxyYouTubeAudio };
