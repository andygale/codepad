#!/bin/sh
set -e

# Run database migrations
echo "Running database migrations..."
yarn --cwd server migrate:prod

# Execute the command passed to this script (the Dockerfile's CMD)
exec "$@" 