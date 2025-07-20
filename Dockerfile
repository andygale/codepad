# Multi-stage build for production
FROM node:20-bookworm AS builder

# Install Java 21 from Eclipse Temurin (required for Java Language Server)
RUN apt-get update && \
    apt-get install -y wget apt-transport-https && \
    mkdir -p /etc/apt/keyrings && \
    wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | tee /etc/apt/keyrings/adoptium.asc && \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list && \
    apt-get update && \
    apt-get install -y temurin-21-jdk libgtk-3-0 libxss1 libxtst6 libnss3 libasound2 libxrandr2 libxdamage1 libxcomposite1 libxfixes3 && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./
COPY client/package*.json ./client/
COPY server/package*.json ./server/

# Install dependencies
RUN yarn install:all

# Copy the rest of the source code
COPY . .

# Run the language server installation script AFTER copying the code.
# This ensures we download the correct architecture and don't overwrite it.
RUN node language-servers/install.js

# Build the application
RUN yarn docker:build

# Production stage  
FROM node:20-bookworm

# Install Java 21 from Eclipse Temurin and GUI libraries
RUN apt-get update && \
    apt-get install -y wget apt-transport-https && \
    mkdir -p /etc/apt/keyrings && \
    wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | tee /etc/apt/keyrings/adoptium.asc && \
    echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list && \
    apt-get update && \
    apt-get install -y temurin-21-jdk libgtk-3-0 libxss1 libxtst6 libnss3 libasound2 libxrandr2 libxdamage1 libxcomposite1 libxfixes3 && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy built application and newly downloaded language servers
COPY --from=builder /app/client/build ./client/build
COPY --from=builder /app/server ./server
COPY --from=builder /app/language-servers ./language-servers
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN yarn install --production --cwd server

# Copy the entrypoint script and make it executable
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create non-root user and set permissions
RUN groupadd -r codecrush && useradd -r -g codecrush codecrush
RUN chown -R codecrush:codecrush /app
USER codecrush

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/info || exit 1

# Set the entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["yarn", "--cwd", "server", "start"]