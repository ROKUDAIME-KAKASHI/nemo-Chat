// Database manager for Nemo Chat
// Private workspace: 100% local IndexedDB storage (completely private to each user)
// OOA Team workspace: Cloud sync & Realtime multi-user collaboration via Supabase
const DB_NAME = 'NemoChatDB';
const DB_VERSION = 2;

class ChatDatabase {
  constructor() {
    this.idb = null;
    this.supabase = null;
    this.currentWorkspace = 'personal'; // 'personal' or 'ooa'
    this.activeChannel = null;
  }

  async init(supabaseConfig = null) {
    // 1. Initialize local IndexedDB
    await this.initIndexedDB();

    // 2. Initialize Supabase if credentials are provided
    if (supabaseConfig?.url && supabaseConfig?.key && window.supabase) {
      try {
        let url = (supabaseConfig.url || '').trim();
        let key = (supabaseConfig.key || '').trim();

        if (url.startsWith('db.')) {
          url = 'https://' + url.replace(/^db\./, '');
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }

        this.supabase = window.supabase.createClient(url, key);
      } catch (err) {
        console.warn('Optional Supabase init warning:', err);
      }
    }

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

    // If in OOA team workspace and Supabase is connected, store in Cloud
    if (workspace === 'ooa' && this.supabase) {
      try {
        const nowIso = new Date().toISOString();
        const { data, error } = await this.supabase
          .from('chats')
          .insert({
            id: chatId,
            title: title,
            workspace: 'ooa',
            created_at: nowIso,
            updated_at: nowIso
          })
          .select()
          .single();

        if (!error && data) {
          return {
            id: data.id,
            title: data.title,
            workspace: data.workspace,
            createdAt: new Date(data.created_at).getTime(),
            updatedAt: new Date(data.updated_at).getTime()
          };
        }
      } catch (err) {
        console.warn('Supabase createChat fallback to local:', err);
      }
    }

    // Local IndexedDB fallback / Private workspace
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
    // If in OOA team workspace, retrieve shared team rooms from Cloud
    if (workspace === 'ooa' && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('chats')
          .select('*')
          .eq('workspace', 'ooa')
          .order('updated_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return data.map(d => ({
            id: d.id,
            title: d.title,
            workspace: d.workspace,
            createdAt: new Date(d.created_at).getTime(),
            updatedAt: new Date(d.updated_at).getTime()
          }));
        } else if (!error && (!data || data.length === 0)) {
          // Auto-initialize the default shared room
          const mainRoom = await this.createChat('OOA Team Room', 'ooa');
          return [mainRoom];
        }
      } catch (err) {
        console.warn('Supabase getAllChats fallback to local:', err);
      }
    }

    // Private workspace: 100% local from IndexedDB
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
    if (this.currentWorkspace === 'ooa' && this.supabase) {
      try {
        await this.supabase
          .from('chats')
          .update({ title: title, updated_at: new Date().toISOString() })
          .eq('id', chatId);
      } catch (_) {}
    }

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
    if (this.currentWorkspace === 'ooa' && this.supabase) {
      try {
        await this.supabase.from('chats').delete().eq('id', chatId);
      } catch (_) {}
    }

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
  async addMessage(chatId, role, content, attachments = [], thoughtData = null, authorName = 'You') {
    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const displayName = role === 'user' ? (authorName || 'Teammate') : 'Mistral NeMo';

    // If in OOA team workspace, broadcast and store in Supabase
    if (this.currentWorkspace === 'ooa' && this.supabase) {
      try {
        const nowIso = new Date().toISOString();
        await this.supabase.from('messages').insert({
          id: msgId,
          chat_id: chatId,
          user_email: displayName,
          role: role,
          content: content,
          attachments: attachments || [],
          thought_data: thoughtData || {},
          created_at: nowIso
        });

        await this.supabase
          .from('chats')
          .update({ updated_at: nowIso })
          .eq('id', chatId);

        return {
          id: msgId,
          chatId,
          role,
          content,
          attachments,
          thoughtData,
          userEmail: displayName,
          timestamp: Date.now()
        };
      } catch (err) {
        console.warn('Supabase addMessage fallback to local:', err);
      }
    }

    // Local IndexedDB storage (Private workspace)
    const msg = {
      id: msgId,
      chatId,
      role,
      content,
      attachments,
      thoughtData,
      userEmail: displayName,
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
    // If in OOA team workspace, fetch shared messages from Cloud
    if (this.currentWorkspace === 'ooa' && this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          return data.map(m => ({
            id: m.id,
            chatId: m.chat_id,
            role: m.role,
            content: m.content,
            attachments: m.attachments || [],
            thoughtData: m.thought_data || null,
            userEmail: m.user_email || '',
            timestamp: new Date(m.created_at).getTime()
          }));
        }
      } catch (err) {
        console.warn('Supabase getMessages fallback to local:', err);
      }
    }

    // Private workspace: from local IndexedDB
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

  // Realtime subscription for OOA team room
  subscribeToChat(chatId, onNewMessage) {
    if (!this.supabase) return null;

    if (this.activeChannel) {
      this.supabase.removeChannel(this.activeChannel);
      this.activeChannel = null;
    }

    this.activeChannel = this.supabase
      .channel(`chat_${chatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const m = payload.new;
          if (m) {
            onNewMessage({
              id: m.id,
              chatId: m.chat_id,
              role: m.role,
              content: m.content,
              attachments: m.attachments || [],
              thoughtData: m.thought_data || null,
              userEmail: m.user_email || '',
              timestamp: new Date(m.created_at).getTime()
            });
          }
        }
      )
      .subscribe();

    return this.activeChannel;
  }

  unsubscribeActiveChat() {
    if (this.supabase && this.activeChannel) {
      this.supabase.removeChannel(this.activeChannel);
      this.activeChannel = null;
    }
  }

  async clearAll(workspace = this.currentWorkspace) {
    if (workspace === 'ooa' && this.supabase) {
      try {
        await this.supabase.from('chats').delete().eq('workspace', 'ooa');
      } catch (_) {}
    }

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
