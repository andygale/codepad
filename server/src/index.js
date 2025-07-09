require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const apiRoutes = require('./routes/api');
const setupRoomHandlers = require('./sockets/roomHandlers');
const LanguageServerService = require('./services/languageServerService');

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST']
  },
  transports: ['websocket']
});

// Initialize Language Server Service
const languageServerService = new LanguageServerService();
languageServerService.initialize();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  setupRoomHandlers(io, socket);
  languageServerService.handleSocketConnection(io, socket);
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/build')));

// Development info endpoint
app.get('/api/info', (req, res) => {
  res.json({ 
    message: 'CodeCrush Server is running',
    version: '1.0.0',
    environment: config.nodeEnv,
    endpoints: {
      execute: 'POST /api/execute',
      info: 'GET /api/info',
      languageServer: 'GET /api/language-server/status',
      websocket: 'ws://localhost:' + config.port
    },
    pistonApi: config.pistonApiUrl,
    languageServer: languageServerService.getStatus()
  });
});

// Language Server status endpoint
app.get('/api/language-server/status', (req, res) => {
  res.json(languageServerService.getStatus());
});

// For any other route, serve index.html from the React build
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
});

// Start server
server.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 CodeCrush Server listening on port ${config.port}`);
  console.log(`📁 Environment: ${config.nodeEnv}`);
  console.log(`🔧 Piston API: ${config.pistonApiUrl}`);
  console.log(`🔧 Language Server: Available`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await languageServerService.shutdown();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await languageServerService.shutdown();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
}); 