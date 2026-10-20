# Heed in containers (compose.yaml): the `service` image runs the service, and the `web` image
# serves the web app with nginx, forwarding /api/v1 to the service.

# Every package, for the web build.
FROM node:26-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# The web app in http mode: it reads the service through /api/v1 on its own address.
FROM deps AS web-build
COPY . .
RUN VITE_API_MODE=http npx vite build

# Only the packages the service runs with.
FROM node:26-bookworm-slim AS service-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:26-bookworm-slim AS service
WORKDIR /app
COPY --from=service-deps /app/node_modules node_modules
COPY . .
# The keys the service makes on its first start (MCP, sign-in for AI apps), kept in a volume so a
# connected AI app stays connected when the container is made again.
RUN mkdir -p /var/lib/heed && chown node:node /var/lib/heed
USER node
ENV HOST=0.0.0.0 \
    PORT=3000 \
    MCP_DEV_KEY_FILE=/var/lib/heed/mcp-dev-key.pem \
    CL_MCP_STATE_KEY_FILE=/var/lib/heed/mcp-state.key \
    CL_OAUTH_SIGNING_KEY_FILE=/var/lib/heed/oauth-key.pem
EXPOSE 3000
# Gets the database ready (db/prepare.ts: migrations, and the demo when SEED_DEMO=on), then serves.
CMD ["sh", "-c", "node db/prepare.ts && exec node src/server/main.ts"]

FROM nginx:1.29-alpine AS web
COPY docker/web.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /app/dist/web /usr/share/nginx/html
# Where /api/v1 goes; nginx fills it into the template when it starts.
ENV HEED_API_URL=http://heed:3000
EXPOSE 80
