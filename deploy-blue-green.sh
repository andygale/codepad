#!/bin/bash

# Blue-Green Deployment Script for CodeCrush
# Supports both 'local' and 'prod' environments
set -e

# --- Environment Configuration ---

# Default to 'prod' environment if not specified
ENV="prod"

# Parse command-line arguments
if [ "$1" == "--env" ]; then
    if [ -n "$2" ]; then
        if [ "$2" == "local" ] || [ "$2" == "prod" ]; then
            ENV="$2"
        else
            echo "❌ Invalid environment '$2'. Please use 'local' or 'prod'."
            exit 1
        fi
    else
        echo "❌ Missing environment value. Please use 'local' or 'prod'."
        exit 1
    fi
fi

echo "🚀 Starting deployment for environment: $ENV"

# Set environment-specific variables
if [ "$ENV" == "local" ]; then
    DOCKER_COMPOSE_FILE="docker-compose.local.yml"
    NGINX_UPSTREAM_CONFIG="upstream.conf"
    APP_DIR="."
    SUDO_CMD=""
    echo "Using local configuration files (sudo disabled)."
else
    # Production environment settings
    DOCKER_COMPOSE_FILE="docker-compose.blue-green.yml"
    NGINX_UPSTREAM_CONFIG="/etc/nginx/conf.d/upstream.conf"
    APP_DIR="/home/ubuntu/codecrush"
    SUDO_CMD="sudo"
    echo "Using production configuration files (sudo enabled)."
fi

# --- Helper Functions ---

# Function to check which color is currently active
get_active_color() {
    if [ ! -f "$NGINX_UPSTREAM_CONFIG" ] || ! grep -q "server codecrush-green:3002;" "$NGINX_UPSTREAM_CONFIG"; then
        echo "blue"
    else
        echo "green"
    fi
}

# Function to switch NGINX to the specified color
switch_to_color() {
    local color=$1
    echo "Switching NGINX to $color..."
    
    # Create the directory if it doesn't exist
    $SUDO_CMD mkdir -p "$(dirname "$NGINX_UPSTREAM_CONFIG")"
    
    # Create the new upstream configuration
    if [ "$color" == "blue" ]; then
        NEW_UPSTREAM="upstream codecrush_upstream { server codecrush-blue:3001; }"
    else
        NEW_UPSTREAM="upstream codecrush_upstream { server codecrush-green:3002; }"
    fi
    
    # Update the upstream configuration file
    echo "$NEW_UPSTREAM" | $SUDO_CMD tee "$NGINX_UPSTREAM_CONFIG" > /dev/null
    
    # Reload nginx
    echo "Reloading nginx configuration..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" exec nginx nginx -s reload
    
    # Verify the change took effect
    echo "Verifying configuration change..."
    CURRENT_CONFIG=$(docker-compose -f "$DOCKER_COMPOSE_FILE" exec nginx cat /etc/nginx/upstream.conf)
    echo "Current nginx config: $CURRENT_CONFIG"
    
    if echo "$CURRENT_CONFIG" | grep -q "$color"; then
        echo "✅ Successfully switched to $color"
    else
        echo "❌ Failed to switch to $color"
        return 1
    fi
}

# --- Main Deployment Logic ---

echo "🚀 Starting Blue-Green deployment for CodeCrush..."
cd "$APP_DIR"

# 0. Ensure upstream.conf file exists (production only)
if [ "$ENV" == "prod" ]; then
    echo "🔧 Ensuring upstream.conf file exists..."
    if [ ! -f "$NGINX_UPSTREAM_CONFIG" ]; then
        echo "Creating initial upstream.conf file..."
        echo "upstream codecrush_upstream { server codecrush-blue:3001; }" | $SUDO_CMD tee "$NGINX_UPSTREAM_CONFIG" > /dev/null
    fi
    
    # Ensure it's a file, not a directory
    if [ -d "$NGINX_UPSTREAM_CONFIG" ]; then
        echo "❌ Error: $NGINX_UPSTREAM_CONFIG is a directory, not a file!"
        echo "Removing directory and creating file..."
        $SUDO_CMD rm -rf "$NGINX_UPSTREAM_CONFIG"
        echo "upstream codecrush_upstream { server codecrush-blue:3001; }" | $SUDO_CMD tee "$NGINX_UPSTREAM_CONFIG" > /dev/null
    fi
fi

# 1. Determine current active and inactive colors
ACTIVE_COLOR=$(get_active_color)
if [ "$ACTIVE_COLOR" == "blue" ]; then
    INACTIVE_COLOR="green"
else
    INACTIVE_COLOR="blue"
fi

echo "Active color: $ACTIVE_COLOR"
echo "Deploying to inactive color: $INACTIVE_COLOR"

# 2. Update code from Git (for production only)
if [ "$ENV" == "prod" ]; then
    echo "🔄 Updating from GitHub..."
    git pull origin main
fi

# 3. Build and start the new (inactive) environment
echo "🏗️ Building and starting $INACTIVE_COLOR environment..."
#export BUILDKIT_PROGRESS=plain
time docker-compose -f "$DOCKER_COMPOSE_FILE" build "codecrush-$INACTIVE_COLOR"
docker-compose -f "$DOCKER_COMPOSE_FILE" up -d --no-deps "codecrush-$INACTIVE_COLOR"

# 3.5. Ensure nginx is running (production only)
if [ "$ENV" == "prod" ]; then
    echo "🔧 Ensuring nginx is running..."
    if ! docker-compose -f "$DOCKER_COMPOSE_FILE" ps nginx | grep -q "Up"; then
        echo "Starting nginx..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d nginx
        sleep 5  # Give nginx time to start
    fi
fi

# 4. Wait for the new container to be healthy
echo "⏳ Waiting for $INACTIVE_COLOR to become healthy..."
HEALTH_STATUS=""
for i in {1..20}; do
    # Check for a healthy state. `grep -q` is used to check quietly.
    if docker-compose -f "$DOCKER_COMPOSE_FILE" ps "codecrush-$INACTIVE_COLOR" | grep -q '(healthy)'; then
        echo "✅ $INACTIVE_COLOR is healthy!"
        HEALTH_STATUS="healthy"
        break
    fi

    # Check for an unhealthy state to fail fast.
    if docker-compose -f "$DOCKER_COMPOSE_FILE" ps "codecrush-$INACTIVE_COLOR" | grep -q '(unhealthy)'; then
        echo "❌ $INACTIVE_COLOR has become unhealthy. Aborting deployment."
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs "codecrush-$INACTIVE_COLOR"
        exit 1
    fi

    echo "Attempt $i: $INACTIVE_COLOR is not healthy yet. Retrying in 5 seconds..."
    sleep 5
done

if [ -z "$HEALTH_STATUS" ]; then
    echo "❌ $INACTIVE_COLOR did not become healthy after several attempts. Aborting deployment."
    docker-compose -f "$DOCKER_COMPOSE_FILE" logs "codecrush-$INACTIVE_COLOR"
    exit 1
fi

# 5. Run database migrations
echo "📦 Running database migrations..."
docker-compose -f "$DOCKER_COMPOSE_FILE" run --rm --entrypoint "" -w /app/server "codecrush-$INACTIVE_COLOR" yarn migrate

# 6. Switch NGINX to the new environment
switch_to_color "$INACTIVE_COLOR"
echo "✅ Traffic switched to $INACTIVE_COLOR"

# 7. Stop the old environment
echo "🛑 Stopping old environment: $ACTIVE_COLOR..."
docker-compose -f "$DOCKER_COMPOSE_FILE" stop "codecrush-$ACTIVE_COLOR"

# Optional: Clean up old container resources
# echo "🧹 Cleaning up old container..."
# docker-compose -f "$DOCKER_COMPOSE_FILE" rm -f "codecrush-$ACTIVE_COLOR"

echo "🎉 Blue-Green deployment complete! $INACTIVE_COLOR is now live." 
echo
echo "Emergency switch-back instructions: (one of the first two)"
echo "echo \"upstream codecrush_upstream { server codecrush-blue:3001; }\" | sudo tee /etc/nginx/upstream.conf"
echo "echo \"upstream codecrush_upstream { server codecrush-green:3002; }\" | sudo tee /etc/nginx/upstream.conf"
echo "sudo docker-compose -f docker-compose.blue-green.yml exec nginx nginx -s reload"
echo "✅ All good. $INACTIVE_COLOR is live."