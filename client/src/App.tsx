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
  { label: 'JavaScript', value: 'javascript' },
  { label: 'Python', value: 'python3' },
  { label: 'C++', value: 'cpp' },
  { label: 'Java', value: 'java' },
];

const SOCKET_SERVER_URL = 'http://localhost:5000';

type ServerEvents = {
  codeUpdate: (data: { code: string }) => void;
  languageUpdate: (data: { language: string; code?: string }) => void;
  runOutput: (data: { output: string }) => void;
};

type ClientEvents = {
  codeUpdate: (data: { code: string; room: string }) => void;
  languageUpdate: (data: { language: string; code?: string; room: string }) => void;
  joinRoom: (data: { room: string }) => void;
  runOutput: (data: { output: string; room: string }) => void;
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
        <h1>CoderPad Clone</h1>
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
  const [code, setCode] = useState('// Write your code here');
  const [language, setLanguage] = useState('javascript');
  const [outputBlocks, setOutputBlocks] = useState<{ timestamp: string; output: string }[]>([]);
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const isRemoteUpdate = useRef(false);
  const prevLanguage = useRef(language);

  const languageExamples: Record<string, string> = {
    javascript: `class Greeter {\n  constructor(message) {\n    this.message = message;\n  }\n  greet() {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
    python3: `class Greeter:\n    def __init__(self, message):\n        self.message = message\n    def greet(self):\n        print(self.message)\n\ngreeter = Greeter('Hello, world!')\ngreeter.greet()`,
    cpp: `#include <iostream>\n\nclass Greeter {\npublic:\n    Greeter(const std::string& message) : message_(message) {}\n    void greet() const { std::cout << message_ << std::endl; }\nprivate:\n    std::string message_;\n};\n\nint main() {\n    Greeter greeter(\"Hello, world!\");\n    greeter.greet();\n    return 0;\n}`,
    java: `public class Greeter {\n    private String message;\n    public Greeter(String message) {\n        this.message = message;\n    }\n    public void greet() {\n        System.out.println(message);\n    }\n    public static void main(String[] args) {\n        Greeter greeter = new Greeter(\"Hello, world!\");\n        greeter.greet();\n    }\n}`
  };

  const commentSyntax: Record<string, (code: string) => string> = {
    javascript: code => code.split('\n').map(line => '// ' + line).join('\n'),
    python3: code => code.split('\n').map(line => '# ' + line).join('\n'),
    cpp: code => code.split('\n').map(line => '// ' + line).join('\n'),
    java: code => code.split('\n').map(line => '// ' + line).join('\n'),
  };

  useEffect(() => {
    if (!roomId) return;
    const socket = io(SOCKET_SERVER_URL);
    socketRef.current = socket;
    socket.emit('joinRoom', { room: roomId });

    socket.on('connect', () => {
      console.log('Connected to backend Socket.IO server');
    });

    socket.on('codeUpdate', ({ code }) => {
      isRemoteUpdate.current = true;
      setCode(code);
    });
    socket.on('languageUpdate', ({ language, code: newCode }) => {
      setCode(newCode);
      setLanguage(language);
      prevLanguage.current = language;
    });
    socket.on('runOutput', ({ output }) => {
      const now = new Date();
      setOutputBlocks(blocks => [
        ...blocks,
        {
          timestamp: now.toLocaleString(),
          output,
        },
      ]);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

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
    const now = new Date();
    setOutputBlocks(blocks => [
      ...blocks,
      {
        timestamp: now.toLocaleString(),
        output: 'Running...'
      },
    ]);
    try {
      const res = await axios.post('http://localhost:5000/execute', {
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
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>CoderPad Room: {roomId}</h1>
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
          <button onClick={handleRun} style={{ marginLeft: 12, fontSize: 16 }}>
            Run
          </button>
        </div>
        <div className="main-content">
          <div className="editor-container">
            <MonacoEditor
              height="100%"
              language={language}
              value={code}
              onChange={handleCodeChange}
              theme="vs-dark"
              options={{ minimap: { enabled: false } }}
            />
          </div>
          <div className="output-container">
            <h2>Output</h2>
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
