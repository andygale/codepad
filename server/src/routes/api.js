const express = require('express');
const codeExecutionService = require('../services/codeExecutionService');
const roomService = require('../services/roomService');
const { requireAuth } = require('../middleware/authMiddleware');
const { validateCodeSizeMiddleware } = require('../utils/validation');
const { createRoomAccessRateLimit, getRateLimitStats } = require('../middleware/rateLimitMiddleware');

const router = express.Router();

// Apply rate limiting middleware to room access endpoints
const roomAccessRateLimit = createRoomAccessRateLimit();

// Whitelist of supported languages
const SUPPORTED_LANGUAGES = new Set([
  'javascript',
  'python',
  'cpp',
  'java',
  'typescript',
  'deno',
  'swift',
  'kotlin'
]);

router.get('/rooms', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 10;
  // Only filter by creatorEmail if explicitly provided in query params
  const creatorEmail = req.query.creatorEmail || null;

  const { rooms, totalCount } = await roomService.getAllRooms(page, limit, creatorEmail);
  res.json({
    rooms,
    totalCount,
  });
});

router.get('/rooms/:roomId', roomAccessRateLimit, async (req, res) => {
  const { roomId } = req.params;
  const room = await roomService.getRoom(roomId);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // SECURITY: Check if room is paused and user is not authenticated
  const isAuthenticated = req.session?.user?.isAuthenticated || false;
  if (room.is_paused && !isAuthenticated) {
    console.log(`Unauthenticated user attempted to access paused room ${roomId} via HTTP - access denied`);
    return res.status(403).json({ 
      error: 'This room is paused and only accessible to logged-in users. Please sign in to access this room.' 
    });
  }

  // SECURITY: Filter out sensitive creator information from response
  const { creator, creator_email, ...safeRoomData } = room;
  res.json(safeRoomData);
});

router.post('/rooms', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const { name: creator, email: creator_email } = req.session.user;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const newRoom = await roomService.createRoom(title, creator, creator_email);
    res.status(201).json(newRoom);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Pause a room (authenticated users only)
router.post('/rooms/:roomId/pause', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Get room to check if it exists
    const room = await roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.is_paused) {
      return res.status(400).json({ error: 'Room is already paused' });
    }
    
    await roomService.pauseRoom(roomId);
    res.json({ message: 'Room paused successfully' });
  } catch (error) {
    console.error('Error pausing room:', error);
    res.status(500).json({ error: 'Failed to pause room' });
  }
});

// Unpause/restart a room (authenticated users only)
router.post('/rooms/:roomId/unpause', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Get room to check if it exists
    const room = await roomService.getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (!room.is_paused) {
      return res.status(400).json({ error: 'Room is not paused' });
    }
    
    await roomService.unpauseRoom(roomId);
    res.json({ message: 'Room restarted successfully' });
  } catch (error) {
    console.error('Error unpausing room:', error);
    res.status(500).json({ error: 'Failed to restart room' });
  }
});

router.post('/execute', validateCodeSizeMiddleware('code'), async (req, res) => {
  const { code, language, roomId } = req.body;

  if (!code || !language) {
    return res.status(400).json({ 
      error: 'Missing required fields: code and language' 
    });
  }

  // SECURITY: Whitelist supported languages
  if (!SUPPORTED_LANGUAGES.has(language)) {
    return res.status(400).json({
      error: `Unsupported language: ${language}. Please use one of: ${[...SUPPORTED_LANGUAGES].join(', ')}`
    });
  }

  // Log code execution with size info
  console.log(`Executing ${language} code (${req.codeSizeBytes || 'unknown'} bytes) for room ${roomId || 'none'}`);


  // Check if room is paused (if roomId is provided)
  if (roomId) {
    try {
      const isPaused = await roomService.checkRoomPauseStatus(roomId);
      if (isPaused) {
        return res.status(403).json({
          error: 'Room is paused. Code execution is not allowed.'
        });
      }
    } catch (error) {
      console.error('Error checking room pause status:', error);
      // Continue with execution if we can't check pause status
    }
  }

  const result = await codeExecutionService.executeCode(code, language);
  
  if (result.success) {
    res.json({ output: result.output, execTimeMs: result.execTimeMs });
  } else {
    // Use the status code from Piston if available, otherwise default to 500
    const statusCode = result.statusCode || 500;
    
    res.status(statusCode).json({
      error: result.error,
      statusCode: result.statusCode,
      pistonResponse: result.pistonResponse,
      originalError: result.originalError
    });
  }
});

// Rate limiting stats endpoint (for monitoring and debugging)
router.get('/rate-limit-stats', requireAuth, getRateLimitStats);

// Playback history endpoint
router.get('/rooms/:roomId/history', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const history = await roomService.getPlaybackHistory(roomId);
    res.json(history);
  } catch (error) {
    console.error('Error getting playback history:', error);
    res.status(500).json({ error: 'Failed to get playback history' });
  }
});

module.exports = router; 