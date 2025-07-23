// dotenv is already loaded in index.js

const config = {
  port: process.env.PORT || 5000,
  pistonApiUrl: process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://agale@localhost:5432/codepad',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Microsoft Authentication
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID || '7d539d3e-b9fa-4ec7-b8e9-ab88ec1db4af',
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID || 'cf3dc8a2-b7cc-4452-848f-cb570a56cfbf',
  
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

module.exports = config; 