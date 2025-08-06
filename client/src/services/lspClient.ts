import { LSPTransport } from './LSPTransport';

// Use 'any' for monaco types to avoid dependency/version conflicts
export class LSPClient {
  private transport: LSPTransport;
  private editor: any;
  private language: string;
  private roomId: string;
  private onConnected: () => void;
  private onDisconnected: () => void;
  private monaco: any;

  private documentVersion: number = 0;
  private disposables: any[] = [];
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  
  private workspaceDir: string = '';
  private projectDir: string = '';
  private hasOpenedDocument: boolean = false;
  private needsDidOpen: boolean = false;

  constructor(
    transport: LSPTransport,
    editor: any,
    language: string,
    roomId: string,
    onConnected: () => void,
    onDisconnected: () => void,
    monacoInstance: any
  ) {
    this.transport = transport;
    this.editor = editor;
    this.language = language;
    this.roomId = roomId;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
    this.monaco = monacoInstance;
    console.log(`[${new Date().toISOString()}] [LSP Client] Created LSP client for ${this.language}`);
  }

  private getDocumentUri(): string {
    const extMap: Record<string, string> = { kotlin: 'kt', java: 'java', python: 'py' };
    const ext = extMap[this.language] || 'txt';
    const fileName = this.language === 'java' ? 'Main.java' : `${this.roomId}.${ext}`;

    // Use projectDir for Java, Kotlin, and Python when available
    if ((this.language === 'java' || this.language === 'kotlin' || this.language === 'python') && this.projectDir) {
      return `file://${this.projectDir}/src/${fileName}`;
    }
    
    // Fallback for other languages or before workspace is configured
    return `file:///workspace/${fileName}`;
  }

  public connect(): void {
    if (this.isConnected || this.connectionPromise) {
      return;
    }

    this.connectionPromise = (async () => {
      console.log(`[${new Date().toISOString()}] [LSP Client] Connecting via WebSocket transport for ${this.language}`);
      await this.transport.ready;

      this.transport.onNotification((msg) => this.handleServerMessage(msg));

      const initializeParams = {
        processId: null,
        rootUri: null,
        workspaceFolders: null,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: false
            },
            completion: {
              dynamicRegistration: false,
              completionItem: {
                snippetSupport: false
              }
            },
            hover: {
              dynamicRegistration: false
            },
            signatureHelp: {
              dynamicRegistration: false
            },
            references: {
              dynamicRegistration: false
            },
            documentHighlight: {
              dynamicRegistration: false
            },
            documentSymbol: {
              dynamicRegistration: false
            },
            formatting: {
              dynamicRegistration: false
            },
            rangeFormatting: {
              dynamicRegistration: false
            },
            onTypeFormatting: {
              dynamicRegistration: false
            },
            definition: {
              dynamicRegistration: false
            },
            codeAction: {
              dynamicRegistration: false
            },
            codeLens: {
              dynamicRegistration: false
            },
            rename: {
              dynamicRegistration: false
            }
          },
          workspace: {
            applyEdit: false,
            workspaceEdit: {
              documentChanges: false
            },
            didChangeConfiguration: {
              dynamicRegistration: false
            },
            didChangeWatchedFiles: {
              dynamicRegistration: false
            },
            symbol: {
              dynamicRegistration: false
            },
            executeCommand: {
              dynamicRegistration: false
            }
          }
        },
      };
      await this.transport.sendRequest('initialize', initializeParams);
      this.transport.sendNotification('initialized', {});

      this.registerProviders();
      this.isConnected = true;
      this.onConnected();

      // Check if we have a deferred didOpen from workspace config (Java)
      if (this.needsDidOpen && !this.hasOpenedDocument) {
        this.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: this.getDocumentUri(),
            languageId: this.language,
            version: 1,
            text: this.editor.getValue(),
          },
        });
        console.log(`[${new Date().toISOString()}] [LSP Client] Sent deferred didOpen with URI: ${this.getDocumentUri()}`);
        this.hasOpenedDocument = true;
        this.needsDidOpen = false;
      }
      // For Java, we wait for workspace configuration before sending didOpen
      // For other languages, send didOpen immediately
      else if (this.language !== 'java') {
        this.transport.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: this.getDocumentUri(),
            languageId: this.language,
            version: 1,
            text: this.editor.getValue(),
          },
        });
        console.log(`[${new Date().toISOString()}] [LSP Client] Sent didOpen for ${this.language} with URI: ${this.getDocumentUri()}`);
        this.hasOpenedDocument = true;
      } else {
        console.log(`[${new Date().toISOString()}] [LSP Client] Java detected - waiting for workspace config before opening document`);
      }
    })();
  }
  
  public disconnect(): void {
    if (this.isConnected) {
      this.sendNotification('textDocument/didClose', {
        textDocument: { uri: this.getDocumentUri() }
      });
    }
    this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'lsp', []);
    this.disposables.forEach(d => d.dispose());
    this.transport.close();
    this.disposables = [];
    this.isConnected = false;
    this.connectionPromise = null;
    this.hasOpenedDocument = false;
    this.needsDidOpen = false;
    this.onDisconnected();
    console.log(`[${new Date().toISOString()}] [LSP Client] Disconnected and cleaned up`);
  }

  private handleServerMessage(message: any): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params;
      const IGNORE_PATTERNS: RegExp[] = [ /must be defined in its own file/i ];
      const filtered = (params.diagnostics || []).filter((d: any) => !IGNORE_PATTERNS.some(re => re.test(d.message)));
      const markers = filtered.map((d: any) => ({
        severity: this.getMarkerSeverity(d.severity),
        startLineNumber: d.range.start.line + 1,
        startColumn: d.range.start.character + 1,
        endLineNumber: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        message: d.message,
        source: 'lsp'
      }));
      this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'lsp', markers);
    } else if (message.method === 'workspace/didChangeConfiguration') {
      if (message.params?.settings?.workspaceDir && message.params?.settings?.projectDir) {
        this.workspaceDir = message.params.settings.workspaceDir;
        this.projectDir = message.params.settings.projectDir;
        console.log(`[${new Date().toISOString()}] [LSP Client] Received workspace config: ${this.projectDir}`);
        
        // Send didOpen for Java, Kotlin, and Python if we haven't already sent it and we're connected
        if ((this.language === 'java' || this.language === 'kotlin' || this.language === 'python') && !this.hasOpenedDocument) {
          if (this.isConnected) {
            this.sendNotification('textDocument/didOpen', {
              textDocument: {
                uri: this.getDocumentUri(),
                languageId: this.language,
                version: 1,
                text: this.editor.getValue(),
              },
            });
            console.log(`[${new Date().toISOString()}] [LSP Client] Sent didOpen with URI: ${this.getDocumentUri()}`);
            this.hasOpenedDocument = true;
          } else {
            console.log(`[${new Date().toISOString()}] [LSP Client] Deferring didOpen until connection is established`);
            this.needsDidOpen = true;
          }
        }
      }
    } else if (message.method === 'window/logMessage') {
      // Optional: log server messages if needed for debugging
    }
  }

  private registerProviders(): void {
    this.disposables.push(this.editor.onDidChangeModelContent((e: any) => this.handleDocumentChange(e)));

    this.disposables.push(this.monaco.languages.registerCompletionItemProvider(this.language, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model: any, position: any) => {
        return this.sendRequest('textDocument/completion', {
          textDocument: { uri: this.getDocumentUri() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).then((result: any) => ({ suggestions: (result.items || result || []).map((item: any) => this.toMonacoCompletionItem(item)) }));
      },
      resolveCompletionItem: (item: any) => {
        if (this.language === 'kotlin') return item;
        return this.sendRequest('completionItem/resolve', item).then((resolved: any) => this.toMonacoCompletionItem({ ...item, ...resolved }));
      }
    }));

    this.disposables.push(this.monaco.languages.registerHoverProvider(this.language, {
      provideHover: (model: any, position: any) => {
        return this.sendRequest('textDocument/hover', {
          textDocument: { uri: this.getDocumentUri() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        }).then((result: any) => {
          if (!result?.contents) return { contents: [] };
          const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
          return { contents: contents.map((c: any) => (typeof c === 'string' ? { value: c } : { value: c.value || c })) };
        });
      }
    }));
  }

  private handleDocumentChange(event: any): void {
    this.documentVersion++;
    const contentChanges = event.changes.map((c: any) => ({
      range: {
        start: { line: c.range.startLineNumber - 1, character: c.range.startColumn - 1 },
        end:   { line: c.range.endLineNumber - 1, character: c.range.endColumn - 1 }
      },
      text: c.text
    }));
    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: this.getDocumentUri(),
        version: this.documentVersion
      },
      contentChanges
    });
  }

  private sendRequest(method: string, params: any): Promise<any> {
    return this.transport.sendRequest(method, params);
  }

  private sendNotification(method: string, params: any): void {
    if (!this.isConnected) {
      console.warn(`[LSP Client] Cannot send notification ${method}, not connected.`);
      return;
    }
    console.log(`[${new Date().toISOString()}] [LSP Client] Sending notification: ${method}`, params);
    this.transport.sendNotification(method, params);
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

  private toMonacoCompletionItem(item: any): any {
    // Mapping from LSP CompletionItemKind to Monaco's enum
    const kindMap: { [key: number]: number } = {
      1: this.monaco.languages.CompletionItemKind.Text, 2: this.monaco.languages.CompletionItemKind.Method,
      3: this.monaco.languages.CompletionItemKind.Function, 4: this.monaco.languages.CompletionItemKind.Constructor,
      5: this.monaco.languages.CompletionItemKind.Field, 6: this.monaco.languages.CompletionItemKind.Variable,
      7: this.monaco.languages.CompletionItemKind.Class, 8: this.monaco.languages.CompletionItemKind.Interface,
      9: this.monaco.languages.CompletionItemKind.Module, 10: this.monaco.languages.CompletionItemKind.Property,
      11: this.monaco.languages.CompletionItemKind.Unit, 12: this.monaco.languages.CompletionItemKind.Value,
      13: this.monaco.languages.CompletionItemKind.Enum, 14: this.monaco.languages.CompletionItemKind.Keyword,
      15: this.monaco.languages.CompletionItemKind.Snippet, 16: this.monaco.languages.CompletionItemKind.Color,
      17: this.monaco.languages.CompletionItemKind.File, 18: this.monaco.languages.CompletionItemKind.Reference,
      19: this.monaco.languages.CompletionItemKind.Folder, 20: this.monaco.languages.CompletionItemKind.EnumMember,
      21: this.monaco.languages.CompletionItemKind.Constant, 22: this.monaco.languages.CompletionItemKind.Struct,
      23: this.monaco.languages.CompletionItemKind.Event, 24: this.monaco.languages.CompletionItemKind.Operator,
      25: this.monaco.languages.CompletionItemKind.TypeParameter
    };
    return {
      label: item.label,
      insertText: item.insertText || item.label,
      kind: kindMap[item.kind] || this.monaco.languages.CompletionItemKind.Text,
      detail: item.detail,
      documentation: item.documentation,
      range: undefined // Let monaco handle this
    };
  }
}
