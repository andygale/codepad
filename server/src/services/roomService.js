const { randomUUID } = require('crypto');
const db = require('./dbService');

const usersByRoom = {};

class RoomService {
  constructor() {
    this.roomState = {};
    this.userNames = {};
  }

  async createRoom(title, creator, creator_email) {
    const roomId = randomUUID();
    const defaultCode = `class Greeter {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
  greet(): void {
    console.log(this.message);
  }
}

const greeter = new Greeter('Hello, world!');
greeter.greet();`;
    const defaultLanguage = 'deno';
    
    try {
      const result = await db.query(
        'INSERT INTO rooms (room_id, title, creator, creator_email, code, language) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
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

  clearOutputHistory(roomId) {
    if (this.roomState[roomId]) {
      this.roomState[roomId].outputHistory = [];
    }
    return [];
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

  // =========================
  // Playback helpers
  // =========================
  async recordSnapshot(roomUuid, code) {
    // ensure room exists
    const roomRow = await this.getRoom(roomUuid);
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

  async getHistory(roomUuid) {
    const roomRow = await this.getRoom(roomUuid);
    if (!roomRow) return [];
    const dbRoomId = roomRow.id;
    const res = await db.query(
      'SELECT seq, code_snapshot FROM edit_history WHERE room_id=$1 ORDER BY seq ASC',
      [dbRoomId]
    );
    return res.rows;
  }
}

module.exports = new RoomService(); 