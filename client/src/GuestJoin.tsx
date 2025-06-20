import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const GuestJoin: React.FC = () => {
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleJoinRoom = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!roomId.trim()) {
      setError('Room ID cannot be empty.');
      return;
    }
    
    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(roomId.trim())) {
      setError('Please enter a valid Room ID.');
      return;
    }
    
    navigate(`/room/${roomId.trim()}`);
  };

  return (
    <div className="landing-page">
      <header className="app-header">
        <h1>Join Room as Guest</h1>
        <p>Enter a Room ID to join as a guest user.</p>
      </header>
      
      <main className="guest-join-main">
        <div className="guest-join-section">
          <h2>Enter Room ID</h2>
          <form onSubmit={handleJoinRoom} className="guest-join-form">
            <input
              type="text"
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                setError('');
              }}
              placeholder="Enter room ID (e.g., 40312efb-58a2-480a-89af-5337cd9fc999)"
              aria-label="Room ID"
              className="room-id-input"
            />
            <button type="submit" className="join-button">Join Room</button>
          </form>
          {error && <p className="error-message">{error}</p>}
          
          <div className="help-text">
            <p>Room IDs are provided by room creators and look like:</p>
            <code className="example-id">40312efb-58a2-480a-89af-5337cd9fc999</code>
          </div>
          
          <div className="back-link">
            <Link to="/" className="guest-link">← Back to Home</Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default GuestJoin; 