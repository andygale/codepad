const { v4: uuidv4 } = require('../server/node_modules/uuid');
const LanguageServerManager = require('./languageServerManager');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

// SECURITY: Safe workspace configuration
const MAX_PATH_LENGTH = 1000;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
const MAX_FILES_PER_ROOM = 100; // Prevent DoS (per room, not per client)
const ALLOWED_EXTENSIONS = new Set(['.kt', '.java', '.js', '.ts', '.py', '.cpp', '.c', '.h']);

// Track room workspaces for cleanup and file counting
const roomWorkspaces = new Map();

/**
 * SECURITY: Validates and sanitizes file paths to prevent path traversal attacks
 * @param {string} uri - The URI from the client
 * @param {string} roomWorkspaceDir - Room workspace directory (for LS compatibility)
 * @param {string} roomId - Room ID for tracking
 * @returns {string} - Safe, validated file path within room workspace
 * @throws {Error} - If path is invalid or unsafe
 */
function validateAndSanitizePath(uri, roomWorkspaceDir, roomId) {
  try {
    // SECURITY: Check for path traversal in the raw URI BEFORE URL parsing
    // The URL constructor automatically resolves .. which bypasses security!
    if (uri.includes('..') || uri.includes('%2e%2e') || uri.includes('%2E%2E')) {
      throw new Error('Path traversal attempt detected in raw URI');
    }
    
    // Parse the URI
    const parsed = new URL(uri);
    
    // Only allow file:// protocol
    if (parsed.protocol !== 'file:') {
      throw new Error(`Invalid protocol: ${parsed.protocol}. Only file:// is allowed.`);
    }
    
    // Get the pathname and decode it
    let requestedPath = decodeURIComponent(parsed.pathname);
    
    // Remove any null bytes or other dangerous characters
    if (requestedPath.includes('\0') || requestedPath.includes('\x00')) {
      throw new Error('Null bytes not allowed in file paths');
    }
    
    // Block Windows-style path traversal attempts (even on Unix systems)
    // This includes \..\, /..\, ..\/, ..\\ and other variations
    if (requestedPath.match(/\.\.[\\\/]/) || requestedPath.match(/[\\\/]\.\.[\\\/]/) || 
        requestedPath.includes('..\\') || requestedPath.includes('\\..')||
        requestedPath.includes('../') || requestedPath.includes('/..')) {
      throw new Error('Path traversal attempt detected');
    }
    
    // Check path length
    if (requestedPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path too long: ${requestedPath.length} > ${MAX_PATH_LENGTH}`);
    }
    
    // Ensure the room workspace exists
    if (!fs.existsSync(roomWorkspaceDir)) {
      throw new Error(`Room workspace does not exist: ${roomWorkspaceDir}`);
    }
    
    // Extract just the filename from the requested path
    // For LSP, we typically just need the filename (e.g., main.java, main.kt)
    const filename = path.basename(requestedPath);
    
    // Validate filename
    if (!filename || filename === '.' || filename === '..') {
      throw new Error('Invalid or empty filename');
    }
    
    // Validate file extension
    const ext = path.extname(filename).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File extension not allowed: ${ext}. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`);
    }
    
    // Check for dangerous filenames
    const dangerousNames = ['.env', '.git', 'passwd', 'shadow', 'hosts'];
    if (dangerousNames.some(name => filename.toLowerCase().includes(name))) {
      throw new Error(`Dangerous filename detected: ${filename}`);
    }
    
    // Resolve the safe path within the room workspace
    const safePath = path.join(roomWorkspaceDir, filename);
    
    // CRITICAL: Ensure the resolved path is still within the room workspace
    if (!safePath.startsWith(roomWorkspaceDir + path.sep) && safePath !== roomWorkspaceDir) {
      throw new Error(`Path traversal attempt detected: ${filename} resolves outside room workspace`);
    }
    
    console.log(`[LSP Security] Validated path for room ${roomId}: ${requestedPath} -> ${safePath}`);
    return safePath;
    
  } catch (error) {
    console.error(`[LSP Security] Path validation failed for URI ${uri} in room ${roomId}:`, error.message);
    throw new Error(`Invalid file path: ${error.message}`);
  }
}

/**
 * SECURITY: Safe file writing with additional checks
 * @param {string} filePath - Validated file path within room workspace
 * @param {string} content - File content to write
 * @param {string} roomId - Room ID for tracking and logging
 */
function safeWriteFile(filePath, content, roomId) {
  try {
    // Additional content validation
    if (typeof content !== 'string') {
      throw new Error('File content must be a string');
    }
    
    // Check content size (prevent DoS)
    if (content.length > MAX_FILE_SIZE) {
      throw new Error(`File content too large: ${content.length} bytes > ${MAX_FILE_SIZE} bytes`);
    }
    
    // Check number of files in this room (prevent DoS)
    const roomWorkspace = path.dirname(filePath);
    if (fs.existsSync(roomWorkspace)) {
      const files = getAllFilesRecursive(roomWorkspace);
      if (files.length >= MAX_FILES_PER_ROOM) {
        throw new Error(`Too many files in room ${roomId}: ${files.length} >= ${MAX_FILES_PER_ROOM}`);
      }
    }
    
    // Ensure directory exists (the room workspace should already exist)
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
    
    // Write file with safe permissions
    fs.writeFileSync(filePath, content, { mode: 0o644, flag: 'w' });
    
    // Update room workspace tracking
    roomWorkspaces.set(roomId, Date.now());
    
    console.log(`[LSP Security] Safely wrote file for room ${roomId}: ${filePath} (${content.length} bytes)`);
    
  } catch (error) {
    console.error(`[LSP Security] Failed to write file ${filePath}:`, error.message);
    throw new Error(`Failed to write file: ${error.message}`);
  }
}

/**
 * Helper function to count files recursively
 */
function getAllFilesRecursive(dir) {
  let files = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        files = files.concat(getAllFilesRecursive(fullPath));
      } else {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors, return what we have
  }
  return files;
}

// Note: Room workspace cleanup is handled by LanguageServerManager.cleanupOldSessionDirs()

class LSPProxy {
  constructor() {
    this.languageServerManager = new LanguageServerManager();
    this.clientConnections = new Map();
    this.buffers = new Map();
    this.messageHandlers = new Map(); // requestId -> { clientId, resolve, reject }
    this.uriMappings = new Map(); // uri -> { clientId, safePath }

    
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
    }
    
    // Always initialize Kotlin project structure to ensure latest fixes are applied
    if (language === 'kotlin') {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing Kotlin project structure for room ${roomId}`);
      await this.initializeKotlinProject(roomWorkspaceDir);
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Kotlin project structure created for room ${roomId}`);
    }

    // For Kotlin, always ensure coroutines are in Gradle cache (even for reused workspaces)
    if (language === 'kotlin') {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Ensuring coroutines dependencies are available in Gradle cache for room ${roomId}`);
      await this.ensureCoroutinesInGradleCache(roomWorkspaceDir);
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Coroutines cache population completed for room ${roomId}`);
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
    const workspaceUri = `file://${roomWorkspaceDir}`;
    const sessionWorkspaceDir = roomWorkspaceDir; // For compatibility with existing code

    // Store client connection (include sessionWorkspaceDir and roomId for later use)
    this.clientConnections.set(clientId, {
      socket,
      languageServer,
      language,
      roomId,
      pendingRequests: new Map(),
      sessionWorkspaceDir,
      workspaceUri
    });


    // Set up message handlers
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Setting up message handlers for client ${clientId}`);
    this.setupClientMessageHandlers(clientId, documentUri);
    this.setupLanguageServerMessageHandlers(clientId);

    // Send initialize message to language server
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Initializing language server for client ${clientId}`);
    await this.initializeLanguageServer(clientId);

    // For Kotlin, always force a project import to ensure dependencies are resolved
    if (language === 'kotlin') {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Forcing Gradle project import for workspace: ${workspaceUri}`);
      try {
        await this.sendRequest(clientId, 'workspace/executeCommand', {
          command: 'java.project.import', // Command supported by JDT-based servers
          arguments: [workspaceUri]
        });
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Gradle project import command sent successfully.`);
        
        // Give Kotlin LS time to process the Gradle project and index dependencies
        const delayMs = 3000; // 3 seconds should be sufficient for basic indexing
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Waiting ${delayMs}ms for Kotlin LS to process Gradle project...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Kotlin LS initialization delay completed`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Failed to execute project import command:`, error);
        // Even if project import fails, give some time for basic Kotlin stdlib indexing
        const fallbackDelay = 2000;
        console.log(`[${new Date().toISOString()}] [LSP Proxy] Using fallback delay of ${fallbackDelay}ms for Kotlin LS indexing`);
        await new Promise(resolve => setTimeout(resolve, fallbackDelay));
      }
    }

    // Handle client disconnect
    socket.on('disconnect', () => {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] LSP client disconnected: ${clientId}`);
      this.clientConnections.delete(clientId);
      this.buffers.delete(clientId); // Clean up message buffer
      this.uriMappings.delete(documentUri); // Clean up URI mapping
      
      // Note: Room workspace cleanup is handled by the existing LanguageServerManager
      
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
    kotlin("jvm") version "2.1.0"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
}

// Force Gradle to download dependencies
configurations.all {
    resolutionStrategy.cacheChangingModulesFor(0, "seconds")
    resolutionStrategy.cacheDynamicVersionsFor(0, "seconds")
}`;

    const buildGradlePath = path.join(projectDir, 'build.gradle.kts');
    // Always write the build.gradle.kts file to ensure latest fixes are applied
    fs.writeFileSync(buildGradlePath, buildGradleContent);

    // Create gradle.properties to help with dependency resolution
    const gradlePropsPath = path.join(projectDir, 'gradle.properties');
    const gradlePropsContent = `
# Enable Gradle daemon for faster builds
org.gradle.daemon=true
# Enable parallel execution
org.gradle.parallel=true
# Enable configuration cache
org.gradle.configuration-cache=true
# Use Kotlin incremental compilation
kotlin.incremental=true
`;
    // Always write the gradle.properties file to ensure latest configuration
    fs.writeFileSync(gradlePropsPath, gradlePropsContent);

    // Pre-download coroutines JAR to Gradle cache to ensure it's available
    await this.ensureCoroutinesInGradleCache(projectDir);

    // Create main.kt directly in project root
    const mainKtPath = path.join(projectDir, 'main.kt');
    if (!fs.existsSync(mainKtPath)) {
      const mainKtContent = `fun main() {
    println("Hello, Kotlin!")
}`;
      fs.writeFileSync(mainKtPath, mainKtContent);
    }
    
    console.log(`[${new Date().toISOString()}] [LSP Proxy] Minimal Kotlin project created with direct JAR references`);
  }

  async ensureCoroutinesInGradleCache(projectDir) {
    try {
      console.log(`[${new Date().toISOString()}] [LSP Proxy] Pre-downloading coroutines to Gradle cache`);
      const homeDir = require('os').homedir();
      const gradleCacheDir = path.join(homeDir, '.gradle', 'caches', 'modules-2', 'files-2.1', 'org.jetbrains.kotlinx');
      
      // Ensure coroutines core is cached (JVM support is included in the main artifact)
      const coroutinesVariants = [
        'kotlinx-coroutines-core/1.10.2/kotlinx-coroutines-core-1.10.2.jar'
      ];
      
      for (const variant of coroutinesVariants) {
        const [artifactName, version, jarName] = variant.split('/');
        const cacheDir = path.join(gradleCacheDir, artifactName, version);
        const cachedJarPath = path.join(cacheDir, jarName);
        
        if (!fs.existsSync(cachedJarPath)) {
          console.log(`[${new Date().toISOString()}] [LSP Proxy] Downloading ${variant} to Gradle cache`);
          
          // Create cache directory structure
          if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
          }
          
          // Download from Maven Central
          const axios = (await import('../server/node_modules/axios/index.js')).default;
          const mavenUrl = `https://repo1.maven.org/maven2/org/jetbrains/kotlinx/${artifactName}/${version}/${jarName}`;
          
          try {
            const response = await axios({ method: 'get', url: mavenUrl, responseType: 'stream' });
            await new Promise((resolve, reject) => {
              const writer = fs.createWriteStream(cachedJarPath);
              response.data.pipe(writer);
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
            console.log(`[${new Date().toISOString()}] [LSP Proxy] Downloaded ${variant} to Gradle cache`);
          } catch (downloadError) {
            console.warn(`[${new Date().toISOString()}] [LSP Proxy] Failed to download ${variant}:`, downloadError.message);
          }
        }
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [LSP Proxy] Error ensuring coroutines in Gradle cache:`, error);
    }
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
          
          // SECURITY FIX: Validate and sanitize the file path
          const uri = message.params.textDocument.uri;
          const fileContent = message.params.textDocument.text;
          
          try {
            // Get room workspace from connection
            const connection = this.clientConnections.get(clientId);
            if (!connection) {
              throw new Error('Client connection not found');
            }
            
            const roomWorkspaceDir = connection.sessionWorkspaceDir;
            const roomId = connection.roomId;
            
            const safePath = validateAndSanitizePath(uri, roomWorkspaceDir, roomId);
            safeWriteFile(safePath, fileContent, roomId);
            
            // Update the message with the safe path for the language server
            message.params.textDocument.uri = `file://${safePath}`;
            this.uriMappings.set(uri, { clientId, safePath });
            
          } catch (securityError) {
            console.error(`[LSP Security] Blocked unsafe file operation:`, securityError.message);
            socket.emit('lsp-error', { 
              error: `Security violation: ${securityError.message}`,
              type: 'security_error'
            });
            return; // Don't forward the message to language server
          }
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
        // SECURITY FIX: Validate and sanitize the file path
        try {
          // Get room workspace from connection
          const connection = this.clientConnections.get(clientId);
          if (!connection) {
            throw new Error('Client connection not found');
          }
          
          const roomWorkspaceDir = connection.sessionWorkspaceDir;
          const roomId = connection.roomId;
          
          const safePath = validateAndSanitizePath(documentUri, roomWorkspaceDir, roomId);
          safeWriteFile(safePath, params.textDocument.text, roomId);
          
          // Update params with safe path for diagnostic request
          const updatedParams = {
            ...params,
            textDocument: {
              ...params.textDocument,
              uri: `file://${safePath}`
            }
          };
          
          await this.handleDiagnosticRequest(clientId, updatedParams);
          
        } catch (securityError) {
          console.error(`[LSP Security] Blocked unsafe diagnostic operation:`, securityError.message);
          socket.emit('lsp-error', { 
            error: `Security violation in diagnostics: ${securityError.message}`,
            type: 'security_error'
          });
        }
        
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP Proxy] Error handling diagnostic request for client ${clientId}:`, error);
        socket.emit('lsp-error', { error: error.message });
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
      const initResult = await this.sendRequest(clientId, 'initialize', initializeParams);

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