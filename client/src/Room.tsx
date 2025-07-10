import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import MonacoEditor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';
import './App.css'; // Reusing styles for now
import PlaybackModal from './PlaybackModal';
import Split from 'react-split';
import { LSPClient } from './services/lspClient';

const API_URL = process.env.REACT_APP_API_URL || '';

const languages = [
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'Java', value: 'java' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Python', value: 'python' },
  { label: 'Swift', value: 'swift' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'TypeScript Fast (Deno)', value: 'deno' },
];

type ServerEvents = {
  codeUpdate: (data: { code: string; changeInfo?: any }) => void;
  codeDelta: (data: { operations: any[] }) => void;
  languageUpdate: (data: { language: string; code?: string }) => void;
  runOutput: (data: { output: string }) => void;
  remoteCursorChange: (data: { position: any; socketId: string }) => void;
  remoteSelectionChange: (data: { selection: any; socketId:string }) => void;
  userList: (data: { users: {id: string, name: string}[] }) => void;
  outputHistory: (data: { outputHistory: { timestamp: string; output: string }[] }) => void;
  room_error: (data: { message: string }) => void;
  room_details: (data: { title: string; createdAt: string }) => void;
};

type ClientEvents = {
  codeUpdate: (data: { code: string; room: string; changeInfo?: any }) => void;
  codeDelta: (data: { operations: any[]; room: string; codeSnapshot: string }) => void;
  saveCode: (data: { room: string; code: string }) => void;
  languageUpdate: (data: { language: string; code?: string; room: string }) => void;
  joinRoom: (data: { roomId: string; user: { id: string, name: string } }) => void;
  runOutput: (data: { output: string; room: string; execTimeMs?: number }) => void;
  clearOutput: (data: { room: string }) => void;
  cursorChange: (data: { room: string; position: any }) => void;
  selectionChange: (data: { room: string; selection: any }) => void;
};

function Room() {
  const { roomId } = useParams();
  const { user, isAuthenticated } = useAuth();
  const [roomStatus, setRoomStatus] = useState<'loading' | 'found' | 'not_found'>('loading');
  const [roomTitle, setRoomTitle] = useState('');
  const [roomCreatedAt, setRoomCreatedAt] = useState('');
  const [language, setLanguage] = useState('deno');
  const [code, setCode] = useState(`class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`);
  const [outputBlocks, setOutputBlocks] = useState<{ timestamp: string; output: string; execTimeMs?: number }[]>([]);
  const [users, setUsers] = useState<{id: string, name: string}[]>([]);
  const [name, setName] = useState('');
  const [namePrompt, setNamePrompt] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsCollectionRef = useRef<any>(null);
  const [remoteSelections, setRemoteSelections] = useState<Record<string, { selection: any, name: string }>>({});
  const remoteCursorActivity = useRef<Record<string, number>>({});
  const [visibleCursorLabels, setVisibleCursorLabels] = useState<Record<string, boolean>>({});
  // Control whether execution output should wrap long lines
  const [wrapOutput, setWrapOutput] = useState(true);
  const isRemoteUpdate = useRef(false);
  const isLocalLanguageUpdate = useRef(false);
  const [lspStatus, setLspStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');

  const lspClientRef = useRef<LSPClient | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevLanguage = useRef(language);
  const [copyMsg, setCopyMsg] = useState('');
  const [iframeHtml, setIframeHtml] = useState('');
  const [showPlayback, setShowPlayback] = useState(false);

  // Refs to access current values in socket event handlers without causing re-renders
  const languageRef = useRef(language);
  const usersRef = useRef(users);

  // Update refs when state changes
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const languageExamples: Record<string, string> = {
    javascript: `console.log('Hello, world!');\nconsole.log('Running Node.js version:', process.version);`,
    typescript: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n    // TypeScript compiles to JavaScript and runs on Node.js\n    console.log('Running Node.js version:', (globalThis as any).process?.version || 'unknown');\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    deno: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n    console.log('Running Deno version:', Deno.version.deno);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    python: `import sys\n\nclass Greeter:\n    def __init__(self, message):\n        self.message = message\n    def greet(self):\n        print(self.message)\n        print(f'Running Python {sys.version}')\n\ngreeter = Greeter('Hello, world!')\ngreeter.greet()`,
    cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    std::cout << "Running C++ with GCC " << __GNUC__ << "." << __GNUC_MINOR__ << "." << __GNUC_PATCHLEVEL__ << std::endl;\n    return 0;\n}`,
    java: `public class Greeter {\n    private String message;\n    public Greeter(String message) {\n        this.message = message;\n    }\n    public void greet() {\n        System.out.println(message);\n        System.out.println("Running Java version: " + System.getProperty("java.version"));\n    }\n    public static void main(String[] args) {\n        Greeter greeter = new Greeter("Hello, world!");\n        greeter.greet();\n    }\n}`,
    html: `<!DOCTYPE html>\n<html>\n<head>\n  <title>Web Example</title>\n  <style>\n    body { font-family: sans-serif; background: #f9f9f9; color: #222; }\n    .greeting { color: #007acc; font-size: 2em; margin-top: 2em; }\n  </style>\n</head>\n<body>\n  <div class="greeting">Hello, world!</div>\n  <script>\n    document.querySelector('.greeting').textContent += ' (from JavaScript!)';\n  </script>\n</body>\n</html>`,
    swift: `func greet(name: String) {\n    print("Hello, \\(name)!")\n    \n    #if swift(>=5.3)\n    print("Running Swift 5.3 or later")\n    #elseif swift(>=5.0)\n    print("Running Swift 5.0-5.2")\n    #else\n    print("Running Swift < 5.0")\n    #endif\n}\n\ngreet(name: "world")`,
    kotlin: `fun main() {\n    println("Hello, world!")\n    println("Running Kotlin \${kotlin.KotlinVersion.CURRENT}")\n}`
  };

  const getUserColor = useCallback((userId: string) => {
      const userColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F7D842', '#8A2BE2', '#FF8C00', '#00CED1'];
      let hash = 0;
      for (let i = 0; i < userId.length; i++) {
          hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      }
      const index = Math.abs(hash % userColors.length);
      return userColors[index];
  }, []);

  

  

  // Set name automatically for authenticated users
  useEffect(() => {
    if (isAuthenticated && user) {
      // Extract first name from full name
      const firstName = user.name.split(' ')[0];
      setName(firstName);
      setNamePrompt(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const checkRoomExists = async () => {
      if (!roomId) {
        setRoomStatus('not_found');
        return;
      }
      try {
        await axios.get(`${API_URL}/api/rooms/${roomId}`);
        setRoomStatus('found');
      } catch (error) {
        setRoomStatus('not_found');
      }
    };
    checkRoomExists();
  }, [roomId]);

  useEffect(() => {
    // Only establish connection after the user has submitted their name
    if (namePrompt || !roomId || !name) {
      return;
    }
    
    const socket = io({
      transports: ['websocket'],
    });
    socketRef.current = socket;
    socket.emit('joinRoom', { roomId, user: { id: socket.id, name } });

    socket.on('connect', () => {
      console.log('Connected to backend Socket.IO server');
      // Re-join room with new socket ID on reconnection
      socket.emit('joinRoom', { roomId, user: { id: socket.id, name } });
    });

    socket.on('room_error', ({ message }) => {
      console.error(`Room Error: ${message}`);
      setRoomStatus('not_found');
    });

    socket.on('room_details', ({ title, createdAt }) => {
      setRoomTitle(title);
      setRoomCreatedAt(createdAt);
    });

    socket.on('codeUpdate', ({ code }) => {
      if (editorRef.current && editorRef.current.getValue() !== code) {
        isRemoteUpdate.current = true;
        editorRef.current.setValue(code);
        isRemoteUpdate.current = false;
      }
    });
    
    socket.on('codeDelta', ({ operations }) => {
      if (!editorRef.current) return;
      isRemoteUpdate.current = true;
      editorRef.current.executeEdits('remote-delta', operations);
      isRemoteUpdate.current = false;
    });

    socket.on('languageUpdate', ({ language, code: newCode }) => {
      // Ignore language updates that we triggered ourselves
      if (isLocalLanguageUpdate.current) {
        console.log('Ignoring languageUpdate - was triggered locally');
        isLocalLanguageUpdate.current = false;
        return;
      }
      
      console.log('Applying remote languageUpdate:', language);
      // Reset the flag since this is a genuine remote update
      isLocalLanguageUpdate.current = false;
      setCode(newCode || '');
      setLanguage(language);
      prevLanguage.current = language;
    });
    socket.on('outputHistory', ({ outputHistory }) => {
      setOutputBlocks(outputHistory);
      if (languageRef.current === 'html' && outputHistory.length > 0) {
        setIframeHtml(outputHistory[outputHistory.length - 1].output);
      }
    });
    socket.on('userList', ({ users }) => {
      setUsers(users);
      setRemoteSelections(prev => {
        const next = { ...prev };
        const userIds = users.map((u: { id: string }) => u.id);
        Object.keys(next).forEach(id => {
          if (!userIds.includes(id)) {
            delete next[id];
          }
        });
        return next;
      });
    });

    socket.on('remoteCursorChange', ({ position, socketId }) => {
      if (!monacoRef.current) return;
      remoteCursorActivity.current[socketId] = Date.now();
      
      // Update cursor position immediately without waiting for user list update
      setRemoteSelections(prev => {
        const user = usersRef.current.find(u => u.id === socketId);
        return {
          ...prev,
          [socketId]: {
            selection: new monacoRef.current.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            name: user?.name || 'Anonymous'
          },
        };
      });
    });

    socket.on('remoteSelectionChange', ({ selection, socketId }) => {
      if (!monacoRef.current) return;
      remoteCursorActivity.current[socketId] = Date.now();
      
      // Update selection immediately without waiting for user list update
      setRemoteSelections(prev => {
        const user = usersRef.current.find(u => u.id === socketId);
        return {
          ...prev,
          [socketId]: {
            selection: new monacoRef.current.Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn),
            name: user?.name || 'Anonymous'
          },
        };
      });
    });

    return () => {
      socket.disconnect();
      // Clean up debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [roomId, name, namePrompt]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setVisibleCursorLabels(prevVisible => {
        const newVisible: Record<string, boolean> = {};
        let changed = false;
        
        for (const socketId in remoteCursorActivity.current) {
          if (!Object.prototype.hasOwnProperty.call(remoteCursorActivity.current, socketId)) continue;
          
          const lastActivity = remoteCursorActivity.current[socketId];
          const shouldBeVisible = (now - lastActivity) < 2000;

          if (!!prevVisible[socketId] !== shouldBeVisible) {
            changed = true;
          }
          newVisible[socketId] = shouldBeVisible;
        }
        
        return changed ? newVisible : prevVisible;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [language, users]); 

  const initializeLSP = useCallback(() => {
        if (!editorRef.current || !socketRef.current || !roomId || !editorReady) {
            console.log(`[Room] Missing requirements - editor: ${!!editorRef.current}, socket: ${!!socketRef.current}, roomId: ${roomId}, editorReady: ${editorReady}`);
            return;
        }

        const supportedLanguages = ['kotlin', 'java', 'python'];
        if (!supportedLanguages.includes(language)) {
            console.log(`[Room] Language ${language} not supported for LSP.`);
            if (lspClientRef.current) {
                lspClientRef.current.disconnect();
                lspClientRef.current = null;
            }
            return;
        }

        console.log(`[Room] Starting LSP initialization for ${language}`);

        // Disconnect previous client if it exists
        if (lspClientRef.current) {
            lspClientRef.current.disconnect();
        }

        // Create new LSP client
        console.log(`[Room] Creating new LSP client for ${language}`);
        lspClientRef.current = new LSPClient(
            socketRef.current,
            editorRef.current,
            language,
            roomId,
            () => {
              console.log('[Room] LSP Connected');
              setLspStatus('connected');
            },
            () => {
              console.log('[Room] LSP Disconnected');
              setLspStatus('disconnected');
            },
            monacoRef.current
        );

        // Connect to LSP server with retry logic
        const connectWithRetry = async (retries: number) => {
            try {
                setLspStatus('connecting');
                await lspClientRef.current?.connect();
            } catch (error) {
                console.error(`[Room] LSP connection failed:`, error);
                if (retries > 0) {
                    console.log(`[Room] Retrying LSP connection... (${retries} retries left)`);
                    setTimeout(() => connectWithRetry(retries - 1), 5000);
                } else {
                    console.error('[Room] LSP connection failed after multiple retries.');
                    setLspStatus('error');
                }
            }
        };

        connectWithRetry(3);

    }, [language, roomId, editorReady]);

  useEffect(() => {
    console.log(`[Room] useEffect triggered for LSP initialization - language: ${language}, roomId: ${roomId}, editor: ${!!editorRef.current}, socket: ${!!socketRef.current}`);
    
    initializeLSP();

    return () => {
      if (lspClientRef.current) {
        lspClientRef.current.disconnect();
        lspClientRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializeLSP]);

  // Ensure Monaco model language matches the current language
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      try {
        monacoRef.current.editor.setModelLanguage(editorRef.current.getModel(), language);
      } catch (err) {
        console.error('Failed to set Monaco model language:', err);
      }
    }
  }, [language]);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    
    // For now, let's use a simple approach: just use the new language example
    // without preserving old code to prevent accumulation
    const newCode = languageExamples[newLang] || '';
    
    console.log('Local language change:', newLang, 'using fresh example');
    isLocalLanguageUpdate.current = true;
    
    // Reset the flag after a longer delay to account for server debouncing
    // This is a safety measure in case the server response gets lost
    setTimeout(() => {
      isLocalLanguageUpdate.current = false;
    }, 2000);
    
    setCode(newCode);
    setLanguage(newLang);
    prevLanguage.current = newLang;
    if (socketRef.current && roomId) {
      socketRef.current.emit('languageUpdate', { language: newLang, code: newCode, room: roomId });
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      // Get the current code directly from the editor
      const currentCode = editorRef.current ? editorRef.current.getValue() : code;
      
      if (language === 'html') {
        setIframeHtml(currentCode);
        if (socketRef.current && roomId) {
          socketRef.current.emit('runOutput', { output: currentCode, room: roomId });
        }
        return;
      }
      const res = await axios.post('/api/execute', {
        code: currentCode,
        language,
      });
      if (socketRef.current && roomId) {
        socketRef.current.emit('runOutput', { output: res.data.output, execTimeMs: res.data.execTimeMs, room: roomId });
      }
    } catch (err: any) {
      if (socketRef.current && roomId) {
        // Extract detailed error information
        let errorOutput = 'Code execution error:\n';
        
        if (err.response?.data) {
          const errorData = err.response.data;
          errorOutput += errorData.error || 'Unknown error';
          
          // Add additional details if available
          if (errorData.pistonResponse) {
            errorOutput += '\n\nPiston API Response:';
            errorOutput += '\n' + JSON.stringify(errorData.pistonResponse, null, 2);
          }
          
          if (errorData.originalError && errorData.originalError !== errorData.error) {
            errorOutput += '\n\nOriginal Error: ' + errorData.originalError;
          }
        } else {
          errorOutput += err.message || 'Unknown error occurred';
        }
        
        socketRef.current.emit('runOutput', { output: errorOutput, room: roomId });
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleClearOutput = () => {
    if (socketRef.current && roomId) {
      socketRef.current.emit('clearOutput', { room: roomId });
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    console.log('[Room] Editor mounted successfully');
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsCollectionRef.current = editor.createDecorationsCollection();
    setEditorReady(true);

    // Main content change handler
    editor.onDidChangeModelContent((event: any) => {
      if (isRemoteUpdate.current) {
        return;
      }
      if (socketRef.current && roomId) {
        // Emit deltas for real-time sync
        socketRef.current.emit('codeDelta', { operations: event.changes, room: roomId, codeSnapshot: editorRef.current.getValue() });

        // Debounce saving the full content to the database
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
        debounceTimeoutRef.current = setTimeout(() => {
          if (editorRef.current) {
            const fullCode = editorRef.current.getValue();
            socketRef.current?.emit('saveCode', { room: roomId, code: fullCode });
          }
        }, 2000); // Save after 2 seconds of inactivity
      }
    });

    // Debounce cursor updates to reduce lag
    let cursorUpdateTimeout: NodeJS.Timeout | null = null;
    let selectionUpdateTimeout: NodeJS.Timeout | null = null;

    editor.onDidChangeCursorPosition(() => {
      if (socketRef.current && roomId) {
        if (cursorUpdateTimeout) clearTimeout(cursorUpdateTimeout);
        cursorUpdateTimeout = setTimeout(() => {
          if (socketRef.current && roomId) {
            socketRef.current.emit('cursorChange', { room: roomId, position: editor.getPosition() });
          }
        }, 50);
      }
    });

    editor.onDidChangeCursorSelection(() => {
      if (socketRef.current && roomId) {
        if (selectionUpdateTimeout) clearTimeout(selectionUpdateTimeout);
        selectionUpdateTimeout = setTimeout(() => {
          if (socketRef.current && roomId) {
            socketRef.current.emit('selectionChange', { room: roomId, selection: editor.getSelection() });
          }
        }, 50);
      }
    });
  }

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const userStyles = users.map(user => {
      const color = getUserColor(user.id);
      return `
        .remote-selection-${user.id} {
            background-color: ${color}4D;
        }
        .remote-cursor-${user.id} {
            border-left: 2px solid ${color};
            position: relative;
        }
        .remote-cursor-${user.id}:hover::after,
        .remote-cursor-${user.id}.show-label::after {
            content: '${user.name}';
            background-color: ${color};
            color: white;
            position: absolute;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 500;
            transform: translateY(-100%) translateX(-50%);
            white-space: nowrap;
            z-index: 1000;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            animation: fadeInLabel 0.2s ease-in;
            pointer-events: none;
            left: 50%;
            top: -2px;
        }
        .editor-container:hover .remote-cursor-${user.id}::after {
            opacity: 0.8;
        }
        @keyframes fadeInLabel {
            from { opacity: 0; transform: translateY(-100%) translateX(-50%) scale(0.8); }
            to { opacity: 1; transform: translateY(-100%) translateX(-50%) scale(1); }
        }
    `;
    }).join('\n');

    let styleTag = document.getElementById('remote-user-styles');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'remote-user-styles';
        document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = userStyles;

    const newDecorations = Object.entries(remoteSelections).map(([id, { selection }]) => {
        const isCursor = selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn;
        return {
            range: selection,
            options: {
                className: isCursor ? `remote-cursor-${id} ${visibleCursorLabels[id] ? 'show-label' : ''}` : `remote-selection-${id}`,
            }
        };
    });

    decorationsCollectionRef.current.set(newDecorations);

  }, [remoteSelections, users, getUserColor, visibleCursorLabels]);

  const handleCopyUrl = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Room URL copied!');
      setTimeout(() => setCopyMsg(''), 2000);
    });
  };

  if (roomStatus === 'loading') {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Loading...</h1>
        </header>
      </div>
    );
  }

  if (roomStatus === 'not_found') {
    return (
      <div className="App">
        <header className="App-header">
          <h1>404 - Room Not Found</h1>
          <p>The room you are looking for does not exist.</p>
          <Link to="/" style={{ color: '#61dafb', fontSize: '1.2em' }}>
            Go back to Home
          </Link>
        </header>
      </div>
    );
  }

  if (namePrompt) {
    return (
        <div className="App">
          <header className="App-header">
            <h1>Enter your name to join the room</h1>
            <form onSubmit={e => { e.preventDefault(); if (name.trim()) setNamePrompt(false); }}>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                style={{ fontSize: 18, padding: 8 }}
                autoFocus
              />
              <button type="submit" className="room-button">
                Join
              </button>
            </form>
          </header>
        </div>
      );
  }

  return (
    <div className="App">
      <header className="App-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '1rem 2rem', boxSizing: 'border-box', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {isAuthenticated && (
              <Link to="/" style={{ color: '#61dafb', textDecoration: 'none', fontSize: '1em' }}>
                Home
              </Link>
            )}
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5em' }}>{roomTitle}</h1>
              <p style={{ margin: 0, fontSize: '0.8em', color: '#aaa' }}>
                Created: {roomCreatedAt ? new Date(roomCreatedAt).toLocaleString() : '...'}
              </p>
            </div>
            <button className="room-button" onClick={handleCopyUrl}>
              Copy Room URL
            </button>
            {isAuthenticated && (
              <button className="room-button" onClick={() => setShowPlayback(true)}>
                Playback
              </button>
            )}
            {copyMsg && <span style={{ color: '#0f0' }}>{copyMsg}</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <select
                value={language}
                onChange={handleLanguageChange}
                style={{ fontSize: 16, padding: 4 }}
              >
                {languages.map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
              {(['kotlin', 'java', 'python'].includes(language)) && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  fontSize: '12px',
                  color: lspStatus === 'connected' ? '#4CAF50' : (lspStatus === 'connecting' ? '#FF9800' : '#FF5722')
                }}>
                  <div style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: lspStatus === 'connected' ? '#4CAF50' : (lspStatus === 'connecting' ? '#FF9800' : '#FF5722')
                  }} />
                  IntelliSense {lspStatus === 'connected' ? 'On' : (lspStatus === 'connecting' ? 'Loading...' : 'Failed')}
                </div>
              )}
            </div>
            <button 
              onClick={handleRun} 
              disabled={isRunning} 
              className="room-button"
            >
              {isRunning ? 'Running...' : 'Run'}
            </button>
            
            {isAuthenticated && user ? (
              <div className="user-info">
                <img src={user.picture} alt={user.name} className="user-avatar" />
                <span className="user-name">{user.name}</span>
              </div>
            ) : (
              <span className="user-name">Guest</span>
            )}
          </div>
        </div>

        <div className="main-content">
          <Split
            className="split"
            sizes={[66, 34]}
            minSize={200}
            gutterSize={8}
            snapOffset={0}
          >
            <div className="editor-container">
              <div style={{ marginBottom: 12, textAlign: 'left', color: '#aaa', fontSize: 14 }}>
                <strong>Users in room:</strong> {users.map((u: { id: string, name: string }) => u.name).join(', ')}
              </div>
              <MonacoEditor
                height="100%"
                language={language === 'deno' ? 'typescript' : language}
                theme="vs-dark"
                value={code}
                onMount={handleEditorDidMount}
                options={{ minimap: { enabled: false } }}
              />
            </div>
            <div className="output-container">
              <div className="output-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <h2 style={{ margin: 0 }}>Output</h2>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.9em' }}>
                  <input
                    type="checkbox"
                    checked={wrapOutput}
                    onChange={(e) => setWrapOutput(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  Wrap lines
                </label>
                <button onClick={handleClearOutput} className="clear-button">
                  Clear
                </button>
              </div>
              {language === 'html' ? (
                <iframe
                  title="Web Output"
                  srcDoc={iframeHtml}
                  style={{ width: '100%', height: '100%', border: '1px solid #444', background: '#fff', borderRadius: 6 }}
                />
              ) : (
                <div className="output-box">
                  {outputBlocks.map((block, idx) => (
                    <div key={idx} style={{ marginBottom: 16 }}>
                      <div style={{ color: '#aaa', fontSize: 12, marginBottom: 4 }}>
                        Run at {new Date(block.timestamp).toLocaleString(undefined, { 
                          year: 'numeric', 
                          month: 'numeric', 
                          day: 'numeric', 
                          hour: 'numeric', 
                          minute: 'numeric', 
                          second: 'numeric',
                          timeZoneName: 'short'
                        })}{typeof block.execTimeMs === 'number' ? ` | Time: ${block.execTimeMs} ms` : ''}
                      </div>
                      <pre style={{ margin: 0, whiteSpace: wrapOutput ? 'pre-wrap' : 'pre', overflowX: wrapOutput ? 'auto' : 'scroll' }}>{block.output}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Split>
        </div>
      </header>
      <PlaybackModal
        roomId={roomId!}
        language={language}
        visible={showPlayback}
        onClose={() => setShowPlayback(false)}
      />
    </div>
  );
}

export default Room; 