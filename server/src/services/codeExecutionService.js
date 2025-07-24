const axios = require('axios');
const config = require('../config');

// Log which Piston endpoint is configured at service load time
console.log(`🔧 CodeExecutionService initialized. Piston endpoint: ${config.pistonApiUrl}`);

class CodeExecutionService {
  async executeCode(code, language) {
    console.log(`▶️  Executing ${language} code via Piston`);
    try {
      const start = Date.now();
      const response = await axios.post(config.pistonApiUrl, {
        language: language,
        version: config.languageVersions[language] || '*',
        files: [{ 
          name: config.fileNames[language] || 'main.txt', 
          content: code 
        }]
      }, {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const elapsed = Date.now() - start;
      
      // Enhanced logging for debugging blank output issues
      console.log(`🔍 [${language}] Piston response received (${elapsed}ms)`);
      console.log(`🔍 [${language}] Response status:`, response.status);
      console.log(`🔍 [${language}] Response data:`, JSON.stringify(response.data, null, 2));
      
      const { run } = response.data;
      
      if (!run) {
        console.error(`❌ [${language}] No 'run' object in Piston response!`);
        return {
          success: false,
          error: 'Invalid Piston response: missing run object',
          pistonResponse: response.data
        };
      }
      
      console.log(`🔍 [${language}] run.stdout:`, JSON.stringify(run.stdout));
      console.log(`🔍 [${language}] run.stderr:`, JSON.stringify(run.stderr));
      console.log(`🔍 [${language}] run.code:`, run.code);
      console.log(`🔍 [${language}] run.signal:`, run.signal);
      
      const stdout = run.stdout || '';
      const stderr = run.stderr || '';
      const output = stdout + stderr;
      
      console.log(`🔍 [${language}] Final output length:`, output.length);
      console.log(`🔍 [${language}] Final output:`, JSON.stringify(output));
      
      // Check for potential issues
      if (output.length === 0) {
        console.warn(`⚠️  [${language}] Zero-length output detected!`);
        console.warn(`⚠️  [${language}] stdout was:`, run.stdout);
        console.warn(`⚠️  [${language}] stderr was:`, run.stderr);
        console.warn(`⚠️  [${language}] Exit code:`, run.code);
      }

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