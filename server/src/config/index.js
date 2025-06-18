const config = {
  port: process.env.PORT || 5000,
  pistonApiUrl: process.env.PISTON_API_URL || 'http://localhost:2000/api/v2/execute',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Language configurations
  languageVersions: {
    javascript: '20.11.1',
    python3: '3.12.0',
    cpp: '10.2.0',
    java: '15.0.2',
    typescript: '5.0.3',
    deno: '1.32.3',
    swift: '5.3.3',
    kotlin: '1.8.20'
  },

  fileNames: {
    javascript: 'main.js',
    python3: 'main.py',
    cpp: 'main.cpp',
    java: 'Main.java',
    typescript: 'main.ts',
    deno: 'main.ts',
    swift: 'main.swift',
    kotlin: 'main.kt'
  }
};

module.exports = config; 