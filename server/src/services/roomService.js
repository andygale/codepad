const { randomUUID } = require('crypto');
const db = require('./dbService');

const usersByRoom = {};

class RoomService {
  constructor() {
    this.roomState = {};
    this.userNames = {};
  }

  async createRoom(title) {
    const roomId = randomUUID();
    try {
      const result = await db.query(
        'INSERT INTO rooms (room_id, title) VALUES ($1, $2) RETURNING *',
        [roomId, title]
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

  async getAllRooms() {
    try {
      const result = await db.query('SELECT * FROM rooms ORDER BY created_at DESC');
      return result.rows;
    } catch (error) {
      console.error('Error getting all rooms:', error);
      return [];
    }
  }

  async getOrCreateRoom(roomId) {
    // First try to get from database
    const dbRoom = await this.getRoom(roomId);
    if (dbRoom) {
      // Initialize in-memory state from database if not already loaded
      if (!this.roomState[roomId]) {
        this.roomState[roomId] = {
          code: dbRoom.code,
          language: dbRoom.language,
          outputHistory: []
        };
      }
      return this.roomState[roomId];
    }
    
    // Fallback to in-memory creation (shouldn't happen with persistent rooms)
    if (!this.roomState[roomId]) {
      this.roomState[roomId] = {
        code: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
        language: 'deno',
        outputHistory: []
      };
    }
    return this.roomState[roomId];
  }

  async updateRoomCode(roomId, code) {
    // Persist to database first
    try {
      await db.query('UPDATE rooms SET code = $1 WHERE room_id = $2', [code, roomId]);
      console.log(`Successfully updated code for room ${roomId}`);
    } catch (error) {
      console.error(`Error updating code for room ${roomId}:`, error);
      throw error; // Re-throw so socket handler can handle it
    }
    
    // Update in-memory state only after successful database update
    if (!this.roomState[roomId]) this.roomState[roomId] = {};
    this.roomState[roomId].code = code;
  }

  async updateRoomLanguage(roomId, language, code) {
    // Persist to database first
    try {
      const result = await db.query('UPDATE rooms SET language = $1, code = $2 WHERE room_id = $3', [language, code, roomId]);
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
  }

  addOutputToRoom(roomId, output) {
    if (!this.roomState[roomId]) this.roomState[roomId] = { outputHistory: [] };
    const timestamp = new Date().toLocaleString();
    if (!this.roomState[roomId].outputHistory) this.roomState[roomId].outputHistory = [];
    this.roomState[roomId].outputHistory.push({ timestamp, output });
    return this.roomState[roomId].outputHistory;
  }

  addUserToRoom(roomId, socketId, name) {
    if (!this.userNames[roomId]) this.userNames[roomId] = {};
    this.userNames[roomId][socketId] = { name: name || 'Anonymous', id: socketId };
    return Object.values(this.userNames[roomId]);
  }

  removeUserFromRoom(roomId, socketId) {
    if (this.userNames[roomId] && this.userNames[roomId][socketId]) {
      delete this.userNames[roomId][socketId];
      return Object.values(this.userNames[roomId]);
    }
    return [];
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
}

module.exports = new RoomService(); 