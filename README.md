# Mistral NeMo Web Chat

A lightweight, purely frontend web chat UI for Mistral NeMo (compatible with `aicreds.in` and OpenAI-compatible endpoints) with local persistence powered by **IndexedDB**.

## Features
- **Pure Frontend**: HTML5, CSS3, and modern JavaScript (no backend server required).
- **Client-Side Database**: Uses browser **IndexedDB** (`NemoChatDB`) for persisting chats, message history, and timestamps.
- **Streaming Responses**: Token-by-token streaming via server-sent events (`stream: true`).
- **Markdown & Code Highlighting**: Formatted markdown outputs with code syntax highlighting.
- **Multi-session Management**: Create new chats, rename automatically from conversation, switch sessions, and delete chats.
- **Configurable Settings**: In-browser API key, custom Base URL (defaults to `https://api.aicreds.in/v1`), model name, and system prompt.

## How to Run

### Option 1: Open directly in your browser
Double-click [`index.html`](file:///C:/coding/nemo%20chat/index.html) or right-click and choose "Open with" -> Chrome / Edge / Firefox.

### Option 2: Run via Python lightweight server (optional)
```powershell
cd "C:\coding\nemo chat"
python -m http.server 3000
```
Then visit `http://localhost:3000` in your browser.

## Configuration
When you open the web UI for the first time, click **Settings** (or the prompt) to paste your `aicreds.in` API key. Your key is stored safely in your browser's `localStorage` and never sent to any external server other than the configured API endpoint.
