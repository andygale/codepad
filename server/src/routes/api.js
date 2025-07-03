const express = require('express');
const codeExecutionService = require('../services/codeExecutionService');
const roomService = require('../services/roomService');

const router = express.Router();

router.get('/rooms', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = 10;
  const creatorEmail = req.query.creatorEmail || null;

  const { rooms, totalCount } = await roomService.getAllRooms(page, limit, creatorEmail);
  res.json({
    rooms,
    totalCount,
  });
});

router.get('/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const room = await roomService.getRoom(roomId);
  if (room) {
    res.json(room);
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

router.post('/rooms', async (req, res) => {
  try {
    const { title, creator, creator_email } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const newRoom = await roomService.createRoom(title, creator || 'Anonymous', creator_email);
    res.status(201).json(newRoom);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/execute', async (req, res) => {
  const { code, language } = req.body;

  if (!code || !language) {
    return res.status(400).json({ 
      error: 'Missing required fields: code and language' 
    });
  }

  const result = await codeExecutionService.executeCode(code, language);
  
  if (result.success) {
    res.json({ output: result.output, execTimeMs: result.execTimeMs });
  } else {
    res.status(500).json({
      error: result.error,
      details: result.details,
      piston: result.pistonError
    });
  }
});

router.get('/rooms/:roomId/history', async (req,res)=>{
  try{
    const {roomId}=req.params;
    const history=await roomService.getHistory(roomId);
    res.json(history);
  }catch(err){
    console.error('history error',err);
    res.status(500).json({error:'Failed to fetch history'});
  }
});

module.exports = router; 