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
        <ul>
          <li>Create a new room for an interview</li>
          <li>Share the room URL with the candidate</li>
          <li>Change the coding language as needed</li>
          <li>Run the code as many times as you like</li>
        </ul>
        <p>Candidates do not need to log in if they have a direct link to the room.</p>
        <p>Rooms will pause after 24 hours (no more edits or execution), but can be unpaused.</p>
      </div>
    </div>
  );
};

export default Instructions; 