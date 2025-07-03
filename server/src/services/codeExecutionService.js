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
      
      // Extract detailed error information
      let errorMessage = 'Code execution failed';
      let statusCode = null;
      let pistonResponse = null;
      
      if (error.response) {
        // The request was made and the server responded with a status code
        statusCode = error.response.status;
        pistonResponse = error.response.data;
        
        errorMessage = `HTTP ${statusCode}: ${pistonResponse?.message || error.message}`;
        
        // Include additional details from Piston response
        if (pistonResponse?.details) {
          errorMessage += `\nDetails: ${pistonResponse.details}`;
        }
      } else if (error.request) {
        // The request was made but no response was received
        errorMessage = 'Network error: Unable to reach code execution service';
      } else {
        // Something happened in setting up the request
        errorMessage = `Request setup error: ${error.message}`;
      }
      
      return {
        success: false,
        error: errorMessage,
        statusCode: statusCode,
        pistonResponse: pistonResponse,
        originalError: error.message
      };
    }
  }
}

module.exports = new CodeExecutionService(); 