# CodeCrush Server

Backend server for the CodeCrush collaborative coding platform.

## Architecture

```
server/
├── src/
│   ├── config/
│   │   └── index.js          # Configuration management
│   ├── services/
│   │   ├── codeExecutionService.js  # Code execution logic
│   │   └── roomService.js           # Room state management
│   ├── routes/
│   │   └── api.js            # API route handlers
│   ├── sockets/
│   │   └── roomHandlers.js   # WebSocket event handlers
│   └── index.js              # Main server entry point
├── package.json              # Server dependencies
└── README.md                 # This file
```

## Features

- **Modular Architecture**: Clean separation of concerns
- **Code Execution**: Integration with Piston API for multi-language support
- **Real-time Collaboration**: WebSocket-based room management
- **Extensible Design**: Ready for authentication and persistence features

## Services

### CodeExecutionService
Handles code execution through the Piston API with error handling and response formatting.

### RoomService
Manages room state, user presence, and output history. Includes placeholder methods for future database persistence.

## API Endpoints

- `POST /api/execute` - Execute code in specified language
- `GET /` - Development info (dev mode only)

## WebSocket Events

### Client → Server
- `joinRoom` - Join a collaboration room
- `codeUpdate` - Update code in room
- `languageUpdate` - Change programming language
- `cursorChange` - Share cursor position
- `selectionChange` - Share text selection
- `runOutput` - Share code execution results

### Server → Client
- `codeUpdate` - Receive code updates
- `languageUpdate` - Receive language changes
- `outputHistory` - Receive execution history
- `userList` - Receive list of users in room
- `remoteCursorChange` - Receive remote cursor positions
- `remoteSelectionChange` - Receive remote text selections

## Configuration

Environment variables:
- `PORT` - Server port (default: 5000)
- `PISTON_API_URL` - Piston API endpoint
- `CORS_ORIGIN` - CORS origin setting
- `NODE_ENV` - Environment mode

## Development

```bash
# Install dependencies
yarn install

# Start in development mode (with nodemon)
yarn dev

# Start in production mode
yarn start
```

## Future Enhancements

The modular structure is designed to easily accommodate:

- **Authentication**: User login/registration system
- **Persistence**: Database integration for saving rooms and code
- **Analytics**: Usage tracking and metrics
- **Rate Limiting**: API protection and abuse prevention
- **Caching**: Redis integration for performance
- **File Management**: Save/load code files
- **Collaboration Features**: Comments, annotations, version history 