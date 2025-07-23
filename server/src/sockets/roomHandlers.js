const roomService = require('../services/roomService');
const RoomService = require('../services/roomService');

// Debounce map to prevent rapid language updates
const languageUpdateTimeouts = new Map();

const setupRoomHandlers = (io, socket) => {
  // Check if user is authenticated, but don't require it for guests
  const session = socket.request.session;
  const user = session && session.user && session.user.isAuthenticated ? session.user : null;
  const isAuthenticated = !!user;

  const joinRoom = async ({ roomId, user: clientUser }) => {
    try {
      const room = await RoomService.getRoom(roomId);
      if (!room) {
        const userInfo = isAuthenticated ? `${user.id} (${user.name})` : `Guest`;
        console.log(`User ${userInfo} attempted to join non-existent room ${roomId}`);
        socket.emit('room_error', { message: `Room ${roomId} does not exist.` });
        return;
      }

      // Send room details to the joining user, including pause status
      socket.emit('room_details', { 
        title: room.title, 
        createdAt: room.created_at,
        isPaused: room.is_paused,
        pausedAt: room.paused_at,
        lastActivityAt: room.last_activity_at
      });

      // For guests, use the provided user info; for authenticated users, use session data
      const userDisplayName = isAuthenticated ? user.name : (clientUser?.name || 'Guest');
      const userId = isAuthenticated ? user.id : 'guest';

      console.log(`User ${userId} (${userDisplayName}) is joining room ${roomId}`);
      socket.join(roomId);
      
      // Get or create room state (now async)
      const roomState = await roomService.getOrCreateRoom(roomId);
      
      // Add user to room
      const users = roomService.addUserToRoom(roomId, socket.id, userDisplayName);
      
      // Send current state to the new user
      socket.emit('codeUpdate', { code: roomState.code });
      socket.emit('languageUpdate', { language: roomState.language, code: roomState.code });
      socket.emit('outputHistory', { outputHistory: roomState.outputHistory || [] });
      socket.emit('roomPauseStatus', { isPaused: room.is_paused });
      
      // Broadcast user list to all users in room
      io.in(roomId).emit('userList', { users });
      
      console.log(`User ${userDisplayName} (${socket.id}) joined room ${roomId}. Language: ${roomState.language}, Paused: ${room.is_paused}`);
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
      
      // If the error is due to room being paused, emit a pause status update
      if (error.message.includes('paused')) {
        socket.emit('room_error', { message: error.message });
        socket.emit('roomPauseStatus', { isPaused: true });
      }
    }
  });

  socket.on('codeDelta', ({ operations, room }) => {
    // Check if room is paused before allowing code changes
    roomService.checkRoomPauseStatus(room).then(isPaused => {
      if (isPaused) {
        socket.emit('room_error', { message: 'Room is paused. Code editing is not allowed.' });
        socket.emit('roomPauseStatus', { isPaused: true });
        return;
      }
      
      // Broadcast delta operations immediately for real-time collaboration
      socket.to(room).emit('codeDelta', { operations });
    }).catch(error => {
      console.error('Error checking room pause status for codeDelta:', error);
    });
  });

  socket.on('languageUpdate', async ({ language, code, room }) => {
    // Check if room is paused first
    try {
      const isPaused = await roomService.checkRoomPauseStatus(room);
      if (isPaused) {
        socket.emit('room_error', { message: 'Room is paused. Language changes are not allowed.' });
        socket.emit('roomPauseStatus', { isPaused: true });
        return;
      }
    } catch (error) {
      console.error('Error checking room pause status for languageUpdate:', error);
      return;
    }
    
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
        
        // If the error is due to room being paused, emit a pause status update
        if (error.message.includes('paused')) {
          socket.emit('room_error', { message: error.message });
          socket.emit('roomPauseStatus', { isPaused: true });
        } else {
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

  socket.on('runOutput', async ({ output, execTimeMs, room }) => {
    // Check if room is paused before allowing output
    try {
      const isPaused = await roomService.checkRoomPauseStatus(room);
      if (isPaused) {
        socket.emit('room_error', { message: 'Room is paused. Code execution is not allowed.' });
        socket.emit('roomPauseStatus', { isPaused: true });
        return;
      }
    } catch (error) {
      console.error('Error checking room pause status for runOutput:', error);
      // Continue with output if we can't check pause status
    }
    
    const outputHistory = roomService.addOutputToRoom(room, output, execTimeMs);
    io.in(room).emit('outputHistory', { outputHistory });
  });

  socket.on('clearOutput', ({ room }) => {
    const outputHistory = roomService.clearOutputHistory(room);
    io.in(room).emit('outputHistory', { outputHistory });
  });

  // Handle room pause/unpause status updates (for authenticated users)
  socket.on('pauseRoom', async ({ roomId }) => {
    if (!isAuthenticated) {
      socket.emit('room_error', { message: 'Authentication required to pause rooms.' });
      return;
    }
    
    try {
      const room = await roomService.getRoom(roomId);
      if (!room) {
        socket.emit('room_error', { message: 'Room not found.' });
        return;
      }
      
      if (room.is_paused) {
        socket.emit('room_error', { message: 'Room is already paused.' });
        return;
      }
      
      await roomService.pauseRoom(roomId);
      
      // Broadcast pause status to all users in the room
      io.in(roomId).emit('roomPauseStatus', { isPaused: true });
      console.log(`Room ${roomId} paused by ${user.name} (${user.email})`);
    } catch (error) {
      console.error('Error pausing room:', error);
      socket.emit('room_error', { message: 'Failed to pause room.' });
    }
  });

  socket.on('unpauseRoom', async ({ roomId }) => {
    if (!isAuthenticated) {
      socket.emit('room_error', { message: 'Authentication required to unpause rooms.' });
      return;
    }
    
    try {
      const room = await roomService.getRoom(roomId);
      if (!room) {
        socket.emit('room_error', { message: 'Room not found.' });
        return;
      }
      
      if (!room.is_paused) {
        socket.emit('room_error', { message: 'Room is not paused.' });
        return;
      }
      
      await roomService.unpauseRoom(roomId);
      
      // Broadcast unpause status to all users in the room
      io.in(roomId).emit('roomPauseStatus', { isPaused: false });
      console.log(`Room ${roomId} unpaused by ${user.name} (${user.email})`);
    } catch (error) {
      console.error('Error unpausing room:', error);
      socket.emit('room_error', { message: 'Failed to restart room.' });
    }
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