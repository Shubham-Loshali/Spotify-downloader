const NodeID3 = require('node-id3');

async function fetchImageBuffer(url) {
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

async function tagMp3(filePath, track, album = 'SpotDownloader') {
    const imageBuffer = await fetchImageBuffer(track.thumbnail);

    const tags = {
        title: track.title || 'Unknown',
        artist: track.artist || 'Unknown Artist',
        album
    };

    if (imageBuffer) {
        tags.image = {
            imageBuffer,
            type: { id: 3, name: 'front cover' },
            mime: 'image/jpeg',
            description: 'Cover'
        };
    }

    const ok = NodeID3.write(tags, filePath);
    if (!ok) {
        throw new Error(typeof ok === 'object' ? JSON.stringify(ok) : 'Failed to write ID3 tags');
    }
}

module.exports = { tagMp3 };
