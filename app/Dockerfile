# ── Stage 1: build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma/        ./prisma/
COPY prisma.config.ts ./
RUN npm ci

# Genera Prisma client (necesario para compilar)
RUN npx prisma generate

COPY tsconfig.json nest-cli.json ./
COPY src/    ./src/
COPY public/ ./public/
RUN npm run build

# ── Stage 2: producción ─────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY prisma/        ./prisma/
COPY prisma.config.ts ./
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist    ./dist
COPY --from=builder /app/public  ./public

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
