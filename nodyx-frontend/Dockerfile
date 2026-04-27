# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache ttf-dejavu && \
    mkdir -p /usr/share/fonts/truetype && \
    ln -s /usr/share/fonts/dejavu /usr/share/fonts/truetype/dejavu

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache ttf-dejavu && \
    mkdir -p /usr/share/fonts/truetype && \
    ln -s /usr/share/fonts/dejavu /usr/share/fonts/truetype/dejavu

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled SvelteKit output
COPY --from=builder /app/build ./build

EXPOSE 3001

CMD ["node", "build"]
