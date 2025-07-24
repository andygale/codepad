import React from 'react';

interface UserEvent {
  userName: string;
  userId: string | null;
  eventType: string;
  eventData: any;
  timestamp: string;
}

interface UserEventsProps {
  events: UserEvent[];
}

const UserEvents: React.FC<UserEventsProps> = ({ events }) => {
  const formatEventMessage = (event: UserEvent) => {
    const time = new Date(event.timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    
    switch (event.eventType) {
      case 'focus_gained':
        return `[${time}] ${event.userName} switched back to this tab`;
      case 'focus_lost':
        return `[${time}] ${event.userName} switched to another tab or application`;
      case 'paste':
        const charCount = event.eventData?.characterCount || 0;
        return `[${time}] ${event.userName} pasted ${charCount} character${charCount !== 1 ? 's' : ''}`;
      default:
        return `[${time}] ${event.userName} ${event.eventType}`;
    }
  };

  return (
    <div 
      className="user-events-container"
      style={{
        background: '#181818',
        color: '#ddd',
        padding: '16px',
        borderRadius: '6px',
        minHeight: '80px',
        fontSize: '0.9em',
        fontFamily: "'Fira Mono', 'Consolas', monospace",
        flex: '1 1 auto',
        overflow: 'auto',
        textAlign: 'left',
        whiteSpace: 'pre-wrap'
      }}
    >
      {events.length === 0 ? (
        <div style={{ color: '#888', fontStyle: 'italic' }}>
          No user events yet. Activity like switching tabs or pasting code will appear here.
        </div>
      ) : (
        events.map((event, idx) => (
          <div key={idx} style={{ marginBottom: '8px', lineHeight: '1.4' }}>
            {formatEventMessage(event)}
          </div>
        ))
      )}
    </div>
  );
};

export default UserEvents; 