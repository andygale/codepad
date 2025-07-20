#!/bin/bash

# CodeCrush Auto-Deploy Script for AWS EC2 + RDS
# Place this script on your EC2 instance for easy updates

set -e

# Configuration
REPO_URL="https://github.com/yourusername/coder-pad-clone.git"  # Update with your repo
APP_DIR="/home/ubuntu/codecrush"
BACKUP_DIR="/home/ubuntu/codecrush-backup"

echo "🚀 Starting CodeCrush deployment..."

# Create backup of current version
if [ -d "$APP_DIR" ]; then
    echo "📦 Creating backup..."
    rm -rf "$BACKUP_DIR"
    cp -r "$APP_DIR" "$BACKUP_DIR"
fi

# Clone or update repository
if [ -d "$APP_DIR" ]; then
    echo "🔄 Updating from GitHub..."
    cd "$APP_DIR"
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found! Copying example..."
    cp ec2-environment.example .env
    echo "⚠️  Please edit .env with your RDS details before running again!"
    echo "⚠️  nano .env"
    exit 1
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down || true

# Remove old images to force rebuild
echo "🧹 Cleaning up old images..."
docker image prune -f
docker-compose -f docker-compose.prod.yml build --no-cache

# Start services
echo "🎯 Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 30

# Check if services are running
echo "🔍 Checking service health..."
if docker-compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo "✅ Deployment successful!"
    echo "🌐 CodeCrush is running at http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3001"
    
    # Cleanup backup
    rm -rf "$BACKUP_DIR"
else
    echo "❌ Deployment failed!"
    if [ -d "$BACKUP_DIR" ]; then
        echo "🔄 Restoring backup..."
        rm -rf "$APP_DIR"
        mv "$BACKUP_DIR" "$APP_DIR"
        cd "$APP_DIR"
        docker-compose -f docker-compose.prod.yml up -d
    fi
    exit 1
fi

echo "📊 Container status:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "🎉 Deployment complete!"
echo "📝 To view logs: docker-compose -f docker-compose.prod.yml logs -f"
echo "🛑 To stop: docker-compose -f docker-compose.prod.yml down"
echo "🔍 To check status: docker-compose -f docker-compose.prod.yml ps" 