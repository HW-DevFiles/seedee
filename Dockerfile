# Node 22 matches CI and .nvmrc. Debian includes glibc for better-sqlite3.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run db:generate && mkdir -p /app/data && chown -R node:node /app

FROM dependencies AS development
ENV NODE_ENV=development DATABASE_URL=file:/app/data/seedee.db AI_PROVIDER=demo DEMO_ACCOUNT_ENABLED=true TRUST_PROXY_HOPS=0
USER node
EXPOSE 3000
CMD ["sh", "scripts/container-start.sh"]

FROM dependencies AS build
ENV NODE_ENV=production DEMO_ACCOUNT_ENABLED=false AI_PROVIDER=demo
RUN npm run build

# Includes migration tooling: run migrations explicitly on this single instance.
FROM build AS production
ENV NODE_ENV=production DATABASE_URL=file:/app/data/seedee.db AI_PROVIDER=demo DEMO_ACCOUNT_ENABLED=false TRUST_PROXY_HOPS=0
USER node
EXPOSE 3000
CMD ["sh", "scripts/container-start.sh"]
