const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const youtubedl = require('youtube-dl-exec');
const { YT_OPTS } = require('./download');

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

    const url = await youtubedl(videoUrl, {
        ...YT_OPTS,
        format: 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        getUrl: true,
        noPlaylist: true
    });

    const streamUrl = String(url).trim();
    if (!streamUrl.startsWith('http')) {
        throw new Error('Could not resolve preview stream.');
    }

    setCachedPreviewUrl(videoUrl, streamUrl);
    return streamUrl;
}

async function proxyYouTubeAudio(req, res, videoUrl) {
    const streamUrl = await getYouTubePreviewUrl(videoUrl);
    const headers = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com'
    };

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
