// Simple in-memory database for testing
// This will be replaced with proper database later

class InMemoryDB {
  constructor() {
    this.users = new Map();
    this.characters = new Map();
    this.sessions = new Map();
    this.messages = new Map();
  }

  // User operations
  async createUser(userData) {
    const id = this.generateId();
    const user = {
      id,
      ...userData,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async findUserByEmail(email) {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async findUserByUsername(username) {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  async findUserByPhone(phone_number) {
    for (const user of this.users.values()) {
      if (user.phone_number === phone_number) return user;
    }
    return null;
  }

  async findUserById(id) {
    return this.users.get(id) || null;
  }

  async findUserByIdentifier(identifier) {
    // Try email first
    let user = await this.findUserByEmail(identifier);
    if (user) return user;

    // Try username
    user = await this.findUserByUsername(identifier);
    if (user) return user;

    // Try phone
    user = await this.findUserByPhone(identifier);
    return user;
  }

  // Character operations
  async createCharacter(characterData) {
    const id = this.generateId();
    const character = {
      id,
      ...characterData,
      created_at: new Date(),
      updated_at: new Date()
    };
    this.characters.set(id, character);
    return character;
  }

  async findCharacterById(id) {
    return this.characters.get(id) || null;
  }

  async findCharactersByOwner(owner_id) {
    const userCharacters = [];
    for (const character of this.characters.values()) {
      if (character.owner_id === owner_id) {
        userCharacters.push(character);
      }
    }
    return userCharacters;
  }

  // Session operations
  async createSession(sessionData) {
    const id = this.generateId();
    const session = {
      id,
      ...sessionData,
      created_at: new Date(),
      ad_counter: 0
    };
    this.sessions.set(id, session);
    return session;
  }

  async findSessionById(id) {
    return this.sessions.get(id) || null;
  }

  async updateSession(id, updates) {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates, { updated_at: new Date() });
      this.sessions.set(id, session);
    }
    return session;
  }

  // Message operations
  async createMessage(messageData) {
    const id = this.generateId();
    const message = {
      id,
      ...messageData,
      created_at: new Date()
    };
    this.messages.set(id, message);
    return message;
  }

  async findMessagesBySession(session_id, limit = 20) {
    const sessionMessages = [];
    for (const message of this.messages.values()) {
      if (message.session_id === session_id) {
        sessionMessages.push(message);
      }
    }
    return sessionMessages
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-limit);
  }

  // Utility methods
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Clear all data (for testing)
  clear() {
    this.users.clear();
    this.characters.clear();
    this.sessions.clear();
    this.messages.clear();
  }
}

// Export singleton instance
export const db = new InMemoryDB();
export default db;
