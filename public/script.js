const API_BASE = (() => {
    const { protocol, port, hostname } = window.location;
    if (protocol === 'file:') return 'http://localhost:3000';
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '3000') {
        return 'http://localhost:3000';
    }
    return '';
})();

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url-input');
    const downloadForm = document.getElementById('download-form');
    const statusArea = document.getElementById('status-area');
    const resultArea = document.getElementById('result-area');
    const statusText = document.getElementById('status-text');
    const submitBtn = document.getElementById('submit-btn');

    const trackView = document.getElementById('track-view');
    const playlistView = document.getElementById('playlist-view');
    const resultImg = document.getElementById('result-img');
    const resultTitle = document.getElementById('result-title');
    const resultArtist = document.getElementById('result-artist');
    const resultNotice = document.getElementById('result-notice');
    const candidatesList = document.getElementById('candidates-list');
    const candidatesSection = document.getElementById('candidates-section');
    const previewPanel = document.getElementById('preview-panel');
    const previewAudio = document.getElementById('preview-audio');
    const previewTitle = document.getElementById('preview-title');
    const previewMeta = document.getElementById('preview-meta');
    const previewStatus = document.getElementById('preview-status');
    const previewEmbedWrap = document.getElementById('preview-embed-wrap');
    const previewEmbed = document.getElementById('preview-embed');
    const btnMp3 = document.getElementById('btn-mp3');
    const btnMp3Label = btnMp3.querySelector('span');

    const playlistImg = document.getElementById('playlist-img');
    const playlistTitle = document.getElementById('playlist-title');
    const playlistMeta = document.getElementById('playlist-meta');
    const playlistTracks = document.getElementById('playlist-tracks');
    const btnPlaylistDownload = document.getElementById('btn-playlist-download');
    const btnPlaylistLabel = btnPlaylistDownload.querySelector('span');

    const progressPanel = document.getElementById('progress-panel');
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressMessage = document.getElementById('progress-message');
    const progressLabel = document.getElementById('progress-label');

    const currentPlatform = 'spotify';
    let lastSpotifyUrl = null;
    let selectedVideoUrl = null;
    let pollTimer = null;
    let previewRequestId = 0;

    const mockTrack = document.querySelector('.mock-track');
    const mockArtist = document.querySelector('.mock-artist');
    const mockCoverImg = document.querySelector('.mock-cover img');
    const mockLive = document.querySelector('.mock-live');

    const DEFAULT_THUMB =
        'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=200&auto=format&fit=crop';

    function setResultsMode(on) {
        document.body.classList.toggle('has-results', on);
    }

    function updateMockPlayer(title, artist, thumbnail) {
        if (mockTrack) mockTrack.textContent = title || 'Your Spotify link';
        if (mockArtist) mockArtist.textContent = artist || 'High quality MP3';
        if (mockLive) mockLive.textContent = title ? 'Matched' : 'Ready';
        if (thumbnail && mockCoverImg) mockCoverImg.src = thumbnail;
    }

    function isSpotifyUrl(value) {
        try {
            const url = new URL(value.trim());
            const host = url.hostname.replace(/^www\./, '').toLowerCase();
            if (!['open.spotify.com', 'spotify.com', 'play.spotify.com'].includes(host)) {
                return false;
            }
            return /\/(track|playlist|album)\/[a-zA-Z0-9]+/i.test(url.pathname);
        } catch {
            return false;
        }
    }

    function openPanel(el) {
        el.classList.remove('hidden');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('is-visible'));
        });
    }

    function closePanel(el) {
        el.classList.remove('is-visible');
        setTimeout(() => {
            if (!el.classList.contains('is-visible')) {
                el.classList.add('hidden');
            }
        }, 450);
    }

    function setLoading(loading, message = 'Processing your link...') {
        submitBtn.disabled = loading;
        statusText.textContent = message;
        if (loading) {
            setResultsMode(false);
            hidePreviewPanel();
            closePanel(resultArea);
            closePanel(progressPanel);
            openPanel(statusArea);
            updateMockPlayer(null, null, 'assets/spotify-logo.png');
        } else {
            closePanel(statusArea);
        }
    }

    function showProgress(show) {
        if (show) {
            openPanel(resultArea);
            openPanel(progressPanel);
        } else {
            closePanel(progressPanel);
        }
    }

    function updateProgress(percent, message, label = 'Downloading...') {
        const p = Math.min(100, Math.max(0, Math.round(percent)));
        progressFill.style.width = `${p}%`;
        progressPercent.textContent = `${p}%`;
        progressMessage.textContent = message || '';
        progressLabel.textContent = label;
        showProgress(true);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    function getSelectedVideoUrl() {
        const checked = candidatesList.querySelector('input[name="yt-candidate"]:checked');
        return checked ? checked.value : null;
    }

    function youtubeVideoId(url) {
        try {
            const u = new URL(url);
            if (u.hostname.includes('youtu.be')) {
                return u.pathname.slice(1).split('/')[0] || null;
            }
            return u.searchParams.get('v');
        } catch {
            return null;
        }
    }

    function stopPreview() {
        previewAudio.pause();
        previewAudio.removeAttribute('src');
        previewAudio.load();
        previewAudio.classList.add('hidden');
        previewEmbed.removeAttribute('src');
        previewEmbedWrap.classList.add('hidden');
        previewPanel.classList.remove('has-embed', 'has-audio');
    }

    function hidePreviewPanel() {
        stopPreview();
        previewPanel.classList.add('hidden');
        previewTitle.textContent = '—';
        previewMeta.textContent = '';
        previewStatus.textContent = 'Verify this is the correct song';
    }

    function showYouTubeEmbed(videoUrl, autoplay = true) {
        const id = youtubeVideoId(videoUrl);
        if (!id) return false;

        previewEmbed.src = `https://www.youtube.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`;
        previewEmbedWrap.classList.remove('hidden');
        previewPanel.classList.add('has-embed');
        previewPanel.classList.remove('has-audio');
        previewAudio.classList.add('hidden');
        return true;
    }

    async function tryAudioStreamFallback(videoUrl, requestId) {
        previewStatus.textContent = 'Loading audio fallback...';
        previewEmbed.removeAttribute('src');
        previewEmbedWrap.classList.add('hidden');
        previewPanel.classList.remove('has-embed');
        previewPanel.classList.add('has-audio');
        previewAudio.classList.remove('hidden');

        previewAudio.src = apiUrl(
            `/api/preview/stream?videoUrl=${encodeURIComponent(videoUrl)}&_=${Date.now()}`
        );

        try {
            await previewAudio.play();
            if (requestId === previewRequestId) {
                previewStatus.textContent = 'Playing audio preview';
            }
        } catch {
            if (requestId === previewRequestId) {
                previewStatus.textContent = 'Preview unavailable — try another match';
            }
        }
    }

    async function playPreview(videoUrl, title, metaText, autoplay = true) {
        if (!videoUrl) return;

        const requestId = ++previewRequestId;
        previewPanel.classList.remove('hidden');
        previewTitle.textContent = title || 'Preview';
        previewMeta.textContent = metaText || '';
        previewStatus.textContent = 'Loading video...';

        previewAudio.pause();
        previewAudio.removeAttribute('src');
        previewAudio.load();
        previewAudio.classList.add('hidden');
        previewEmbed.removeAttribute('src');
        previewEmbedWrap.classList.add('hidden');
        previewPanel.classList.remove('has-embed', 'has-audio');

        if (showYouTubeEmbed(videoUrl, autoplay)) {
            previewStatus.textContent = 'Playing via YouTube';
            return;
        }

        await tryAudioStreamFallback(videoUrl, requestId);
    }

    function candidateMetaText(c) {
        let meta = c.artist || '';
        if (c.durationLabel) meta += ` · ${c.durationLabel}`;
        if (c.recommended) meta += ' · Best match';
        return meta;
    }

    async function parseApiError(response) {
        if (response.status === 404) {
            return 'Backend not found. Run npm start and open http://localhost:3000 (don’t open the HTML file directly or use Live Server).';
        }
        try {
            const data = await response.json();
            if (data.error) return data.error;
        } catch {
            /* ignore */
        }
        return `Request failed (${response.status})`;
    }

    async function checkServerConnection() {
        try {
            const res = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(3000) });
            return res.ok;
        } catch {
            return false;
        }
    }

    function renderCandidates(candidates, recommendedVideoUrl) {
        candidatesList.innerHTML = '';
        if (!candidates || candidates.length === 0) {
            candidatesSection.classList.add('hidden');
            hidePreviewPanel();
            selectedVideoUrl = null;
            return;
        }

        const defaultUrl =
            recommendedVideoUrl ||
            (candidates.find(c => c.recommended)?.videoUrl ?? candidates[0].videoUrl);

        candidates.forEach((c, index) => {
            const label = document.createElement('label');
            label.className = 'candidate-item' + (c.recommended ? ' candidate-recommended' : '');
            label.style.setProperty('--i', index);

            const playBtn = document.createElement('button');
            playBtn.type = 'button';
            playBtn.className = 'candidate-play-btn';
            playBtn.setAttribute('aria-label', `Play preview: ${c.title}`);
            playBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'yt-candidate';
            input.id = `candidate-${index}`;
            input.value = c.videoUrl;
            if (c.videoUrl === defaultUrl) input.checked = true;

            const details = document.createElement('span');
            details.className = 'candidate-details';

            const titleEl = document.createElement('span');
            titleEl.className = 'candidate-title';
            titleEl.textContent = c.title;

            const metaEl = document.createElement('span');
            metaEl.className = 'candidate-meta';
            metaEl.textContent = candidateMetaText(c);

            details.appendChild(titleEl);
            details.appendChild(metaEl);
            label.appendChild(playBtn);
            label.appendChild(input);
            label.appendChild(details);
            candidatesList.appendChild(label);

            const meta = candidateMetaText(c);
            playBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                input.checked = true;
                selectedVideoUrl = c.videoUrl;
                playPreview(c.videoUrl, c.title, meta);
            });

            input.addEventListener('change', () => {
                if (input.checked) {
                    selectedVideoUrl = c.videoUrl;
                }
            });
        });

        selectedVideoUrl = defaultUrl;
        candidatesSection.classList.remove('hidden');

        const defaultCandidate =
            candidates.find(c => c.videoUrl === defaultUrl) || candidates[0];
        previewPanel.classList.remove('hidden');
        previewTitle.textContent = defaultCandidate.title;
        previewMeta.textContent = candidateMetaText(defaultCandidate);
        previewStatus.textContent = 'Click ▶ on a match to preview';
    }

    function showTrack(data, spotifyUrl) {
        trackView.classList.remove('hidden');
        playlistView.classList.add('hidden');
        setResultsMode(true);

        resultTitle.textContent = data.title || 'Unknown Title';
        resultArtist.textContent = data.artist || 'Unknown Artist';
        resultImg.src = data.thumbnail || DEFAULT_THUMB;
        lastSpotifyUrl = spotifyUrl;
        updateMockPlayer(data.title, data.artist, data.thumbnail);

        renderCandidates(data.candidates, data.recommendedVideoUrl);

        if (data.candidates?.length > 0) {
            resultNotice.textContent =
                'Listen to the preview to verify the match, then download (includes ID3 tags + cover art).';
            btnMp3.classList.remove('hidden');
        } else {
            hidePreviewPanel();
            resultNotice.textContent = 'No YouTube match found for this track.';
            btnMp3.classList.add('hidden');
        }

        resultNotice.classList.remove('hidden');
        openPanel(resultArea);
    }

    function showPlaylist(data, spotifyUrl) {
        trackView.classList.add('hidden');
        playlistView.classList.remove('hidden');
        setResultsMode(true);

        lastSpotifyUrl = spotifyUrl;
        updateMockPlayer(data.name, `${data.trackCount} tracks`, data.thumbnail);
        playlistTitle.textContent = data.name || 'Playlist';
        playlistImg.src = data.thumbnail || DEFAULT_THUMB;

        let meta = `${data.trackCount} tracks ready`;
        if (data.capped) meta += ` (max ${data.maxTracks} per download)`;
        playlistMeta.textContent = meta;

        playlistTracks.innerHTML = '';
        (data.tracks || []).forEach((t, i) => {
            const li = document.createElement('li');
            li.style.setProperty('--i', i);
            li.textContent = `${i + 1}. ${t.title} — ${t.artist}`;
            playlistTracks.appendChild(li);
        });

        openPanel(resultArea);
    }

    function showLookupError(title, detail) {
        trackView.classList.remove('hidden');
        playlistView.classList.add('hidden');
        setResultsMode(true);
        updateMockPlayer(title, detail, null);
        resultTitle.textContent = title;
        resultArtist.textContent = detail;
        resultImg.src = DEFAULT_THUMB;
        resultNotice.classList.add('hidden');
        candidatesSection.classList.add('hidden');
        hidePreviewPanel();
        btnMp3.classList.add('hidden');
        openPanel(resultArea);
    }

    function showNotice(message, { error = false } = {}) {
        resultNotice.textContent = message;
        resultNotice.classList.toggle('is-error', error);
        resultNotice.classList.remove('hidden');
    }

    async function pollJob(jobId) {
        return new Promise((resolve, reject) => {
            stopPolling();

            const tick = async () => {
                try {
                    const res = await fetch(apiUrl(`/api/jobs/${jobId}`));
                    const job = await res.json();

                    if (!res.ok) throw new Error(job.error || 'Job failed');

                    updateProgress(
                        job.percent,
                        job.message,
                        job.status === 'done' ? 'Complete' : 'Downloading...'
                    );

                    if (job.status === 'done') {
                        stopPolling();
                        resolve(job);
                        return;
                    }

                    if (job.status === 'error') {
                        stopPolling();
                        reject(new Error(job.error || job.message || 'Download failed'));
                    }
                } catch (e) {
                    stopPolling();
                    reject(e);
                }
            };

            tick();
            pollTimer = setInterval(tick, 1000);
        });
    }

    function buildFallbackFilename(ext = 'mp3') {
        const title = (resultTitle.textContent || 'track').trim();
        const artist = (resultArtist.textContent || '').split('·')[0].trim();
        let name = artist && artist !== 'Unknown Artist' ? `${title} - ${artist}` : title;
        name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
        return `${name || 'track'}.${ext}`;
    }

    function parseDownloadFilename(disposition, fallback) {
        if (!disposition) return fallback;

        const starMatch = disposition.match(/filename\*=(?:UTF-8''|utf-8'')([^;\n]+)/i);
        if (starMatch) {
            try {
                return decodeURIComponent(starMatch[1].trim());
            } catch {
                /* fall through */
            }
        }

        const quoted = disposition.match(/filename="([^"]+)"/i);
        if (quoted) return quoted[1];

        const unquoted = disposition.match(/filename=([^;\n]+)/i);
        if (unquoted) return unquoted[1].trim().replace(/^["']|["']$/g, '');

        return fallback;
    }

    async function downloadJobFile(jobId, fallbackName) {
        const res = await fetch(apiUrl(`/api/jobs/${jobId}/file`));
        if (!res.ok) throw new Error(await parseApiError(res));

        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const filename = parseDownloadFilename(
            disposition,
            fallbackName || buildFallbackFilename()
        );

        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);

        return filename;
    }

    downloadForm.addEventListener('submit', async e => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (!url) return;

        if (!isSpotifyUrl(url)) {
            showLookupError(
                'Invalid Spotify link',
                'Use a track, playlist, or album URL from open.spotify.com'
            );
            return;
        }

        setLoading(true, 'Loading from Spotify...');
        try {
            if (!(await checkServerConnection())) {
                throw new Error(
                    'Server is not running. In the project folder run npm start, then open http://localhost:3000'
                );
            }

            const response = await fetch(
                apiUrl(`/api/info?url=${encodeURIComponent(url)}&platform=${currentPlatform}`)
            );
            if (!response.ok) throw new Error(await parseApiError(response));

            const data = await response.json();
            lastSpotifyUrl = data.spotifyUrl || url;

            if (data.kind === 'playlist' || data.kind === 'album') {
                showPlaylist(data, lastSpotifyUrl);
            } else {
                showTrack(data, lastSpotifyUrl);
            }
        } catch (error) {
            showLookupError('Could not load', error.message);
        } finally {
            setLoading(false);
        }
    });

    btnMp3.addEventListener('click', async e => {
        e.preventDefault();
        if (!lastSpotifyUrl) return;

        const videoUrl = getSelectedVideoUrl() || selectedVideoUrl;
        if (!videoUrl) {
            showNotice('Select a YouTube match from the list first.', { error: true });
            return;
        }

        const originalLabel = btnMp3Label.textContent;
        btnMp3.disabled = true;
        btnMp3.classList.add('loading');
        btnMp3Label.textContent = 'Starting...';

        try {
            const res = await fetch(apiUrl('/api/jobs'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'track',
                    spotifyUrl: lastSpotifyUrl,
                    videoUrl,
                    platform: currentPlatform
                })
            });
            if (!res.ok) throw new Error(await parseApiError(res));
            const { jobId } = await res.json();

            showProgress(true);
            resultNotice.textContent =
                'Downloading… preview keeps playing so you can confirm it’s the right song.';
            resultNotice.classList.remove('hidden');
            const job = await pollJob(jobId);
            const filename = await downloadJobFile(
                jobId,
                job.filename || buildFallbackFilename()
            );
            updateProgress(100, `Saved: ${filename}`, 'Done');
            showNotice(`Downloaded with ID3 tags: ${filename}`);
        } catch (error) {
            showNotice(error.message || 'Download failed.', { error: true });
            showProgress(false);
        } finally {
            btnMp3.disabled = false;
            btnMp3.classList.remove('loading');
            btnMp3Label.textContent = originalLabel;
        }
    });

    btnPlaylistDownload.addEventListener('click', async () => {
        if (!lastSpotifyUrl) return;

        const originalLabel = btnPlaylistLabel.textContent;
        btnPlaylistDownload.disabled = true;
        btnPlaylistDownload.classList.add('loading');
        btnPlaylistLabel.textContent = 'Preparing ZIP...';

        try {
            const res = await fetch(apiUrl('/api/jobs'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'playlist',
                    spotifyUrl: lastSpotifyUrl,
                    platform: currentPlatform
                })
            });
            if (!res.ok) throw new Error(await parseApiError(res));
            const { jobId } = await res.json();

            showProgress(true);
            updateProgress(0, 'Loading playlist tracks...', 'Playlist download');
            const job = await pollJob(jobId);
            const filename = await downloadJobFile(
                jobId,
                job.filename || buildFallbackFilename('zip')
            );
            updateProgress(100, `ZIP ready: ${filename}`, 'Done');
            showNotice(`Playlist downloaded as ${filename}`);
        } catch (error) {
            showNotice(error.message || 'Playlist download failed.', { error: true });
            showProgress(false);
        } finally {
            btnPlaylistDownload.disabled = false;
            btnPlaylistDownload.classList.remove('loading');
            btnPlaylistLabel.textContent = originalLabel;
        }
    });
});

(function initFloatingParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let particles = [];

    const COUNT = 48;

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function createParticle() {
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 1.8 + 1,
            vx: (Math.random() - 0.5) * 0.18,
            vy: (Math.random() - 0.5) * 0.18,
            baseAlpha: Math.random() * 0.35 + 0.25,
            pulse: Math.random() * Math.PI * 2,
            pulseSpeed: Math.random() * 0.012 + 0.004
        };
    }

    function resetParticle(p) {
        p.x = Math.random() * width;
        p.y = Math.random() * height;
        p.vx = (Math.random() - 0.5) * 0.18;
        p.vy = (Math.random() - 0.5) * 0.18;
    }

    function drawParticle(p) {
        const alpha = p.baseAlpha * (0.65 + 0.35 * Math.sin(p.pulse));
        const glow = p.r * 4;

        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        gradient.addColorStop(0, `rgba(30, 215, 96, ${alpha})`);
        gradient.addColorStop(0.35, `rgba(30, 215, 96, ${alpha * 0.45})`);
        gradient.addColorStop(1, 'rgba(30, 215, 96, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(180, 255, 210, ${Math.min(1, alpha + 0.15)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }

    function tick() {
        ctx.clearRect(0, 0, width, height);

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.pulse += p.pulseSpeed;

            if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) {
                resetParticle(p);
            }

            drawParticle(p);
        }

        requestAnimationFrame(tick);
    }

    resize();
    particles = Array.from({ length: COUNT }, createParticle);
    window.addEventListener('resize', () => {
        resize();
        particles.forEach(resetParticle);
    });
    requestAnimationFrame(tick);
})();
