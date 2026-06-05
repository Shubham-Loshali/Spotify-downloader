const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const archiver = require('archiver');
const youtubedl = require('youtube-dl-exec');
const { createJob, updateJob, getJob, listJobSnapshot } = require('./lib/jobs');
const { tagMp3 } = require('./lib/id3');
const { downloadYouTubeToFile, YT_OPTS } = require('./lib/download');
const { getYouTubePreviewUrl, proxyYouTubeAudio } = require('./lib/preview');

const PORT = process.env.PORT || 3000;
const MAX_PLAYLIST_TRACKS = 25;

const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'spotify.com', 'play.spotify.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const requestCounts = new Map();

const MIN_CANDIDATE_SCORE = 12;
const MIN_RECOMMEND_SCORE = 18;
const MIN_DOWNLOAD_SCORE = 14;

const VARIANT_MARKERS = [
    'sped up',
    'slowed',
    'speed up',
    'nightcore',
    '8d audio',
    'karaoke',
    'fan made',
    'tribute'
];

function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = requestCounts.get(ip);

    if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
        entry = { start: now, count: 0 };
        requestCounts.set(ip, entry);
    }

    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
    }
    next();
}

function decodeHtmlEntities(text) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function parseSpotifyUrl(input) {
    let url;
    try {
        url = new URL(String(input).trim());
    } catch {
        throw new Error('Invalid URL. Paste a valid Spotify link.');
    }

    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!SPOTIFY_HOSTS.has(host)) {
        throw new Error('Only Spotify URLs are supported.');
    }

    const match = url.pathname.match(/^(?:\/intl-[a-z]{2})?\/(track|playlist|album)\/([a-zA-Z0-9]+)/i);
    if (!match) {
        throw new Error('Supported links: track, playlist, or album.');
    }

    const type = match[1].toLowerCase();
    const id = match[2];
    return {
        type,
        id,
        url: `https://open.spotify.com/${type}/${id}`
    };
}

function parseSpotifyTrackUrl(input) {
    const parsed = parseSpotifyUrl(input);
    if (parsed.type !== 'track') {
        throw new Error('This endpoint requires a single track URL.');
    }
    return parsed.url;
}

function parseYouTubeVideoUrl(input) {
    let url;
    try {
        url = new URL(String(input).trim());
    } catch {
        throw new Error('Invalid YouTube URL.');
    }

    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) {
        throw new Error('Invalid YouTube URL.');
    }

    const id = url.searchParams.get('v');
    if (!id) throw new Error('Invalid YouTube video URL.');

    return `https://www.youtube.com/watch?v=${id}`;
}

function parseTitleAndArtist(text) {
    let s = decodeHtmlEntities(text)
        .replace(/\s*\|\s*Spotify\s*$/i, '')
        .trim();

    const lyricsMatch = s.match(/^(.+?)\s*-\s*song and lyrics by\s+(.+)$/i);
    if (lyricsMatch) {
        return { title: lyricsMatch[1].trim(), artist: lyricsMatch[2].trim() };
    }

    const byMatch = s.match(/^(.+?)\s+by\s+(.+)$/i);
    if (byMatch) {
        return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
    }

    const dashIdx = s.indexOf(' - ');
    if (dashIdx !== -1) {
        const left = s.slice(0, dashIdx).trim();
        const right = s.slice(dashIdx + 3).trim();
        return { title: right, artist: left };
    }

    return { title: s, artist: '' };
}

function extractSpotifyDurationMs(html) {
    if (!html) return null;
    const meta =
        html.match(/property=["']music:duration["']\s+content=["'](\d+)["']/i) ||
        html.match(/content=["'](\d+)["']\s+property=["']music:duration["']/i);
    if (meta) return parseInt(meta[1], 10) * 1000;
    const msMatch = html.match(/"duration_ms"\s*:\s*(\d+)/);
    if (msMatch) return parseInt(msMatch[1], 10);
    return null;
}

function normalizeSearchText(text) {
    return decodeHtmlEntities(text)
        .toLowerCase()
        .replace(/[–—‑‒]/g, '-')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function tokenize(text) {
    return normalizeSearchText(text)
        .split(' ')
        .filter(w => w.length > 1);
}

function tokenOverlapScore(a, b) {
    const aTokens = tokenize(a);
    const bTokens = tokenize(b);
    if (aTokens.length === 0 || bTokens.length === 0) return 0;
    let matched = 0;
    for (const token of aTokens) {
        if (bTokens.some(bt => bt === token || bt.includes(token) || token.includes(bt))) {
            matched += 1;
        }
    }
    return matched / aTokens.length;
}

function hasUnwantedVariant(text, spotifyTitle) {
    const hay = normalizeSearchText(text);
    const spotifyNorm = normalizeSearchText(spotifyTitle);
    return VARIANT_MARKERS.some(
        marker => hay.includes(marker) && !spotifyNorm.includes(marker)
    );
}

function durationMatchScore(spotifyDurationMs, durationSec) {
    if (!spotifyDurationMs || !durationSec) return 0;
    const diff = Math.abs(spotifyDurationMs / 1000 - durationSec);
    if (diff <= 3) return 18;
    if (diff <= 8) return 14;
    if (diff <= 15) return 8;
    if (diff <= 25) return 2;
    if (diff <= 45) return -6;
    return -20;
}

function scoreYouTubeMatch(track, ytTitle, ytChannel, durationSec) {
    let score = 0;
    const combined = `${ytTitle} ${ytChannel}`;
    const titleOverlap = tokenOverlapScore(track.title, ytTitle);
    const artistOverlap = tokenOverlapScore(track.artist, combined);

    score += Math.round(titleOverlap * 22);
    score += Math.round(artistOverlap * 14);
    score += durationMatchScore(track.durationMs, durationSec);

    const normTitle = normalizeSearchText(track.title);
    const normYt = normalizeSearchText(ytTitle);
    if (normTitle && normYt.includes(normTitle)) score += 8;
    if (hasUnwantedVariant(ytTitle, track.title)) score -= 25;
    if (titleOverlap < 0.45) score -= 12;

    const artistTokens = tokenize(track.artist);
    if (artistTokens.length > 0) {
        const hay = normalizeSearchText(combined);
        if (artistTokens.filter(t => hay.includes(t)).length === 0) score -= 10;
    }

    if (/topic/i.test(ytChannel)) score += 4;
    return score;
}

function formatDuration(seconds) {
    if (!seconds || seconds < 1) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function safeFilename(name) {
    const cleaned = decodeHtmlEntities(name)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
    return cleaned || 'track';
}

async function getSpotifyData(rawUrl) {
    const url = parseSpotifyTrackUrl(rawUrl);

    const oembedRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
        { headers: { Accept: 'application/json' } }
    );

    if (!oembedRes.ok) {
        if (oembedRes.status === 404) {
            throw new Error('This track is unavailable or removed from Spotify.');
        }
        throw new Error(`Spotify could not load this track (HTTP ${oembedRes.status}).`);
    }

    const oembedData = await oembedRes.json();
    let { title, artist } = parseTitleAndArtist(oembedData.title || '');
    let durationMs = null;

    try {
        const htmlRes = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        if (htmlRes.ok) {
            const htmlText = await htmlRes.text();
            durationMs = extractSpotifyDurationMs(htmlText);
            const titleMatch = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
                const parsed = parseTitleAndArtist(titleMatch[1]);
                if (parsed.title) title = parsed.title;
                if (parsed.artist) artist = parsed.artist;
            }
        }
    } catch (e) {
        console.warn('Spotify HTML fallback failed:', e.message);
    }

    title = decodeHtmlEntities(title);
    artist = decodeHtmlEntities(artist || 'Unknown Artist');
    if (!title) {
        title = decodeHtmlEntities(
            (oembedData.title || 'Unknown Track').replace(/\s*\|\s*Spotify\s*$/i, '').trim()
        );
    }

    return {
        title,
        artist,
        thumbnail: oembedData.thumbnail_url || null,
        searchQuery: [title, artist].filter(Boolean).join(' ').trim() || title,
        spotifyUrl: url,
        durationMs
    };
}

async function getCollectionMeta(collectionUrl, type) {
    try {
        const oembedRes = await fetch(
            `https://open.spotify.com/oembed?url=${encodeURIComponent(collectionUrl)}`,
            { headers: { Accept: 'application/json' } }
        );
        if (oembedRes.ok) {
            const data = await oembedRes.json();
            return {
                name: decodeHtmlEntities((data.title || type).replace(/\s*\|\s*Spotify\s*$/i, '')),
                thumbnail: data.thumbnail_url || null
            };
        }
    } catch {
        /* ignore */
    }
    return { name: type === 'album' ? 'Album' : 'Playlist', thumbnail: null };
}

async function getCollectionTracks(collectionUrl, type) {
    const embedUrl = `https://open.spotify.com/embed/${type}/${parseSpotifyUrl(collectionUrl).id}`;
    const htmlRes = await fetch(embedUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    if (!htmlRes.ok) {
        throw new Error('Could not load playlist/album from Spotify.');
    }

    const html = await htmlRes.text();
    const ids = [];
    const seen = new Set();
    const regex = /spotify:track:([a-zA-Z0-9]{10,})/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            ids.push(m[1]);
        }
    }

    if (ids.length === 0) {
        throw new Error('No tracks found in this playlist/album. It may be empty or private.');
    }

    const limited = ids.slice(0, MAX_PLAYLIST_TRACKS);
    const tracks = [];

    for (let i = 0; i < limited.length; i++) {
        try {
            const track = await getSpotifyData(`https://open.spotify.com/track/${limited[i]}`);
            tracks.push(track);
        } catch (e) {
            console.warn(`Skipped track ${limited[i]}:`, e.message);
        }
    }

    if (tracks.length === 0) {
        throw new Error('Could not load any tracks from this playlist/album.');
    }

    return { tracks, totalFound: ids.length, loaded: tracks.length };
}

async function searchYouTube(track, limit = 6) {
    const queries = [
        `${track.artist} ${track.title}`,
        `${track.title} ${track.artist}`,
        `${track.title} official audio`,
        track.searchQuery,
        track.title
    ]
        .map(q => q.trim())
        .filter((q, i, arr) => q && arr.indexOf(q) === i);

    const seen = new Set();
    const collected = [];

    for (const query of queries) {
        try {
            const result = await youtubedl(`ytsearch${limit}:${query}`, {
                ...YT_OPTS,
                flatPlaylist: true,
                dumpSingleJson: true,
                skipDownload: true
            });

            const entries = result.entries || (result.id ? [result] : []);
            for (const entry of entries) {
                const id = entry.id || entry.url;
                if (!id || seen.has(id)) continue;
                seen.add(id);

                const videoUrl =
                    entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null);
                if (!videoUrl) continue;

                collected.push({
                    videoUrl,
                    title: decodeHtmlEntities(entry.title || 'Unknown'),
                    artist: decodeHtmlEntities(entry.uploader || entry.channel || 'Unknown'),
                    durationSec: entry.duration || 0,
                    durationLabel: formatDuration(entry.duration || 0)
                });
            }
            if (collected.length >= 5) break;
        } catch (e) {
            console.warn(`YouTube search failed for "${query}":`, e.message);
        }
    }

    return collected;
}

async function buildYouTubeCandidates(track) {
    const results = await searchYouTube(track, 6);
    if (results.length === 0) return [];

    const scored = results
        .map(item => ({
            ...item,
            score: scoreYouTubeMatch(track, item.title, item.artist, item.durationSec),
            recommended: false
        }))
        .filter(item => item.score >= MIN_CANDIDATE_SCORE)
        .sort((a, b) => b.score - a.score);

    const unique = [];
    const keys = new Set();
    for (const item of scored) {
        const key = normalizeSearchText(item.title);
        if (keys.has(key)) continue;
        keys.add(key);
        unique.push(item);
    }

    if (unique.length > 0 && unique[0].score >= MIN_RECOMMEND_SCORE) {
        unique[0].recommended = true;
    }

    return unique.slice(0, 6);
}

function pickBestCandidate(candidates) {
    const best = candidates[0];
    if (!best || best.score < MIN_DOWNLOAD_SCORE) return null;
    return best;
}

async function createZipFromFiles(filePaths, zipPath) {
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);

        for (const file of filePaths) {
            archive.file(file, { name: path.basename(file) });
        }

        archive.finalize();
    });
}

async function runTrackJob(job, spotifyUrl, videoUrl) {
    try {
        updateJob(job, { status: 'running', message: 'Loading Spotify metadata...', percent: 5 });

        const track = await getSpotifyData(spotifyUrl);
        const ytUrl = parseYouTubeVideoUrl(videoUrl);

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdl-'));
        job.tmpDir = tmpDir;

        const outPath = path.join(tmpDir, `${safeFilename(track.title)} - ${safeFilename(track.artist)}.mp3`);
        job.filename = path.basename(outPath);

        updateJob(job, { message: 'Downloading audio from YouTube...', percent: 10 });

        await downloadYouTubeToFile(ytUrl, outPath, pct => {
            updateJob(job, {
                percent: 10 + pct * 0.7,
                message: `Downloading... ${Math.round(pct)}%`
            });
        });

        updateJob(job, { message: 'Writing ID3 tags & album art...', percent: 85 });
        await tagMp3(outPath, track, 'SpotDownloader');

        job.filePath = outPath;
        updateJob(job, {
            status: 'done',
            percent: 100,
            message: 'Download ready!'
        });
    } catch (error) {
        updateJob(job, { status: 'error', error: error.message, message: error.message });
        if (job.tmpDir) {
            await fsp.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

async function runPlaylistJob(job, collectionUrl, collectionType) {
    try {
        updateJob(job, { status: 'running', message: 'Loading playlist from Spotify...', percent: 2 });

        const meta = await getCollectionMeta(collectionUrl, collectionType);
        const { tracks, totalFound, loaded } = await getCollectionTracks(collectionUrl, collectionType);

        job.total = loaded;
        updateJob(job, {
            message: `Found ${loaded} tracks (${totalFound > loaded ? `first ${loaded} of ${totalFound}` : loaded}). Starting downloads...`,
            percent: 5
        });

        const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdl-'));
        job.tmpDir = tmpDir;
        const downloaded = [];
        let skipped = 0;

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const basePercent = 5 + (i / tracks.length) * 85;

            updateJob(job, {
                current: i + 1,
                message: `Track ${i + 1}/${tracks.length}: ${track.title}`,
                percent: basePercent
            });

            const candidates = await buildYouTubeCandidates(track);
            const best = pickBestCandidate(candidates);
            if (!best) {
                skipped += 1;
                continue;
            }

            const filePath = path.join(
                tmpDir,
                `${String(i + 1).padStart(2, '0')} - ${safeFilename(track.title)} - ${safeFilename(track.artist)}.mp3`
            );

            try {
                await downloadYouTubeToFile(best.videoUrl, filePath, pct => {
                    updateJob(job, {
                        percent: basePercent + (pct / 100) * (85 / tracks.length),
                        message: `Track ${i + 1}/${tracks.length}: ${track.title} (${Math.round(pct)}%)`
                    });
                });
                await tagMp3(filePath, track, meta.name);
                downloaded.push(filePath);
            } catch (e) {
                console.warn(`Failed track ${track.title}:`, e.message);
                skipped += 1;
            }
        }

        if (downloaded.length === 0) {
            throw new Error('No tracks could be downloaded. Try individual tracks instead.');
        }

        updateJob(job, { message: 'Creating ZIP archive...', percent: 92 });

        const zipName = `${safeFilename(meta.name)}.zip`;
        const zipPath = path.join(tmpDir, zipName);
        await createZipFromFiles(downloaded, zipPath);

        job.filePath = zipPath;
        job.filename = zipName;
        updateJob(job, {
            status: 'done',
            percent: 100,
            message: `Done! ${downloaded.length} tracks${skipped ? ` (${skipped} skipped)` : ''}.`
        });
    } catch (error) {
        updateJob(job, { status: 'error', error: error.message, message: error.message });
        if (job.tmpDir) {
            await fsp.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    }
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());
app.use(rateLimit);

app.get('/api/health', (_req, res) => {
    res.json({ ok: true, features: ['tracks', 'playlists', 'albums', 'id3', 'progress'] });
});

app.get('/api/resolve', (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).json({ error: 'URL is required' });
        const parsed = parseSpotifyUrl(url);
        return res.json(parsed);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

app.get('/api/info', async (req, res) => {
    try {
        const { url, platform } = req.query;
        if (!url) return res.status(400).json({ error: 'URL is required' });
        if (platform !== 'spotify') {
            return res.status(400).json({ error: 'Only Spotify is supported' });
        }

        const parsed = parseSpotifyUrl(url);

        if (parsed.type === 'playlist' || parsed.type === 'album') {
            const meta = await getCollectionMeta(parsed.url, parsed.type);
            const { tracks, totalFound, loaded } = await getCollectionTracks(parsed.url, parsed.type);
            return res.json({
                kind: parsed.type,
                name: meta.name,
                thumbnail: meta.thumbnail,
                spotifyUrl: parsed.url,
                trackCount: loaded,
                totalFound,
                capped: totalFound > loaded,
                maxTracks: MAX_PLAYLIST_TRACKS,
                tracks: tracks.map(t => ({
                    title: t.title,
                    artist: t.artist,
                    thumbnail: t.thumbnail,
                    spotifyUrl: t.spotifyUrl
                }))
            });
        }

        const track = await getSpotifyData(url);
        const candidates = await buildYouTubeCandidates(track);
        const recommended = candidates.find(c => c.recommended) || candidates[0] || null;

        return res.json({
            kind: 'track',
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail,
            spotifyUrl: track.spotifyUrl,
            durationMs: track.durationMs,
            candidates: candidates.map(
                ({ videoUrl, title, artist, durationLabel, score, recommended }) => ({
                    videoUrl,
                    title,
                    artist,
                    durationLabel,
                    score,
                    recommended
                })
            ),
            recommendedVideoUrl: recommended?.videoUrl || null,
            hasMatch: candidates.length > 0
        });
    } catch (error) {
        console.error('Info endpoint error:', error.message);
        const message = error.message || 'Failed to fetch info';
        const status =
            message.includes('Invalid') || message.includes('Supported') || message.includes('Only')
                ? 400
                : 500;
        return res.status(status).json({ error: message });
    }
});

app.get('/api/preview/stream', async (req, res) => {
    try {
        const { videoUrl } = req.query;
        if (!videoUrl) {
            return res.status(400).json({ error: 'videoUrl is required.' });
        }

        const normalized = parseYouTubeVideoUrl(videoUrl);
        await proxyYouTubeAudio(req, res, normalized);
    } catch (error) {
        console.error('Preview stream error:', error.message);
        if (!res.headersSent) {
            return res.status(500).json({ error: error.message || 'Preview failed.' });
        }
    }
});

app.get('/api/preview', async (req, res) => {
    try {
        const { videoUrl } = req.query;
        if (!videoUrl) {
            return res.status(400).json({ error: 'videoUrl is required.' });
        }

        const normalized = parseYouTubeVideoUrl(videoUrl);
        const url = await getYouTubePreviewUrl(normalized);
        return res.json({ url });
    } catch (error) {
        console.error('Preview error:', error.message);
        return res.status(500).json({ error: error.message || 'Preview failed.' });
    }
});

app.post('/api/jobs', async (req, res) => {
    try {
        const { mode, spotifyUrl, videoUrl } = req.body;
        if (!spotifyUrl) return res.status(400).json({ error: 'spotifyUrl is required' });

        const parsed = parseSpotifyUrl(spotifyUrl);

        if (mode === 'playlist' || parsed.type === 'playlist' || parsed.type === 'album') {
            if (parsed.type === 'track') {
                return res.status(400).json({ error: 'Use a playlist or album URL for batch download.' });
            }
            const job = createJob('playlist');
            runPlaylistJob(job, parsed.url, parsed.type);
            return res.json({ jobId: job.id });
        }

        if (!videoUrl) {
            return res.status(400).json({ error: 'videoUrl is required for track download.' });
        }

        const job = createJob('track');
        runTrackJob(job, parsed.type === 'track' ? parsed.url : spotifyUrl, videoUrl);
        return res.json({ jobId: job.id });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

app.get('/api/jobs/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json(listJobSnapshot(job));
});

app.get('/api/jobs/:id/file', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'done' || !job.filePath) {
        return res.status(400).json({ error: 'File not ready yet' });
    }

    res.download(job.filePath, job.filename, async err => {
        if (job.tmpDir) {
            await fsp.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
        }
    });
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Features: tracks, playlists/albums (ZIP), ID3 tags, download progress');
});
