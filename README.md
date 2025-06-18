# Codepad - Collaborative Code Editor

A real-time collaborative coding platform built with React, Node.js, Socket.IO, and Monaco Editor. Execute code in multiple languages using the Piston API.

## Features

- 🚀 **Real-time collaboration** - Multiple users can edit code simultaneously
- 💻 **Multi-language support** - JavaScript, TypeScript, Python, C++, Java, Swift, Kotlin, and more
- 🎨 **Syntax highlighting** - Powered by Monaco Editor (VS Code's editor)
- ⚡ **Code execution** - Run code directly in the browser
- 👥 **User presence** - See who's online and their cursors/selections
- 📱 **Responsive design** - Works on desktop and mobile devices

## Quick Start

### Development with Remote Piston API (Default)
```bash
yarn dev
```

### Development with Local Piston API
```bash
yarn dev:local
```

## Local Piston Setup

For better performance and privacy, you can run your own Piston API instance locally using Docker.

### Prerequisites
- Docker installed and running
- At least 4GB of available RAM

### Quick Setup

1. **Start local Piston API:**
   ```bash
   yarn piston:start
   ```

2. **Check status:**
   ```bash
   yarn piston:status
   ```

3. **Test the API:**
   ```bash
   yarn piston:test
   ```

4. **Start development server with local Piston:**
   ```bash
   yarn dev:local
   ```

### Manual Piston Management

You can also use the included management script directly:

```bash
# Start Piston API
./piston-local.sh start

# Stop Piston API
./piston-local.sh stop

# Restart Piston API
./piston-local.sh restart

# Check status and installed runtimes
./piston-local.sh status

# Install additional languages
./piston-local.sh install python 3.12.0
./piston-local.sh install rust 1.68.2

# List all available packages
./piston-local.sh packages

# Test the API
./piston-local.sh test
```

### Pre-installed Languages

The local Piston instance comes with these languages pre-installed:

- **JavaScript** (Node.js 20.11.1)
- **TypeScript** (5.0.3) - Traditional compilation (~2.5s execution time)
- **Deno** (1.32.3) - Fast TypeScript execution (~0.5s execution time) ⚡
- **Python** (3.12.0)
- **C/C++** (GCC 10.2.0)
- **Java** (15.0.2)
- **Swift** (5.3.3)
- **Kotlin** (1.8.20)

### TypeScript Performance Comparison

For TypeScript development, we recommend using **Deno** for faster iteration:

- **Traditional TypeScript**: ~2.5 seconds (compilation + execution)
- **Deno TypeScript**: ~0.5 seconds (direct execution) - **5x faster!** ⚡

Deno provides the same TypeScript features with much better performance for development and testing.

### Installing Additional Languages

To install more languages, use the install command:

```bash
./piston-local.sh install <language> <version>
```

Example:
```bash
./piston-local.sh install rust 1.68.2
./piston-local.sh install go 1.16.2
./piston-local.sh install ruby 3.0.1
```

## Environment Variables

- `PISTON_API_URL` - Override the Piston API endpoint (default: `http://localhost:2000/api/v2/execute` for local, `https://emkc.org/api/v2/piston/execute` for remote)

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │◄──►│  Node.js Server │◄──►│   Piston API    │
│                 │    │                 │    │                 │
│ - Monaco Editor │    │ - Socket.IO     │    │ - Code Execution│
│ - Real-time UI  │    │ - Express       │    │ - Multi-language│
│ - User presence │    │ - Room mgmt     │    │ - Sandboxed     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Development

### Project Structure
```
codepad/
├── client/          # React frontend
│   ├── src/
│   │   ├── App.tsx  # Main application
│   │   └── ...
│   └── package.json
├── server/          # Node.js backend
│   ├── src/
│   │   ├── config/  # Configuration
│   │   ├── services/ # Business logic
│   │   ├── routes/  # API routes
│   │   ├── sockets/ # WebSocket handlers
│   │   └── index.js # Main server
│   └── package.json
├── package.json     # Root package.json
└── piston-local.sh  # Piston management script
```

### Available Scripts

- `yarn dev` - Start development server with remote Piston API
- `yarn dev:local` - Start development server with local Piston API
- `yarn start` - Start production server
- `yarn install:all` - Install all dependencies (root, client, server)
- `yarn build:client` - Build React client
- `yarn server:start` - Start server in production mode
- `yarn server:dev` - Start server in development mode (with nodemon)
- `yarn piston:start` - Start local Piston API container
- `yarn piston:stop` - Stop local Piston API container
- `yarn piston:restart` - Restart local Piston API container
- `yarn piston:status` - Check Piston API status
- `yarn piston:test` - Test Piston API functionality

## Deployment

### Render.com (Recommended)

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Use the following settings:
   - **Build Command:** `yarn install:all && yarn build:client`
   - **Start Command:** `yarn server:start`
   - **Environment:** Node.js

### Environment Variables for Production

Set these in your deployment platform:

- `NODE_ENV=production`
- `PISTON_API_URL=https://emkc.org/api/v2/piston/execute` (or your hosted Piston instance)

## Troubleshooting

### Port Already in Use
If you see "EADDRINUSE" error, another process is using port 5000:
```bash
# Find and kill the process
lsof -ti:5000 | xargs kill -9
```

### Docker Issues on Apple Silicon
The Piston container uses `linux/amd64` platform which may show warnings on Apple Silicon Macs. This is normal and the container should work correctly with the `--privileged` flag.

### Piston API Not Responding
1. Check if Docker is running
2. Verify the container is running: `docker ps | grep piston`
3. Check container logs: `docker logs piston-api`
4. Restart the container: `yarn piston:restart`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both local and remote Piston APIs
5. Submit a pull request

## License

ISC License 