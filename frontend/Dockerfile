# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Use relative path so the same build works through any tunnel URL.
# nginx proxies /api/ → backend:8000/ so no absolute URL is needed.
ENV NEXT_PUBLIC_API_URL=/api

RUN npm run build

# ── Stage 2: Production runner ────────────────────────────────────────────────
# NO dev server. NO HMR. NO webpack-hmr WebSocket.
# No more page refreshes caused by Cloudflare dropping the WS connection.
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]