const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

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

app.get('/', (req, res) => {
  res.send('CoderPad Clone Backend Running');
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('joinRoom', ({ room }) => {
    console.log(`joinRoom received from ${socket.id} for room: ${room}`);
    socket.join(room);
    // Send current state to the new user
    if (roomState[room]) {
      socket.emit('codeUpdate', { code: roomState[room].code });
      socket.emit('languageUpdate', { language: roomState[room].language, code: roomState[room].code });
    } else {
      roomState[room] = { code: '// Write your code here', language: 'javascript' };
    }
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
    io.in(room).emit('runOutput', { output });
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

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 