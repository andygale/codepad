import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Link,
  useNavigate,
} from 'react-router-dom';
import axios from 'axios';
import Room from './Room';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || '';

interface RoomData {
  id: number;
  room_id: string;
  title: string;
  created_at: string;
}

function LandingPage() {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const response = await axios.get<RoomData[]>(`${API_URL}/api/rooms`);
        setRooms(response.data);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        setError('Could not fetch rooms. Please try again later.');
      }
    };
    fetchRooms();
  }, []);

  const handleCreateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    try {
      const response = await axios.post<RoomData>(`${API_URL}/api/rooms`, { title });
      const newRoom = response.data;
      navigate(`/room/${newRoom.room_id}`);
    } catch (err) {
      console.error('Error creating room:', err);
      setError('Could not create room. Please try again.');
    }
  };

  return (
    <div className="landing-page">
      <header className="app-header">
        <h1>Welcome to Codepad</h1>
        <p>Real-time collaborative code editor.</p>
      </header>
      <main>
        <div className="create-room-section">
          <h2>Create a New Room</h2>
          <form onSubmit={handleCreateRoom} className="create-room-form">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError('');
              }}
              placeholder="Enter room title"
              aria-label="Room title"
            />
            <button type="submit">Create Room</button>
          </form>
          {error && <p className="error-message">{error}</p>}
        </div>
        <div className="room-list-section">
          <h2>Or Join an Existing Room</h2>
          {rooms.length > 0 ? (
            <ul className="room-list">
              {rooms.map((room) => (
                <li key={room.room_id} className="room-list-item">
                  <Link to={`/room/${room.room_id}`}>
                    <span className="room-title">{room.title}</span>
                    <span className="room-timestamp">
                      {new Date(room.created_at).toLocaleString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No rooms available. Create one to get started!</p>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/room/:roomId" element={<Room />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
