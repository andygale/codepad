const roomService = require('../services/roomService');

const setupRoomHandlers = (io, socket) => {
  socket.on('joinRoom', ({ room, name }) => {
    socket.join(room);
    
    // Get or create room state
    const roomState = roomService.getOrCreateRoom(room);
    
    // Add user to room
    const users = roomService.addUserToRoom(room, socket.id, name);
    
    // Send current state to the new user
    socket.emit('codeUpdate', { code: roomState.code });
    socket.emit('languageUpdate', { language: roomState.language, code: roomState.code });
    socket.emit('outputHistory', { outputHistory: roomState.outputHistory || [] });
    
    // Broadcast user list to all users in room
    io.in(room).emit('userList', { users });
    
    console.log(`User ${name} (${socket.id}) joined room ${room}`);
  });

  socket.on('codeUpdate', ({ code, room }) => {
    roomService.updateRoomCode(room, code);
    socket.to(room).emit('codeUpdate', { code });
  });

  socket.on('languageUpdate', ({ language, code, room }) => {
    roomService.updateRoomLanguage(room, language, code);
    socket.to(room).emit('languageUpdate', { language, code });
  });

  socket.on('cursorChange', ({ room, position }) => {
    socket.to(room).emit('remoteCursorChange', { position, socketId: socket.id });
  });

  socket.on('selectionChange', ({ room, selection }) => {
    socket.to(room).emit('remoteSelectionChange', { selection, socketId: socket.id });
  });

  socket.on('runOutput', ({ output, room }) => {
    const outputHistory = roomService.addOutputToRoom(room, output);
    io.in(room).emit('outputHistory', { outputHistory });
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) { // Skip the socket's own room
        const users = roomService.removeUserFromRoom(room, socket.id);
        io.in(room).emit('userList', { users });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
};

module.exports = setupRoomHandlers; 