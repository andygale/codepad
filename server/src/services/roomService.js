const { randomUUID } = require('crypto');
const db = require('./dbService');

const usersByRoom = {};

class RoomService {
  constructor() {
    this.roomState = {};
    this.userNames = {};
    this.loadingPromises = new Map();
    // Start auto-pause scheduler
    this.startAutoPauseScheduler();
  }

  async createRoom(title, creator, creator_email) {
    const roomId = randomUUID().replace(/-/g, '').substring(0, 12);
    const defaultCode = `class Greeter {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
  greet(): void {
    console.log(this.message);
    console.log('Running Deno version:', Deno.version.deno);
  }
}

const greeter = new Greeter('Hello, world!');
greeter.greet();`;
    const defaultLanguage = 'deno';
    
    try {
      const result = await db.query(
        'INSERT INTO rooms (room_id, title, creator, creator_email, code, language, last_activity_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *',
        [roomId, title, creator, creator_email, defaultCode, defaultLanguage]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating room:', error);
      return null;
    }
  }

  async getRoom(roomId) {
    try {
      const result = await db.query('SELECT * FROM rooms WHERE room_id = $1', [roomId]);
      return result.rows[0];
    } catch (error) {
      console.error(`Error getting room ${roomId}:`, error);
      return null;
    }
  }

  async getAllRooms(page = 1, limit = 10, creator_email = null) {
    const offset = (page - 1) * limit;
    const queryParams = [limit, offset];
    const countParams = [];
    let whereClause = '';

    if (creator_email) {
      whereClause = 'WHERE creator_email = $3';
      queryParams.push(creator_email);
      countParams.push(creator_email);
    }
    const countQuery = `SELECT COUNT(*) FROM rooms ${creator_email ? 'WHERE creator_email = $1' : ''}`;

    try {
      const roomsResult = await db.query(
        `SELECT * FROM rooms ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        queryParams
      );
      const countResult = await db.query(countQuery, countParams);
      return {
        rooms: roomsResult.rows,
        totalCount: parseInt(countResult.rows[0].count, 10),
      };
    } catch (error) {
      console.error('Error getting all rooms:', error);
      return { rooms: [], totalCount: 0 };
    }
  }

  async getOrCreateRoom(roomId) {
    // If room is already loaded, return it
    if (this.roomState[roomId]) {
      return this.roomState[roomId];
    }

    // If room is currently being loaded, wait for the existing promise to resolve
    if (this.loadingPromises.has(roomId)) {
      return this.loadingPromises.get(roomId);
    }

    // If room is not loaded and not being loaded, start loading it
    const loadingPromise = (async () => {
      try {
        const dbRoom = await this.getRoom(roomId);
        if (dbRoom) {
          // Initialize in-memory state from database if not already loaded
          // Pass dbRoom.id to avoid a redundant query
          const outputHistory = await this.loadOutputHistoryFromDb(roomId, dbRoom.id);
          this.roomState[roomId] = {
            code: dbRoom.code,
            language: dbRoom.language,
            outputHistory: outputHistory,
            isPaused: dbRoom.is_paused,
            lastActivityAt: dbRoom.last_activity_at,
            pausedAt: dbRoom.paused_at,
          };
          return this.roomState[roomId];
        }

        // Fallback to in-memory creation (shouldn't happen with persistent rooms)
        if (!this.roomState[roomId]) {
          this.roomState[roomId] = {
            code: `class Greeter {\\n  message: string;\\n  constructor(message: string) {\\n    this.message = message;\\n  }\\n  greet(): void {\\n    console.log(this.message);\\n    console.log('Running Deno version:', Deno.version.deno);\\n  }\\n}\\n\\nconst greeter = new Greeter('Hello, world!');\\ngreeter.greet();`,
            language: 'deno',
            outputHistory: [],
            isPaused: false,
            lastActivityAt: new Date(),
            pausedAt: null,
          };
        }
        return this.roomState[roomId];
      } finally {
        // Once loading is complete (or failed), remove the promise
        this.loadingPromises.delete(roomId);
      }
    })();

    this.loadingPromises.set(roomId, loadingPromise);
    return loadingPromise;
  }

  async updateRoomActivity(roomId) {
    try {
      await db.query('UPDATE rooms SET last_activity_at = NOW() WHERE room_id = $1', [roomId]);
      
      // Update in-memory state
      if (this.roomState[roomId]) {
        this.roomState[roomId].lastActivityAt = new Date();
      }
    } catch (error) {
      console.error(`Error updating activity for room ${roomId}:`, error);
    }
  }

  async updateRoomCode(roomId, code) {
    // Check if room is paused first
    const room = await this.getRoom(roomId);
    if (room && room.is_paused) {
      throw new Error('Room is paused. Code editing is not allowed.');
    }

    // Persist to database first
    try {
      await db.query('UPDATE rooms SET code = $1, last_activity_at = NOW() WHERE room_id = $2', [code, roomId]);
      console.log(`Successfully updated code for room ${roomId}`);
    } catch (error) {
      console.error(`Error updating code for room ${roomId}:`, error);
      throw error; // Re-throw so socket handler can handle it
    }
    
    // Update in-memory state only after successful database update
    if (!this.roomState[roomId]) this.roomState[roomId] = {};
    this.roomState[roomId].code = code;
    this.roomState[roomId].lastActivityAt = new Date();
  }

  async updateRoomLanguage(roomId, language, code) {
    // Check if room is paused first
    const room = await this.getRoom(roomId);
    if (room && room.is_paused) {
      throw new Error('Room is paused. Language changes are not allowed.');
    }

    // Persist to database first
    try {
      const result = await db.query('UPDATE rooms SET language = $1, code = $2, last_activity_at = NOW() WHERE room_id = $3', [language, code, roomId]);
      console.log(`Successfully updated language and code for room ${roomId}. Rows affected: ${result.rowCount}`);
      
      // Check if any rows were actually updated
      if (result.rowCount === 0) {
        throw new Error(`No room found with ID ${roomId}`);
      }
    } catch (error) {
      console.error(`Error updating language and code for room ${roomId}:`, error);
      throw error; // Re-throw so socket handler can handle it
    }
    
    // Update in-memory state only after successful database update
    if (!this.roomState[roomId]) this.roomState[roomId] = {};
    this.roomState[roomId].language = language;
    this.roomState[roomId].code = code;
    this.roomState[roomId].lastActivityAt = new Date();
  }

  async pauseRoom(roomId) {
    try {
      await db.query('UPDATE rooms SET is_paused = true, paused_at = NOW() WHERE room_id = $1', [roomId]);
      
      // Update in-memory state
      if (this.roomState[roomId]) {
        this.roomState[roomId].isPaused = true;
        this.roomState[roomId].pausedAt = new Date();
      }
      
      console.log(`Room ${roomId} has been paused`);
    } catch (error) {
      console.error(`Error pausing room ${roomId}:`, error);
      throw error;
    }
  }

  async unpauseRoom(roomId) {
    try {
      await db.query('UPDATE rooms SET is_paused = false, paused_at = NULL, last_activity_at = NOW() WHERE room_id = $1', [roomId]);
      
      // Update in-memory state
      if (this.roomState[roomId]) {
        this.roomState[roomId].isPaused = false;
        this.roomState[roomId].pausedAt = null;
        this.roomState[roomId].lastActivityAt = new Date();
      }
      
      console.log(`Room ${roomId} has been unpaused`);
    } catch (error) {
      console.error(`Error unpausing room ${roomId}:`, error);
      throw error;
    }
  }

  async checkRoomPauseStatus(roomId) {
    const room = await this.getRoom(roomId);
    return room ? room.is_paused : false;
  }

  async findRoomsToAutoPause() {
    try {
      // Find rooms that are not paused and have been inactive for more than 3 hours
      const result = await db.query(`
        SELECT room_id FROM rooms 
        WHERE is_paused = false 
        AND last_activity_at < NOW() - INTERVAL '3 hours'
      `);
      return result.rows.map(row => row.room_id);
    } catch (error) {
      console.error('Error finding rooms to auto-pause:', error);
      return [];
    }
  }

  async startAutoPauseScheduler() {
    // Run every hour to check for rooms that need to be auto-paused
    setInterval(async () => {
      try {
        const roomsToPause = await this.findRoomsToAutoPause();
        for (const roomId of roomsToPause) {
          await this.pauseRoom(roomId);
          console.log(`Auto-paused room ${roomId} after 3 hours of inactivity`);
        }
      } catch (error) {
        console.error('Error in auto-pause scheduler:', error);
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  async addOutputToRoom(roomId, output, execTimeMs) {
    if (!this.roomState[roomId]) this.roomState[roomId] = { outputHistory: [] };
    const timestamp = new Date().toISOString();
    if (!this.roomState[roomId].outputHistory) this.roomState[roomId].outputHistory = [];
    const entry = { timestamp, output };
    if (typeof execTimeMs === 'number') entry.execTimeMs = execTimeMs;
    
    // Persist to database first
    try {
      await this.saveOutputToDb(roomId, output, execTimeMs);
      // Update in-memory state only after successful database save
      this.roomState[roomId].outputHistory.push(entry);
    } catch (error) {
      console.error(`Error saving output to database for room ${roomId}:`, error);
      // Still add to memory even if database save fails to maintain functionality
      this.roomState[roomId].outputHistory.push(entry);
    }
    
    // Update room activity when code is executed
    this.updateRoomActivity(roomId);
    
    return this.roomState[roomId].outputHistory;
  }

  async clearOutputHistory(roomId) {
    if (!this.roomState[roomId]) this.roomState[roomId] = { outputHistory: [] };
    
    // Clear from database first
    try {
      await this.clearOutputFromDb(roomId);
      // Clear in-memory state only after successful database clear
      this.roomState[roomId].outputHistory = [];
    } catch (error) {
      console.error(`Error clearing output from database for room ${roomId}:`, error);
      // Still clear memory even if database clear fails to maintain functionality
      this.roomState[roomId].outputHistory = [];
    }
    
    return this.roomState[roomId].outputHistory;
  }

  getRoomState(roomId) {
    return this.roomState[roomId] || null;
  }

  addUserToRoom(roomId, socketId, name) {
    if (!this.userNames[roomId]) this.userNames[roomId] = {};
    this.userNames[roomId][socketId] = { name: name || 'Anonymous', id: socketId };
    
    // Update room activity when users join
    this.updateRoomActivity(roomId);
    
    return Object.values(this.userNames[roomId]);
  }

  removeUserFromRoom(roomId, socketId) {
    if (this.userNames[roomId] && this.userNames[roomId][socketId]) {
      delete this.userNames[roomId][socketId];
    }
    if (!this.userNames[roomId] || Object.keys(this.userNames[roomId]).length === 0) {
      delete this.userNames[roomId];
    }
    return this.userNames[roomId] ? Object.values(this.userNames[roomId]) : [];
  }

  getUserName(roomId, socketId) {
    if (!this.userNames[roomId] || !this.userNames[roomId][socketId]) {
      return null;
    }
    return this.userNames[roomId][socketId].name;
  }

  getRoomUsers(roomId) {
    return this.userNames[roomId] ? Object.values(this.userNames[roomId]) : [];
  }

  // Future methods for persistence
  async saveRoom(roomId) {
    // TODO: Implement database persistence
    console.log(`Saving room ${roomId} to database`);
  }

  async loadRoom(roomId) {
    // TODO: Implement database loading
    console.log(`Loading room ${roomId} from database`);
  }

  // =========================
  // Playback helpers
  // =========================
  async recordSnapshot(roomId, code) {
    // ensure room exists
    const roomRow = await this.getRoom(roomId);
    if (!roomRow) return;
    const dbRoomId = roomRow.id;

    // get next sequence number
    const seqRes = await db.query('SELECT COALESCE(MAX(seq),0)+1 AS next FROM edit_history WHERE room_id=$1', [dbRoomId]);
    const seq = seqRes.rows[0].next;

    await db.query(
      'INSERT INTO edit_history (room_id, seq, code_snapshot) VALUES ($1,$2,$3)',
      [dbRoomId, seq, code]
    );
  }

  async getHistory(roomId) {
    const roomRow = await this.getRoom(roomId);
    if (!roomRow) return [];
    const dbRoomId = roomRow.id;
    const res = await db.query(
      'SELECT seq, code_snapshot FROM edit_history WHERE room_id=$1 ORDER BY seq ASC',
      [dbRoomId]
    );
    return res.rows;
  }

  async getPlaybackHistory(roomId) {
    try {
      // Get room to ensure it exists and get db id
      const roomRow = await this.getRoom(roomId);
      if (!roomRow) return [];
      
      const result = await db.query('SELECT * FROM edit_history WHERE room_id = $1 ORDER BY seq', [roomRow.id]);
      return result.rows;
    } catch (error) {
      console.error(`Error getting playback history for room ${roomId}:`, error);
      return [];
    }
  }

  // =========================
  // Code Output Database Methods
  // =========================
  
  async loadOutputHistoryFromDb(roomId, dbRoomId) {
    try {
      // If dbRoomId is not provided, fetch it. This is for backward compatibility or other callers.
      if (!dbRoomId) {
        const roomRow = await this.getRoom(roomId);
        if (!roomRow) return [];
        dbRoomId = roomRow.id;
      }
      
      const result = await db.query(
        'SELECT output, exec_time_ms, created_at FROM code_outputs WHERE room_id = $1 ORDER BY created_at ASC',
        [dbRoomId]
      );
      
      return result.rows.map(row => ({
        timestamp: row.created_at.toISOString(),
        output: row.output,
        ...(row.exec_time_ms !== null && { execTimeMs: row.exec_time_ms })
      }));
    } catch (error) {
      console.error(`Error loading output history from database for room ${roomId}:`, error);
      return [];
    }
  }

  async saveOutputToDb(roomId, output, execTimeMs) {
    try {
      // Get room to ensure it exists and get db id
      const roomRow = await this.getRoom(roomId);
      if (!roomRow) {
        throw new Error(`Room ${roomId} not found`);
      }
      
      await db.query(
        'INSERT INTO code_outputs (room_id, output, exec_time_ms) VALUES ($1, $2, $3)',
        [roomRow.id, output, execTimeMs || null]
      );
    } catch (error) {
      console.error(`Error saving output to database for room ${roomId}:`, error);
      throw error;
    }
  }

  async clearOutputFromDb(roomId) {
    try {
      // Get room to ensure it exists and get db id
      const roomRow = await this.getRoom(roomId);
      if (!roomRow) {
        throw new Error(`Room ${roomId} not found`);
      }
      
      const result = await db.query('DELETE FROM code_outputs WHERE room_id = $1', [roomRow.id]);
      console.log(`Cleared ${result.rowCount} output records for room ${roomId}`);
    } catch (error) {
      console.error(`Error clearing output from database for room ${roomId}:`, error);
      throw error;
    }
  }

  // =========================
  // User Events Database Methods
  // =========================
  
  async saveUserEvent(roomId, userName, userId, eventType, eventData = null) {
    try {
      // Get room to ensure it exists and get db id
      const roomRow = await this.getRoom(roomId);
      if (!roomRow) {
        throw new Error(`Room ${roomId} not found`);
      }
      
      await db.query(
        'INSERT INTO user_events (room_id, user_name, user_id, event_type, event_data) VALUES ($1, $2, $3, $4, $5)',
        [roomRow.id, userName, userId, eventType, eventData ? JSON.stringify(eventData) : null]
      );
      
      console.log(`Saved user event for room ${roomId}: ${userName} - ${eventType}`);
    } catch (error) {
      console.error(`Error saving user event for room ${roomId}:`, error);
      throw error;
    }
  }

  async getUserEvents(roomId, limit = 50) {
    try {
      // Get room to ensure it exists and get db id
      const roomRow = await this.getRoom(roomId);
      if (!roomRow) {
        return [];
      }
      
      const result = await db.query(
        'SELECT user_name, user_id, event_type, event_data, created_at FROM user_events WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2',
        [roomRow.id, limit]
      );
      
      return result.rows.map(row => {
        let parsedData = null;
        if (row.event_data !== null && row.event_data !== undefined) {
          // `pg` returns JSONB columns as plain JS objects. However, older rows might be strings
          if (typeof row.event_data === 'string') {
            try {
              parsedData = JSON.parse(row.event_data);
            } catch (err) {
              console.warn('Failed to parse event_data string, returning raw value', err);
              parsedData = row.event_data;
            }
          } else {
            parsedData = row.event_data; // Already an object
          }
        }
        return {
          userName: row.user_name,
          userId: row.user_id,
          eventType: row.event_type,
          eventData: parsedData,
          timestamp: row.created_at.toISOString()
        };
      });
    } catch (error) {
      console.error(`Error getting user events for room ${roomId}:`, error);
      return [];
    }
  }
}

module.exports = new RoomService(); 