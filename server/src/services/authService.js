const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const config = require('../config');

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.microsoftTenantId}/discovery/v2.0/keys`
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

async function validateAndDecodeIdToken(idToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(idToken, getKey, {
      audience: config.microsoftClientId,
      issuer: `https://login.microsoftonline.com/${config.microsoftTenantId}/v2.0`,
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) {
        return reject(err);
      }
      resolve(decoded);
    });
  });
}

async function handleMicrosoftCallback(req, idToken) {
  try {
    const decodedToken = await validateAndDecodeIdToken(idToken);
    
    // Microsoft tokens may have email in different claims
    const email = decodedToken.email || 
                  decodedToken.preferred_username || 
                  decodedToken.upn || 
                  decodedToken.unique_name;
    
    // Store user info in session
    req.session.user = {
      id: decodedToken.sub,
      name: decodedToken.name,
      email: email,
      isAuthenticated: true
    };

    console.log('User session created:', req.session.user);
    console.log('Token claims:', Object.keys(decodedToken));
    
    return { 
      success: true, 
      user: req.session.user 
    };
  } catch (error) {
    console.error('Error during Microsoft callback:', error);
    return { 
      success: false, 
      error: 'Authentication failed. Please try again.' 
    };
  }
}

module.exports = {
  handleMicrosoftCallback,
  validateAndDecodeIdToken
}; 