require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const config = require('./config');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/authRoutes');
const setupRoomHandlers = require('./sockets/roomHandlers');
const LanguageServerService = require('./services/languageServerService');
const dbService = require('./services/dbService');

const app = express();
const server = http.createServer(app);

// Trust the first proxy if configured
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Session middleware setup
const sessionMiddleware = session({
  store: new PgSession({
    pool: dbService.getPool(),
    tableName: 'user_sessions',
  }),
  secret: config.sessionSecret || 'default_secret', // Fallback for safety
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
  },
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket'],
});

// Initialize Language Server Service
const languageServerService = new LanguageServerService();
languageServerService.initialize();

// Apply middleware
app.use(sessionMiddleware);
app.use(cors({
  origin: config.corsOrigin,
  credentials: true
}));
app.use(express.json());


// API Routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);


// Share session middleware with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});


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
      websocket: 'ws://localhost:' + (config.port || 3001),
    },
    pistonApi: config.pistonApiUrl,
    languageServer: languageServerService.getStatus(),
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
const PORT = config.port || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CodeCrush Server listening on port ${PORT}`);
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