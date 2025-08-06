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

const roomService = require('./services/roomService');
const WebSocket = require('ws');
const dbService = require('./services/dbService');

const app = express();
const server = http.createServer(app);

// SECURITY: Enable 'trust proxy' to ensure secure cookies work behind Nginx.
// This allows Express to trust the X-Forwarded-* headers set by the proxy.
app.set('trust proxy', 1);

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
    // Use 'none' for production to allow cross-site cookie sending,
    // but it requires a secure context. 'lax' is safer for local http.
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  },
  name: 'codecrush.sid', // Custom session cookie name for easier debugging
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


// Apply middleware
app.use(sessionMiddleware);

// Debug middleware to log session info
app.use((req, res, next) => {
  if (req.url.includes('/api/auth/')) {
    console.log(`=== ${req.method} ${req.url} ===`);
    console.log('Session ID:', req.sessionID);
    console.log('Session exists:', !!req.session);
    console.log('Session user:', req.session?.user);
    console.log('Cookies:', req.headers.cookie);
    console.log('X-Forwarded-Proto:', req.headers['x-forwarded-proto']);
  }
  next();
});

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

});

// ---------------------------
// WebSocket proxy for LSP
// ---------------------------
console.log('🔧 LSP Proxy enabled');
const lspWSS = new WebSocket.Server({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  console.log(`🔧 [LSP Proxy] Raw upgrade URL: ${req.url}`);
  const upgradeStart = Date.now();
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/lsp\/(kotlin|java)\/([A-Za-z0-9]+)\/?$/);
    if (!match) {
      // Not an LSP upgrade path, let other handlers proceed
      return;
      // Not an LSP path – let other handlers (e.g., Socket.IO) deal with it
      return;
    }
    const [, lang, roomId] = match;
    console.log(`🔧 [LSP Proxy] Upgrade requested – lang=${lang}, room=${roomId}`);

    // Enforce room not paused
    const room = await roomService.getRoom(roomId);
    if (!room || room.is_paused) {
      socket.destroy();
      return;
    }

    // Connect to gateway
    const gatewayHost = process.env.LSP_GATEWAY_HOST || 'lsp-gateway';
    const gatewayUrl = `ws://${gatewayHost}:3000/${lang}`;
    console.log(`🔧 [LSP Proxy] Connecting to gateway ${gatewayUrl}`);
    const upstream = new WebSocket(gatewayUrl);

    upstream.on('open', () => {
      console.log('🔧 [LSP Proxy] Gateway connection open, completing upgrade');
      lspWSS.handleUpgrade(req, socket, head, (clientWs) => {
        // Pipe messages both ways
        clientWs.on('message', (data) => upstream.send(data));
        upstream.on('message', (data) => clientWs.send(data));
        const cleanup = () => {
          clientWs.close();
          upstream.close();
        };
        clientWs.on('close', cleanup);
        upstream.on('close', cleanup);
      });
    });

    upstream.on('error', (err) => {
      console.error('LSP proxy: failed to connect to gateway', err.message);
      if (!socket.destroyed) socket.destroy();
    });
  } catch (err) {
    console.error('LSP proxy upgrade error', err);
    socket.destroy();
  }
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/build')));

// For any other route, serve index.html from the React build
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
});

// Development info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    message: 'CodeCrush Server is running',
    version: '1.0.0',
    environment: config.nodeEnv,
    endpoints: {
      execute: 'POST /api/execute',
      info: 'GET /api/info',
      websocket: 'ws://localhost:' + (config.port || 3001),
    },
    pistonApi: config.pistonApiUrl,
  });
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

  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');

  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
}); 