# ================================
# Backend Dockerfile - multi-stage, targets match docker-compose.yml (development / production)
# ================================
FROM node:24-alpine AS base

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./

# ================================
# Development: ts-node with reload, source mounted as a volume
FROM base AS development
RUN npm ci
COPY . .
# dist/ holds the compiled health-check script used by the compose healthcheck
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ================================
# Build: TypeScript -> dist
FROM base AS build
RUN npm ci
# Bundle app source
COPY . .
RUN npm run build

# ================================
# Production: runtime dependencies and compiled code only, non-root user
FROM base AS production

# Environment variables
ENV NODE_ENV=production

RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p uploads logs && chown -R node:node uploads logs
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node dist/scripts/health-check.js || exit 1

# Seed runs first, then the server starts
# (the seed is now a separate idempotent command: docker compose exec backend npm run seed)
CMD ["node", "dist/index.js"]
