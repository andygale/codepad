# Multi-stage build for production
FROM node:18-bullseye AS builder

# Install Java 21 (required for Java Language Server)
RUN apt-get update && apt-get install -y openjdk-21-jdk && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
RUN yarn install:all

# Copy source code
COPY . .

# Build the application (includes language server installation)
RUN yarn build:prod

# Production stage
FROM node:18-bullseye

# Install Java 21 (required for Java Language Server)
RUN apt-get update && apt-get install -y openjdk-21-jdk && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder /app/client/build ./client/build
COPY --from=builder /app/server ./server
COPY --from=builder /app/language-servers ./language-servers
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN yarn install --production --cwd server

# Create non-root user
RUN groupadd -r codecrush && useradd -r -g codecrush codecrush
RUN chown -R codecrush:codecrush /app
USER codecrush

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/info || exit 1

# Start the application
CMD ["node", "server/src/index.js"]