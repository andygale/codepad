const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const roomState = {};
const userNames = {};

app.get('/', (req, res) => {
  res.send('Codepad Backend Running');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', ({ room, name }) => {
    console.log(`joinRoom received from ${socket.id} for room: ${room}, name: ${name}`);
    socket.join(room);
    if (!roomState[room]) {
      roomState[room] = {
        code: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
        language: 'typescript',
        outputHistory: []
      };
    }
    if (!userNames[room]) userNames[room] = {};
    userNames[room][socket.id] = name || 'Anonymous';
    // Send current state to the new user
    socket.emit('codeUpdate', { code: roomState[room].code });
    socket.emit('languageUpdate', { language: roomState[room].language, code: roomState[room].code });
    socket.emit('outputHistory', { outputHistory: roomState[room].outputHistory || [] });
    // Broadcast user list
    io.in(room).emit('userList', { users: Object.values(userNames[room]) });
  });

  socket.on('codeUpdate', ({ code, room }) => {
    console.log(`codeUpdate received from ${socket.id} for room: ${room}, code:`, code);
    if (!roomState[room]) roomState[room] = {};
    roomState[room].code = code;
    socket.to(room).emit('codeUpdate', { code });
  });

  socket.on('languageUpdate', ({ language, code, room }) => {
    console.log(`languageUpdate received from ${socket.id} for room: ${room}, language:`, language);
    if (!roomState[room]) roomState[room] = {};
    roomState[room].language = language;
    roomState[room].code = code;
    socket.to(room).emit('languageUpdate', { language, code });
  });

  socket.on('runOutput', ({ output, room }) => {
    if (!roomState[room]) roomState[room] = { outputHistory: [] };
    const timestamp = new Date().toLocaleString();
    if (!roomState[room].outputHistory) roomState[room].outputHistory = [];
    roomState[room].outputHistory.push({ timestamp, output });
    io.in(room).emit('outputHistory', { outputHistory: roomState[room].outputHistory });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (userNames[room] && userNames[room][socket.id]) {
        delete userNames[room][socket.id];
        io.in(room).emit('userList', { users: Object.values(userNames[room]) });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.post('/execute', async (req, res) => {
  const { code, language } = req.body;
  // Hardcoded versions for now
  const languageVersions = {
    javascript: '18.15.0',
    python3: '3.10.0',
    cpp: '11.0.0',
    java: '15.0.2',
  };
  const version = languageVersions[language] || 'latest';
  // Determine file name based on language
  const fileNames = {
    javascript: 'main.js',
    python3: 'main.py',
    cpp: 'main.cpp',
    java: 'Main.java',
  };
  const fileName = fileNames[language] || 'main.txt';
  try {
    const response = await axios.post('https://emkc.org/api/v2/piston/execute', {
      language,
      version,
      files: [{ name: fileName, content: code }]
    });
    res.json({ output: response.data.run.output });
  } catch (err) {
    if (err.response) {
      console.error('Piston API error response:', err.response.data);
    }
    console.error('Error in /execute:', err);
    res.status(500).json({ error: 'Code execution failed', details: err.message, piston: err.response?.data });
  }
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/build')));

// For any other route, serve index.html from the React build
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 