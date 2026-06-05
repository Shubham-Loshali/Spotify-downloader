const path = require('path');
const fsp = require('fs').promises;
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');
const { formatUserError } = require('./errors');

const YT_OPTS = {
    noWarnings: true,
    noCallHome: true,
    preferFreeFormats: true,
    ffmpegLocation: ffmpegPath,
    extractorArgs: 'youtube:player_client=android,web',
    retries: 3,
    fragmentRetries: 3,
    socketTimeout: 30
};

async function downloadYouTubeToFile(videoUrl, outputMp3Path, onProgress) {
    const dir = path.dirname(outputMp3Path);
    const base = path.basename(outputMp3Path, '.mp3');
    const template = path.join(dir, `${base}.%(ext)s`);

    await fsp.mkdir(dir, { recursive: true });

    const subprocess = youtubedl.exec(videoUrl, {
        ...YT_OPTS,
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0,
        output: template,
        noPlaylist: true,
        newline: true
    });

    const handleChunk = chunk => {
        const text = chunk.toString();
        const match = text.match(/(\d+(?:\.\d+)?)%/);
        if (match && onProgress) {
            onProgress(parseFloat(match[1]));
        }
    };

    subprocess.stdout?.on('data', handleChunk);
    subprocess.stderr?.on('data', handleChunk);

    try {
        await subprocess;
    } catch (error) {
        console.error('yt-dlp download failed:', error.stderr || error.message);
        throw new Error(formatUserError(error));
    }

    const files = await fsp.readdir(dir);
    const audio = files.find(f => f.startsWith(base) && /\.(mp3|m4a|opus|webm)$/i.test(f));
    if (!audio) {
        throw new Error('Audio file was not created. Try another YouTube match.');
    }

    const fullPath = path.join(dir, audio);
    if (fullPath !== outputMp3Path) {
        if (audio.endsWith('.mp3')) {
            await fsp.rename(fullPath, outputMp3Path);
            return outputMp3Path;
        }
        throw new Error('Expected MP3 output but got another format.');
    }

    return outputMp3Path;
}

module.exports = { downloadYouTubeToFile, YT_OPTS };
