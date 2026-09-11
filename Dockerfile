# Shared install layer: both images need node_modules from the same lockfile.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild

# Online-alpha WebSocket server (plain Node + ws, run through tsx).
FROM deps AS server
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]

FROM deps AS build
# Baked into the bundle at build time; see docs/SELF_HOSTING.md for HTTPS/wss setups.
ARG VITE_WS_URL
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# Default target: the static game.
FROM nginx:alpine AS web
# Access logging off, error logging kept — see nginx.conf and docs/OBSERVABILITY_PRIVACY.md.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
