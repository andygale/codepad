import { Socket } from 'socket.io-client';

// We will receive the monaco instance from the caller to ensure the same singleton
// across the whole application (avoids duplicate instances which break markers).
// Use 'any' for simplicity to avoid type mismatches between dynamic instances.
export class LSPClient {
  private socket: Socket;
  private editor: any; // monaco.editor.IStandaloneCodeEditor
  private language: string;
  private roomId: string;
  private onConnected: () => void;
  private onDisconnected: () => void;
  private monaco: any;

  private clientId: string | null = null;
  private documentUri: string = '';
  private documentVersion: number = 0;
  private disposables: any[] = [];
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(
    socket: Socket,
    editor: any,
    language: string,
    roomId: string,
    onConnected: () => void,
    onDisconnected: () => void,
    monacoInstance: any
  ) {
    this.socket = socket;
    this.editor = editor;
    this.language = language;
    this.roomId = roomId;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
    this.monaco = monacoInstance;
    console.log(`[${new Date().toISOString()}] [LSP Client] Created LSP client for ${this.language}`);
  }

  public connect(): void {
    if (this.isConnected || this.connectionPromise) {
      return;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      console.log(`[${new Date().toISOString()}] [LSP Client] Attempting to connect for ${this.language} in room ${this.roomId}`);

      this.setupSocketListeners();
      
      this.socket.emit('lsp-connect', {
        language: this.language,
        roomId: this.roomId,
      });

      // Timeout for connection
      const timeout = setTimeout(() => {
        reject(new Error(`[LSP Client] Connection timed out after 15 seconds for ${this.language}`));
      }, 15000);

      this.socket.once('lsp-connected', (data: { clientId: string; documentUri: string }) => {
        clearTimeout(timeout);
        this.clientId = data.clientId;
        this.documentUri = data.documentUri;
        this.isConnected = true;
        this.registerProviders();
        this.onConnected();

        // Clear existing LSP markers to avoid stale errors
        this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'lsp', []);

        // For Kotlin, use a longer delay to ensure the language server is fully initialized
        const delay = this.language === 'kotlin' ? 1000 : 50; // 1 second for Kotlin, 50ms for others
        console.log(`[${new Date().toISOString()}] [LSP Client] Waiting ${delay}ms before sending didOpen to ensure LS readiness`);
        
        setTimeout(() => {
          // Send didOpen notification
          this.sendNotification('textDocument/didOpen', {
            textDocument: {
              uri: this.documentUri,
              languageId: this.language,
              version: 1,
              text: this.editor.getValue(),
            },
          });
          resolve();
        }, delay);
      });

      this.socket.once('lsp-error', (error: any) => {
        clearTimeout(timeout);
        console.error(`[${new Date().toISOString()}] [LSP Client] Connection error:`, error);
        this.disconnect();
        reject(new Error(error.error || 'Failed to connect to LSP'));
      });
    });
  }
  
  public disconnect(): void {
    // Notify LSP server of document close to clear diagnostics server-side
    if (this.isConnected && this.documentUri) {
      this.sendNotification('textDocument/didClose', {
        textDocument: { uri: this.documentUri }
      });
    }
    // Clear any existing LSP markers on disconnect to remove stale errors
    this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'lsp', []);

    if (this.socket) {
      this.socket.off('lsp-connected');
      this.socket.off('lsp-error');
      this.socket.off('lsp-message');
      this.socket.off('disconnect');
    }
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.isConnected = false;
    this.connectionPromise = null;
    this.clientId = null;
    this.documentUri = '';
    this.onDisconnected();
    console.log(`[${new Date().toISOString()}] [LSP Client] Disconnected and cleaned up`);
  }

  private setupSocketListeners(): void {
    this.socket.on('lsp-message', (message: any) => {
      this.handleServerMessage(message);
    });

    this.socket.on('disconnect', () => {
      console.log(`[${new Date().toISOString()}] [LSP Client] Disconnected from server`);
      this.disconnect();
    });
  }

  private handleServerMessage(message: any): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params;
      const IGNORE_CODES = new Set([16777541]); // e.g., "public type must be defined in its own file"
      const IGNORE_PATTERNS: RegExp[] = [
        /must be defined in its own file/i,
        /Cannot find name 'fun'/i,         // Kotlin LS not ready - basic keywords missing
        /Cannot find name 'println'/i,     // Kotlin LS not ready - stdlib missing
        /Cannot find name 'val'/i,         // Kotlin LS not ready - basic keywords missing
        /Cannot find name 'var'/i,         // Kotlin LS not ready - basic keywords missing
        /Cannot find name 'class'/i,       // Kotlin LS not ready - basic keywords missing
        /Cannot find name 'import'/i       // Kotlin LS not ready - basic keywords missing
      ];

      const filtered = (params.diagnostics || []).filter((d: any) => {
        if (IGNORE_CODES.has(Number(d.code))) return false;
        if (IGNORE_PATTERNS.some((re) => re.test(d.message))) return false;
        return true;
      });

      console.log(`[${new Date().toISOString()}] [LSP Client] Received diagnostics:`, filtered);

      const markers = filtered.map((d: any) => ({
        severity: this.getMarkerSeverity(d.severity),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        source: d.source || 'lsp'
      }));
      this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'lsp', markers);
    } else if (message.method === 'window/logMessage') {
      console.log(`[${new Date().toISOString()}] [LSP Client] LSP Log:`, message.params.message);
    }
  }

  private registerProviders(): void {
    // Register on-change handler
    this.disposables.push(this.editor.onDidChangeModelContent((e: any) => this.handleDocumentChange(e)));

    // Register completion provider
    this.disposables.push(this.monaco.languages.registerCompletionItemProvider(this.language, {
      triggerCharacters: ['.', '"', "'", '/', '<', '@', '#', ' '],
      provideCompletionItems: (model: any, position: any) => {
        return this.sendRequest('textDocument/completion', {
          textDocument: { uri: this.documentUri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).then((result: any) => {
          const items = (result.items || result || []).map((item: any) => this.toMonacoCompletionItem(item));
          return { suggestions: items };
        });
      },
      resolveCompletionItem: (item: any) => {
        return this.sendRequest('completionItem/resolve', item).then((resolved: any) => {
          return this.toMonacoCompletionItem({ ...item, ...resolved });
        });
      }
    }));

    // Register hover provider
    this.disposables.push(this.monaco.languages.registerHoverProvider(this.language, {
      provideHover: (model: any, position: any) => {
        return this.sendRequest('textDocument/hover', {
          textDocument: { uri: this.documentUri },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).then((result: any) => {
          if (!result || !result.contents) return { contents: [] };
          const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
          return {
            contents: contents.map((c: any) => (typeof c === 'string' ? { value: c } : { value: c.value || c }))
          };
        });
      }
    }));
  }

  private handleDocumentChange(event: any): void {
    this.documentVersion++;
    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: this.documentUri,
        version: this.documentVersion
      },
      contentChanges: [{ text: this.editor.getValue() }]
    });
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        return reject(new Error('Not connected'));
      }
      const requestId = Math.random().toString(36).substring(2, 15);
      const message = {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params,
      };

      const responseHandler = (response: any) => {
        if (response.id === requestId) {
          this.socket.off('lsp-message', responseHandler);
          if (response.error) {
            reject(response.error);
          } else {
            resolve(response.result);
          }
        }
      };

      this.socket.on('lsp-message', responseHandler);
      this.socket.emit('lsp-message', message);
    });
  }

  private sendNotification(method: string, params: any): void {
    if (!this.isConnected) {
      console.warn(`[LSP Client] Cannot send notification, not connected.`);
      return;
    }
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.socket.emit('lsp-message', message);
  }

  private getMarkerSeverity(severity: number): any {
    switch (severity) {
      case 1: return this.monaco.MarkerSeverity.Error;
      case 2: return this.monaco.MarkerSeverity.Warning;
      case 3: return this.monaco.MarkerSeverity.Info;
      case 4: return this.monaco.MarkerSeverity.Hint;
      default: return this.monaco.MarkerSeverity.Info;
    }
  }

  // =====================
  // Helpers
  // =====================

  private toMonacoCompletionItem(item: any): any {
    const kindMap: Record<number, number> = {
      1: this.monaco.languages.CompletionItemKind.Text,
      2: this.monaco.languages.CompletionItemKind.Method,
      3: this.monaco.languages.CompletionItemKind.Function,
      4: this.monaco.languages.CompletionItemKind.Constructor,
      5: this.monaco.languages.CompletionItemKind.Field,
      6: this.monaco.languages.CompletionItemKind.Variable,
      7: this.monaco.languages.CompletionItemKind.Class,
      8: this.monaco.languages.CompletionItemKind.Interface,
      9: this.monaco.languages.CompletionItemKind.Module,
      10: this.monaco.languages.CompletionItemKind.Property,
      11: this.monaco.languages.CompletionItemKind.Unit,
      12: this.monaco.languages.CompletionItemKind.Value,
      13: this.monaco.languages.CompletionItemKind.Enum,
      14: this.monaco.languages.CompletionItemKind.Keyword,
      15: this.monaco.languages.CompletionItemKind.Snippet,
      16: this.monaco.languages.CompletionItemKind.Color,
      17: this.monaco.languages.CompletionItemKind.File,
      18: this.monaco.languages.CompletionItemKind.Reference,
      19: this.monaco.languages.CompletionItemKind.Folder,
      20: this.monaco.languages.CompletionItemKind.EnumMember,
      21: this.monaco.languages.CompletionItemKind.Constant,
      22: this.monaco.languages.CompletionItemKind.Struct,
      23: this.monaco.languages.CompletionItemKind.Event,
      24: this.monaco.languages.CompletionItemKind.Operator,
      25: this.monaco.languages.CompletionItemKind.TypeParameter,
    };

    return {
      label: item.label,
      insertText: item.insertText || item.label,
      kind: kindMap[item.kind] || this.monaco.languages.CompletionItemKind.Text,
      documentation: item.documentation ? (typeof item.documentation === 'string' ? item.documentation : item.documentation.value) : undefined,
      range: undefined, // let Monaco decide
      sortText: item.sortText,
      filterText: item.filterText,
      detail: item.detail,
    };
  }
}