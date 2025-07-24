import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import MonacoEditor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { useAuth } from './AuthContext';
import './App.css'; // Reusing styles for now
import PlaybackModal from './PlaybackModal';
import UserEvents from './UserEvents';
import Split from 'react-split';
import { LSPClient } from './services/lspClient';
import { validateCodeSize, formatBytes } from './utils/validation';

const API_URL = process.env.REACT_APP_API_URL || '';

const languages = [
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'Java', value: 'java' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Plain Text', value: 'plaintext' },
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
  room_details: (data: { title: string; createdAt: string; isPaused?: boolean; pausedAt?: string; lastActivityAt?: string }) => void;
  roomPauseStatus: (data: { isPaused: boolean }) => void;
  newUserEvent: (data: { userName: string; userId: string | null; eventType: string; eventData: any; timestamp: string }) => void;
  userEventsHistory: (data: { events: Array<{ userName: string; userId: string | null; eventType: string; eventData: any; timestamp: string }> }) => void;
};

type ClientEvents = {
  joinRoom: (data: { roomId: string; user: { id: string; name: string } }) => void;
  saveCode: (data: { room: string; code: string }) => void;
  codeDelta: (data: { operations: any[]; room: string; codeSnapshot?: string }) => void;
  languageUpdate: (data: { language: string; code: string; room: string }) => void;
  cursorChange: (data: { room: string; position: any }) => void;
  selectionChange: (data: { room: string; selection: any }) => void;
  runOutput: (data: { output: string; execTimeMs?: number; room: string }) => void;
  clearOutput: (data: { room: string }) => void;
  pauseRoom: (data: { roomId: string }) => void;
  unpauseRoom: (data: { roomId: string }) => void;
  userEvent: (data: { roomId: string; eventType: string; eventData?: any }) => void;
  getUserEvents: (data: { roomId: string }) => void;
};

function Room() {
  const { roomId } = useParams();
  const { user, isAuthenticated, loading, initializeAuth } = useAuth();
  const [roomStatus, setRoomStatus] = useState<'loading' | 'found' | 'not_found'>('loading');
  const [roomTitle, setRoomTitle] = useState('');
  const [roomCreatedAt, setRoomCreatedAt] = useState('');
  const [isPaused, setIsPaused] = useState(false);

  const [language, setLanguage] = useState('deno');
  const [code, setCode] = useState(`class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`);
  const [outputBlocks, setOutputBlocks] = useState<{ timestamp: string; output: string; execTimeMs?: number }[]>([]);
  const [users, setUsers] = useState<{id: string, name: string}[]>([]);
  const [name, setName] = useState('');
  const [namePrompt, setNamePrompt] = useState(false); // Start with false, will be set based on auth state
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
  const [lspEnabled, setLspEnabled] = useState(true);

  const lspClientRef = useRef<LSPClient | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevLanguage = useRef(language);
  const [copyMsg, setCopyMsg] = useState('');
  const [iframeHtml, setIframeHtml] = useState('');
  const [showPlayback, setShowPlayback] = useState(false);
  const [htmlRunKey, setHtmlRunKey] = useState(0); // Add this to force iframe re-render
  const [codeSizeError, setCodeSizeError] = useState<string | null>(null);
  const [codeSize, setCodeSize] = useState<number>(0);

  // User Events state
  const [activeTab, setActiveTab] = useState<'output' | 'events'>('output');
  const [userEvents, setUserEvents] = useState<Array<{ userName: string; userId: string | null; eventType: string; eventData: any; timestamp: string }>>([]);
  const [hasNewEvents, setHasNewEvents] = useState(false);
  const activeTabRef = useRef<'output' | 'events'>('output');

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

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const languageExamples: Record<string, string> = {
    javascript: `console.log('Hello, world!');\nconsole.log('Running Node.js version:', process.version);`,
    typescript: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n    // TypeScript compiles to JavaScript and runs on Node.js\n    console.log('Running Node.js version:', (globalThis as any).process?.version || 'unknown');\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    deno: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n    console.log('Running Deno version:', Deno.version.deno);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    python: `import sys\n\nclass Greeter:\n    def __init__(self, message):\n        self.message = message\n    def greet(self):\n        print(self.message)\n        print(f'Running Python {sys.version}')\n\ngreeter = Greeter('Hello, world!')\ngreeter.greet()`,
    cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    std::cout << "Running C++ with GCC " << __GNUC__ << "." << __GNUC_MINOR__ << "." << __GNUC_PATCHLEVEL__ << std::endl;\n    return 0;\n}`,
    java: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n        System.out.println("Running Java " + System.getProperty("java.version"));\n    }\n}`,
    swift: `print("Hello, world!")\nprint("Running Swift")`,
    kotlin: `fun main() {\n    println("Hello, world!")\n    println("Running Kotlin \${KotlinVersion.CURRENT}")\n}`,
    html: `<!DOCTYPE html>\n<html>\n<head>\n    <title>Hello World</title>\n</head>\n<body>\n    <h1>Hello, world!</h1>\n    <p>This is a basic HTML page.</p>\n</body>\n</html>`,
    plaintext: 'This is plain text. You can write anything here, but it cannot be executed.'
  };

  const getIsRunDisabled = () => {
    return isRunning || language === 'plaintext' || isPaused || !!codeSizeError;
  };

  // Handle authentication state and name prompt logic
  useEffect(() => {
    if (loading) {
      // Still loading auth, don't show name prompt yet
      setNamePrompt(false);
      return;
    }

    if (isAuthenticated && user) {
      // User is authenticated, set name automatically and hide prompt
      const firstName = user.name.split(' ')[0];
      setName(firstName);
      setNamePrompt(false);
    } else {
      // User is not authenticated, show name prompt for guest access
      setNamePrompt(true);
    }
  }, [loading, isAuthenticated, user]);

  // Initialize authentication when component mounts (handles direct room URLs)
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    const checkRoomExists = async () => {
      if (!roomId) {
        setRoomStatus('not_found');
        return;
      }
      try {
        const response = await axios.get(`${API_URL}/api/rooms/${roomId}`);
        

        
        setRoomStatus('found');
      } catch (error) {
        setRoomStatus('not_found');
      }
    };
    checkRoomExists();
  }, [roomId, isAuthenticated, user]);

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
      
      // If we had an LSP connection before, reinitialize it after reconnection
      if (lspClientRef.current && editorReady) {
        console.log('[Room] Socket reconnected, reinitializing LSP');
        initializeLSP();
      }
    });

    socket.on('room_error', ({ message }) => {
      console.error(`Room Error: ${message}`);
      if (message.includes('does not exist')) {
        setRoomStatus('not_found');
      }
    });

    socket.on('room_details', ({ title, createdAt, isPaused: roomIsPaused, pausedAt: roomPausedAt, lastActivityAt: roomLastActivityAt }) => {
      setRoomTitle(title);
      setRoomCreatedAt(createdAt);
      if (roomIsPaused !== undefined) {
        setIsPaused(roomIsPaused);
      }
    });

    socket.on('roomPauseStatus', ({ isPaused: roomIsPaused }) => {
      setIsPaused(roomIsPaused);
      
      // Update editor read-only status
      if (editorRef.current) {
        editorRef.current.updateOptions({ readOnly: roomIsPaused });
      }
    });

    socket.on('codeUpdate', ({ code }) => {
      if (editorRef.current && editorRef.current.getValue() !== code) {
        isRemoteUpdate.current = true;
        editorRef.current.setValue(code);
        isRemoteUpdate.current = false;
        
        // Update code size tracking for remote updates
        const validation = validateCodeSize(code);
        setCodeSize(validation.sizeBytes);
        if (!validation.isValid) {
          setCodeSizeError(validation.error || 'Code size validation failed');
        } else {
          setCodeSizeError(null);
        }
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
      
      // Update code size tracking for language changes
      const validation = validateCodeSize(newCode || '');
      setCodeSize(validation.sizeBytes);
      if (!validation.isValid) {
        setCodeSizeError(validation.error || 'Code size validation failed');
      } else {
        setCodeSizeError(null);
      }
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

    // User Events socket listeners
    socket.on('newUserEvent', (eventData) => {
      setUserEvents(prev => [eventData, ...prev]);
      // If user is not on events tab, show new event indicator
      if (activeTabRef.current !== 'events') {
        setHasNewEvents(true);
      }
    });

    socket.on('userEventsHistory', ({ events }) => {
      setUserEvents(events);
    });

    return () => {
      socket.disconnect();
      // Clean up debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [roomId, name, namePrompt]);

  // Browser focus/blur event detection (only for non-authenticated users)
  useEffect(() => {
    if (!socketRef.current || !roomId || isAuthenticated) return;

    const handleFocus = () => {
      socketRef.current?.emit('userEvent', { 
        roomId, 
        eventType: 'focus_gained'
      });
    };

    const handleBlur = () => {
      socketRef.current?.emit('userEvent', { 
        roomId, 
        eventType: 'focus_lost'
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab became hidden (user switched away)
        socketRef.current?.emit('userEvent', { 
          roomId, 
          eventType: 'focus_lost'
        });
      } else {
        // Tab became visible (user switched back)
        socketRef.current?.emit('userEvent', { 
          roomId, 
          eventType: 'focus_gained'
        });
      }
    };

    // Use both window events and visibility API for better coverage
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [roomId, socketRef.current, isAuthenticated]);

  // Request user events history when authenticated user is ready
  useEffect(() => {
    if (isAuthenticated && socketRef.current && roomId) {
      socketRef.current.emit('getUserEvents', { roomId });
    }
  }, [isAuthenticated, roomId, socketRef.current]);

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

  const toggleLSP = useCallback(() => {
    setLspEnabled(prev => {
      const newEnabled = !prev;
      if (!newEnabled && lspClientRef.current) {
        // Disable LSP - disconnect and clear markers
        lspClientRef.current.disconnect();
        lspClientRef.current = null;
        setLspStatus('disconnected');
        if (monacoRef.current && editorRef.current) {
          // Clear ALL possible marker types to remove any remaining red squiggles
          const model = editorRef.current.getModel();
          monacoRef.current.editor.setModelMarkers(model, 'lsp', []);
          monacoRef.current.editor.setModelMarkers(model, 'typescript', []);
          monacoRef.current.editor.setModelMarkers(model, 'javascript', []);
          monacoRef.current.editor.setModelMarkers(model, 'python', []);
          monacoRef.current.editor.setModelMarkers(model, 'java', []);
          monacoRef.current.editor.setModelMarkers(model, 'kotlin', []);
        }
      } else if (newEnabled && editorRef.current && socketRef.current && roomId && editorReady) {
        // Enable LSP - reinitialize
        setTimeout(() => initializeLSP(), 100);
      }
      return newEnabled;
    });
  }, [roomId, editorReady]);

  const initializeLSP = useCallback(async () => {
    if (!editorRef.current || !socketRef.current || !roomId || !editorReady || !lspEnabled) {
      console.log('[Room] LSP initialization skipped - missing dependencies');
      return;
    }

    // Only enable LSP for supported languages
    if (!['kotlin', 'java', 'python'].includes(language)) {
      console.log(`[Room] LSP not supported for language: ${language}`);
      setLspStatus('disconnected');
      return;
    }

    try {
      // Clean up existing connection
      if (lspClientRef.current) {
        lspClientRef.current.disconnect();
        lspClientRef.current = null;
      }

      console.log(`[Room] Initializing LSP for language: ${language}, room: ${roomId}`);

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

    } catch (error) {
      console.error('[Room] LSP initialization error:', error);
      setLspStatus('error');
    }
  }, [language, roomId, editorReady, lspEnabled]);

  useEffect(() => {
    console.log(`[Room] useEffect triggered for LSP initialization - language: ${language}, roomId: ${roomId}, editor: ${!!editorRef.current}, socket: ${!!socketRef.current}, editorReady: ${editorReady}`);
    
    // Only initialize if all requirements are met
    if (editorRef.current && socketRef.current && roomId && editorReady) {
      // Add a small delay to ensure all state updates have propagated
      const timer = setTimeout(() => {
        initializeLSP();
      }, 100);
      
      return () => clearTimeout(timer);
    }

    return () => {
      if (lspClientRef.current) {
        lspClientRef.current.disconnect();
        lspClientRef.current = null;
      }
    };
  }, [initializeLSP, language, roomId, editorReady]);

  // Ensure Monaco model language matches the current language
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      try {
        // Clear existing markers before changing language
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'typescript', []);
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'python', []);
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'javascript', []);
        monacoRef.current.editor.setModelMarkers(editorRef.current.getModel(), 'lsp', []);
        
        monacoRef.current.editor.setModelLanguage(editorRef.current.getModel(), language);
      } catch (err) {
        console.error('Failed to set Monaco model language:', err);
      }
    }
  }, [language]);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isPaused) {
      return; // Prevent language changes when paused
    }
    
    const newLang = e.target.value;
    
    // For now, let's use a simple approach: just use the new language example
    // without preserving old code to prevent accumulation
    const newCode = languageExamples[newLang] || '';
    
    // Validate the new code size
    const validation = validateCodeSize(newCode);
    if (!validation.isValid) {
      setCodeSizeError(validation.error || 'Code size validation failed');
      // Don't proceed with language change if code is too large
      return;
    }
    
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
    setCodeSize(validation.sizeBytes);
    setCodeSizeError(null);
    
    if (socketRef.current && roomId) {
      socketRef.current.emit('languageUpdate', { language: newLang, code: newCode, room: roomId });
    }
  };

  const handleRun = async () => {
    if (isPaused) {
      return; // Prevent execution when paused
    }
    
    // Get the current code directly from the editor
    const currentCode = editorRef.current ? editorRef.current.getValue() : code;
    
    // Validate code size before execution
    const validation = validateCodeSize(currentCode);
    if (!validation.isValid) {
      setCodeSizeError(validation.error || 'Code size validation failed');
      if (socketRef.current && roomId) {
        socketRef.current.emit('runOutput', { 
          output: `Error: ${validation.error}`, 
          room: roomId 
        });
      }
      return;
    }
    
    setCodeSizeError(null); // Clear any previous errors
    setIsRunning(true);
    try {
      
      if (language === 'html') {
        setIframeHtml(currentCode);
        setHtmlRunKey(prev => prev + 1); // Increment key to force iframe re-render
        if (socketRef.current && roomId) {
          socketRef.current.emit('runOutput', { output: currentCode, room: roomId });
        }
        return;
      }
      const res = await axios.post('/api/execute', {
        code: currentCode,
        language,
        roomId, // Include roomId for pause checking
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
    
    // Set read-only based on pause status
    editor.updateOptions({ readOnly: isPaused });
    
    // Disable built-in validation for all languages to rely on LSP only
    try {
      // For Python - disable built-in validation since we have LSP
      if (monaco.languages.python?.pythonDefaults) {
        monaco.languages.python.pythonDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true
        });
      }
      
      // Intercept setModelMarkers to block built-in validation for LSP-supported languages only
      const originalSetModelMarkers = monaco.editor.setModelMarkers;
      monaco.editor.setModelMarkers = function(model: any, owner: string, markers: any[]) {
        // Allow LSP markers and TypeScript/JavaScript built-in markers
        if (owner === 'lsp' || owner === 'typescript' || owner === 'javascript') {
          return originalSetModelMarkers.call(this, model, owner, markers);
        }
        // Block built-in validators for LSP-supported languages (python, java, kotlin)
        console.log(`[Monaco] Blocked markers from ${owner}:`, markers);
        return originalSetModelMarkers.call(this, model, owner, []);
      };
    } catch (err) {
      console.warn('Failed to configure Monaco validation:', err);
    }
    
    // Clear any existing markers to start with a clean state
    monaco.editor.setModelMarkers(editor.getModel(), 'typescript', []);
    monaco.editor.setModelMarkers(editor.getModel(), 'python', []);
    monaco.editor.setModelMarkers(editor.getModel(), 'javascript', []);
    
    setEditorReady(true);
    
    // Initialize code size tracking
    const initialCode = editor.getValue();
    const initialValidation = validateCodeSize(initialCode);
    setCodeSize(initialValidation.sizeBytes);
    if (!initialValidation.isValid) {
      setCodeSizeError(initialValidation.error || 'Code size validation failed');
    }

    // Main content change handler
    editor.onDidChangeModelContent((event: any) => {
      if (isRemoteUpdate.current || isPaused) {
        return;
      }
      
      // Validate code size on every change
      const currentCode = editor.getValue();
      const validation = validateCodeSize(currentCode);
      setCodeSize(validation.sizeBytes);
      
      if (!validation.isValid) {
        setCodeSizeError(validation.error || 'Code size validation failed');
      } else {
        setCodeSizeError(null);
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
            // Don't save if code is too large
            const finalValidation = validateCodeSize(fullCode);
            if (finalValidation.isValid) {
              socketRef.current?.emit('saveCode', { room: roomId, code: fullCode });
            }
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

    // Paste event detection (only for non-authenticated users)
    editor.onDidPaste((e: any) => {
      if (socketRef.current && roomId && e.range && !isAuthenticated) {
        // Calculate the number of characters pasted
        const model = editor.getModel();
        if (model) {
          const pastedText = model.getValueInRange(e.range);
          const characterCount = pastedText.length;
          
          socketRef.current.emit('userEvent', {
            roomId,
            eventType: 'paste',
            eventData: { characterCount }
          });
        }
      }
    });
  }

  // Update editor read-only status when pause state changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ readOnly: isPaused });
    }
  }, [isPaused]);

  const getUserColor = useCallback((socketId: string) => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    const users = usersRef.current;
    const userIndex = users.findIndex(u => u.id === socketId);
    return colors[userIndex % colors.length];
  }, []);

  useEffect(() => {
    if (!monacoRef.current) return;

    // Create CSS for user-specific cursor colors
    const style = document.getElementById('remote-cursor-styles') || document.createElement('style');
    style.id = 'remote-cursor-styles';
    
    let cssContent = '';
    users.forEach((user, index) => {
      const color = getUserColor(user.id);
      cssContent += `
        .remote-cursor-${user.id}::after {
          content: '';
          position: absolute;
          top: 0;
          left: -1px;
          width: 2px;
          height: 20px;
          background-color: ${color};
          animation: cursor-blink 1s infinite;
        }
        .remote-cursor-${user.id}.show-label::before {
          content: '${user.name}';
          position: absolute;
          top: -20px;
          left: -1px;
          background-color: ${color};
          color: white;
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 11px;
          white-space: nowrap;
          z-index: 1000;
        }
        .remote-selection-${user.id} {
          background-color: ${color}33 !important;
        }
      `;
    });

    cssContent += `
      @keyframes cursor-blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
    `;

    style.textContent = cssContent;
    if (!document.head.contains(style)) {
      document.head.appendChild(style);
    }

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

  const handleTabChange = (tab: 'output' | 'events') => {
    setActiveTab(tab);
    if (tab === 'events') {
      setHasNewEvents(false);
      // Request user events if we haven't loaded them yet
      if (isAuthenticated && socketRef.current && roomId && userEvents.length === 0) {
        socketRef.current.emit('getUserEvents', { roomId });
      }
    }
  };

  if (roomStatus === 'loading' || loading) {
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
              <h1 style={{ margin: 0, fontSize: '1.5em' }}>
                {roomTitle}
                {isPaused && (
                  <span style={{ 
                    marginLeft: '0.5rem', 
                    fontSize: '0.7em', 
                    color: '#ff6b6b', 
                    background: '#33223a', 
                    padding: '0.2rem 0.5rem', 
                    borderRadius: '4px',
                    border: '1px solid #ff6b6b'
                  }}>
                    PAUSED
                  </span>
                )}
              </h1>
              {isPaused && (
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8em', color: '#ff6b6b' }}>
                  This room is paused. Code editing and execution are disabled.
                </p>
              )}
            </div>
            {isAuthenticated && (
              <button className="room-button" onClick={handleCopyUrl}>
                Copy Room URL
              </button>
            )}
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
                disabled={isPaused}
              >
                {languages.map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
              {(['kotlin', 'java', 'python'].includes(language)) && (
                <div 
                  onClick={toggleLSP}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                  style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  fontSize: '12px',
                  color: !lspEnabled ? '#9E9E9E' : (lspStatus === 'connected' ? '#4CAF50' : (lspStatus === 'connecting' ? '#FF9800' : '#FF5722')),
                  cursor: 'pointer',
                  userSelect: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid transparent',
                  transition: 'all 0.2s ease'
                }}>
                  <div style={{ 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    backgroundColor: !lspEnabled ? '#9E9E9E' : (lspStatus === 'connected' ? '#4CAF50' : (lspStatus === 'connecting' ? '#FF9800' : '#FF5722'))
                  }} />
                  IntelliSense {!lspEnabled ? 'Off' : (lspStatus === 'connected' ? 'On' : (lspStatus === 'connecting' ? 'Loading...' : 'Failed'))}
                </div>
              )}
            </div>
            <button 
              onClick={handleRun} 
              disabled={getIsRunDisabled()} 
              className="room-button"
              style={(isPaused || codeSizeError) ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              {isRunning ? 'Running...' : 
               isPaused ? 'Run (Paused)' : 
               codeSizeError ? 'Run (Code too large)' : 
               'Run'}
            </button>
            
            {isAuthenticated && user ? (
              <div className="user-info">
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
              <div style={{ marginBottom: 12, textAlign: 'left', color: '#aaa', fontSize: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>Users in room:</strong> {users.map((u: { id: string, name: string }) => u.name).join(', ')}
                  {isPaused && (
                    <span style={{ marginLeft: '1rem', color: '#ff6b6b', fontSize: 12 }}>
                      (Room is paused)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ 
                    color: codeSize > 8192 ? '#ff6b6b' : codeSize > 5120 ? '#ff9800' : '#4CAF50'
                  }}>
                    {formatBytes(codeSize)} / 10KB
                  </span>
                  {codeSizeError && (
                    <span style={{ color: '#ff6b6b', fontSize: 11 }}>
                      ⚠️ Code too large
                    </span>
                  )}
                </div>
              </div>
              <MonacoEditor
                height="100%"
                language={language === 'deno' ? 'typescript' : language}
                theme="vs-dark"
                value={code}
                onMount={handleEditorDidMount}
                options={{ minimap: { enabled: false }, readOnly: isPaused }}
              />
            </div>
            <div className="output-container">
              {/* Tab Headers */}
              <div style={{ display: 'flex', marginBottom: 12, borderBottom: '1px solid #333' }}>
                <button 
                  onClick={() => handleTabChange('output')}
                  style={{
                    background: activeTab === 'output' ? '#333' : 'transparent',
                    color: activeTab === 'output' ? '#fff' : '#aaa',
                    border: 'none',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    borderBottom: activeTab === 'output' ? '2px solid #61dafb' : '2px solid transparent',
                    fontSize: '14px'
                  }}
                >
                  Code Output
                </button>
                {isAuthenticated && (
                  <button 
                    onClick={() => handleTabChange('events')}
                    style={{
                      background: activeTab === 'events' ? '#333' : 'transparent',
                      color: activeTab === 'events' ? '#fff' : '#aaa',
                      border: 'none',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      borderBottom: activeTab === 'events' ? '2px solid #61dafb' : '2px solid transparent',
                      fontSize: '14px',
                      position: 'relative'
                    }}
                  >
                    User Events
                    {hasNewEvents && (
                      <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '8px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: '#ff6b6b',
                        animation: 'pulse 2s infinite'
                      }} />
                    )}
                  </button>
                )}
              </div>

              {/* Tab Content */}
              {activeTab === 'output' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, color: '#aaa' }}>Output</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <label style={{ fontSize: '12px', color: '#aaa', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={wrapOutput}
                          onChange={(e) => setWrapOutput(e.target.checked)}
                          style={{ marginRight: '4px' }}
                        />
                        Wrap lines
                      </label>
                      <button onClick={handleClearOutput} className="room-button">Clear Output</button>
                    </div>
                  </div>
                  {language === 'html' && iframeHtml ? (
                    <iframe
                      key={htmlRunKey}
                      srcDoc={iframeHtml}
                      style={{ width: '100%', height: '300px', border: '1px solid #333', backgroundColor: 'white' }}
                      title="HTML Output"
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
                </>
              )}

              {activeTab === 'events' && isAuthenticated && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, color: '#aaa' }}>User Events</h3>
                    <div style={{ fontSize: '12px', color: '#888' }}>
                      Activity tracking for authenticated users
                    </div>
                  </div>
                  <UserEvents events={userEvents} />
                </>
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