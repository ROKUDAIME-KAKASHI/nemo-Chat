// Application Logic for Mistral NeMo Chat
let currentChatId = null;
let abortController = null;

// Load from env.js if present
const env = window.ENV || {};

// Settings state
const settings = {
  apiKey: env.API_KEY || localStorage.getItem('nemo_api_key') || '',
  baseUrl: env.BASE_URL || localStorage.getItem('nemo_base_url') || 'https://api.aicredits.in/v1',
  modelName: env.MODEL_NAME || localStorage.getItem('nemo_model_name') || 'mistralai/mistral-nemo',
  systemPrompt: localStorage.getItem('nemo_system_prompt') || 'You are Mistral NeMo, a helpful, precise, and thoughtful AI assistant.'
};

// Auto-fix typo domain if cached in localStorage
if (settings.baseUrl.includes('aicreds.in')) {
  settings.baseUrl = 'https://api.aicredits.in/v1';
  localStorage.setItem('nemo_base_url', settings.baseUrl);
}
if (settings.modelName === 'mistral-nemo') {
  settings.modelName = 'mistralai/mistral-nemo';
  localStorage.setItem('nemo_model_name', settings.modelName);
}
if (env.API_KEY) {
  localStorage.setItem('nemo_api_key', env.API_KEY);
}

// DOM elements
const chatListEl = document.getElementById('chatList');
const messagesContainer = document.getElementById('messagesContainer');
const welcomeScreen = document.getElementById('welcomeScreen');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const chatTitleDisplay = document.getElementById('chatTitleDisplay');
const currentModelLabel = document.getElementById('currentModelLabel');

// Settings modal elements
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const baseUrlInput = document.getElementById('baseUrlInput');
const modelNameInput = document.getElementById('modelNameInput');
const systemPromptInput = document.getElementById('systemPromptInput');
const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');

// Configure marked options
if (window.marked) {
  marked.setOptions({
    highlight: function(code, lang) {
      if (window.hljs && lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return code;
    },
    breaks: true
  });
}

// Global helper for tip cards
window.setInput = function(text) {
  messageInput.value = text;
  adjustTextareaHeight();
  messageInput.focus();
};

// Initialize Application
async function initApp() {
  await window.chatDb.init();
  setupEventListeners();
  await loadChatList();

  // If running on a web server (e.g. Vercel or local proxy), fetch server configuration
  if (window.location.protocol.startsWith('http')) {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const serverConfig = await res.json();
        if (serverConfig.modelName && !localStorage.getItem('nemo_model_name')) {
          settings.modelName = serverConfig.modelName;
        }
        if (serverConfig.baseUrl && !localStorage.getItem('nemo_base_url')) {
          settings.baseUrl = serverConfig.baseUrl;
        }
      }
    } catch (_) {
      // Fallback silently if /api/config is not available
    }
  }

  updateModelBadge();
}

function updateModelBadge() {
  currentModelLabel.textContent = settings.modelName;
}

function setupEventListeners() {
  // New Chat
  newChatBtn.addEventListener('click', () => createNewChat());

  // Input auto-resize & keyboard send
  messageInput.addEventListener('input', adjustTextareaHeight);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);
  stopBtn.addEventListener('click', handleStop);

  // Clear history
  clearAllBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all chat history?')) {
      await window.chatDb.clearAll();
      currentChatId = null;
      await loadChatList();
      renderMessages([]);
      chatTitleDisplay.textContent = 'New Chat';
    }
  });

  // Settings Modal
  openSettingsBtn.addEventListener('click', openSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  saveSettingsBtn.addEventListener('click', saveSettings);
  toggleApiKeyVisibility.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Mobile sidebar toggle
  const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
  const sidebar = document.getElementById('sidebar');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}

function adjustTextareaHeight() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 180) + 'px';
}

// Settings Logic
function openSettings() {
  apiKeyInput.value = settings.apiKey;
  baseUrlInput.value = settings.baseUrl;
  modelNameInput.value = settings.modelName;
  systemPromptInput.value = settings.systemPrompt;
  settingsModal.style.display = 'flex';
}

function closeSettings() {
  settingsModal.style.display = 'none';
}

function saveSettings() {
  settings.apiKey = apiKeyInput.value.trim();
  settings.baseUrl = baseUrlInput.value.trim() || 'https://api.aicredits.in/v1';
  settings.modelName = modelNameInput.value.trim() || 'mistralai/mistral-nemo';
  settings.systemPrompt = systemPromptInput.value.trim();

  if (settings.apiKey) {
    localStorage.setItem('nemo_api_key', settings.apiKey);
  } else {
    localStorage.removeItem('nemo_api_key');
  }
  localStorage.setItem('nemo_base_url', settings.baseUrl);
  localStorage.setItem('nemo_model_name', settings.modelName);
  localStorage.setItem('nemo_system_prompt', settings.systemPrompt);

  updateModelBadge();
  closeSettings();
}

// Chat Management
async function loadChatList() {
  const chats = await window.chatDb.getAllChats();
  chatListEl.innerHTML = '';

  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
    item.innerHTML = `
      <span class="chat-item-title">${escapeHtml(chat.title)}</span>
      <button class="delete-chat-btn" title="Delete chat">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-chat-btn')) return;
      selectChat(chat.id);
    });

    const delBtn = item.querySelector('.delete-chat-btn');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.chatDb.deleteChat(chat.id);
      if (currentChatId === chat.id) {
        currentChatId = null;
        chatTitleDisplay.textContent = 'New Chat';
      }
      await loadChatList();
      if (!currentChatId) {
        renderMessages([]);
      }
    });

    chatListEl.appendChild(item);
  });

  if (!currentChatId && chats.length > 0) {
    selectChat(chats[0].id);
  } else if (!currentChatId) {
    renderMessages([]);
  }
}

async function createNewChat() {
  const chat = await window.chatDb.createChat();
  currentChatId = chat.id;
  await loadChatList();
  selectChat(chat.id);
  messageInput.focus();
}

async function selectChat(chatId) {
  currentChatId = chatId;
  const chats = await window.chatDb.getAllChats();
  const currentChat = chats.find(c => c.id === chatId);
  chatTitleDisplay.textContent = currentChat ? currentChat.title : 'New Chat';

  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const currentItem = [...chatListEl.children].find(el => el.textContent.includes(currentChat?.title));
  if (currentItem) currentItem.classList.add('active');

  const messages = await window.chatDb.getMessages(chatId);
  renderMessages(messages);
}

// Rendering Messages
function renderMessages(messages) {
  messagesContainer.innerHTML = '';

  if (!messages || messages.length === 0) {
    messagesContainer.appendChild(welcomeScreen);
    welcomeScreen.style.display = 'block';
    return;
  }

  welcomeScreen.style.display = 'none';
  messages.forEach(msg => {
    appendMessageElement(msg.role, msg.content, msg.id);
  });

  scrollToBottom();
}

function appendMessageElement(role, content = '', msgId = null) {
  welcomeScreen.style.display = 'none';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (msgId) row.dataset.id = msgId;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  avatar.textContent = role === 'user' ? 'U' : 'NM';

  const contentBox = document.createElement('div');
  contentBox.className = 'message-content';

  if (role === 'assistant') {
    contentBox.innerHTML = window.marked ? marked.parse(content) : escapeHtml(content);
    // Add copy action
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
      <button class="copy-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      </button>
    `;
    actions.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(contentBox.innerText);
      actions.querySelector('span').textContent = 'Copied!';
      setTimeout(() => actions.querySelector('span').textContent = 'Copy', 1500);
    });
    contentBox.appendChild(actions);
  } else {
    contentBox.textContent = content;
  }

  row.appendChild(avatar);
  row.appendChild(contentBox);
  messagesContainer.appendChild(row);
  scrollToBottom();

  return contentBox;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Handling Chat & API Streaming
async function handleSend() {
  const text = messageInput.value.trim();
  if (!text) return;

  const isHttp = window.location.protocol.startsWith('http');
  if (!isHttp && !settings.apiKey) {
    alert('Please provide your API key in Settings when running directly from a local file.');
    openSettings();
    return;
  }

  // Ensure an active chat session exists
  if (!currentChatId) {
    const newChat = await window.chatDb.createChat();
    currentChatId = newChat.id;
  }

  // Clear input
  messageInput.value = '';
  adjustTextareaHeight();

  // Save user message to DB
  await window.chatDb.addMessage(currentChatId, 'user', text);
  appendMessageElement('user', text);

  // Update chat title if it's the first message
  const messages = await window.chatDb.getMessages(currentChatId);
  if (messages.length === 1) {
    const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
    await window.chatDb.updateChatTitle(currentChatId, title);
    chatTitleDisplay.textContent = title;
    await loadChatList();
  }

  // Prepare message history for API
  const apiMessages = [
    { role: 'system', content: settings.systemPrompt }
  ];
  messages.forEach(m => {
    apiMessages.push({ role: m.role, content: m.content });
  });

  // Create UI element for assistant's pending response
  const assistantContentBox = appendMessageElement('assistant', '');
  toggleInputState(true);

  let fullResponse = '';
  abortController = new AbortController();

  try {
    let endpoint;
    let headers = { 'Content-Type': 'application/json' };
    let bodyPayload;

    if (isHttp) {
      // Use server proxy (Vercel serverless edge route or local server with env variables)
      endpoint = '/api/chat';
      bodyPayload = {
        apiKey: settings.apiKey || undefined,
        baseUrl: settings.baseUrl,
        model: settings.modelName,
        messages: apiMessages
      };
    } else {
      // Direct call if opened via file://
      const cleanBaseUrl = settings.baseUrl.replace(/\/+$/, '');
      endpoint = `${cleanBaseUrl}/chat/completions`;
      headers['Authorization'] = `Bearer ${settings.apiKey}`;
      bodyPayload = {
        model: settings.modelName,
        messages: apiMessages,
        stream: true
      };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(bodyPayload),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let isStreamDone = false;

    while (!isStreamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') {
            isStreamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const choice = parsed.choices?.[0];
            const token = choice?.delta?.content || '';
            if (token) {
              fullResponse += token;
              assistantContentBox.innerHTML = window.marked ? marked.parse(fullResponse) : escapeHtml(fullResponse);
              scrollToBottom();
            }
            if (choice?.finish_reason && choice.finish_reason !== null) {
              isStreamDone = true;
              break;
            }
          } catch (e) {
            // Ignore parse errors on partial chunks
          }
        }
      }
    }

    // Cancel reader if stream finished before socket close
    try {
      await reader.cancel();
    } catch (_) {}

    // Save final response to DB
    await window.chatDb.addMessage(currentChatId, 'assistant', fullResponse);

    // Add copy action button
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
      <button class="copy-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      </button>
    `;
    actions.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(fullResponse);
      actions.querySelector('span').textContent = 'Copied!';
      setTimeout(() => actions.querySelector('span').textContent = 'Copy', 1500);
    });
    assistantContentBox.appendChild(actions);

  } catch (error) {
    if (error.name === 'AbortError') {
      assistantContentBox.innerHTML += `<p><em>[Generation stopped]</em></p>`;
      if (fullResponse) {
        await window.chatDb.addMessage(currentChatId, 'assistant', fullResponse);
      }
    } else {
      console.error(error);
      let errMsg = escapeHtml(error.message);
      if (window.location.protocol === 'file:' && (errMsg.includes('fetch') || errMsg.includes('network'))) {
        errMsg += `<br><br><small style="color: var(--text-muted)">💡 <strong>Browser restriction:</strong> Browsers block network requests from <code>file://</code> URLs. Please double-click <strong>run.bat</strong> or execute <code>python server.py</code> in the folder to open the app on <code>http://localhost:3000</code>.</small>`;
      }
      assistantContentBox.innerHTML = `<p style="color: var(--danger)"><strong>Error:</strong> ${errMsg}</p>`;
    }
  } finally {
    toggleInputState(false);
    abortController = null;
  }
}

function handleStop() {
  if (abortController) {
    abortController.abort();
  }
}

function toggleInputState(isGenerating) {
  sendBtn.style.display = isGenerating ? 'none' : 'flex';
  stopBtn.style.display = isGenerating ? 'flex' : 'none';
  messageInput.disabled = isGenerating;
  if (!isGenerating) {
    messageInput.focus();
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Run app on load
window.addEventListener('DOMContentLoaded', initApp);
