#!/bin/bash

# Local Piston Management Script

case "$1" in
  start)
    echo "Starting local Piston API..."
    docker run -d --name piston-api --privileged --platform linux/amd64 \
      -v piston-data-native:/piston \
      -p 2000:2000 \
      ghcr.io/engineer-man/piston
    echo "Piston API started on http://localhost:2000"
    ;;
  
  stop)
    echo "Stopping local Piston API..."
    docker stop piston-api
    docker rm piston-api
    echo "Piston API stopped"
    ;;
  
  restart)
    echo "Restarting local Piston API..."
    docker stop piston-api 2>/dev/null
    docker rm piston-api 2>/dev/null
    docker run -d --name piston-api --privileged --platform linux/amd64 \
      -v piston-data-native:/piston \
      -p 2000:2000 \
      ghcr.io/engineer-man/piston
    echo "Piston API restarted on http://localhost:2000"
    ;;
  
  status)
    echo "Checking Piston API status..."
    if docker ps | grep -q piston-api; then
      echo "✅ Piston API is running"
      echo "Available runtimes:"
      curl -s http://localhost:2000/api/v2/runtimes | jq -r '.[] | "  - \(.language) \(.version)"' 2>/dev/null || echo "  (jq not installed - raw JSON response)"
    else
      echo "❌ Piston API is not running"
    fi
    ;;
  
  install)
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Usage: $0 install <language> <version>"
      echo "Example: $0 install python 3.12.0"
      exit 1
    fi
    echo "Installing $2 $3..."
    curl -X POST http://localhost:2000/api/v2/packages \
      -H "Content-Type: application/json" \
      -d "{\"language\": \"$2\", \"version\": \"$3\"}"
    echo
    ;;
  
  packages)
    echo "Available packages:"
    curl -s http://localhost:2000/api/v2/packages | jq -r '.[] | "  - \(.language) \(.language_version) (installed: \(.installed))"' 2>/dev/null || echo "  (jq not installed - use: curl -s http://localhost:2000/api/v2/packages)"
    ;;
  
  test)
    echo "Testing Piston API..."
    result=$(curl -s -X POST http://localhost:2000/api/v2/execute \
      -H "Content-Type: application/json" \
      -d '{"language": "javascript", "version": "20.11.1", "files": [{"content": "console.log(\"Piston API is working!\");"}]}')
    
    if echo "$result" | grep -q "Piston API is working!"; then
      echo "✅ Piston API test successful"
    else
      echo "❌ Piston API test failed"
      echo "Response: $result"
    fi
    ;;
  
  *)
    echo "Local Piston Management Script"
    echo "Usage: $0 {start|stop|restart|status|install|packages|test}"
    echo ""
    echo "Commands:"
    echo "  start     - Start the Piston API container"
    echo "  stop      - Stop and remove the Piston API container"
    echo "  restart   - Restart the Piston API container"
    echo "  status    - Check if Piston API is running and show runtimes"
    echo "  install   - Install a language package (usage: install <language> <version>)"
    echo "  packages  - List all available packages"
    echo "  test      - Test the Piston API with a simple JavaScript execution"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 install python 3.12.0"
    echo "  $0 status"
    exit 1
    ;;
esac 