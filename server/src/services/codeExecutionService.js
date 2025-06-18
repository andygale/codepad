const axios = require('axios');
const config = require('../config');

class CodeExecutionService {
  async executeCode(code, language) {
    try {
      const response = await axios.post(config.pistonApiUrl, {
        language: language,
        version: config.languageVersions[language] || '*',
        files: [{ 
          name: config.fileNames[language] || 'main.txt', 
          content: code 
        }]
      });
      
      return { 
        success: true, 
        output: response.data.run.output 
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