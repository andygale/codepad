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
import GuestJoin from './GuestJoin';
import { AuthProvider, useAuth } from './AuthContext';
import GoogleOneTap from './GoogleOneTap';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || '';

interface RoomData {
  id: number;
  room_id: string;
  title: string;
  creator: string;
  creator_email?: string;
  created_at: string;
}

function LandingPage() {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [showMyRooms, setShowMyRooms] = useState(false);
  const navigate = useNavigate();
  const { user, isAuthenticated, isAuthorized, logout, loading } = useAuth();

  useEffect(() => {
    const fetchRooms = async () => {
      if (!isAuthorized) return;
      
      try {
        const response = await axios.get<RoomData[]>(`${API_URL}/api/rooms`);
        setRooms(response.data);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        setError('Could not fetch rooms. Please try again later.');
      }
    };
    fetchRooms();
  }, [isAuthorized]);

  const handleCreateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!isAuthorized) {
      setError('You must be logged in to create rooms.');
      return;
    }
    
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    
    try {
      const response = await axios.post<RoomData>(`${API_URL}/api/rooms`, { 
        title,
        creator: user?.name,
        creator_email: user?.email
      });
      const newRoom = response.data;
      navigate(`/room/${newRoom.room_id}`);
    } catch (err) {
      console.error('Error creating room:', err);
      setError('Could not create room. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="landing-page">
        <header className="app-header">
          <h1>Loading...</h1>
        </header>
      </div>
    );
  }

  return (
    <div className="landing-page">
      <header className="app-header">
        <div className="header-content">
          <div>
            <h1>Welcome to Codepad</h1>
            <p>Real-time collaborative code editor.</p>
          </div>
          {isAuthenticated && (
            <div className="user-info">
              <img src={user?.picture} alt={user?.name} className="user-avatar" />
              <span className="user-name">{user?.name}</span>
              <button onClick={logout} className="logout-button">Logout</button>
            </div>
          )}
        </div>
      </header>
      
      {!isAuthenticated && (
        <div className="auth-section">
          <h2>Login Required</h2>
          <p>Please sign in with your Google account to view and create rooms.</p>
          <GoogleOneTap 
            onSuccess={() => setAuthError('')}
            onError={(error) => setAuthError('Login failed. Please try again.')}
          />
          {authError && <p className="error-message">{authError}</p>}
          <div className="guest-access">
            <p>Or <Link to="/join" className="guest-link">join an existing room as a guest</Link></p>
          </div>
        </div>
      )}

      {isAuthorized && (
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
          <div className="filter-container">
            <label>
              <input
                type="checkbox"
                checked={showMyRooms}
                onChange={(e) => setShowMyRooms(e.target.checked)}
              />
              Only show my rooms
            </label>
          </div>
          {rooms.length > 0 ? (
            <div className="room-table-container">
              <table className="room-table">
                <thead>
                  <tr>
                    <th>Room Title</th>
                    <th>Creator</th>
                    <th>Created</th>
                    <th>Room ID</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms
                    .filter(room => !showMyRooms || (user && room.creator === user.name))
                    .map((room) => (
                    <tr key={room.room_id} className="room-table-row">
                      <td className="room-title-cell">
                        <Link to={`/room/${room.room_id}`} className="room-link">
                          {room.title}
                        </Link>
                      </td>
                      <td className="room-creator-cell">
                        {room.creator}
                        {room.creator_email && <div className="creator-email">{room.creator_email}</div>}
                      </td>
                      <td className="room-date-cell">
                        {new Date(room.created_at).toLocaleString()}
                      </td>
                      <td className="room-id-cell">
                        <code className="room-id">{room.room_id.slice(0, 8)}...</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No rooms available. Create one to get started!</p>
          )}
        </div>
        </main>
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/join" element={<GuestJoin />} />
            <Route path="/room/:roomId" element={<Room />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
