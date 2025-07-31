const express = require('express');
const authService = require('../services/authService');

const router = express.Router();

// Microsoft SSO callback
router.post('/callback', async (req, res) => {
  console.log('🔥 AUTH CALLBACK HIT! 🔥');
  console.log('=== AUTH CALLBACK START ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Request body:', req.body);
  console.log('Session before:', req.session);
  console.log('Session ID before:', req.sessionID);
  
  const { token } = req.body;
  
  if (!token) {
    console.log('ERROR: No token provided');
    return res.status(400).json({ error: 'ID token is required' });
  }
  
  const result = await authService.handleMicrosoftCallback(req, token);
  
  console.log('Auth result:', result);
  console.log('Session after:', req.session);
  console.log('=== AUTH CALLBACK END ===');
  
  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(401).json(result);
  }
});

// Get current user
router.get('/me', (req, res) => {
  console.log('=== AUTH ME START ===');
  console.log('Request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Session:', req.session);
  console.log('Session user:', req.session?.user);
  console.log('=== AUTH ME END ===');
  
  if (req.session.user && req.session.user.isAuthenticated) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ isAuthenticated: false });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('codecrush.sid'); // Clear the custom session cookie name
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

module.exports = router; 