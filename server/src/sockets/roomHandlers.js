const roomService = require('../services/roomService');
const RoomService = require('../services/roomService');

// Debounce map to prevent rapid language updates
const languageUpdateTimeouts = new Map();

const setupRoomHandlers = (io, socket) => {
  const joinRoom = async ({ roomId, user }) => {
    try {
      const room = await RoomService.getRoom(roomId);
      if (!room) {
        console.log(`User ${user.id} (${user.name}) attempted to join non-existent room ${roomId}`);
        socket.emit('room_error', { message: `Room ${roomId} does not exist.` });
        return;
      }

      // Send room details to the joining user
      socket.emit('room_details', { 
        title: room.title, 
        createdAt: room.created_at 
      });

      console.log(`User ${user.id} (${user.name}) is joining room ${roomId}`);
      socket.join(roomId);
      
      // Get or create room state (now async)
      const roomState = await roomService.getOrCreateRoom(roomId);
      
      // Add user to room
      const users = roomService.addUserToRoom(roomId, socket.id, user.name);
      
      // Send current state to the new user
      socket.emit('codeUpdate', { code: roomState.code });
      socket.emit('languageUpdate', { language: roomState.language, code: roomState.code });
      socket.emit('outputHistory', { outputHistory: roomState.outputHistory || [] });
      
      // Broadcast user list to all users in room
      io.in(roomId).emit('userList', { users });
      
      console.log(`User ${user.name} (${socket.id}) joined room ${roomId}. Language: ${roomState.language}`);
    } catch (error) {
      console.error(`Error in joinRoom for ${roomId}:`, error);
      socket.emit('room_error', { message: 'Failed to join room. Please try again.' });
    }
  };

  socket.on('joinRoom', joinRoom);

  socket.on('saveCode', async ({ code, room }) => {
    try {
      await roomService.updateRoomCode(room, code);
      await roomService.recordSnapshot(room, code);
      console.log(`Successfully saved code for room ${room}: ${code.length} characters`);
    } catch (error) {
      console.error(`Error saving code for room ${room}:`, error);
    }
  });

  socket.on('codeDelta', ({ operations, room }) => {
    // Broadcast delta operations immediately for real-time collaboration
    socket.to(room).emit('codeDelta', { operations });
  });

  socket.on('languageUpdate', async ({ language, code, room }) => {
    // Clear any existing timeout for this room
    if (languageUpdateTimeouts.has(room)) {
      clearTimeout(languageUpdateTimeouts.get(room));
    }

    // Debounce language updates by 100ms to prevent race conditions
    const timeoutId = setTimeout(async () => {
      try {
        console.log(`Language update for room ${room}: ${language} with ${code.length} characters`);
        
        // Update database first
        await roomService.updateRoomLanguage(room, language, code);
        console.log(`Successfully updated database for room ${room} to language: ${language}`);
        
        // Only broadcast to other users after successful database update
        // Don't emit back to sender to avoid race conditions with local state
        socket.to(room).emit('languageUpdate', { language, code });
        
        console.log(`Language update broadcast completed for room ${room}`);
        
        // Clean up timeout reference
        languageUpdateTimeouts.delete(room);
      } catch (error) {
        console.error(`Error updating language for room ${room}:`, error);
        
        // If database update failed, send the current state back to the user
        // We need to revert their local state to match the database
        try {
          const roomState = await roomService.getOrCreateRoom(room);
          socket.emit('languageUpdate', { 
            language: roomState.language, 
            code: roomState.code 
          });
          console.log(`Reverted language change for room ${room} due to database error`);
        } catch (revertError) {
          console.error(`Error reverting language change for room ${room}:`, revertError);
        }
        
        // Clean up timeout reference
        languageUpdateTimeouts.delete(room);
      }
    }, 100);

    languageUpdateTimeouts.set(room, timeoutId);
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
        
        // Clean up any pending language update timeouts for this room
        if (languageUpdateTimeouts.has(room)) {
          clearTimeout(languageUpdateTimeouts.get(room));
          languageUpdateTimeouts.delete(room);
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
};

module.exports = setupRoomHandlers; 