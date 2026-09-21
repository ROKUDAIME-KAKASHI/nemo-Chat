// IndexedDB database manager for Nemo Chat
const DB_NAME = 'NemoChatDB';
const DB_VERSION = 1;

class ChatDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Chats store: id, title, createdAt, updatedAt
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Messages store: id, chatId, role, content, timestamp
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('chatId', 'chatId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  // Chats CRUD
  async createChat(title = 'New Chat') {
    const chat = {
      id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: title,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readwrite');
      const store = tx.objectStore('chats');
      const req = store.add(chat);
      req.onsuccess = () => resolve(chat);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllChats() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readonly');
      const store = tx.objectStore('chats');
      const index = store.index('updatedAt');
      const req = index.openCursor(null, 'prev'); // Most recent first
      const chats = [];

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          chats.push(cursor.value);
          cursor.continue();
        } else {
          resolve(chats);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async updateChatTitle(chatId, title) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chats', 'readwrite');
      const store = tx.objectStore('chats');
      const getReq = store.get(chatId);

      getReq.onsuccess = () => {
        const chat = getReq.result;
        if (chat) {
          chat.title = title;
          chat.updatedAt = Date.now();
          store.put(chat);
          resolve(chat);
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async deleteChat(chatId) {
    return new Promise(async (resolve, reject) => {
      const tx = this.db.transaction(['chats', 'messages'], 'readwrite');
      const chatStore = tx.objectStore('chats');
      const msgStore = tx.objectStore('messages');

      chatStore.delete(chatId);

      // Delete associated messages
      const msgIndex = msgStore.index('chatId');
      const msgReq = msgIndex.openKeyCursor(IDBKeyRange.only(chatId));

      msgReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          msgStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Messages CRUD
  async addMessage(chatId, role, content, attachments = []) {
    const msg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      chatId,
      role,
      content,
      attachments,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages', 'chats'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const chatStore = tx.objectStore('chats');

      msgStore.add(msg);

      // Update chat updatedAt timestamp
      const chatReq = chatStore.get(chatId);
      chatReq.onsuccess = () => {
        const chat = chatReq.result;
        if (chat) {
          chat.updatedAt = Date.now();
          chatStore.put(chat);
        }
      };

      tx.oncomplete = () => resolve(msg);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getMessages(chatId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('timestamp');
      const req = index.openCursor();
      const messages = [];

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.chatId === chatId) {
            messages.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(messages);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['chats', 'messages'], 'readwrite');
      tx.objectStore('chats').clear();
      tx.objectStore('messages').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
}

window.chatDb = new ChatDatabase();
