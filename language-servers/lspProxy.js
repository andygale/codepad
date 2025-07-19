const { v4: uuidv4 } = require('../server/node_modules/uuid');
const LanguageServerManager = require('./languageServerManager');
const path = require('path');
const fs = require('fs');

class LSPProxy {
  constructor() {
    this.languageServerManager = new LanguageServerManager();
    this.clientConnections = new Map();
    this.buffers = new Map();
    this.messageHandlers = new Map(); // requestId -> { clientId, resolve, reject }
    
    console.log(`[${new Date().toISOString()}] [LSP Proxy] LSP Proxy initialized`);
  }

  async handleClientConnection(socket, language, roomId) {
    const clientId = uuidv4();
    
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Client connected: ${clientId} (${language}) in room ${roomId}`);
    
    // Create room-level workspace directory FIRST (shared by all clients in the room)
    const roomWorkspaceDir = path.join(this.languageServerManager.getWorkspaceDir(), roomId);
    let workspaceCreated = false;
    if (!fs.existsSync(roomWorkspaceDir)) {
        fs.mkdirSync(roomWorkspaceDir, { recursive: true });
        workspaceCreated = true;
        
        // Create proper project structure for Kotlin
        if (language === 'kotlin') {
          console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing Kotlin project structure for room ${roomId}`);
          await this.initializeKotlinProject(roomWorkspaceDir);
          console.log(`[${new Date().toISOString()}] [LSP Proxy] Kotlin project structure created for room ${roomId}`);
        }
    }

    // Start language server AFTER workspace is ready
    let languageServer;
    try {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Starting language server for ${language} in room ${roomId}...`);
      languageServer = await this.languageServerManager.startLanguageServer(language, roomId);
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Language server started successfully for ${language} in room ${roomId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [LSP Proxy] Failed to start language server for ${language}:`, error);
      socket.emit('lsp-error', { error: `Failed to start ${language} language server: ${error.message}` });
      return;
    }

    // Use simple file path for all languages (consistent with Python/Java approach)
    const sourceFileName = `main.${this.languageServerManager.getLanguageExtension(language)}`;
    const sourceFilePath = path.join(roomWorkspaceDir, sourceFileName);
    const documentUri = `file://${sourceFilePath}`;
    const sessionWorkspaceDir = roomWorkspaceDir; // For compatibility with existing code

    // Store client connection (include sessionWorkspaceDir and roomId for later use)
    this.clientConnections.set(clientId, {
      socket,
      languageServer,
      language,
      roomId,
      pendingRequests: new Map(),
      sessionWorkspaceDir
    });

    // Set up message handlers
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Setting up message handlers for client ${clientId}`);
    this.setupClientMessageHandlers(clientId, documentUri);
    this.setupLanguageServerMessageHandlers(clientId);

    // Send initialize message to language server
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing language server for client ${clientId}`);
    await this.initializeLanguageServer(clientId);

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] LSP client disconnected: ${clientId}`);
      this.clientConnections.delete(clientId);
      this.buffers.delete(clientId); // Clean up message buffer
      
      // Clean up session workspace
      if (fs.existsSync(sessionWorkspaceDir)) {
        fs.rm(sessionWorkspaceDir, { recursive: true, force: true }, (err) => {
          if (err) {
            console.error(`[${new Date().toISOString()}] [LSP Proxy] Error removing session directory ${sessionWorkspaceDir}:`, err);
          } else {
            console.log(`[${new Date().toISOString()}] [LSP Proxy] Removed session directory: ${sessionWorkspaceDir}`);
          }
        });
      }

      // Clean up pending requests
      for (const [requestId, handler] of this.messageHandlers.entries()) {
        if (handler.clientId === clientId) {
          handler.reject(new Error('Client disconnected'));
          this.messageHandlers.delete(requestId);
        }
      }
    });

    return { clientId, documentUri };
  }

  async initializeKotlinProject(projectDir) {
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing minimal Kotlin project in ${projectDir}`);
    
    // Create working Gradle project that should actually resolve dependencies
    const buildGradleContent = `plugins {
    kotlin("jvm") version "1.9.22"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.10.2")
}`;

    const buildGradlePath = path.join(projectDir, 'build.gradle.kts');
    if (!fs.existsSync(buildGradlePath)) {
      fs.writeFileSync(buildGradlePath, buildGradleContent);
    }

    // Create main.kt directly in project root
    const mainKtPath = path.join(projectDir, 'main.kt');
    if (!fs.existsSync(mainKtPath)) {
      const mainKtContent = `fun main() {
    println("Hello, Kotlin!")
}`;
      fs.writeFileSync(mainKtPath, mainKtContent);
    }
    
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Minimal Kotlin project created with direct JAR references`);
    
    // Give Kotlin LS time to process the Gradle project and download/index dependencies
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Waiting for Kotlin LS to process Gradle project and download coroutines...`);
    await new Promise(resolve => setTimeout(resolve, 10000)); // More time for network dependency download
  }

  setupClientMessageHandlers(clientId, documentUri) {
    console.log(`[${new Date().toISOString()}] [LSP Proxy] setupClientMessageHandlers called for client ${clientId}`);
    const connection = this.clientConnections.get(clientId);
    if (!connection) {
      console.error(`[${new Date().toISOString()}] [LSP Proxy] No connection found for client ${clientId}`);
      return;
    }

    const { socket, languageServer } = connection;
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Setting up event handlers for client ${clientId}`);

    // Handle LSP messages from client
    socket.on('lsp-message', async (message) => {
      try {
        // Intercept didOpen to write the file to the workspace so the LS can find it
        if (message.method === 'textDocument/didOpen') {
          console.log(`[${new Date().toISOString()}] [LSP Proxy] Intercepted textDocument/didOpen for client ${clientId}`);
          const uri = message.params.textDocument.uri;
          const filePath = new URL(uri).pathname;
          const fileDir = path.dirname(filePath);

          console.log(`[${new Date().toISOString()}] [LSP Proxy] Writing file to ${filePath}`);
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
          }
          fs.writeFileSync(filePath, message.params.textDocument.text);
        }

        await this.sendToLanguageServer(clientId, message);
      } catch (error) {
        console.error('Error sending message to language server:', error);
        socket.emit('lsp-error', { error: error.message });
      }
    });

    // Handle document synchronization
    socket.on('lsp-document-change', async (params) => {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Received lsp-document-change for client ${clientId}`);
      try {
        await this.handleDocumentChange(clientId, params);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Error handling document change for client ${clientId}:`, error);
      }
    });

    // Handle completion requests
    socket.on('lsp-completion', async (params) => {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Received lsp-completion for client ${clientId}:`, params);
      try {
        const result = await this.handleCompletionRequest(clientId, params);
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Completion result for client ${clientId}:`, result);
        socket.emit('lsp-completion-response', result);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Error handling completion request for client ${clientId}:`, error);
        socket.emit('lsp-error', { error: error.message });
      }
    });

    // Handle hover requests
    socket.on('lsp-hover', async (params) => {
      try {
        const result = await this.handleHoverRequest(clientId, params);
        socket.emit('lsp-hover-response', result);
      } catch (error) {
        console.error('Error handling hover request:', error);
        socket.emit('lsp-error', { error: error.message });
      }
    });

    // Handle diagnostic requests
    socket.on('lsp-diagnostics', async (params) => {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Received lsp-diagnostics for client ${clientId}:`, params);
      try {
        // Create the file in the workspace before sending the didOpen notification
        const filePath = new URL(documentUri).pathname;
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        fs.writeFileSync(filePath, params.textDocument.text);
        
        await this.handleDiagnosticRequest(clientId, params);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Error handling diagnostic request for client ${clientId}:`, error);
      }
    });
  }

  setupLanguageServerMessageHandlers(clientId) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) return;

    const { socket, languageServer } = connection;

    // Handle messages from language server
    languageServer.stdout.on('data', (data) => {
      try {
        const messages = this.parseLanguageServerMessages(clientId, data);
        for (const message of messages) {
          this.handleLanguageServerMessage(clientId, message);
        }
      } catch (error) {
        console.error('Error parsing language server message:', error);
      }
    });

    languageServer.stderr.on('data', (data) => {
      console.error(`Language server stderr (${connection.language}):`, data.toString());
    });
  }

  async initializeLanguageServer(clientId) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) return;
    // Use the session-specific workspace directory for this client
    const workspacePath = connection.sessionWorkspaceDir || path.join(__dirname, 'workspace');
    const workspaceUri = `file://${workspacePath}`;
    
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing language server with workspace: ${workspaceUri}`);

    const initializeParams = {
      processId: process.pid,
      // Use explicit workspace for all languages to ensure files are included
      rootUri: workspaceUri,
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
          },
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
          didChangeWatchedFiles: {
            dynamicRegistration: true,
          },
          symbol: {
            dynamicRegistration: true,
            symbolKind: {
              valueSet: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
            },
          },
          configuration: true,
          workspaceFolders: true,
        },
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
          },
          synchronization: {
            dynamicRegistration: true,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true,
          },
          completion: {
            dynamicRegistration: true,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true,
            },
            contextSupport: true,
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: {
            dynamicRegistration: true,
          },
          references: {
            dynamicRegistration: true,
          },
          documentHighlight: {
            dynamicRegistration: true,
          },
          codeAction: {
            dynamicRegistration: true,
          },
          codeLens: {
            dynamicRegistration: true,
          },
          formatting: {
            dynamicRegistration: true,
          },
          rangeFormatting: {
            dynamicRegistration: true,
          },
          onTypeFormatting: {
            dynamicRegistration: true,
          },
          rename: {
            dynamicRegistration: true,
          },
          foldingRange: {
            dynamicRegistration: true,
          },
        },
      },
      workspaceFolders: [
        {
          uri: workspaceUri,
          name: path.basename(workspacePath)
        }
      ],
    };

    try {
      // Send initialize request and wait for response
      await this.sendRequest(clientId, 'initialize', initializeParams);

      // Per LSP spec, the client MUST send an 'initialized' notification once it receives the response
      await this.sendNotification(clientId, 'initialized', {});

      // Optionally inform server about (empty) workspace configuration so it doesn’t wait for it
      await this.sendNotification(clientId, 'workspace/didChangeConfiguration', { settings: {} });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [LSP Proxy] Error initializing language server for client ${clientId}:`, error);
      // Optionally, emit an error to the client
      const connection = this.clientConnections.get(clientId);
      if (connection) {
        connection.socket.emit('lsp-error', { error: `Failed to initialize language server: ${error.message}` });
      }
    }
  }

  async sendRequest(clientId, method, params) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) throw new Error('Client not connected');

    const requestId = uuidv4();
    const message = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.messageHandlers.set(requestId, { clientId, resolve, reject, method });
      
      const messageString = JSON.stringify(message);
      const messageWithHeader = `Content-Length: ${messageString.length}\r\n\r\n${messageString}`;
      
      connection.languageServer.stdin.write(messageWithHeader);
      
      // Increase timeout for long-running operations like 'initialize'
      const timeoutMs = method === 'initialize' ? 60000 : 10000;
      setTimeout(() => {
        if (this.messageHandlers.has(requestId)) {
          this.messageHandlers.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, timeoutMs);
    });
  }

  async sendNotification(clientId, method, params) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) throw new Error('Client not connected');

    const message = {
      jsonrpc: '2.0',
      method,
      params
    };

    const messageString = JSON.stringify(message);
    const messageWithHeader = `Content-Length: ${messageString.length}\r\n\r\n${messageString}`;
    
    connection.languageServer.stdin.write(messageWithHeader);
  }

  async sendToLanguageServer(clientId, message) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) throw new Error('Client not connected');

    const messageString = JSON.stringify(message);
    const messageWithHeader = `Content-Length: ${messageString.length}\r\n\r\n${messageString}`;
    
    connection.languageServer.stdin.write(messageWithHeader);
  }

  parseLanguageServerMessages(clientId, data) {
    const messages = [];
    
    // Get or create buffer for this client
    if (!this.buffers.has(clientId)) {
      this.buffers.set(clientId, '');
    }
    
    // Append new data to buffer
    this.buffers.set(clientId, this.buffers.get(clientId) + data.toString());
    let buffer = this.buffers.get(clientId);
    
    // Safety counter to prevent infinite loops
    let iterations = 0;
    const maxIterations = 100;
    
    // Process complete messages from buffer
    while (buffer.length > 0 && iterations < maxIterations) {
      iterations++;
      
      // Look for Content-Length header at the beginning of buffer
      const headerMatch = buffer.match(/^Content-Length: (\d+)\r?\n\r?\n/);
      if (!headerMatch) {
        // No valid header at the beginning, look for the next one
        const nextHeaderIndex = buffer.indexOf('Content-Length:');
        if (nextHeaderIndex > 0) {
          console.warn(`[${new Date().toISOString()}] [LSP Proxy] Discarding invalid data before next header: ${buffer.substring(0, nextHeaderIndex)}`);
          buffer = buffer.substring(nextHeaderIndex);
          continue;
        } else {
          // No more headers found, keep buffer for next data chunk
          break;
        }
      }
      
      const contentLength = parseInt(headerMatch[1]);
      const headerEndIndex = headerMatch[0].length;
      
      // Check if we have enough data for the message
      if (buffer.length < headerEndIndex + contentLength) {
        // Not enough data yet, wait for more
        break;
      }
      
      // Find the actual JSON message end by looking for the next Content-Length header
      const jsonStart = headerEndIndex;
      const nextHeaderIndex = buffer.indexOf('Content-Length:', jsonStart);
      
      let jsonContent;
      if (nextHeaderIndex !== -1 && nextHeaderIndex < jsonStart + contentLength) {
        // Next header appears before Content-Length suggests - use actual boundary
        jsonContent = buffer.substring(jsonStart, nextHeaderIndex);
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Content-Length mismatch: expected ${contentLength}, actual ${jsonContent.length}`);
      } else {
        // Use Content-Length, but validate it doesn't include extra characters
        const extractedContent = buffer.substring(jsonStart, jsonStart + contentLength);
        
        // Check if the extracted content ends with valid JSON
        // Find the last closing brace that would complete the JSON
        let lastBraceIndex = -1;
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < extractedContent.length; i++) {
          const char = extractedContent[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                lastBraceIndex = i;
              }
            }
          }
        }
        
        if (lastBraceIndex !== -1 && lastBraceIndex < extractedContent.length - 1) {
          // There's extra content after the JSON - truncate it
          jsonContent = extractedContent.substring(0, lastBraceIndex + 1);
          console.log(`[${new Date().toISOString()}] [LSP Proxy] Truncated extra content: ${extractedContent.substring(lastBraceIndex + 1)}`);
        } else {
          jsonContent = extractedContent;
        }
      }
      
      // Try to parse the JSON
      try {
        const parsed = JSON.parse(jsonContent);
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Successfully parsed message: ${parsed.method || 'response'} for client ${clientId}`);
        messages.push(parsed);
        
        // Move buffer past this message
        if (nextHeaderIndex !== -1 && nextHeaderIndex < jsonStart + contentLength) {
          buffer = buffer.substring(nextHeaderIndex);
        } else {
          buffer = buffer.substring(jsonStart + jsonContent.length);
        }
        
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Error parsing LSP JSON message for client ${clientId}:`, error);
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Message content (${jsonContent.length} chars):`, jsonContent);
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Message content hex:`, Buffer.from(jsonContent).toString('hex'));
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Buffer around error (first 200 chars):`, buffer.substring(0, 200));
        
        // Skip this message and continue
        buffer = buffer.substring(headerEndIndex + contentLength);
      }
    }
    
    // Update buffer
    this.buffers.set(clientId, buffer);
    
    if (iterations >= maxIterations) {
      console.error(`[${new Date().toISOString()}] [LSP Proxy] Hit maximum iterations (${maxIterations}) while parsing messages for client ${clientId}`);
      console.error(`[${new Date().toISOString()}] [LSP Proxy] Clearing buffer to prevent infinite loop`);
      this.buffers.set(clientId, '');
    }
    
    return messages;
  }

  handleLanguageServerMessage(clientId, message) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) return;

    // Handle server -> client requests that require immediate simple responses
    if (message.id && message.method === 'workspace/configuration') {
      // Respond with an empty configuration array so the server can proceed
      const response = {
        jsonrpc: '2.0',
        id: message.id,
        result: []
      };
      const str = JSON.stringify(response);
      connection.languageServer.stdin.write(`Content-Length: ${str.length}\r\n\r\n${str}`);
      return; // Do not forward this message to browser
    }

    if (message.id && message.method === 'client/registerCapability') {
      // Acknowledge capability registration with null result
      const response = {
        jsonrpc: '2.0',
        id: message.id,
        result: null
      };
      const str = JSON.stringify(response);
      connection.languageServer.stdin.write(`Content-Length: ${str.length}\r\n\r\n${str}`);
      return;
    }

    if (message.id && this.messageHandlers.has(message.id)) {
      // Response to a request originated by the proxy (e.g., initialize)
      const handler = this.messageHandlers.get(message.id);

      if (handler.method === 'initialize') {
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Received 'initialize' response with capabilities:`, JSON.stringify(message.result.capabilities, null, 2));
      }

      this.messageHandlers.delete(message.id);

      if (message.error) {
        handler.reject(new Error(message.error.message));
      } else {
        handler.resolve(message.result);
      }
    } else {
      // Forward EVERYTHING else (responses to client requests or notifications)
      connection.socket.emit('lsp-message', message);

      // For debugging, still handle specific notifications locally if needed
      if (message.method === 'window/logMessage') {
        console.log(`Language server log (${connection.language}):`, message.params.message);
      }
    }
  }

  // The helper below is no longer needed to emit a separate diagnostics event, but keep the logic if other code relies on it.
  handlePublishDiagnostics(clientId, params) {
    const connection = this.clientConnections.get(clientId);
    if (!connection) return;

    connection.socket.emit('lsp-message', {
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params
    });
  }

  async handleDocumentChange(clientId, params) {
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Forwarding textDocument/didChange notification for client ${clientId}`);
    await this.sendNotification(clientId, 'textDocument/didChange', params);
  }

  async handleCompletionRequest(clientId, params) {
    return await this.sendRequest(clientId, 'textDocument/completion', params);
  }

  async handleHoverRequest(clientId, params) {
    return await this.sendRequest(clientId, 'textDocument/hover', params);
  }

  async handleDiagnosticRequest(clientId, params) {
    await this.sendNotification(clientId, 'textDocument/didOpen', params);
  }
}

module.exports = LSPProxy;