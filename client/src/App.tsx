import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Link,
  useNavigate,
} from 'react-router-dom';
import axios from 'axios';
import { Pagination } from 'antd';
import Room from './Room';
import { AuthProvider, useAuth } from './AuthContext';
import HandleRedirect from './HandleRedirect';
import Instructions from './Instructions';
import codeCrushLogo from './assets/CodeCrush_logo.jpeg';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || '';

interface RoomData {
  id: number;
  room_id: string;
  title: string;
  creator: string;
  creator_email?: string;
  created_at: string;
  is_paused?: boolean;
  paused_at?: string;
  last_activity_at?: string;
}

function LandingPage() {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [showMyRooms, setShowMyRooms] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRooms, setTotalRooms] = useState(0);
  const [restartingRooms, setRestartingRooms] = useState<Set<string>>(new Set());
  const [pausingRooms, setPausingRooms] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const { user, isAuthenticated, login, logout, loading, initializeAuth } = useAuth();
  const ROOMS_PER_PAGE = 10;

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    const fetchRooms = async () => {
      if (!isAuthenticated) return;
      try {
        let url = `${API_URL}/api/rooms?page=${currentPage}&limit=${ROOMS_PER_PAGE}`;
        if (showMyRooms && user?.email) {
          url += `&creatorEmail=${user.email}`;
        }
        const response = await axios.get<{ rooms: RoomData[], totalCount: number }>(url, { withCredentials: true });
        setRooms(response.data.rooms);
        setTotalRooms(response.data.totalCount);
      } catch (err) {
        console.error('Error fetching rooms:', err);
        setError('Could not fetch rooms. Please try again later.');
      }
    };
    fetchRooms();
  }, [isAuthenticated, currentPage, showMyRooms, user]);

  const handleCreateRoom = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAuthenticated) {
      setError('You must be logged in to create rooms.');
      return;
    }
    if (!title.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    try {
      const response = await axios.post<RoomData>(`${API_URL}/api/rooms`, { title }, { withCredentials: true });
      navigate(`/room/${response.data.room_id}`);
    } catch (err) {
      console.error('Error creating room:', err);
      setError('Could not create room. Please try again.');
    }
  };

  const handleRestartRoom = async (roomId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    setRestartingRooms(prev => new Set(Array.from(prev)).add(roomId));
    try {
      await axios.post(`${API_URL}/api/rooms/${roomId}/unpause`, {}, { withCredentials: true });
      setRooms(prevRooms => prevRooms.map(room => room.room_id === roomId ? { ...room, is_paused: false, paused_at: undefined } : room));
    } catch (error) {
      console.error('Error restarting room:', error);
      setError('Failed to restart room. Please try again.');
    } finally {
      setRestartingRooms(prev => {
        const newSet = new Set(prev);
        newSet.delete(roomId);
        return newSet;
      });
    }
  };

  const handlePauseRoom = async (roomId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    setPausingRooms(prev => new Set(Array.from(prev)).add(roomId));
    try {
      await axios.post(`${API_URL}/api/rooms/${roomId}/pause`, {}, { withCredentials: true });
      setRooms(prevRooms => prevRooms.map(room => room.room_id === roomId ? { ...room, is_paused: true, paused_at: new Date().toISOString() } : room));
    } catch (error) {
      console.error('Error pausing room:', error);
      setError('Failed to pause room. Please try again.');
    } finally {
      setPausingRooms(prev => {
        const newSet = new Set(prev);
        newSet.delete(roomId);
        return newSet;
      });
    }
  };

  const canManageRoom = (room: RoomData) => isAuthenticated && user;

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return 'Less than 1 hour ago';
  };

  if (loading) {
    return (
      <div className="landing-page">
        <header className="app-header"><h1>Loading...</h1></header>
      </div>
    );
  }

  return (
    <div className="landing-page">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <img src={codeCrushLogo} alt="CodeCrush Logo" className="app-logo" />
            <div>
              <h1>Welcome to CodeCrush</h1>
              <p>Real-time collaborative code editor.</p>
            </div>
          </div>
          {isAuthenticated && (
            <nav className="header-nav">
              <Link to="/instructions" className="instructions-link">Instructions</Link>
            </nav>
          )}
          {isAuthenticated && user && (
            <div className="user-info">
              <span className="user-name">{user.name}</span>
              <button onClick={logout} className="logout-button">Logout</button>
            </div>
          )}
        </div>
      </header>

      {!isAuthenticated && (
        <div className="auth-section">
          <h2>Login Required</h2>
          <p>Please sign in to view and create rooms.</p>
          <button onClick={login} className="login-button">Login</button>
          {authError && <p className="error-message">{authError}</p>}
        </div>
      )}

      {isAuthenticated && (
        <main>
          <div className="create-room-section">
            <h2>Create a New Room</h2>
            <form onSubmit={handleCreateRoom} className="create-room-form">
              <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setError(''); }} placeholder="Enter room title" aria-label="Room title" />
              <button type="submit">Create Room</button>
            </form>
            {error && <p className="error-message">{error}</p>}
          </div>
          <div className="room-list-section">
            <h2>Or Join an Existing Room</h2>
            <div className="filter-container">
              <label>
                <input type="checkbox" checked={showMyRooms} onChange={(e) => { setShowMyRooms(e.target.checked); setCurrentPage(1); }} />
                Only show my rooms
              </label>
            </div>
            {rooms.length > 0 ? (
              <div className="room-table-container">
                <table className="room-table">
                  <thead>
                    <tr><th>Room Title</th><th>Creator</th><th>Status</th><th>Created</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => (
                      <tr key={room.room_id} className="room-table-row">
                        <td className="room-title-cell"><Link to={`/room/${room.room_id}`} className="room-link">{room.title}</Link></td>
                        <td className="room-creator-cell">{room.creator}{room.creator_email && <div className="creator-email">{room.creator_email}</div>}</td>
                        <td className="room-status-cell">
                          {room.is_paused ? (
                            <span className="status-paused">Paused{room.paused_at && <div className="status-detail">{getTimeAgo(room.paused_at)}</div>}</span>
                          ) : (
                            <span className="status-active">Active{room.last_activity_at && <div className="status-detail">Last activity: {getTimeAgo(room.last_activity_at)}</div>}</span>
                          )}
                        </td>
                        <td className="room-date-cell">{new Date(room.created_at).toLocaleString()}</td>
                        <td className="room-actions-cell">
                          {canManageRoom(room) && (
                            room.is_paused ? (
                              <button className="restart-button" onClick={(e) => handleRestartRoom(room.room_id, e)} disabled={restartingRooms.has(room.room_id)}>
                                {restartingRooms.has(room.room_id) ? 'Restarting...' : 'Restart'}
                              </button>
                            ) : (
                              <button className="pause-button" onClick={(e) => handlePauseRoom(room.room_id, e)} disabled={pausingRooms.has(room.room_id)}>
                                {pausingRooms.has(room.room_id) ? 'Pausing...' : 'Pause'}
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pagination-container">
                  <Pagination current={currentPage} total={totalRooms} pageSize={ROOMS_PER_PAGE} onChange={setCurrentPage} showSizeChanger={false} />
                </div>
              </div>
            ) : (<p>No rooms available. Create one to get started!</p>)}
          </div>
        </main>
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="/handleRedirect" element={<HandleRedirect />} />
      <Route path="/instructions" element={<Instructions />} />
    </Routes>
  );
}

const AppWrapper = () => (
  <Router>
    <AuthProvider>
      <App />
    </AuthProvider>
  </Router>
);

export default AppWrapper;
