// Database manager for Nemo Chat (Local IndexedDB storage & workspace separation)
const DB_NAME = 'NemoChatDB';
const DB_VERSION = 2;

class ChatDatabase {
  constructor() {
    this.idb = null;
    this.currentWorkspace = 'personal'; // 'personal' or 'ooa'
    this.activeChannel = null;
  }

  async init(config = null) {
    await this.initIndexedDB();
    return this;
  }

  initIndexedDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          chatStore.createIndex('workspace', 'workspace', { unique: false });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('chatId', 'chatId', { unique: false });
          msgStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.idb = e.target.result;
        resolve(this.idb);
      };

      request.onerror = (e) => {
        console.error('IndexedDB error:', e.target.error);
        resolve(null);
      };
    });
  }

  // Chats CRUD
  async createChat(title = 'New Chat', workspace = this.currentWorkspace) {
    const chatId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const chat = {
      id: chatId,
      title: title,
      workspace: workspace,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      if (!this.idb) return resolve(chat);
      const tx = this.idb.transaction('chats', 'readwrite');
      const store = tx.objectStore('chats');
      const req = store.add(chat);
      req.onsuccess = () => resolve(chat);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllChats(workspace = this.currentWorkspace) {
    return new Promise((resolve) => {
      if (!this.idb) return resolve([]);
      const tx = this.idb.transaction('chats', 'readonly');
      const store = tx.objectStore('chats');
      const req = store.getAll();
      req.onsuccess = () => {
        const chats = (req.result || [])
          .filter(c => !c.workspace || c.workspace === workspace)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        resolve(chats);
      };
      req.onerror = () => resolve([]);
    });
  }

  async updateChatTitle(chatId, title) {
    return new Promise((resolve) => {
      if (!this.idb) return resolve(null);
      const tx = this.idb.transaction('chats', 'readwrite');
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
      getReq.onerror = () => resolve(null);
    });
  }

  async deleteChat(chatId) {
    return new Promise((resolve) => {
      if (!this.idb) return resolve(true);
      const tx = this.idb.transaction(['chats', 'messages'], 'readwrite');
      const chatStore = tx.objectStore('chats');
      const msgStore = tx.objectStore('messages');

      chatStore.delete(chatId);
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
      tx.onerror = () => resolve(true);
    });
  }

  // Messages CRUD
  async addMessage(chatId, role, content, attachments = [], thoughtData = null) {
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const msg = {
      id: msgId,
      chatId,
      role,
      content,
      attachments: attachments || [],
      thoughtData: thoughtData || null,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      if (!this.idb) return resolve(msg);
      const tx = this.idb.transaction(['messages', 'chats'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const chatStore = tx.objectStore('chats');
      msgStore.add(msg);
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
    return new Promise((resolve) => {
      if (!this.idb) return resolve([]);
      const tx = this.idb.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const req = store.getAll();
      req.onsuccess = () => {
        const msgs = (req.result || [])
          .filter(m => m.chatId === chatId)
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        resolve(msgs);
      };
      req.onerror = () => resolve([]);
    });
  }

  subscribeToChat(chatId, onNewMessage) {
    return null;
  }

  unsubscribeActiveChat() {}

  async clearAll(workspace = this.currentWorkspace) {
    if (!this.idb) return true;
    return new Promise((resolve) => {
      const tx = this.idb.transaction(['chats', 'messages'], 'readwrite');
      const chatStore = tx.objectStore('chats');
      const msgStore = tx.objectStore('messages');
      const chatIndex = chatStore.index('workspace');
      const req = chatIndex.openCursor(IDBKeyRange.only(workspace));

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const chatId = cursor.value.id;
          chatStore.delete(chatId);

          const msgIndex = msgStore.index('chatId');
          const msgReq = msgIndex.openKeyCursor(IDBKeyRange.only(chatId));
          msgReq.onsuccess = (me) => {
            const mcursor = me.target.result;
            if (mcursor) {
              msgStore.delete(mcursor.primaryKey);
              mcursor.continue();
            }
          };
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(true);
    });
  }
}

window.chatDb = new ChatDatabase();
