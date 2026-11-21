# ================================
# Frontend Dockerfile - multi-stage, targets match docker-compose.yml (development / production)
# ================================
FROM node:24-alpine AS development

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

EXPOSE 3001
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3001"]

# ================================
FROM node:24-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy app source
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Build the app
RUN npm run build

# ================================
# Production stage
FROM nginx:1.27-alpine AS production

# Copy built files from the build stage to nginx
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
# nginx.conf is a full main config (user, events, http), so it replaces /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/nginx.conf

# Worker user and temp paths referenced by nginx.conf; the master keeps root to bind port 80
RUN addgroup -g 1001 -S nginx-group && \
    adduser -S -D -H -u 1001 -G nginx-group nginx-user && \
    mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi && \
    chown -R nginx-user:nginx-group /tmp/nginx /usr/share/nginx/html

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
