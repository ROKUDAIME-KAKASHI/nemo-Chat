// Application Logic for Mistral NeMo Chat
let currentChatId = null;
let abortController = null;
let pendingAttachments = []; // [{ id, name, size, type, content }]

// Configure PDF.js worker if available
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

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

// Workspace & Auth elements
let currentWorkspace = 'personal'; // 'personal' or 'ooa'
let authMode = 'signin'; // 'signin' or 'signup'
const tabPersonal = document.getElementById('tabPersonal');
const tabOOA = document.getElementById('tabOOA');
const newChatBtnText = document.getElementById('newChatBtnText');
const authBtn = document.getElementById('authBtn');
const authBtnLabel = document.getElementById('authBtnLabel');
const authModal = document.getElementById('authModal');
const closeAuthBtn = document.getElementById('closeAuthBtn');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authErrorMsg = document.getElementById('authErrorMsg');
const tabSignIn = document.getElementById('tabSignIn');
const tabSignUp = document.getElementById('tabSignUp');
const authModalTitle = document.getElementById('authModalTitle');

// Attachment elements
const attachmentTray = document.getElementById('attachmentTray');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const dragOverlay = document.getElementById('dragOverlay');

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
const supabaseUrlInput = document.getElementById('supabaseUrlInput');
const supabaseAnonKeyInput = document.getElementById('supabaseAnonKeyInput');

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
  let sbUrl = localStorage.getItem('nemo_supabase_url') || env.SUPABASE_URL || '';
  let sbKey = localStorage.getItem('nemo_supabase_anon_key') || env.SUPABASE_ANON_KEY || '';

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
        if (serverConfig.supabaseUrl) {
          sbUrl = serverConfig.supabaseUrl;
        }
        if (serverConfig.supabaseAnonKey) {
          sbKey = serverConfig.supabaseAnonKey;
        }
      }
    } catch (_) {
      // Fallback silently if /api/config is not available
    }
  }

  await window.chatDb.init({ url: sbUrl, key: sbKey });

  // Listen to auth state changes from Supabase
  window.chatDb.onAuthStateChange((event, session) => {
    updateAuthUI(session);
  });

  updateAuthUI(window.chatDb.currentUser ? { user: window.chatDb.currentUser } : null);

  setupEventListeners();
  await loadChatList();
  updateModelBadge();
}

// Workspace & Auth Helpers
function updateAuthUI(session) {
  const user = session?.user || window.chatDb.currentUser;
  if (user) {
    const email = user.email || '';
    const shortName = email.split('@')[0] || 'User';
    authBtnLabel.textContent = shortName;
    authBtn.title = `Signed in as ${email}. Click to sign out.`;
  } else {
    authBtnLabel.textContent = 'Sign In';
    authBtn.title = 'Sign In / Register';
  }
}

function openAuthModal(mode = 'signin') {
  authMode = mode;
  authErrorMsg.style.display = 'none';
  authErrorMsg.textContent = '';
  if (authMode === 'signin') {
    tabSignIn.classList.add('active');
    tabSignUp.classList.remove('active');
    authModalTitle.textContent = 'Sign In';
    authSubmitBtn.textContent = 'Sign In';
  } else {
    tabSignUp.classList.add('active');
    tabSignIn.classList.remove('active');
    authModalTitle.textContent = 'Create Account';
    authSubmitBtn.textContent = 'Create Account';
  }
  authModal.style.display = 'flex';
  authEmail.focus();
}

function closeAuthModal() {
  authModal.style.display = 'none';
  authErrorMsg.style.display = 'none';
  authForm.reset();
}

async function switchWorkspace(ws) {
  if (currentWorkspace === ws) return;

  if (ws === 'ooa' && !window.chatDb.currentUser) {
    const proceed = confirm('OOA Team Room requires signing in so your teammates can see your messages. Sign in now?');
    if (proceed) {
      openAuthModal('signin');
    }
    return;
  }

  currentWorkspace = ws;
  window.chatDb.currentWorkspace = ws;

  if (ws === 'personal') {
    tabPersonal.classList.add('active');
    tabOOA.classList.remove('active');
    newChatBtnText.textContent = 'New Chat';
  } else {
    tabOOA.classList.add('active');
    tabPersonal.classList.remove('active');
    newChatBtnText.textContent = 'New Team Room';
  }

  window.chatDb.unsubscribeActiveChat();
  currentChatId = null;
  await loadChatList();
}

function updateModelBadge() {
  currentModelLabel.textContent = settings.modelName;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];

// Lazy-load Tesseract.js only when an image or scanned document needs OCR
let tesseractLoadedPromise = null;
function loadTesseract() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (!tesseractLoadedPromise) {
    tesseractLoadedPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error('Failed to load OCR engine. Please check your network connection.'));
      document.head.appendChild(script);
    });
  }
  return tesseractLoadedPromise;
}

async function runOCR(imageSource, onProgress) {
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        const pct = Math.round((m.progress || 0) * 100);
        onProgress(`OCR: ${pct}%`);
      } else if (onProgress && m.status && m.status !== 'recognizing text') {
        onProgress('Analyzing...');
      }
    }
  });
  const ret = await worker.recognize(imageSource);
  await worker.terminate();
  return (ret && ret.data && ret.data.text) ? ret.data.text.trim() : '';
}

async function parseFile(file, onProgress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext) || (file.type && file.type.startsWith('image/'));
  let content = '';

  if (isImage) {
    if (onProgress) onProgress('Starting OCR...');
    content = await runOCR(file, onProgress);
    if (!content) {
      content = '[Image was processed with OCR, but no text could be detected.]';
    }
  } else if (ext === 'pdf') {
    if (!window.pdfjsLib) {
      throw new Error('PDF parsing library is not ready.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullPdfText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(`Reading Page ${i}/${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageStrings = textContent.items.map(item => item.str).filter(Boolean);
      const pageText = pageStrings.join(' ').trim();
      if (pageText) {
        fullPdfText += `--- Page ${i} ---\n${pageText}\n\n`;
      }
    }

    // Fallback to OCR if PDF has no selectable digital text (scanned document)
    if (!fullPdfText.trim()) {
      if (onProgress) onProgress('Scanned PDF detected. Running OCR...');
      let ocrText = '';
      const maxOcrPages = Math.min(pdf.numPages, 10);
      for (let i = 1; i <= maxOcrPages; i++) {
        if (onProgress) onProgress(`OCR Page ${i}/${maxOcrPages}...`);
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        const pageOcr = await runOCR(canvas, p => {
          if (onProgress) onProgress(`P.${i} ${p}`);
        });
        if (pageOcr) {
          ocrText += `--- Page ${i} (Scanned OCR) ---\n${pageOcr}\n\n`;
        }
      }
      fullPdfText = ocrText;
    }

    content = fullPdfText.trim();
    if (!content) {
      content = '[Note: PDF document appears to have no selectable text or readable handwriting.]';
    }
  } else {
    // Plain text, code files, CSV, JSON, Markdown, YAML, logs, etc.
    content = await file.text();
  }

  return content;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) {
      alert(`File "${file.name}" is too large (max 25MB).`);
      continue;
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImage = IMAGE_EXTS.includes(ext) || (file.type && file.type.startsWith('image/'));

    const attItem = {
      id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: file.name || (isImage ? 'pasted-image.png' : 'file'),
      size: file.size,
      type: ext || (isImage ? 'png' : 'txt'),
      isImage: isImage,
      isPdf: ext === 'pdf',
      status: 'processing',
      statusText: isImage ? 'Initializing OCR...' : 'Reading...',
      content: ''
    };

    pendingAttachments.push(attItem);
    renderAttachmentTray();

    try {
      const content = await parseFile(file, (msg) => {
        attItem.statusText = msg;
        renderAttachmentTray();
      });
      attItem.content = content;
      attItem.status = 'ready';
      attItem.statusText = '';
    } catch (err) {
      console.error('Failed to parse file:', file.name, err);
      attItem.status = 'error';
      attItem.statusText = 'Error reading';
      alert(`Could not process "${file.name}": ${err.message}`);
    }

    renderAttachmentTray();
  }

  messageInput.focus();
}

function renderAttachmentTray() {
  if (!attachmentTray) return;
  if (!pendingAttachments.length) {
    attachmentTray.style.display = 'none';
    attachmentTray.innerHTML = '';
    return;
  }

  attachmentTray.style.display = 'flex';
  attachmentTray.innerHTML = '';

  pendingAttachments.forEach(att => {
    const chip = document.createElement('div');
    chip.className = `attachment-chip ${att.status === 'processing' ? 'processing' : ''}`;
    let icon = '📝';
    if (att.isPdf) icon = '📄';
    else if (att.isImage) icon = '🖼️';

    chip.innerHTML = `
      <span class="chip-icon">${icon}</span>
      <span class="chip-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</span>
      <span class="chip-size">(${formatFileSize(att.size)})</span>
      ${att.statusText ? `<span class="chip-status">${escapeHtml(att.statusText)}</span>` : ''}
      <button type="button" class="chip-remove" title="Remove attachment">&times;</button>
    `;

    chip.querySelector('.chip-remove').addEventListener('click', () => {
      pendingAttachments = pendingAttachments.filter(a => a.id !== att.id);
      renderAttachmentTray();
    });

    attachmentTray.appendChild(chip);
  });
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

  // File Attach Button
  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      fileInput.value = '';
    });
  }

  // Paste file from clipboard
  messageInput.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      handleFiles(e.clipboardData.files);
    }
  });

  // Drag and Drop files onto chat area
  const chatArea = document.querySelector('.chat-area');
  if (chatArea && dragOverlay) {
    let dragCounter = 0;
    ['dragenter', 'dragover'].forEach(eventName => {
      chatArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    chatArea.addEventListener('dragenter', (e) => {
      dragCounter++;
      if (dragCounter === 1) {
        dragOverlay.style.display = 'flex';
      }
    });

    chatArea.addEventListener('dragleave', (e) => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dragOverlay.style.display = 'none';
      }
    });

    chatArea.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dragOverlay.style.display = 'none';
      if (e.dataTransfer && e.dataTransfer.files) {
        handleFiles(e.dataTransfer.files);
      }
    });
  }

  // Workspace Tabs
  if (tabPersonal) {
    tabPersonal.addEventListener('click', () => switchWorkspace('personal'));
  }
  if (tabOOA) {
    tabOOA.addEventListener('click', () => switchWorkspace('ooa'));
  }

  // Auth Button (Sign In / Account Sign Out)
  if (authBtn) {
    authBtn.addEventListener('click', async () => {
      if (window.chatDb.currentUser) {
        const confirmLogout = confirm(`Signed in as ${window.chatDb.currentUser.email}. Do you want to sign out?`);
        if (confirmLogout) {
          await window.chatDb.signOut();
          updateAuthUI(null);
          await switchWorkspace('personal');
          await loadChatList();
        }
      } else {
        openAuthModal('signin');
      }
    });
  }

  // Auth Modal Controls
  if (closeAuthBtn) {
    closeAuthBtn.addEventListener('click', closeAuthModal);
  }
  if (tabSignIn) {
    tabSignIn.addEventListener('click', () => openAuthModal('signin'));
  }
  if (tabSignUp) {
    tabSignUp.addEventListener('click', () => openAuthModal('signup'));
  }
  if (authModal) {
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });
  }

  // Auth Form Submission
  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authEmail.value.trim();
      const password = authPassword.value;
      if (!email || !password) return;

      authSubmitBtn.disabled = true;
      authSubmitBtn.textContent = 'Please wait...';
      authErrorMsg.style.display = 'none';

      try {
        if (authMode === 'signin') {
          await window.chatDb.signIn(email, password);
        } else {
          await window.chatDb.signUp(email, password);
          alert('Account registered successfully! You are now signed in.');
        }
        closeAuthModal();
        updateAuthUI({ user: window.chatDb.currentUser });
        await loadChatList();
      } catch (err) {
        console.error('Auth error:', err);
        authErrorMsg.textContent = err.message || 'Authentication failed. Please check your credentials.';
        authErrorMsg.style.display = 'block';
      } finally {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
      }
    });
  }

  // Clear history for current workspace
  clearAllBtn.addEventListener('click', async () => {
    const wsLabel = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'Private';
    if (confirm(`Are you sure you want to delete all chat history in the ${wsLabel} workspace?`)) {
      await window.chatDb.clearAll(currentWorkspace);
      currentChatId = null;
      await loadChatList();
      renderMessages([]);
      chatTitleDisplay.textContent = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat';
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
  if (supabaseUrlInput) {
    supabaseUrlInput.value = localStorage.getItem('nemo_supabase_url') || env.SUPABASE_URL || '';
  }
  if (supabaseAnonKeyInput) {
    supabaseAnonKeyInput.value = localStorage.getItem('nemo_supabase_anon_key') || env.SUPABASE_ANON_KEY || '';
  }
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

  const newSbUrl = supabaseUrlInput ? supabaseUrlInput.value.trim() : '';
  const newSbKey = supabaseAnonKeyInput ? supabaseAnonKeyInput.value.trim() : '';
  if (newSbUrl) localStorage.setItem('nemo_supabase_url', newSbUrl);
  if (newSbKey) localStorage.setItem('nemo_supabase_anon_key', newSbKey);

  if (newSbUrl || newSbKey) {
    window.chatDb.init({
      url: newSbUrl || env.SUPABASE_URL,
      key: newSbKey || env.SUPABASE_ANON_KEY
    }).then(() => {
      updateAuthUI(window.chatDb.currentUser ? { user: window.chatDb.currentUser } : null);
      loadChatList();
    });
  }

  updateModelBadge();
  closeSettings();
}

// Chat Management
async function loadChatList() {
  const chats = await window.chatDb.getAllChats(currentWorkspace);
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
        chatTitleDisplay.textContent = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat';
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
    chatTitleDisplay.textContent = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat';
    renderMessages([]);
  }
}

async function createNewChat() {
  const defaultTitle = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat';
  const chat = await window.chatDb.createChat(defaultTitle, currentWorkspace);
  currentChatId = chat.id;
  await loadChatList();
  selectChat(chat.id);
  messageInput.focus();
}

async function selectChat(chatId) {
  currentChatId = chatId;
  window.chatDb.unsubscribeActiveChat();

  const chats = await window.chatDb.getAllChats(currentWorkspace);
  const currentChat = chats.find(c => c.id === chatId);
  chatTitleDisplay.textContent = currentChat ? currentChat.title : (currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat');

  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const currentItem = [...chatListEl.children].find(el => el.textContent.includes(currentChat?.title));
  if (currentItem) currentItem.classList.add('active');

  const messages = await window.chatDb.getMessages(chatId);
  renderMessages(messages);

  // Subscribe to real-time updates for team room in OOA workspace
  if (currentWorkspace === 'ooa') {
    window.chatDb.subscribeToChat(chatId, (newMsg) => {
      if (!document.querySelector(`.message-row[data-id="${newMsg.id}"]`)) {
        appendMessageElement(newMsg.role, newMsg.content, newMsg.id, newMsg.attachments, newMsg.thoughtData, newMsg.userEmail);
      }
    });
  }
}

// Claude-style reasoning parser
function parseThoughtFromText(fullText) {
  let thought = '';
  let answer = fullText;

  // Match complete <think>...</think> or <thought>...</thought>
  const thinkMatch = fullText.match(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/i);
  if (thinkMatch) {
    thought = thinkMatch[1].trim();
    answer = fullText.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/i, '').trim();
  } else {
    // Match unclosed opening tag during live streaming
    const openMatch = fullText.match(/<(?:think|thought)>([\s\S]*)$/i);
    if (openMatch) {
      thought = openMatch[1].trim();
      answer = '';
    }
  }

  return { thought, answer };
}

// Rendering Messages
function renderMessages(messages) {
  messagesContainer.innerHTML = '';

  if (!messages || messages.length === 0) {
    const h2 = welcomeScreen.querySelector('h2');
    const p = welcomeScreen.querySelector('p');
    if (currentWorkspace === 'ooa') {
      if (h2) h2.textContent = 'OOA Team Workspace';
      if (p) p.textContent = 'Real-time collaborative AI room for OOA team members.';
    } else {
      if (h2) h2.textContent = 'Pondering with NeMo';
      if (p) p.textContent = 'Thoughtful reasoning powered by Mistral NeMo & your secure account.';
    }
    messagesContainer.appendChild(welcomeScreen);
    welcomeScreen.style.display = 'block';
    return;
  }

  welcomeScreen.style.display = 'none';
  messages.forEach(msg => {
    appendMessageElement(msg.role, msg.content, msg.id, msg.attachments, msg.thoughtData, msg.userEmail);
  });

  scrollToBottom();
}

function appendMessageElement(role, content = '', msgId = null, attachments = [], thoughtData = null, userEmail = '') {
  welcomeScreen.style.display = 'none';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (msgId) row.dataset.id = msgId;

  const avatar = document.createElement('div');
  avatar.className = `avatar ${role}`;
  if (role === 'user') {
    const initial = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';
    avatar.textContent = initial;
    if (userEmail) avatar.title = userEmail;
  } else {
    avatar.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"></path>
      </svg>
    `;
    avatar.title = 'Mistral NeMo';
  }

  const contentBox = document.createElement('div');
  contentBox.className = 'message-content';

  if (role === 'user') {
    // Show sender badge in OOA team room
    if (currentWorkspace === 'ooa' || (userEmail && userEmail !== 'You')) {
      const authorTag = document.createElement('div');
      authorTag.className = 'message-author-tag';
      const displayName = userEmail ? userEmail.split('@')[0] : 'Teammate';
      authorTag.textContent = `👤 ${displayName}`;
      contentBox.appendChild(authorTag);
    }

    if (attachments && attachments.length > 0) {
      const attachWrapper = document.createElement('div');
      attachWrapper.className = 'message-attachments';
      attachWrapper.innerHTML = attachments.map(att => {
        let icon = '📎';
        if (att.type === 'pdf') icon = '📄';
        else if (IMAGE_EXTS.includes(att.type)) icon = '🖼️';
        return `
          <span class="attachment-badge">
            <span>${icon}</span>
            <span>${escapeHtml(att.name)}</span>
            <small>(${formatFileSize(att.size)})</small>
          </span>
        `;
      }).join('');
      contentBox.appendChild(attachWrapper);
    }
    const textEl = document.createElement('div');
    textEl.className = 'message-text';
    textEl.textContent = content;
    contentBox.appendChild(textEl);
  } else {
    // Assistant Message with Claude Thinking / Pondering
    let thoughtText = thoughtData?.thought || '';
    let thoughtSeconds = thoughtData?.seconds || 0;
    let answerText = content;

    const parsed = parseThoughtFromText(content);
    if (parsed.thought) {
      thoughtText = parsed.thought;
      answerText = parsed.answer;
    }

    let thoughtBox = null;
    if (thoughtData?.isLive) {
      // Live streaming thought box
      thoughtBox = document.createElement('div');
      thoughtBox.className = 'claude-thought-box is-thinking';
      thoughtBox.innerHTML = `
        <div class="claude-thought-header">
          <span class="claude-thought-shimmer">
            <svg class="claude-sparkle-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"></path>
            </svg>
            <span class="claude-thought-status">Thinking...</span>
            <span class="claude-thought-timer">(0s)</span>
          </span>
          <svg class="claude-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="claude-thought-body">
          <div class="claude-thought-content">Pondering the prompt and formulating response...</div>
        </div>
      `;
      thoughtBox.querySelector('.claude-thought-header').addEventListener('click', () => {
        thoughtBox.classList.toggle('collapsed');
      });
      contentBox.appendChild(thoughtBox);
    } else if (thoughtText || thoughtSeconds > 0) {
      // Finished thought accordion
      thoughtBox = document.createElement('div');
      thoughtBox.className = 'claude-thought-box collapsed';
      const label = thoughtSeconds > 0 ? `Thought for ${thoughtSeconds} second${thoughtSeconds === 1 ? '' : 's'}` : 'Thought process';
      thoughtBox.innerHTML = `
        <div class="claude-thought-header">
          <span class="claude-thought-shimmer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"></path>
            </svg>
            <span style="font-weight: 500; color: var(--accent);">${label}</span>
          </span>
          <svg class="claude-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="claude-thought-body">
          <div class="claude-thought-content">${escapeHtml(thoughtText || 'Reasoned across prompt and context.')}</div>
        </div>
      `;
      thoughtBox.querySelector('.claude-thought-header').addEventListener('click', () => {
        thoughtBox.classList.toggle('collapsed');
      });
      contentBox.appendChild(thoughtBox);
    }

    const textEl = document.createElement('div');
    textEl.className = 'message-text';
    textEl.innerHTML = window.marked ? marked.parse(answerText) : escapeHtml(answerText);
    contentBox.appendChild(textEl);

    if (content) {
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
        navigator.clipboard.writeText(answerText);
        actions.querySelector('span').textContent = 'Copied!';
        setTimeout(() => actions.querySelector('span').textContent = 'Copy', 1500);
      });
      contentBox.appendChild(actions);
    }

    contentBox.textEl = textEl;
    contentBox.thoughtBox = thoughtBox;
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
  if (pendingAttachments.some(a => a.status === 'processing')) {
    alert('Please wait for OCR / file processing to finish before sending.');
    return;
  }

  // If in OOA team workspace and not signed in, require authentication
  if (currentWorkspace === 'ooa' && !window.chatDb.currentUser) {
    alert('Please sign in with your email to collaborate in the OOA Team Room.');
    openAuthModal('signin');
    return;
  }

  let text = messageInput.value.trim();
  const hasAttachments = pendingAttachments.length > 0;

  if (!text && !hasAttachments) return;

  if (!text && hasAttachments) {
    text = pendingAttachments.length === 1
      ? `Please examine the attached file (${pendingAttachments[0].name}) and provide a helpful summary or analysis.`
      : `Please examine the attached files and provide a helpful summary or analysis.`;
  }

  const isHttp = window.location.protocol.startsWith('http');
  if (!isHttp && !settings.apiKey) {
    alert('Please provide your API key in Settings when running directly from a local file.');
    openSettings();
    return;
  }

  // Ensure an active chat session exists
  if (!currentChatId) {
    const defaultTitle = currentWorkspace === 'ooa' ? 'OOA Team Room' : 'New Chat';
    const newChat = await window.chatDb.createChat(defaultTitle, currentWorkspace);
    currentChatId = newChat.id;
  }

  // Snapshot current attachments and clear tray
  const currentAttachments = [...pendingAttachments];
  pendingAttachments = [];
  renderAttachmentTray();

  // Clear input
  messageInput.value = '';
  adjustTextareaHeight();

  // Save user message to DB
  const attachmentMeta = currentAttachments.map(a => ({ name: a.name, size: a.size, type: a.type }));
  const savedUserMsg = await window.chatDb.addMessage(currentChatId, 'user', text, attachmentMeta);
  appendMessageElement('user', text, savedUserMsg?.id, attachmentMeta, null, window.chatDb.currentUser?.email);

  // Construct prompt containing attached file contents for LLM
  let promptForModel = text;
  if (currentAttachments.length > 0) {
    const fileBlocks = currentAttachments.map(att => {
      const isImg = att.isImage || IMAGE_EXTS.includes(att.type);
      const header = isImg ? `--- Start of Image (OCR Extracted Text): ${att.name} ---` : `--- Start of File: ${att.name} ---`;
      const footer = isImg ? `--- End of Image (OCR): ${att.name} ---` : `--- End of File: ${att.name} ---`;
      return `${header}\n${att.content}\n${footer}`;
    }).join('\n\n');
    promptForModel = `${fileBlocks}\n\nUser Request:\n${text}`;
  }

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
  messages.forEach((m, idx) => {
    if (idx === messages.length - 1 && currentAttachments.length > 0) {
      apiMessages.push({ role: m.role, content: promptForModel });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  });

  // Create UI element for assistant's pending response with live thinking
  const assistantContentBox = appendMessageElement('assistant', '', null, [], { isLive: true });
  toggleInputState(true);

  let fullResponse = '';
  abortController = new AbortController();

  const startStreamTime = Date.now();
  const PONDER_PHRASES = [
    'Thinking...',
    'Pondering...',
    'Reviewing context...',
    'Synthesizing response...',
    'Reasoning...'
  ];
  let phraseIdx = 0;

  const thinkingInterval = setInterval(() => {
    if (!assistantContentBox.thoughtBox) return;
    const elapsedSec = Math.floor((Date.now() - startStreamTime) / 1000);
    const timerEl = assistantContentBox.thoughtBox.querySelector('.claude-thought-timer');
    const statusEl = assistantContentBox.thoughtBox.querySelector('.claude-thought-status');
    if (timerEl) timerEl.textContent = `(${elapsedSec}s)`;
    if (statusEl && elapsedSec % 2 === 0) {
      phraseIdx = (phraseIdx + 1) % PONDER_PHRASES.length;
      statusEl.textContent = PONDER_PHRASES[phraseIdx];
    }
  }, 1000);

  try {
    let endpoint;
    let headers = { 'Content-Type': 'application/json' };
    let bodyPayload;

    if (isHttp) {
      endpoint = '/api/chat';
      bodyPayload = {
        apiKey: settings.apiKey || undefined,
        baseUrl: settings.baseUrl,
        model: settings.modelName,
        messages: apiMessages
      };
    } else {
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
              const { thought, answer } = parseThoughtFromText(fullResponse);
              if (thought && assistantContentBox.thoughtBox) {
                const thoughtContentEl = assistantContentBox.thoughtBox.querySelector('.claude-thought-content');
                if (thoughtContentEl) thoughtContentEl.textContent = thought;
              }
              const displayAnswer = thought ? answer : fullResponse;
              assistantContentBox.textEl.innerHTML = window.marked ? marked.parse(displayAnswer) : escapeHtml(displayAnswer);
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

    clearInterval(thinkingInterval);
    const elapsedSec = Math.max(1, Math.round((Date.now() - startStreamTime) / 1000));
    const { thought, answer } = parseThoughtFromText(fullResponse);

    // Finalize Claude Thought Box UI
    if (assistantContentBox.thoughtBox) {
      assistantContentBox.thoughtBox.classList.remove('is-thinking');
      assistantContentBox.thoughtBox.classList.add('collapsed');
      const headerEl = assistantContentBox.thoughtBox.querySelector('.claude-thought-header');
      if (headerEl) {
        headerEl.innerHTML = `
          <span class="claude-thought-shimmer">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14"></path>
            </svg>
            <span style="font-weight: 500; color: var(--accent);">Thought for ${elapsedSec} second${elapsedSec === 1 ? '' : 's'}</span>
          </span>
          <svg class="claude-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;
      }
      const thoughtContentEl = assistantContentBox.thoughtBox.querySelector('.claude-thought-content');
      if (thoughtContentEl && !thought) {
        thoughtContentEl.textContent = 'Reasoned across prompt and context.';
      }
    }

    const finalAnswer = thought ? answer : fullResponse;
    const finalThoughtData = { thought, seconds: elapsedSec };

    // Save final response and thinking time to DB
    const savedAssistantMsg = await window.chatDb.addMessage(currentChatId, 'assistant', finalAnswer, [], finalThoughtData);
    if (assistantContentBox.parentElement && savedAssistantMsg?.id) {
      assistantContentBox.parentElement.dataset.id = savedAssistantMsg.id;
    }

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
      navigator.clipboard.writeText(finalAnswer);
      actions.querySelector('span').textContent = 'Copied!';
      setTimeout(() => actions.querySelector('span').textContent = 'Copy', 1500);
    });
    assistantContentBox.appendChild(actions);

  } catch (error) {
    clearInterval(thinkingInterval);
    if (assistantContentBox.thoughtBox) {
      assistantContentBox.thoughtBox.classList.remove('is-thinking');
    }
    if (error.name === 'AbortError') {
      assistantContentBox.textEl.innerHTML += `<p><em>[Generation stopped]</em></p>`;
      if (fullResponse) {
        await window.chatDb.addMessage(currentChatId, 'assistant', fullResponse);
      }
    } else {
      console.error(error);
      let errMsg = escapeHtml(error.message);
      if (window.location.protocol === 'file:' && (errMsg.includes('fetch') || errMsg.includes('network'))) {
        errMsg += `<br><br><small style="color: var(--text-muted)">💡 <strong>Browser restriction:</strong> Browsers block network requests from <code>file://</code> URLs. Please double-click <strong>run.bat</strong> or execute <code>python server.py</code> in the folder to open the app on <code>http://localhost:3000</code>.</small>`;
      }
      assistantContentBox.textEl.innerHTML = `<p style="color: var(--danger)"><strong>Error:</strong> ${errMsg}</p>`;
    }
  } finally {
    clearInterval(thinkingInterval);
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
