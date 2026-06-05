# SpotDownloader

Download **Spotify tracks, playlists, and albums** as tagged MP3 files.

- **Metadata** from Spotify (title, artist, cover art)
- **Audio** from matched YouTube videos
- **ID3 tags** embedded in every MP3
- **Progress bar** during downloads
- **Playlists/albums** → ZIP (up to 25 tracks per run)

## Requirements

- Node.js **18+**

## Setup

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy (free on Render)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New +** → **Blueprint**
3. Connect this repo — Render reads `render.yaml` automatically
4. Choose the **Free** plan and wait for deploy
5. Open your `*.onrender.com` URL

## Usage

### Single track
1. Paste a Spotify **track** URL → **Look up**
2. Select the best YouTube match
3. **Download MP3** (watch the progress bar)

### Playlist or album
1. Paste a **playlist** or **album** URL → **Look up**
2. Review the track list
3. **Download all as ZIP** (auto-matches each song on YouTube)

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/info?url=` | Track or playlist metadata |
| `POST /api/jobs` | Start download (`mode`: `track` or `playlist`) |
| `GET /api/jobs/:id` | Job progress |
| `GET /api/jobs/:id/file` | Download finished file |

## Notes

- Spotify does not provide downloadable audio; YouTube is used as the source.
- Private playlists may not work.
- Large playlists are capped at **25 tracks** per ZIP.
