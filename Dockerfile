FROM node:18-alpine

WORKDIR /app

# Install Git LFS for model downloads
RUN apk add --no-cache git git-lfs

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Pull bundled models
RUN git lfs pull || true

# Expose the service port
EXPOSE 8083

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8083/status || exit 1

CMD ["node", "service.js"]
