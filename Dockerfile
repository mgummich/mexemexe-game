# Shared install layer for the browser bundle: vite, typescript and phaser.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild esbuild

# Online-alpha WebSocket server (plain Node + ws, run through tsx). It installs
# its own tree rather than reusing `deps`: at runtime it needs `ws` and `tsx`
# and nothing else, so dev tooling is omitted and phaser — a dependency of the
# browser bundle alone — is dropped. All three in one RUN, since a later layer
# deleting files cannot shrink an earlier one.
FROM node:22-alpine AS server
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && npm rebuild esbuild \
 && rm -rf node_modules/phaser
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
# Drop to the image's own unprivileged user (docs/THREAT_MODEL.md TM-16). The server binds 8787,
# writes nothing to disk and reads only files baked into the image, so root buys it nothing and
# costs a process escape starting as uid 0. `node` is the node:22-alpine built-in user, so there
# is nothing to create; the files stay owned by root and stay readable, which is the shape we
# want — the runtime cannot rewrite its own code.
USER node
EXPOSE 8787
# The local bin directly, not `npx`: npx resolves and may write to a cache under $HOME, which an
# unprivileged user has no reason to need. The shim is executable and has its own shebang.
CMD ["./node_modules/.bin/tsx", "server/index.ts"]

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
