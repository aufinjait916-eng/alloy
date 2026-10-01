# =======================================================================
# Production Dockerfile for Alloy Inventory & Melting Management
# Lightweight, secure Node.js Alpine image for TrueNAS SCALE & Docker
# =======================================================================

FROM node:20-alpine

# Set non-interactive environment & container variables
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Add tzdata for accurate furnace / transaction logging timestamps
RUN apk add --no-cache tzdata

# Copy package manifests first for optimal Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev

# Copy application runtime files and EJS views
COPY server.js ./
COPY schema.sql ./
COPY views/ ./views/
COPY public/ ./public/

# Set file permissions for the default node user
RUN chown -R node:node /app

# Run as non-privileged user for container hardening
USER node

# Expose default application port
EXPOSE 3000

# Health check to ensure Express is accepting traffic
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Start server directly (Zero build requirement)
CMD ["node", "server.js"]
