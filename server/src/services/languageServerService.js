const LanguageServerManager = require('../../../language-servers/languageServerManager');
const LSPProxy = require('../../../language-servers/lspProxy');

class LanguageServerService {
  constructor() {
    this.lspProxy = new LSPProxy();
    console.log(`[${new Date().toISOString()}] [LSP] Language Server Service initialized`);
    this.clientConnections = new Map(); // roomId -> Map<socketId, clientInfo>
  }

  async handleSocketConnection(io, socket) {
    console.log(`[${new Date().toISOString()}] [LSP] Socket connected: ${socket.id}`);
    
    // Handle LSP connection request
    socket.on('lsp-connect', async (data) => {
      console.log(`[${new Date().toISOString()}] [LSP] Connection request from ${socket.id}:`, data);
      const { language, roomId } = data;
      
      if (!language || !roomId) {
        console.error(`[${new Date().toISOString()}] [LSP] Missing required parameters - language: ${language}, roomId: ${roomId}`);
        socket.emit('lsp-error', { error: 'Language and roomId are required' });
        return;
      }

      // Check if language is supported
      const supportedLanguages = ['kotlin', 'java'];
      if (!supportedLanguages.includes(language)) {
        console.error(`[${new Date().toISOString()}] [LSP] Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(', ')}`);
        socket.emit('lsp-error', { error: `Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(', ')}` });
        return;
      }

      try {
        console.log(`[${new Date().toISOString()}] [LSP] Starting language server for ${language} in room ${roomId}`);
        const { clientId, documentUri } = await this.lspProxy.handleClientConnection(socket, language, roomId);
        console.log(`[${new Date().toISOString()}] [LSP] Language server started successfully, clientId: ${clientId}, documentUri: ${documentUri}`);
        
        // Track client connection
        if (!this.clientConnections.has(roomId)) {
          this.clientConnections.set(roomId, new Map());
        }
        
        this.clientConnections.get(roomId).set(socket.id, {
          clientId,
          language
        });

        console.log(`[${new Date().toISOString()}] [LSP] Emitting lsp-connected event for client ${clientId}`);
        socket.emit('lsp-connected', { clientId, language, documentUri });
        
        // Handle subsequent messages for this client
        this.lspProxy.setupClientMessageHandlers(clientId, documentUri);

      } catch (error) {
        console.error(`[${new Date().toISOString()}] [LSP] Error connecting to language server for ${language}:`, error);
        console.error(`[${new Date().toISOString()}] [LSP] Error stack:`, error.stack);
        socket.emit('lsp-error', { error: `Failed to start ${language} language server: ${error.message}` });
      }
    });

    // Handle LSP disconnection
    socket.on('lsp-disconnect', async (data) => {
      const { roomId } = data;
      console.log(`[${new Date().toISOString()}] [LSP] Disconnect request from ${socket.id} for room ${roomId}`);
      await this.handleClientDisconnect(socket.id, roomId);
    });

    // Handle socket disconnection
    socket.on('disconnect', async () => {
      console.log(`[${new Date().toISOString()}] [LSP] Socket disconnected: ${socket.id}`);
      
      // Find and clean up all connections for this socket
      for (const [roomId, connections] of this.clientConnections.entries()) {
        if (connections.has(socket.id)) {
          console.log(`[${new Date().toISOString()}] [LSP] Cleaning up connection for socket ${socket.id} in room ${roomId}`);
          await this.handleClientDisconnect(socket.id, roomId);
          break;
        }
      }
    });
  }

  async handleClientDisconnect(socketId, roomId) {
    if (!this.clientConnections.has(roomId)) return;

    const roomConnections = this.clientConnections.get(roomId);
    const clientInfo = roomConnections.get(socketId);
    
    if (clientInfo) {
      roomConnections.delete(socketId);
      
      // If no more clients for this room, we could optionally shut down the language server
      if (roomConnections.size === 0) {
        this.clientConnections.delete(roomId);
        // Optionally: await this.languageServerManager.stopLanguageServer(clientInfo.language);
      }

      console.log(`[${new Date().toISOString()}] [LSP] LSP client disconnected: ${socketId} from room ${roomId}`);
    }
  }

  async initialize() {
    console.log('Language Server Service initialized');
  }

  async shutdown() {
    console.log('Shutting down language servers...');
    if (this.lspProxy && this.lspProxy.languageServerManager) {
      await this.lspProxy.languageServerManager.stopAllLanguageServers();
    }
    console.log('All language servers stopped.');
  }

  // Get status of language servers
  getStatus() {
    return {
      connectedClients: this.clientConnections.size,
      activeLanguageServers: this.languageServerManager.servers.size,
      supportedLanguages: ['kotlin', 'java']
    };
  }
}

module.exports = LanguageServerService;