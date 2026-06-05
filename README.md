# AudioFlux

**Download Spotify tracks, playlists, and albums as properly tagged MP3 files.**

AudioFlux is a full-stack web application that fetches metadata from Spotify, sources audio from matched YouTube videos, and delivers downloads with embedded ID3 tags and album artwork. No account or sign-up required.

---

## Features

- **Track downloads** — Paste a Spotify track URL, preview matches, and download a tagged MP3
- **Playlist & album support** — Batch-download up to 25 tracks as a ZIP archive
- **Smart YouTube matching** — Scores candidates by title, artist, duration, and audio quality signals
- **Live audio preview** — Listen to a YouTube match before downloading
- **ID3 tagging** — Title, artist, and cover art embedded in every file
- **Real-time progress** — Track download status with a live progress bar
- **Modern UI** — Responsive, single-page interface with no login wall

---

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | HTML, CSS, Vanilla JavaScript |
| **Backend** | Node.js, Express 5 |
| **Audio pipeline** | yt-dlp, ffmpeg |
| **Metadata** | Spotify oEmbed / embed API, node-id3 |
| **Archiving** | archiver (ZIP) |
| **Deployment** | Docker, Render |

---

## How It Works

```
Spotify URL  →  Metadata lookup  →  YouTube search & scoring
                                            ↓
                              User selects match (track) or auto-match (playlist)
                                            ↓
                              Download  →  ffmpeg transcode  →  ID3 tag  →  MP3 / ZIP
```

> Spotify does not provide downloadable audio files. AudioFlux uses publicly available YouTube sources as the audio layer while preserving Spotify metadata for tagging.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **18 or later**
- [Python](https://www.python.org/) **3.9+** (required by yt-dlp)
- Git

### Local installation

```bash
git clone https://github.com/Shubham-Loshali/Spotify-downloader.git
cd Spotify-downloader
npm install
npm start
```

Open **http://localhost:3000** in your browser.

---

## Usage

### Download a single track

1. Paste a Spotify **track** link into the input field
2. Click **Look up**
3. Preview candidates and select the best YouTube match
4. Click **Download MP3** and wait for the progress bar to complete

### Download a playlist or album

1. Paste a Spotify **playlist** or **album** link
2. Click **Look up** to load the track list
3. Click **Download all as ZIP**
4. Each track is auto-matched on YouTube and packaged into a single archive

---

## Project Structure

```
Spotify-downloader/
├── public/                 # Frontend (static files served to the browser)
│   ├── index.html
│   ├── script.js
│   ├── style.css
│   └── assets/
├── src/                    # Backend (Node.js / Express)
│   ├── server.js           # API routes & app entry point
│   └── lib/
│       ├── download.js     # YouTube → MP3 pipeline
│       ├── id3.js          # ID3 tag writer
│       ├── jobs.js         # Background job manager
│       └── preview.js      # Audio preview proxy
├── Dockerfile              # Production container image
├── render.yaml             # Render Blueprint config
├── package.json
└── README.md
```

---

## Limitations

- Playlist and album downloads are capped at **25 tracks** per request
- Private or region-locked Spotify content may not be accessible
- YouTube matching accuracy depends on availability of suitable uploads
- Cloud-hosted instances may occasionally be rate-limited by YouTube

---

## Disclaimer

This project is intended for **personal and educational use only**. Downloading copyrighted material may violate the terms of service of Spotify, YouTube, or other platforms, as well as applicable copyright law in your jurisdiction. The author does not encourage or condone piracy. Use responsibly and only with content you have the right to download.

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**Shubham Loshali**

If you find this project useful, consider giving it a star on GitHub.
