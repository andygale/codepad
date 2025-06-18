import React, { useState, useEffect, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useParams,
} from 'react-router-dom';
import './App.css';

const languages = [
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'Java', value: 'java' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Python', value: 'python3' },
  { label: 'Swift', value: 'swift' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'TypeScript Fast (Deno)', value: 'deno' },
];

type ServerEvents = {
  codeUpdate: (data: { code: string }) => void;
  languageUpdate: (data: { language: string; code?: string }) => void;
  runOutput: (data: { output: string }) => void;
  remoteCursorChange: (data: { position: any; socketId: string }) => void;
  remoteSelectionChange: (data: { selection: any; socketId:string }) => void;
  userList: (data: { users: {id: string, name: string}[] }) => void;
  outputHistory: (data: { outputHistory: { timestamp: string; output: string }[] }) => void;
};

type ClientEvents = {
  codeUpdate: (data: { code: string; room: string }) => void;
  languageUpdate: (data: { language: string; code?: string; room: string }) => void;
  joinRoom: (data: { room: string; name: string }) => void;
  runOutput: (data: { output: string; room: string }) => void;
  cursorChange: (data: { room: string; position: any }) => void;
  selectionChange: (data: { room: string; selection: any }) => void;
};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

function Landing() {
  const navigate = useNavigate();
  const [roomInput, setRoomInput] = useState('');

  const handleNewRoom = () => {
    const newRoomId = generateRoomId();
    navigate(`/room/${newRoomId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim()) {
      navigate(`/room/${roomInput.trim()}`);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Codepad</h1>
        <button onClick={handleNewRoom} style={{ fontSize: 18, margin: 12 }}>
          New Room
        </button>
        <form onSubmit={handleJoinRoom} style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder="Enter Room ID"
            value={roomInput}
            onChange={e => setRoomInput(e.target.value)}
            style={{ fontSize: 16, padding: 4 }}
          />
          <button type="submit" style={{ fontSize: 16, marginLeft: 8 }}>
            Join Room
          </button>
        </form>
      </header>
    </div>
  );
}

function Room() {
  const { roomId } = useParams();
  const [language, setLanguage] = useState('deno');
  const [code, setCode] = useState(`class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`);
  const [outputBlocks, setOutputBlocks] = useState<{ timestamp: string; output: string }[]>([]);
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
  const isRemoteUpdate = useRef(false);
  const prevLanguage = useRef(language);
  const [copyMsg, setCopyMsg] = useState('');
  const [iframeHtml, setIframeHtml] = useState('');

  const languageExamples: Record<string, string> = {
    javascript: `class Greeter {\n  constructor(message) {\n    this.message = message;\n  }\n  greet() {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    typescript: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    deno: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    python3: `class Greeter:\n    def __init__(self, message):\n        self.message = message\n    def greet(self):\n        print(self.message)\n\ngreeter = Greeter('Hello, world!')\ngreeter.greet()`,
    cpp: `#include <iostream>\n\nclass Greeter {\npublic:\n    Greeter(const std::string& message) : message_(message) {}\n    void greet() const { std::cout << message_ << std::endl; }\nprivate:\n    std::string message_;\n};\n\nint main() {\n    Greeter greeter(\"Hello, world!\");\n    greeter.greet();\n    return 0;\n}`,
    java: `public class Greeter {\n    private String message;\n    public Greeter(String message) {\n        this.message = message;\n    }\n    public void greet() {\n        System.out.println(message);\n    }\n    public static void main(String[] args) {\n        Greeter greeter = new Greeter(\"Hello, world!\");\n        greeter.greet();\n    }\n}`,
    html: `<!DOCTYPE html>\n<html>\n<head>\n  <title>Web Example</title>\n  <style>\n    body { font-family: sans-serif; background: #f9f9f9; color: #222; }\n    .greeting { color: #007acc; font-size: 2em; margin-top: 2em; }\n  </style>\n</head>\n<body>\n  <div class=\"greeting\">Hello, world!</div>\n  <script>\n    document.querySelector('.greeting').textContent += ' (from JavaScript!)';\n  </script>\n</body>\n</html>`,
    swift: `func greet(name: String) {\n    print("Hello, \\(name)!")\n}\n\ngreet(name: "world")`,
    kotlin: `fun main() {\n    println("Hello, world!")\n}`
  };

  const userColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#F7D842', '#8A2BE2', '#FF8C00', '#00CED1'];
  const getUserColor = (userId: string) => {
      let hash = 0;
      for (let i = 0; i < userId.length; i++) {
          hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      }
      const index = Math.abs(hash % userColors.length);
      return userColors[index];
  };

  const commentSyntax: Record<string, (code: string) => string> = {
    javascript: code => code.split('\n').map(line => '// ' + line).join('\n'),
    typescript: code => code.split('\n').map(line => '// ' + line).join('\n'),
    deno: code => code.split('\n').map(line => '// ' + line).join('\n'),
    python3: code => code.split('\n').map(line => '# ' + line).join('\n'),
    cpp: code => code.split('\n').map(line => '// ' + line).join('\n'),
    java: code => code.split('\n').map(line => '// ' + line).join('\n'),
  };

  useEffect(() => {
    if (!roomId || !name) return;
    
    const socket = io({
      transports: ['websocket'],
    });
    socketRef.current = socket;
    socket.emit('joinRoom', { room: roomId, name });

    socket.on('connect', () => {
      console.log('Connected to backend Socket.IO server');
    });

    socket.on('codeUpdate', ({ code }) => {
      isRemoteUpdate.current = true;
      setCode(code);
      prevLanguage.current = language;
    });
    socket.on('languageUpdate', ({ language, code: newCode }) => {
      setCode(newCode);
      setLanguage(language);
      prevLanguage.current = language;
    });
    socket.on('outputHistory', ({ outputHistory }) => {
      setOutputBlocks(outputHistory);
      if (language === 'html' && outputHistory.length > 0) {
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
      setUsers(currentUsers => {
        const user = currentUsers.find(u => u.id === socketId);
        setRemoteSelections(prev => ({
          ...prev,
          [socketId]: {
            selection: new monacoRef.current.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            name: user?.name || 'Anonymous'
          },
        }));
        return currentUsers;
      });
    });

    socket.on('remoteSelectionChange', ({ selection, socketId }) => {
      if (!monacoRef.current) return;
      remoteCursorActivity.current[socketId] = Date.now();
      setUsers(currentUsers => {
        const user = currentUsers.find(u => u.id === socketId);
        setRemoteSelections(prev => ({
          ...prev,
          [socketId]: {
            selection: new monacoRef.current.Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn),
            name: user?.name || 'Anonymous'
          },
        }));
        return currentUsers;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, name]);

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
  }, []); // Remove the dependency to prevent interval recreation

  const handleCodeChange = (value: string | undefined) => {
    setCode(value || '');
    if (!isRemoteUpdate.current && socketRef.current && roomId) {
      console.log('Emitting codeUpdate to backend:', value || '');
      socketRef.current.emit('codeUpdate', { code: value || '', room: roomId });
    }
    isRemoteUpdate.current = false;
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLang = e.target.value;
    let newCode = languageExamples[newLang] || '';
    if (code !== languageExamples[language]) {
      const commentOut = commentSyntax[newLang] || (c => c);
      newCode += '\n\n' + commentOut(code);
    }
    setCode(newCode);
    setLanguage(newLang);
    prevLanguage.current = newLang;
    if (socketRef.current && roomId) {
      console.log('Emitting languageUpdate to backend:', newLang, newCode);
      socketRef.current.emit('languageUpdate', { language: newLang, code: newCode, room: roomId });
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      if (language === 'html') {
        setIframeHtml(code);
        if (socketRef.current && roomId) {
          socketRef.current.emit('runOutput', { output: code, room: roomId });
        }
        return;
      }
      const res = await axios.post('/api/execute', {
        code,
        language,
      });
      if (socketRef.current && roomId) {
        socketRef.current.emit('runOutput', { output: res.data.output, room: roomId });
      }
    } catch (err: any) {
      if (socketRef.current && roomId) {
        socketRef.current.emit('runOutput', { output: 'Error running code: ' + (err.response?.data?.error || err.message), room: roomId });
      }
    } finally {
      setIsRunning(false);
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsCollectionRef.current = editor.createDecorationsCollection();

    editor.onDidChangeCursorPosition(() => {
      if (socketRef.current && roomId) {
        socketRef.current.emit('cursorChange', { room: roomId, position: editor.getPosition() });
      }
    });

    editor.onDidChangeCursorSelection(() => {
      if (socketRef.current && roomId) {
        socketRef.current.emit('selectionChange', { room: roomId, selection: editor.getSelection() });
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
            <button type="submit" style={{ fontSize: 18, marginLeft: 12 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 16 }}>
          <h1 style={{ margin: 0 }}>Codepad Room: {roomId}</h1>
          <button onClick={handleCopyUrl} style={{ fontSize: 14, padding: '4px 10px', cursor: 'pointer' }}>
            Copy Room URL
          </button>
          {copyMsg && <span style={{ color: '#0f0' }}>{copyMsg}</span>}
        </div>
        <div style={{ marginBottom: 16 }}>
          <select
            value={language}
            onChange={handleLanguageChange}
            style={{ fontSize: 16, padding: 4 }}
          >
            {languages.map(lang => (
              <option key={lang.value} value={lang.value}>{lang.label}</option>
            ))}
          </select>
          <button onClick={handleRun} disabled={isRunning} style={{ marginLeft: 12, fontSize: 16 }}>
            {isRunning ? 'Running...' : 'Run'}
          </button>
        </div>
        <div className="main-content">
          <div className="editor-container">
            <div style={{ marginBottom: 12, textAlign: 'left', color: '#aaa', fontSize: 14 }}>
              <strong>Users in room:</strong> {users.map((u: { id: string, name: string }) => u.name).join(', ')}
            </div>
            <MonacoEditor
              height="100%"
              language={language === 'python3' ? 'python' : language === 'deno' ? 'typescript' : language}
              theme="vs-dark"
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorDidMount}
              options={{ minimap: { enabled: false } }}
            />
          </div>
          <div className="output-container">
            <h2>Output</h2>
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
                      Run at {block.timestamp}
                    </div>
                    <pre style={{ margin: 0 }}>{block.output}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </Router>
  );
}

export default App;
