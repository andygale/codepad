#!/bin/bash

# Blue-Green Deployment Script for CodeCrush
set -e

APP_DIR="/home/ubuntu/codecrush"
DOCKER_COMPOSE_FILE="docker-compose.blue-green.yml"
NGINX_UPSTREAM_CONFIG="/etc/nginx/upstream.conf"

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
    if [ "$color" == "blue" ]; then
        echo "upstream codecrush_upstream { server codecrush-blue:3001; }" > nginx_upstream_temp.conf
    else
        echo "upstream codecrush_upstream { server codecrush-green:3002; }" > nginx_upstream_temp.conf
    fi
    # Use sudo to update the config in /etc/nginx
    sudo mv nginx_upstream_temp.conf "$NGINX_UPSTREAM_CONFIG"
    # Reload NGINX to apply changes without downtime
    sudo docker-compose -f "$DOCKER_COMPOSE_FILE" exec nginx nginx -s reload
}

# --- Main Deployment Logic ---

echo "🚀 Starting Blue-Green deployment for CodeCrush..."
cd "$APP_DIR"

# 1. Determine current active and inactive colors
ACTIVE_COLOR=$(get_active_color)
if [ "$ACTIVE_COLOR" == "blue" ]; then
    INACTIVE_COLOR="green"
else
    INACTIVE_COLOR="blue"
fi

echo "Active color: $ACTIVE_COLOR"
echo "Deploying to inactive color: $INACTIVE_COLOR"

# 2. Update code from Git
echo "🔄 Updating from GitHub..."
git pull origin main

# 3. Build and start the new (inactive) environment
echo "🏗️ Building and starting $INACTIVE_COLOR environment..."
time docker-compose -f "$DOCKER_COMPOSE_FILE" build "codecrush-$INACTIVE_COLOR"
docker-compose -f "$DOCKER_COMPOSE_FILE" up -d --no-deps "codecrush-$INACTIVE_COLOR"

# 4. Wait for the new container to be healthy
echo "⏳ Waiting for $INACTIVE_COLOR to become healthy..."
HEALTH_STATUS=""
for i in {1..10}; do
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

    echo "Attempt $i: $INACTIVE_COLOR is not healthy yet. Retrying in 15 seconds..."
    sleep 15
done

if [ -z "$HEALTH_STATUS" ]; then
    echo "❌ $INACTIVE_COLOR did not become healthy after several attempts. Aborting deployment."
    docker-compose -f "$DOCKER_COMPOSE_FILE" logs "codecrush-$INACTIVE_COLOR"
    exit 1
fi

# 5. Run database migrations (only once from one of the services)
echo "📦 Running database migrations..."
# We override the entrypoint and set the working directory to /app/server
# to correctly run the 'migrate' script from server/package.json.
docker-compose -f "$DOCKER_COMPOSE_FILE" run --rm --entrypoint "" -w /app/server "codecrush-$INACTIVE_COLOR" yarn migrate

# 6. Switch NGINX to the new environment
switch_to_color "$INACTIVE_COLOR"
echo "✅ Traffic switched to $INACTIVE_COLOR"

# Give it a moment for traffic to stabilize
sleep 10

# 7. Stop the old (previously active) environment
echo "✅ The old environment ($ACTIVE_COLOR) is still running. You can switch back to it quickly if needed by re-running this script."
echo "   Once you are confident the new version is stable, you can manually stop it by running:"
echo "   docker-compose -f $DOCKER_COMPOSE_FILE stop codecrush-$ACTIVE_COLOR"
# echo "🛑 Stopping old environment: $ACTIVE_COLOR..."
# docker-compose -f "$DOCKER_COMPOSE_FILE" stop "codecrush-$ACTIVE_COLOR"

# Optional: Clean up old container resources
# echo "🧹 Cleaning up old container..."
# docker-compose -f "$DOCKER_COMPOSE_FILE" rm -f "codecrush-$ACTIVE_COLOR"

echo "🎉 Blue-Green deployment complete! $INACTIVE_COLOR is now live." 
echo
echo "Emergency switch-back instructions: (one of the first two)"
echo "echo \"upstream codecrush_upstream { server codecrush-blue:3001; }\" | sudo tee /etc/nginx/upstream.conf"
echo "echo \"upstream codecrush_upstream { server codecrush-green:3002; }\" | sudo tee /etc/nginx/upstream.conf"
echo "sudo docker-compose -f docker-compose.blue-green.yml exec nginx nginx -s reload"
