# Language Servers

This directory contains language server implementations for providing IntelliSense features to the Monaco Editor.

## Supported Languages

- **Kotlin**: Uses Kotlin Language Server (KLS)
- **Java**: Uses Eclipse JDT Language Server (jdt.ls)

## Installation

### Development
```bash
# Install language servers
yarn install:language-servers

# Start development server (includes language servers)
yarn dev
```

### Production
```bash
# Build with language servers
yarn build

# Start production server
yarn start
```

## Architecture

1. **Language Server Process**: Each language server runs as a separate process
2. **WebSocket Proxy**: Server-side proxy that communicates with language servers via LSP
3. **Monaco LSP Client**: Client-side integration with Monaco Editor
4. **Real-time Sync**: Language server state synced across all collaborative users

## Configuration

Language servers are automatically configured based on the selected language in the Monaco Editor. No additional setup required.