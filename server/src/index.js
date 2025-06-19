require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const apiRoutes = require('./routes/api');
const setupRoomHandlers = require('./sockets/roomHandlers');

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

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  setupRoomHandlers(io, socket);
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../../client/build')));

// Development info endpoint
app.get('/api/info', (req, res) => {
  res.json({ 
    message: 'Codepad Server is running',
    version: '1.0.0',
    environment: config.nodeEnv,
    endpoints: {
      execute: 'POST /api/execute',
      info: 'GET /api/info',
      websocket: 'ws://localhost:' + config.port
    },
    pistonApi: config.pistonApiUrl
  });
});

// For any other route, serve index.html from the React build
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
});

// Start server
server.listen(config.port, '0.0.0.0', () => {
  console.log(`🚀 Codepad Server listening on port ${config.port}`);
  console.log(`📁 Environment: ${config.nodeEnv}`);
  console.log(`🔧 Piston API: ${config.pistonApiUrl}`);
}); 