const express = require('express');
const app = express();

app.use(express.json());

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Piston Test API is running!', status: 'ok' });
});

// Runtimes endpoint
app.get('/api/v2/runtimes', (req, res) => {
  res.json([
    { language: 'javascript', version: '18.0.0', aliases: ['js', 'node'] },
    { language: 'python3', version: '3.10.0', aliases: ['python'] },
    { language: 'deno', version: '1.32.3', aliases: ['typescript'] }
  ]);
});

// Execute endpoint (basic test)
app.post('/api/v2/execute', (req, res) => {
  const { language, files } = req.body;
  
  if (language === 'javascript') {
    try {
      // Very basic JS execution (unsafe - just for testing)
      const code = files[0].content;
      let output = '';
      
      // Capture console.log
      const originalLog = console.log;
      console.log = (...args) => {
        output += args.join(' ') + '\n';
      };
      
      eval(code);
      console.log = originalLog;
      
      res.json({
        language: 'javascript',
        version: '18.0.0',
        run: {
          stdout: output,
          stderr: '',
          code: 0,
          signal: null
        }
      });
    } catch (error) {
      res.json({
        language: 'javascript',
        version: '18.0.0',
        run: {
          stdout: '',
          stderr: error.message,
          code: 1,
          signal: null
        }
      });
    }
  } else {
    res.json({
      run: {
        stdout: '',
        stderr: `Language ${language} not supported in test mode`,
        code: 1,
        signal: null
      }
    });
  }
});

const port = process.env.PORT || 2000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Piston Test API running on port ${port}`);
}); 