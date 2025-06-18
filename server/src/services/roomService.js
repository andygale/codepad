class RoomService {
  constructor() {
    this.roomState = {};
    this.userNames = {};
  }

  getOrCreateRoom(roomId) {
    if (!this.roomState[roomId]) {
      this.roomState[roomId] = {
        code: `class Greeter {\n  message: string;\n  constructor(message: string) {\n    this.message = message;\n  }\n  greet(): void {\n    console.log(this.message);\n  }\n}\n\nconst greeter = new Greeter('Hello, world!');\ngreeter.greet();`,
        language: 'deno',
        outputHistory: []
      };
    }
    return this.roomState[roomId];
  }

  updateRoomCode(roomId, code) {
    if (!this.roomState[roomId]) this.roomState[roomId] = {};
    this.roomState[roomId].code = code;
  }

  updateRoomLanguage(roomId, language, code) {
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