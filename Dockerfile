FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 8000

CMD ["bun", "run", "src/index.ts"]
