# Use official Node.js LTS image
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies (using install instead of ci for flexibility)
RUN npm install --production --no-package-lock

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /usr/src/app

USER appuser

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application (can be overridden for worker mode)
CMD ["npm", "start"]