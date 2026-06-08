# 优城美市 · Our Block — production image for Google Cloud Run
#
# No build step: the server is plain ESM Node and the frontend is static files
# served by Express. Cloud Run injects PORT (8080) and the app already reads it.
# Persistence + media live in GCS via ADC (the attached service account) — the
# gcs-key.json keyfile is intentionally NOT copied in (see .dockerignore).

FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

# Install production deps first so this layer caches across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source (node_modules and secrets excluded by .dockerignore).
COPY . .

# Cloud Run sets PORT; this is just documentation + a sane local default.
ENV PORT=8080
EXPOSE 8080

# Run as the unprivileged user that ships with the node image.
USER node

CMD ["node", "server/index.js"]
