const axios = require('axios');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const config = require('../config');

const client = jwksClient({
  cache: true, // Enable caching
  rateLimit: true, // Enable rate limiting
  jwksRequestsPerMinute: 5, // Alow 5 requests per minute
  jwksUri: `https://login.microsoftonline.com/${config.microsoftTenantId}/discovery/v2.0/keys`
});

// Promisify the getSigningKey function to use with async/await
const getSigningKey = (kid) => {
  return new Promise((resolve, reject) => {
    client.getSigningKey(kid, (err, key) => {
      if (err) {
        return reject(err);
      }
      resolve(key);
    });
  });
};

async function getKey(header, callback) {
  try {
    let key = await getSigningKey(header.kid);
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  } catch (err) {
    // If we get a "key not found" error, it might be due to key rotation.
    // Force a cache refresh and try one more time.
    if (err && err.name === 'SigningKeyNotFoundError') {
      console.warn('Signing key not found, attempting to refetch from JWKS URI...');
      client.getSigningKey(header.kid, { cache: false }, (refreshErr, freshKey) => {
        if (refreshErr || !freshKey) {
          console.error('Failed to retrieve signing key after refresh:', refreshErr || 'Key not found');
          return callback(refreshErr || new Error('Failed to retrieve signing key'));
        }
        const signingKey = freshKey.publicKey || freshKey.rsaPublicKey;
        callback(null, signingKey);
      });
    } else {
      console.error('Error retrieving signing key:', err);
      callback(err);
    }
  }
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

    // Manually save the session to ensure it's written before the response is sent
    await new Promise((resolve, reject) => {
      req.session.save(err => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log('User session created and saved:', req.session.user);
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