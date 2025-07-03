const axios = require('axios');
const config = require('../config');

class CodeExecutionService {
  async executeCode(code, language) {
    try {
      const start = Date.now();
      const response = await axios.post(config.pistonApiUrl, {
        language: language,
        version: config.languageVersions[language] || '*',
        files: [{ 
          name: config.fileNames[language] || 'main.txt', 
          content: code 
        }]
      });
      const elapsed = Date.now() - start;
      const { run } = response.data;
      const output = (run.stdout || '') + (run.stderr || '');

      return { 
        success: true, 
        output: output,
        execTimeMs: elapsed
      };
    } catch (error) {
      console.error('Code execution error:', error.message);
      
      return {
        success: false,
        error: 'Code execution failed',
        details: error.message,
        pistonError: error.response?.data
      };
    }
  }
}

module.exports = new CodeExecutionService(); 