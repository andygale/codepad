const express = require('express');
const codeExecutionService = require('../services/codeExecutionService');

const router = express.Router();

router.post('/execute', async (req, res) => {
  const { code, language } = req.body;

  if (!code || !language) {
    return res.status(400).json({ 
      error: 'Missing required fields: code and language' 
    });
  }

  const result = await codeExecutionService.executeCode(code, language);
  
  if (result.success) {
    res.json({ output: result.output });
  } else {
    res.status(500).json({
      error: result.error,
      details: result.details,
      piston: result.pistonError
    });
  }
});

module.exports = router; 