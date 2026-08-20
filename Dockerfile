FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
# git + ca-certificates needed only during npm ci for baileys' libsignal git dependency
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && npm ci --omit=dev \
    && apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY src ./src
COPY data/holidays-*.json ./data/

EXPOSE 3000
CMD ["node", "src/index.js"]
