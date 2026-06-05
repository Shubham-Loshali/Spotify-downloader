const ffmpegPath = require('ffmpeg-static');

const AUDIO_FORMAT = 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best';
const PLAYER_CLIENTS = ['android,web', 'ios', 'mweb', 'web'];

const YT_OPTS = {
    noWarnings: true,
    noCallHome: true,
    ffmpegLocation: ffmpegPath,
    retries: 3,
    fragmentRetries: 3,
    socketTimeout: 30
};

const STREAM_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    Referer: 'https://www.youtube.com/',
    Origin: 'https://www.youtube.com'
};

module.exports = { YT_OPTS, AUDIO_FORMAT, PLAYER_CLIENTS, STREAM_HEADERS };
