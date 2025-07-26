// dotenv is already loaded in index.js

const config = {
  port: process.env.PORT || 5000,
  pistonApiUrl: process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://agale@localhost:5432/codepad',
  // SECURITY FIX: Remove wildcard CORS origin and properly handle multiple origins
  corsOrigin: getCorsOrigins(),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Microsoft SSO
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID,
  
  // Session configuration
  sessionSecret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  trustProxy: process.env.TRUST_PROXY === 'true',
  
  // Security configuration
  maxCodeSizeBytes: parseInt(process.env.MAX_CODE_SIZE_BYTES, 10) || 10240, // 10KB default
  
  // Language configurations
  languageVersions: {
    javascript: '20.11.1',
    python: '3.12.0',
    cpp: '10.2.0',
    java: '15.0.2',
    typescript: '5.0.3',
    deno: '1.32.3',
    swift: '5.3.3',
    //kotlin: '1.8.20'
    kotlin: '2.2.0'
  },

  fileNames: {
    javascript: 'main.js',
    python: 'main.py',
    cpp: 'main.cpp',
    java: 'Main.java',
    typescript: 'main.ts',
    deno: 'main.ts',
    swift: 'main.swift',
    kotlin: 'main.kt'
  }
};

// --- Configuration Validation ---

// CRITICAL: Validate that Microsoft SSO configuration is present.
// These are essential for authentication to function in any environment.
if (!config.microsoftClientId || !config.microsoftTenantId) {
  console.error('FATAL ERROR: MICROSOFT_CLIENT_ID or MICROSOFT_TENANT_ID is not defined in the environment.');
  console.error('Please ensure these variables are set in your .env file for local development or as environment variables in production.');
  process.exit(1); // Exit immediately if auth config is missing
}

// Session configuration
config.sessionSecret = process.env.SESSION_SECRET;

// CRITICAL: Ensure a session secret is provided in production.
if (config.nodeEnv === 'production' && (!config.sessionSecret || config.sessionSecret === 'your-secret-key-change-in-production')) {
  console.error('FATAL ERROR: SESSION_SECRET is not defined in production or is the default value.');
  console.error('Please set this environment variable for session security.');
  process.exit(1);
}

/**
 * Get CORS origins based on environment and configuration
 * @returns {string|string[]|function} CORS origin configuration
 */
function getCorsOrigins() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const corsOriginEnv = process.env.CORS_ORIGIN;
  
  // If CORS_ORIGIN is explicitly set, use it
  if (corsOriginEnv) {
    // Handle comma-separated origins
    if (corsOriginEnv.includes(',')) {
      return corsOriginEnv.split(',').map(origin => origin.trim());
    }
    return corsOriginEnv;
  }
  
  // Default secure configurations based on environment
  if (nodeEnv === 'production') {
    // SECURITY: In production, you MUST set CORS_ORIGIN explicitly
    console.warn('⚠️  WARNING: CORS_ORIGIN not set in production! Using restrictive default.');
    return false; // Deny all cross-origin requests by default
  } else if (nodeEnv === 'development') {
    // Development: Allow common development origins
    return [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:5000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:5000'
    ];
  } else {
    // Test environment or other: be restrictive
    return 'http://localhost:3000';
  }
}

module.exports = config; 