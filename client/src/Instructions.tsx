import React from 'react';
import { useAuth } from './AuthContext';
import { Navigate, Link } from 'react-router-dom';
import './App.css';

const Instructions: React.FC = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="App">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Loading...</h1>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="App">
      <header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        width: '100%', 
        padding: '1rem 2rem', 
        boxSizing: 'border-box',
        background: '#181818',
        borderBottom: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/" style={{ color: '#61dafb', textDecoration: 'none', fontSize: '1em' }}>
            ← Back to Home
          </Link>
          <h1 style={{ margin: 0, fontSize: '1.5em' }}>User Guide</h1>
        </div>
      </header>
      
      <div className="instructions-page">
        <p>This app provides a shared editor that can be used for coding interviews.</p>
        
        <h3>Getting Started</h3>
        <ul>
          <li>Create a new room for an interview</li>
          <li>Share the room URL with the candidate</li>
          <li>Change the coding language as needed</li>
          <li>Run the code as many times as you like</li>
          <li>Use the playback feature to review the session</li>
        </ul>

        <h3>Room Management</h3>
        <ul>
          <li><strong>Auto-pause:</strong> Rooms automatically pause after 3 hours of inactivity to prevent abuse</li>
          <li><strong>Manual pause:</strong> Any logged-in user can pause/restart rooms at any time</li>
          <li><strong>Paused rooms:</strong> When paused, code editing and execution are disabled</li>
          <li><strong>Restart:</strong> Any logged-in user can restart paused rooms from the homepage</li>
          <li><strong>Paused room access:</strong> Only authenticated users can access paused rooms</li>
        </ul>

        <h3>Guest Access</h3>
        <p>Candidates do not need to log in if they have a direct link to an <strong>active</strong> room. They can join as guests and participate in the session. However, if a room is paused, guests will be prompted to sign in.</p>
        
      </div>
    </div>
  );
};

export default Instructions; 