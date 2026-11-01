# Heed in containers (compose.yaml): the `service` image runs the service, and the `web` image
# serves the web app with nginx, forwarding /api/v1 to the service. For local evaluation on one
# computer (docs/self-hosting.md), not for production use.
#
# The base images are pinned by digest, so a rebuild gets the same bytes. To move to a newer
# release, pull the tag and put its digest here: docker buildx imagetools inspect <image:tag>.

# Every package, for the web build.
FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# The web app in http mode: it reads the service through /api/v1 on its own address.
FROM deps AS web-build
COPY . .
RUN VITE_API_MODE=http npx vite build \
    # Each text file also gzipped at the highest level, for nginx's gzip_static.
    && find dist/web -type f -regex '.*\.\(js\|css\|html\|svg\|txt\|json\|ico\)$' -exec gzip -9 -k -n {} + \
    # The security headers, with the hash of the theme script index.html carries inline.
    && node scripts/web-csp.ts dist/web/index.html docker/security-headers.conf security-headers.conf

# Only the packages the service runs with.
FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS service-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS service
# pg_dump and pg_restore of PostgreSQL 18, for backups and the restore drill
# (docs/self-hosting.md, "Back up"): Debian's own are older than the server.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
    && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y --auto-remove postgresql-common \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=service-deps /app/node_modules node_modules
# What the service runs: its code, the migrations, the seed and the demo model, which the demo
# reads from here (CMD). Not the tests, the docs or the build scripts.
COPY package.json ./
COPY src src
COPY db db
# The keys the service makes on its first start (MCP, sign-in for agents), kept in a volume so a
# connected agent stays connected when the container is made again.
RUN mkdir -p /var/lib/heed && chown node:node /var/lib/heed
USER node
# Production unless told otherwise: people sign in with the company's OpenID Connect provider
# (docs/operations.md, "Run the image in production mode"), and the image refuses to start until
# that is set up. The demo's people picker needs NODE_ENV=development, which compose.yaml sets.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MCP_DEV_KEY_FILE=/var/lib/heed/mcp-dev-key.pem \
    CL_MCP_STATE_KEY_FILE=/var/lib/heed/mcp-state.key \
    CL_OAUTH_SIGNING_KEY_FILE=/var/lib/heed/oauth-key.pem
EXPOSE 3000
# Ready once the database answers. Every 2 seconds while it starts (the first start loads the
# demo, a minute or two), then every 30.
HEALTHCHECK --start-period=5m --start-interval=2s --interval=30s --timeout=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Gets the database ready (db/prepare.ts: migrations, and the demo when SEED_DEMO=on), then serves.
# Outside production the image reads its own copy of the demo Cube model (db/seed/cube) unless
# CUBE_MODEL_DIR names another folder, so the demo needs no folder shared from the host.
CMD ["sh", "-c", "[ \"$NODE_ENV\" = production ] || export CUBE_MODEL_DIR=\"${CUBE_MODEL_DIR:-/app/db/seed/cube}\"; node db/prepare.ts && exec node src/server/main.ts"]

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS web
# nginx as its own user, not root: no `user` line (that needs root), its pid file and the
# config the entrypoint writes from the template in places that user owns.
RUN sed -i '/^user /d; s,^pid .*,pid /tmp/nginx.pid;,' /etc/nginx/nginx.conf \
    && rm /etc/nginx/conf.d/default.conf \
    && chown -R nginx:nginx /var/cache/nginx /etc/nginx/conf.d
COPY docker/web.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /app/security-headers.conf /etc/nginx/heed/security-headers.conf
COPY --from=web-build /app/dist/web /usr/share/nginx/html
USER nginx
# Where /api/v1 goes; nginx fills it into the template when it starts.
ENV HEED_API_URL=http://heed:3000
EXPOSE 8080
HEALTHCHECK --start-period=30s --start-interval=1s --interval=30s --timeout=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
