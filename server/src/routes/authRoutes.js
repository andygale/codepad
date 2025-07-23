const express = require('express');
const authService = require('../services/authService');

const router = express.Router();

// Microsoft SSO callback
router.post('/callback', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'ID token is required' });
  }
  
  const result = await authService.handleMicrosoftCallback(req, token);
  
  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(401).json(result);
  }
});

// Get current user
router.get('/me', (req, res) => {
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
    res.clearCookie('connect.sid'); // The default session cookie name
    res.status(200).json({ message: 'Logged out successfully' });
  });
});

module.exports = router; 