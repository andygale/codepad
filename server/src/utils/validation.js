const config = require('../config');

/**
 * Validates that code is within the allowed size limit
 * @param {string} code - The code to validate
 * @returns {object} - { isValid: boolean, error?: string, sizeBytes?: number }
 */
function validateCodeSize(code) {
  if (typeof code !== 'string') {
    return {
      isValid: false,
      error: 'Code must be a string'
    };
  }

  const sizeBytes = Buffer.byteLength(code, 'utf8');
  const maxSize = config.maxCodeSizeBytes;

  if (sizeBytes > maxSize) {
    return {
      isValid: false,
      error: `Code size (${sizeBytes} bytes) exceeds maximum allowed size of ${maxSize} bytes (${Math.round(maxSize / 1024)}KB)`,
      sizeBytes,
      maxSize
    };
  }

  return {
    isValid: true,
    sizeBytes
  };
}

/**
 * Express middleware for validating code size in request body
 * @param {string} codeField - The field name containing the code (default: 'code')
 */
function validateCodeSizeMiddleware(codeField = 'code') {
  return (req, res, next) => {
    const code = req.body[codeField];
    
    if (!code) {
      // If no code field, let other validation handle it
      return next();
    }

    const validation = validateCodeSize(code);
    
    if (!validation.isValid) {
      return res.status(413).json({
        error: 'Payload too large',
        message: validation.error,
        maxSizeBytes: validation.maxSize
      });
    }

    // Add size info to request for logging
    req.codeSizeBytes = validation.sizeBytes;
    next();
  };
}

module.exports = {
  validateCodeSize,
  validateCodeSizeMiddleware
}; 