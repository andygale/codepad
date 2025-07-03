require('dotenv').config();

const config = {
  port: process.env.PORT || 5000,
  pistonApiUrl: process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://agale@localhost:5432/codecrush',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Language configurations
  languageVersions: {
    javascript: '18.15.0',
    python: '3.10.0',
    cpp: '10.2.0',
    java: '15.0.2',
    typescript: '5.0.3',
    deno: '1.32.3',
    swift: '5.3.3',
    kotlin: '1.8.20'
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