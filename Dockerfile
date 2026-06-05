FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x node_modules/ffmpeg-static/ffmpeg 2>/dev/null || true \
    && node_modules/youtube-dl-exec/bin/yt-dlp -U \
    && node_modules/youtube-dl-exec/bin/yt-dlp --version

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
