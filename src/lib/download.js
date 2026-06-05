const path = require('path');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const { formatUserError } = require('./errors');
const { getYouTubePreviewUrl } = require('./preview');
const { YT_OPTS, AUDIO_FORMAT, PLAYER_CLIENTS, STREAM_HEADERS } = require('./youtube');

function attachProgress(subprocess, onProgress) {
    const handleChunk = chunk => {
        const text = chunk.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match && onProgress) onProgress(parseFloat(match[1]));
    };
    subprocess.stdout?.on('data', handleChunk);
    subprocess.stderr?.on('data', handleChunk);
}

async function execYtDlp(videoUrl, flags, onProgress) {
    const subprocess = youtubedl.exec(videoUrl, {
        ...YT_OPTS,
        noPlaylist: true,
        newline: true,
        ...flags
    });
    attachProgress(subprocess, onProgress);
    try {
        await subprocess;
    } catch (error) {
        console.error('yt-dlp failed:', error.stderr || error.message);
        throw error;
    }
}

async function findDownloadedAudio(dir, base) {
    const files = await fsp.readdir(dir);
    return files.find(f => f.startsWith(base) && /\.(mp3|m4a|opus|webm|ogg|aac)$/i.test(f)) || null;
}

function ffmpegToMp3(inputPath, outputMp3Path) {
    return new Promise((resolve, reject) => {
        const args = ['-y', '-i', inputPath, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', outputMp3Path];
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', chunk => {
            stderr += chunk.toString();
        });
        proc.on('error', reject);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || 'Audio conversion failed.'));
        });
    });
}

async function downloadRawAudio(videoUrl, dir, base, client, onProgress) {
    const template = path.join(dir, `${base}.%(ext)s`);
    await execYtDlp(
        videoUrl,
        {
            format: AUDIO_FORMAT,
            output: template,
            extractorArgs: `youtube:player_client=${client}`
        },
        onProgress
    );
    return findDownloadedAudio(dir, base);
}

async function downloadViaStream(videoUrl, dir, base, onProgress) {
    if (onProgress) onProgress(5);
    const streamUrl = await getYouTubePreviewUrl(videoUrl);
    if (onProgress) onProgress(20);

    const response = await fetch(streamUrl, { headers: STREAM_HEADERS });
    if (!response.ok) {
        throw new Error(`Stream download failed (HTTP ${response.status})`);
    }

    const contentType = response.headers.get('content-type') || '';
    let ext = '.m4a';
    if (contentType.includes('webm')) ext = '.webm';
    else if (contentType.includes('ogg')) ext = '.ogg';

    const tempPath = path.join(dir, `${base}${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fsp.writeFile(tempPath, buffer);
    if (onProgress) onProgress(70);
    return path.basename(tempPath);
}

async function downloadDirectMp3(videoUrl, dir, base, client, onProgress) {
    const template = path.join(dir, `${base}.%(ext)s`);
    await execYtDlp(
        videoUrl,
        {
            format: AUDIO_FORMAT,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
            output: template,
            extractorArgs: `youtube:player_client=${client}`
        },
        onProgress
    );
    return findDownloadedAudio(dir, base);
}

async function downloadYouTubeToFile(videoUrl, outputMp3Path, onProgress) {
    const dir = path.dirname(outputMp3Path);
    const base = path.basename(outputMp3Path, '.mp3');
    await fsp.mkdir(dir, { recursive: true });

    let lastError = null;

    for (const client of PLAYER_CLIENTS) {
        try {
            const rawFile = await downloadRawAudio(videoUrl, dir, base, client, onProgress);
            if (!rawFile) throw new Error('Audio file was not created.');

            const rawPath = path.join(dir, rawFile);
            if (rawFile.endsWith('.mp3')) {
                if (rawPath !== outputMp3Path) await fsp.rename(rawPath, outputMp3Path);
                return outputMp3Path;
            }

            await ffmpegToMp3(rawPath, outputMp3Path);
            await fsp.rm(rawPath, { force: true }).catch(() => {});
            return outputMp3Path;
        } catch (error) {
            lastError = error;
            console.warn(`Raw download failed (${client}):`, error.stderr || error.message);
        }
    }

    try {
        const streamFile = await downloadViaStream(videoUrl, dir, base, onProgress);
        const streamPath = path.join(dir, streamFile);
        await ffmpegToMp3(streamPath, outputMp3Path);
        await fsp.rm(streamPath, { force: true }).catch(() => {});
        return outputMp3Path;
    } catch (error) {
        lastError = error;
        console.warn('Stream download failed:', error.message);
    }

    for (const client of PLAYER_CLIENTS) {
        try {
            const mp3File = await downloadDirectMp3(videoUrl, dir, base, client, onProgress);
            if (!mp3File) throw new Error('MP3 file was not created.');

            const mp3Path = path.join(dir, mp3File);
            if (mp3Path !== outputMp3Path) await fsp.rename(mp3Path, outputMp3Path);
            return outputMp3Path;
        } catch (error) {
            lastError = error;
            console.warn(`Direct MP3 failed (${client}):`, error.stderr || error.message);
        }
    }

    throw new Error(formatUserError(lastError));
}

module.exports = { downloadYouTubeToFile, YT_OPTS };
