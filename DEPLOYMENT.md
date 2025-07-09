# Deployment Guide - CodeCrush with IntelliSense

## Quick Start

### Development
```bash
# Install dependencies and language servers
yarn install:all
yarn install:language-servers

# Start development server
yarn dev
```

### Production (Docker)
```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build and run manually
docker build -t codecrush .
docker run -p 3001:3001 codecrush
```

## IntelliSense Features

### Supported Languages
- **Kotlin**: Full IntelliSense with Kotlin Language Server
- **Java**: Full IntelliSense with Eclipse JDT Language Server

### Available Features
- ✅ Auto-completion
- ✅ Error detection and diagnostics
- ✅ Hover information
- ✅ Real-time syntax checking
- ✅ Collaborative IntelliSense (shared across all users)

## Requirements

### System Requirements
- Node.js 18+
- Java 11+ (required for Java Language Server)
- 4GB RAM minimum (language servers are memory-intensive)

### Dependencies
All language servers are automatically downloaded and installed during build.

## Environment Variables

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:pass@localhost:5432/codecrush
PISTON_API_URL=http://localhost:2000
```

## Deployment Options

### 1. Traditional Deployment
```bash
# Production build
yarn build:prod

# Start production server
yarn start
```

### 2. Docker Deployment
```bash
# Build image
docker build -t codecrush .

# Run container
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e PISTON_API_URL=http://... \
  codecrush
```

### 3. Docker Compose (Recommended)
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Language Server Management

### Manual Installation
```bash
# Install language servers manually
yarn install:language-servers
```

### Troubleshooting
```bash
# Check language server status
curl http://localhost:3001/api/language-server/status

# View server logs
docker-compose logs codecrush
```

## Performance Considerations

### Memory Usage
- Kotlin Language Server: ~512MB
- Java Language Server: ~1GB
- Multiple concurrent users: +200MB per active session

### Optimization
- Language servers are shared across users in the same room
- Servers automatically start/stop based on usage
- Built-in connection pooling and resource management

## Monitoring

### Health Check
```bash
# Check application health
curl http://localhost:3001/api/info

# Check language server status
curl http://localhost:3001/api/language-server/status
```

### Metrics
- Connected clients: Real-time count
- Active language servers: Per-language status
- Memory usage: Monitor via Docker stats

## Security

### Considerations
- Language servers run in isolated processes
- No file system access outside workspace
- Network isolation via Docker networking
- User input sanitization

## Scaling

### Horizontal Scaling
- Use load balancer with sticky sessions
- Shared database for session persistence
- Redis for real-time synchronization

### Vertical Scaling
- Increase memory allocation for language servers
- Use faster storage for better performance
- Optimize database queries

## Backup

### Data Persistence
- Database: PostgreSQL with volume mounting
- Language servers: Auto-downloaded on startup
- User sessions: Stored in database

### Backup Strategy
```bash
# Database backup
docker exec codecrush-db pg_dump -U codecrush codecrush > backup.sql

# Restore
docker exec -i codecrush-db psql -U codecrush codecrush < backup.sql
```