import express from 'express';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const PORT = process.env.PORT || 3000;

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Wrap default Express instance into a native Node HTTP Server for Socket.IO support
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

// Track active WebSocket participant connections
const connectedSockets = new Set();

// Express JSON parsing middleware
app.use(express.json());

// Persistent Browser Session State
let browser = null;
let context = null;
let page = null;
let browserStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
let initializationError = null;

// Safe list of browser launch arguments
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', // Extremely important: prevents Docker memory allocation crashes
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process' // Keeps RAM footprint small on micro container tiers
];

/**
 * Ensures the persistent browser session is alive and healthy.
 * Handles automatic launching, state verification, and background crash recovery.
 */
async function initPersistentSession() {
  if (browserStatus === 'connecting') {
    // Wait for the active initialization to complete
    while (browserStatus === 'connecting') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (browserStatus === 'connected') return;
  }

  // If already flagged connected, perform a fast check to verify the browser is responsive
  if (browser && context && page && browserStatus === 'connected') {
    try {
      // Call a basic lightweight Page function to verify process health
      page.url();
      return;
    } catch (e) {
      console.warn('[Playwright Session] Persistent browser connection lost. Cleaning up zombie processes...', e.message);
      await cleanupPersistentSession();
    }
  }

  console.log('[Playwright Session] Initializing single persistent Chromium session...');
  browserStatus = 'connecting';
  initializationError = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: LAUNCH_ARGS
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    page = await context.newPage();

    // Default startup page state
    await page.goto('about:blank');

    // Attach real-time frame and load listeners to capture browser state changes
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        await broadcastBrowserState();
      }
    });

    page.on('load', async () => {
      await broadcastBrowserState();
    });

    browserStatus = 'connected';
    console.log('[Playwright Session] Shared persistent session initialized successfully.');
  } catch (error) {
    console.error('[Playwright Session] Failed to initialize persistent session:', error);
    browserStatus = 'error';
    initializationError = error.message || 'Unknown error during instantiation';
    await cleanupPersistentSession();
    throw error;
  }
}

/**
 * Broadcasts the current active browser session state to all connected Socket.IO clients.
 */
async function broadcastBrowserState() {
  if (page && browserStatus === 'connected') {
    try {
      const currentUrl = page.url();
      const title = await page.title();
      const payload = {
        currentUrl,
        title,
        timestamp: new Date().toISOString()
      };
      console.log('[Playwright Auto Sync] Broadcasting state update:', payload);
      io.emit('browser:state', payload);
    } catch (e) {
      console.error('[Playwright Auto Sync] Failed to broadcast state:', e.message);
    }
  }
}

// Socket.IO Client Coordination setup
io.on('connection', async (socket) => {
  connectedSockets.add(socket);
  console.log(`[Socket.IO] Peer connected: ${socket.id} (Total: ${connectedSockets.size})`);

  // Promptly synchronize the initial browser session details to the newly joined peer
  let currentUrl = null;
  let title = null;
  if (page && browserStatus === 'connected') {
    try {
      currentUrl = page.url();
      title = await page.title();
    } catch (e) {
      console.error('[Socket.IO Connection Init] Failed to inspect page details:', e.message);
    }
  }

  socket.emit('browser:state', {
    currentUrl: currentUrl || 'about:blank',
    title: title || '',
    timestamp: new Date().toISOString()
  });

  // Multicast active participant count to everyone
  io.emit('participants:update', {
    count: connectedSockets.size
  });

  socket.on('disconnect', () => {
    connectedSockets.delete(socket);
    console.log(`[Socket.IO] Peer disconnected: ${socket.id} (Remaining: ${connectedSockets.size})`);
    
    io.emit('participants:update', {
      count: connectedSockets.size
    });
  });
});

/**
 * Gracefully disposes session resources and updates statuses
 */
async function cleanupPersistentSession() {
  try {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  } catch (e) {
    console.error('[Playwright Session Cleanup] Error during resource disposal:', e);
  } finally {
    page = null;
    context = null;
    browser = null;
    if (browserStatus !== 'error') {
      browserStatus = 'disconnected';
    }
  }
}

/**
 * 1. Health check endpoint (Required)
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    service: 'Playwright Chromium Minimal Verification Layer'
  });
});

/**
 * 2. Session Info Endpoint (Required)
 * GET /session-info
 */
app.get('/session-info', async (req, res) => {
  let currentUrl = null;
  let title = null;
  let status = browserStatus;

  if (status === 'connected' && page) {
    try {
      currentUrl = page.url();
      title = await page.title();
    } catch (error) {
      console.warn('[Playwright Session] Failed to fetch live metadata. Session marked unhealthy.', error.message);
      status = 'disconnected';
      await cleanupPersistentSession();
    }
  }

  res.json({
    status,
    currentUrl,
    title,
    initializationError: status === 'error' ? initializationError : null,
    timestamp: new Date().toISOString()
  });
});

/**
 * 3. Navigation controller endpoint (Required)
 * POST /navigate
 */
app.post('/navigate', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing 'url' parameter in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    console.log(`[Playwright Session] Directing persistent page to: "${url}"`);
    // Navigate with a generous 20-second timeout limit
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    const currentUrl = page.url();
    const title = await page.title();

    // Broadcast the new state to all listeners right away
    await broadcastBrowserState();

    res.json({
      success: true,
      message: "Navigation completed",
      currentUrl,
      title
    });
  } catch (error) {
    console.error('[Playwright Session] Navigation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Navigation command failed'
    });
  }
});

/**
 * 3.1. GET Navigation test controller (Required for easy GET testing from mobile/browsers)
 * GET /navigate-test?url=https://example.com
 */
app.get('/navigate-test', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Missing 'url' query parameter. Usage: /navigate-test?url=https://example.com"
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    console.log(`[Playwright Session GET] Directing persistent page to: "${url}"`);
    // Navigate with a generous 20-second timeout limit
    await page.goto(url, { waitUntil: 'load', timeout: 20000 });

    const currentUrl = page.url();
    const title = await page.title();

    // Broadcast the new state to all listeners right away
    await broadcastBrowserState();

    res.json({
      success: true,
      message: "Navigation completed via GET test route",
      currentUrl,
      title
    });
  } catch (error) {
    console.error('[Playwright Session GET] Navigation failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Navigation command failed'
    });
  }
});

/**
 * 3.2. Participants counter (Required)
 * GET /participants
 */
app.get('/participants', (req, res) => {
  res.json({
    count: connectedSockets.size
  });
});

/**
 * 3.2.1. Screenshot Endpoint (Required)
 * GET /screenshot
 * Captures a JPEG screenshot of the current page, reusing the persistent page.
 */
app.get('/screenshot', async (req, res) => {
  try {
    // Ensure persistent session is active and healthy
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    console.log('[Playwright Session] Capturing JPEG screenshot of the current page...');
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 80
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (error) {
    console.error('[Playwright Session] Failed to capture screenshot:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Screenshot command failed'
    });
  }
});

/**
 * 3.2.2. Interactive mouse click endpoint
 * POST /click
 * Body: { x, y }
 */
app.post('/click', async (req, res) => {
  try {
    const { x, y } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing 'x' or 'y' parameters in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    const posX = Number(x);
    const posY = Number(y);
    if (isNaN(posX) || isNaN(posY)) {
      return res.status(400).json({
        success: false,
        error: "Parameters 'x' and 'y' must be valid numbers."
      });
    }

    console.log(`[Playwright Session] Mouse clicking at (${posX}, ${posY})...`);
    await page.mouse.click(posX, posY);

    // Broadcast the new state to all listeners right away
    await broadcastBrowserState();

    res.json({
      success: true,
      message: `Mouse clicked successfully at (${posX}, ${posY})`
    });
  } catch (error) {
    console.error('[Playwright Session] Click command failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Click command failed'
    });
  }
});

/**
 * 3.2.3. Interactive mouse move endpoint
 * POST /move
 * Body: { x, y }
 */
app.post('/move', async (req, res) => {
  try {
    const { x, y } = req.body;
    if (x === undefined || y === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing 'x' or 'y' parameters in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    const posX = Number(x);
    const posY = Number(y);
    if (isNaN(posX) || isNaN(posY)) {
      return res.status(400).json({
        success: false,
        error: "Parameters 'x' and 'y' must be valid numbers."
      });
    }

    console.log(`[Playwright Session] Mouse moving to (${posX}, ${posY})...`);
    await page.mouse.move(posX, posY);

    res.json({
      success: true,
      message: `Mouse moved successfully to (${posX}, ${posY})`
    });
  } catch (error) {
    console.error('[Playwright Session] Move command failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Move command failed'
    });
  }
});

/**
 * 3.2.4. Interactive mouse virtual scroll endpoint
 * POST /scroll
 * Body: { deltaY }
 */
app.post('/scroll', async (req, res) => {
  try {
    const { deltaY } = req.body;
    if (deltaY === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing 'deltaY' parameter in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    const dY = Number(deltaY);
    if (isNaN(dY)) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'deltaY' must be a valid number."
      });
    }

    console.log(`[Playwright Session] Scrolling wheel vertically by ${dY}px...`);
    await page.mouse.wheel(0, dY);

    res.json({
      success: true,
      message: `Scrolling completed successfully by ${dY}px`
    });
  } catch (error) {
    console.error('[Playwright Session] Scroll command failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Scroll command failed'
    });
  }
});

/**
 * 3.2.7. Interactive keyboard type endpoint
 * POST /type
 * Body: { text }
 */
app.post('/type', async (req, res) => {
  try {
    const { text } = req.body;
    if (text === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing 'text' parameter in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    console.log(`[Playwright Session] Keyboard typing text: "${text}"...`);
    await page.keyboard.type(text);

    // Broadcast the new state to all listeners right away
    await broadcastBrowserState();

    res.json({
      success: true,
      message: `Typed text successfully`
    });
  } catch (error) {
    console.error('[Playwright Session] Type command failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Type command failed'
    });
  }
});

/**
 * 3.2.8. Interactive keyboard keypress endpoint
 * POST /press
 * Body: { key }
 */
app.post('/press', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({
        success: false,
        error: "Missing 'key' parameter in the request body."
      });
    }

    // Ensure session is active before routing browser commands
    await initPersistentSession();

    if (!page || browserStatus !== 'connected') {
      return res.status(500).json({
        success: false,
        error: "Persistent browser session is currently unavailable."
      });
    }

    console.log(`[Playwright Session] Keyboard pressing key: "${key}"...`);
    await page.keyboard.press(key);

    // Broadcast the new state to all listeners right away
    await broadcastBrowserState();

    res.json({
      success: true,
      message: `Pressed key "${key}" successfully`
    });
  } catch (error) {
    console.error('[Playwright Session] Press command failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Press command failed'
    });
  }
});

/**
 * 3.3. Test Debug dashboard showing live status and synchronized properties (Required)
 * GET /debug
 */
app.get('/debug', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VBrowser Real-Time Debugger</title>
  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
    body {
      font-family: 'Inter', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body class="bg-slate-50 min-h-screen flex flex-col">
  <div class="max-w-4xl w-full mx-auto p-6 flex-1 flex flex-col justify-center">
    <div class="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-8 space-y-6">
      
      <div class="flex items-center justify-between border-b border-slate-100 pb-5">
        <div>
          <h1 class="text-xl font-semibold text-slate-950 tracking-tight">VBrowser Real-Time Session Debugger</h1>
          <p class="text-xs text-slate-500 mt-1">Monitor connected participants and active browser states live.</p>
        </div>
        <span id="connection-badge" class="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-50 text-amber-700 border border-amber-200 animate-pulse font-mono">
          Connecting...
        </span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Sockets</p>
          <div class="flex items-baseline mt-2 gap-2">
            <span id="participants-count" class="text-3xl font-semibold text-slate-900 font-mono">0</span>
            <span class="text-xs text-slate-500">participants</span>
          </div>
        </div>

        <div class="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Browser Status</p>
          <div class="flex items-center mt-3 gap-2">
            <span id="status-indicator" class="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
            <span id="browser-status" class="text-sm font-semibold capitalize text-slate-700 font-mono">checking</span>
          </div>
        </div>

        <div class="bg-slate-50/50 rounded-xl p-4 border border-slate-100">
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Last Interaction</p>
          <p id="last-sync" class="text-sm mt-3 font-semibold text-slate-700 font-mono truncate">Never</p>
        </div>
      </div>

      <div class="bg-slate-950 text-slate-50 rounded-xl p-5 space-y-4 font-mono select-all">
        <h2 class="text-xs font-semibold text-slate-400 border-b border-slate-800 pb-2 uppercase tracking-widest flex items-center justify-between">
          <span>Active State Payload</span>
          <span class="text-[10px] text-green-500 normal-case">Synced live</span>
        </h2>
        <div class="space-y-2 text-xs">
          <div><span class="text-slate-500">URL:</span> <span id="current-url" class="text-blue-400 break-all">Checking URL...</span></div>
          <div><span class="text-slate-500">Title:</span> <span id="page-title" class="text-green-400">Loading Title...</span></div>
        </div>
      </div>

      <div class="space-y-3 bg-slate-50/30 rounded-xl p-5 border border-slate-100">
        <h3 class="text-sm font-medium text-slate-900">Redirect Persistent Browser</h3>
        <p class="text-xs text-slate-500">Enter a URL below to instruct the shared persistent page to navigate. All connected windows will synchronize instantly.</p>
        
        <form id="navigate-form" class="flex gap-2.5 mt-2">
          <input 
            type="url" 
            id="url-input" 
            required 
            placeholder="https://example.com" 
            class="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-200 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
          />
          <button 
            type="submit" 
            id="submit-btn"
            class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-sm font-semibold rounded-lg text-white transition duration-150 shadow-sm focus:outline-none"
          >
            Navigate
          </button>
        </form>
        <p id="navigate-status" class="text-xs font-semibold hidden"></p>
      </div>

      <div class="space-y-3 bg-slate-50/30 rounded-xl p-5 border border-slate-100">
        <h3 class="text-sm font-medium text-slate-900">Keyboard Session Remote</h3>
        <p class="text-xs text-slate-500">Inject raw keyboard events into the active webpage. Make sure a target input element is focused first (e.g. by tapping on it inside the /controls view).</p>
        
        <div class="space-y-3 mt-2">
          <div class="flex gap-2.5">
            <input 
              type="text" 
              id="keyboard-text-input" 
              placeholder="Type message or text here..." 
              class="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-200 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
            />
            <button 
              id="btn-keyboard-type"
              class="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-sm font-semibold rounded-lg text-white transition duration-150 shadow-sm focus:outline-none"
            >
              Type Text
            </button>
          </div>
          
          <div class="flex gap-2.5">
            <button 
              id="btn-keyboard-enter"
              class="flex-1 px-4 py-2 bg-slate-850 hover:bg-slate-900 text-sm font-semibold rounded-lg text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition duration-150 shadow-sm focus:outline-none"
            >
              Press Enter ↩
            </button>
            <button 
              id="btn-keyboard-backspace"
              class="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-sm font-semibold rounded-lg text-white transition duration-150 shadow-sm focus:outline-none"
            >
              Press Backspace ⌫
            </button>
          </div>
        </div>
        <p id="keyboard-status" class="text-xs font-semibold hidden mt-2"></p>
      </div>

    </div>
  </div>

  <script>
    const socket = io();

    const connectionBadge = document.getElementById('connection-badge');
    const participantsCount = document.getElementById('participants-count');
    const browserStatusText = document.getElementById('browser-status');
    const statusIndicator = document.getElementById('status-indicator');
    const lastSyncText = document.getElementById('last-sync');
    const currentUrlText = document.getElementById('current-url');
    const pageTitleText = document.getElementById('page-title');
    const navigateForm = document.getElementById('navigate-form');
    const urlInput = document.getElementById('url-input');
    const submitBtn = document.getElementById('submit-btn');
    const navigateStatus = document.getElementById('navigate-status');

    // Keyboard Elements
    const keyboardTextInput = document.getElementById('keyboard-text-input');
    const btnKeyboardType = document.getElementById('btn-keyboard-type');
    const btnKeyboardEnter = document.getElementById('btn-keyboard-enter');
    const btnKeyboardBackspace = document.getElementById('btn-keyboard-backspace');
    const keyboardStatus = document.getElementById('keyboard-status');

    function updateStatusIndicator(status) {
      browserStatusText.textContent = status;
      statusIndicator.className = 'w-2.5 h-2.5 rounded-full';
      if (status === 'connected') {
        statusIndicator.classList.add('bg-green-500');
      } else if (status === 'connecting') {
        statusIndicator.classList.add('bg-amber-500');
      } else if (status === 'error') {
        statusIndicator.classList.add('bg-red-500');
      } else {
        statusIndicator.classList.add('bg-slate-400');
      }
    }

    async function fetchInfo() {
      try {
        const res = await fetch('/session-info');
        const data = await res.json();
        updateStatusIndicator(data.status);
      } catch (e) {
        console.error('Failed to get session info:', e);
      }
    }

    fetchInfo();

    socket.on('connect', () => {
      connectionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-green-50 text-green-700 border border-green-200 font-mono";
      connectionBadge.textContent = "Live WS Connected";
    });

    socket.on('disconnect', () => {
      connectionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-red-50 text-red-700 border border-red-200 font-mono";
      connectionBadge.textContent = "Disconnected";
    });

    socket.on('browser:state', (data) => {
      currentUrlText.textContent = data.currentUrl || 'about:blank';
      pageTitleText.textContent = data.title || '(No page loaded)';
      lastSyncText.textContent = new Date(data.timestamp).toLocaleTimeString();
      fetchInfo();
    });

    socket.on('participants:update', (data) => {
      participantsCount.textContent = data.count;
    });

    navigateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUrl = urlInput.value.trim();
      if (!targetUrl) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Navigating...';
      navigateStatus.className = "text-xs font-semibold text-slate-500 block";
      navigateStatus.textContent = "Sending instruction to browser, please hold...";

      try {
        const response = await fetch("/navigate-test?url=" + encodeURIComponent(targetUrl));
        const result = await response.json();
        
        if (result.success) {
          navigateStatus.className = "text-xs font-semibold text-green-600 block";
          navigateStatus.textContent = "Browser navigated successfully.";
          urlInput.value = '';
        } else {
          navigateStatus.className = "text-xs font-semibold text-red-600 block";
          navigateStatus.textContent = "Fail: " + result.error;
        }
      } catch (err) {
        navigateStatus.className = "text-xs font-semibold text-red-600 block";
        navigateStatus.textContent = "Network Error: " + err.message;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Navigate';
        setTimeout(() => {
          navigateStatus.classList.add('hidden');
        }, 5000);
      }
    });

    function showKeyboardStatus(message, isSuccess) {
      if (isSuccess === undefined) isSuccess = true;
      keyboardStatus.className = "text-xs font-semibold " + (isSuccess ? "text-green-600" : "text-rose-600") + " block mt-2";
      keyboardStatus.textContent = message;
      keyboardStatus.classList.remove("hidden");
      setTimeout(function() {
        keyboardStatus.classList.add("hidden");
      }, 4000);
    }

    btnKeyboardType.addEventListener('click', async () => {
      const text = keyboardTextInput.value;
      if (!text) {
        showKeyboardStatus('Please type some text first', false);
        return;
      }
      btnKeyboardType.disabled = true;
      try {
        const response = await fetch('/type', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text })
        });
        const result = await response.json();
        if (result.success) {
          showKeyboardStatus('Successfully typed text: "' + text + '"', true);
          keyboardTextInput.value = '';
        } else {
          showKeyboardStatus('Error: ' + result.error, false);
        }
      } catch (err) {
        showKeyboardStatus('Network error: ' + err.message, false);
      } finally {
        btnKeyboardType.disabled = false;
      }
    });

    btnKeyboardEnter.addEventListener('click', async () => {
      btnKeyboardEnter.disabled = true;
      try {
        const response = await fetch('/press', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'Enter' })
        });
        const result = await response.json();
        if (result.success) {
          showKeyboardStatus('Pressed "Enter" key successfully!', true);
        } else {
          showKeyboardStatus('Error: ' + result.error, false);
        }
      } catch (err) {
        showKeyboardStatus('Network error: ' + err.message, false);
      } finally {
        btnKeyboardEnter.disabled = false;
      }
    });

    btnKeyboardBackspace.addEventListener('click', async () => {
      btnKeyboardBackspace.disabled = true;
      try {
        const response = await fetch('/press', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'Backspace' })
        });
        const result = await response.json();
        if (result.success) {
          showKeyboardStatus('Pressed "Backspace" key successfully!', true);
        } else {
          showKeyboardStatus('Error: ' + result.error, false);
        }
      } catch (err) {
        showKeyboardStatus('Network error: ' + err.message, false);
      } finally {
        btnKeyboardBackspace.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

/**
 * 3.4. Serve Touch-Pilot Controller for Mobile Display (Android/iOS)
 * GET /controls
 */
app.get('/controls', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>VBrowser Mobile Controls</title>
  <script src="/socket.io/socket.io.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    body {
      font-family: 'Inter', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen flex flex-col selection:bg-indigo-500 selection:text-white">

  <!-- Header Section -->
  <header class="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-4 py-3 sm:px-6">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="p-2 bg-indigo-600/10 rounded-xl border border-indigo-500/20 text-indigo-400">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"; />
          </svg>
        </div>
        <div>
          <h1 class="text-lg font-bold tracking-tight text-white flex items-center gap-2">
            VBrowser Mobile Touch-Pilot
            <span class="text-[10px] bg-indigo-500/20 text-indigo-300 font-normal px-2 py-0.5 rounded-full border border-indigo-500/30">Beta</span>
          </h1>
          <p class="text-xs text-slate-400">Low-latency gesture remote & visual session tracker</p>
        </div>
      </div>
      
      <div class="flex items-center gap-2 sm:gap-3 self-start sm:self-center">
        <!-- Live Connection State badge -->
        <span id="socket-badge" class="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 font-mono">
          Sync Idle
        </span>
        <span id="session-badge" class="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 font-mono">
          Checking browser...
        </span>
      </div>
    </div>
  </header>

  <!-- URL Address Tracker Banner -->
  <section class="bg-indigo-950/20 border-b border-slate-800/80 px-4 py-2 sm:px-6">
    <div class="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center gap-2 text-xs">
      <div class="flex items-center gap-1.5 shrink-0 text-indigo-400 font-semibold font-mono">
        <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
        REMOTE URL:
      </div>
      <div class="truncate text-slate-300 font-mono flex-1 hover:text-white transition cursor-pointer" id="active-url" onclick="window.navigator.clipboard.writeText(this.textContent)">
        Loading current session address...
      </div>
      <div class="text-slate-500 truncate" id="active-title">
        (No tab loaded)
      </div>
    </div>
  </section>

  <!-- Main Grid Layout -->
  <main class="max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
    
    <!-- LEFT COLUMN: Touch Viewport Frame -->
    <section class="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
      <div class="bg-slate-950 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
        <!-- Viewport Header -->
        <div class="flex items-center justify-between bg-slate-900 px-4 py-3 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <span class="flex gap-1.5">
              <span class="w-3 h-3 rounded-full bg-rose-500/80"></span>
              <span class="w-3 h-3 rounded-full bg-amber-500/80"></span>
              <span class="w-3 h-3 rounded-full bg-emerald-500/80"></span>
            </span>
            <span class="text-xs font-mono text-slate-400 ml-2">Live Canvas Viewport (1280 × 720)</span>
          </div>
          <div class="flex items-center gap-2">
            <!-- Loading Indicator -->
            <span id="load-spinner" class="hidden text-indigo-400 animate-spin">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z";></path>
              </svg>
            </span>
            <span class="text-[11px] font-mono text-slate-500 pb-0.5" id="last-screenshot-time">Updated recently</span>
          </div>
        </div>

        <!-- Viewport Workspace Box -->
        <div class="bg-black relative select-none flex items-center justify-center p-2 min-h-[220px] sm:min-h-[400px]">
          <div class="relative max-w-full overflow-hidden rounded-lg shadow-2xl border border-slate-900 group">
            <!-- Screenshot display -->
            <img 
              id="viewport-screenshot" 
              src="/screenshot" 
              alt="Browser Live Render" 
              referrerpolicy="no-referrer"
              class="w-full h-auto object-contain cursor-crosshair block transition opacity-0 duration-300 select-none pointer-events-auto"
              onload="this.style.opacity=1; document.getElementById('load-spinner').classList.add('hidden');"
              onerror="onScreenshotLoadError()"
            />
            
            <!-- Tap Indicator Overlay element -->
            <div id="tap-pointer" class="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-indigo-400 bg-indigo-500/30 scale-0 pointer-events-none transition-all duration-300 z-10 font-normal text-xs text-center leading-4 text-white"></div>
          </div>
        </div>

        <!-- Viewport Controls Footer -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 px-4 py-3 border-t border-slate-800 text-xs">
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 cursor-pointer font-medium text-slate-300">
              <input type="checkbox" id="toggle-autorefresh" checked class="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 focus:outline-none w-4 h-4">
              <span>Auto-refresh (2s)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer font-medium text-slate-300">
              <input type="checkbox" id="auto-click-tap" checked class="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 focus:outline-none w-4 h-4">
              <span>Auto-click parent-grid on tap</span>
            </label>
          </div>
          <button 
            id="btn-refresh-manual" 
            class="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-slate-100 font-semibold rounded-lg font-mono transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8a2.12 2.12 0 010 .582v.418H18" />
            </svg>
            Refresh Screenshot
          </button>
        </div>
      </div>

      <!-- Quick Interactive Directions / Tutorial Hint -->
      <div class="bg-indigo-950/15 border border-indigo-500/20 rounded-xl p-4 flex gap-3 text-xs leading-relaxed text-indigo-200">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0 text-indigo-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <span class="font-bold text-white text-indigo-100 uppercase tracking-wide">Touch Viewport Navigation Tip:</span>
          Hover or click anywhere directly inside the viewport image above. The system automatically maps your relative touch tap dimensions into valid coordinate bounds `(0-1280, 0-720)` and executes a server-side mouse command!
        </div>
      </div>
    </section>

    <!-- RIGHT COLUMN: Interaction Cockpit Panels -->
    <section class="lg:col-span-5 xl:col-span-4 flex flex-col gap-6">

      <!-- Redirection / Quick Browser Navigation Card -->
      <div class="bg-slate-950 rounded-2xl border border-slate-800 shadow-xl p-5 space-y-3">
        <h2 class="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
          <span class="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
          Pilot Navigation Address
        </h2>
        <form id="cockpit-navigate-form" class="flex gap-2">
          <input 
            type="url" 
            id="url-field" 
            required 
            placeholder="https://google.com" 
            class="flex-1 px-3 py-1.5 bg-slate-905 border border-slate-800 rounded-lg text-xs placeholder-slate-500 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-900"
          />
          <button 
            type="submit" 
            id="url-submit-btn" 
            class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold rounded-lg text-white transition shrink-0"
          >
            Go url
          </button>
        </form>
      </div>
      
      <!-- Preset Actions / Scrolling Card -->
      <div class="bg-slate-950 rounded-2xl border border-slate-800 shadow-xl p-5 space-y-4">
        <h2 class="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
          <span class="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
          Quick Preset Interactions
        </h2>
        
        <div class="grid grid-cols-2 gap-3.5">
          <button 
            id="btn-scroll-up" 
            class="flex items-center justify-center gap-1.5 p-3 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 active:bg-slate-750 font-semibold rounded-xl text-xs transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            Scroll Down
          </button>
          
          <button 
            id="btn-scroll-down" 
            class="flex items-center justify-center gap-1.5 p-3 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 active:bg-slate-750 font-semibold rounded-xl text-xs transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            Scroll Up
          </button>
        </div>

        <button 
          id="btn-click-center" 
          class="w-full flex items-center justify-center gap-1.5 p-3 bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 active:bg-slate-750 font-semibold rounded-xl text-xs text-slate-100 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
          </svg>
          Click Center Area (640, 360)
        </button>
      </div>

      <!-- Custom Precision Coordinates Input Card -->
      <div class="bg-slate-950 rounded-2xl border border-slate-800 shadow-xl p-5 space-y-4">
        <h2 class="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
          <span class="w-1.5 h-3 bg-indigo-500 rounded-sm"></span>
          Precision Pointer Sandbox
        </h2>

        <!-- Coordinates Field Row -->
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label for="input-coord-x" class="text-xs text-slate-400 font-medium">X Coordinate (px)</label>
            <input 
              type="number" 
              id="input-coord-x" 
              value="640" 
              min="0" 
              max="1280"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div class="space-y-1.5">
            <label for="input-coord-y" class="text-xs text-slate-400 font-medium">Y Coordinate (px)</label>
            <input 
              type="number" 
              id="input-coord-y" 
              value="360" 
              min="0" 
              max="720"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <!-- Action triggers -->
        <div class="grid grid-cols-2 gap-3 pt-2">
          <button 
            id="btn-trigger-click" 
            class="flex items-center justify-center gap-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 font-bold rounded-lg text-xs text-white shadow transition"
          >
            Trigger Click
          </button>
          <button 
            id="btn-trigger-move" 
            class="flex items-center justify-center gap-1 py-2.5 bg-slate-800 border border-slate-700 hover:bg-slate-750 active:bg-slate-700 rounded-lg text-xs font-semibold text-slate-100 transition"
          >
            Move Cursor
          </button>
        </div>
      </div>

      <!-- Live API Response Activity Logs -->
      <div class="bg-slate-950 rounded-2xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-56">
        <div class="bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
          <span class="text-xs font-semibold tracking-wider uppercase text-slate-400">Interaction Log Console</span>
          <button id="btn-clear-console" class="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono">Clear</button>
        </div>
        <div id="log-container" class="p-3 font-mono text-[11px] space-y-1.5 flex-1 overflow-y-auto bg-slate-950 scrollbar-thin">
          <div class="text-slate-500">[System] Console Initialized. Ready for actions.</div>
        </div>
      </div>

    </section>
  </main>

  <!-- Script block handling interaction logics -->
  <script>
    const socket = io();
    const activeUrl = document.getElementById('active-url');
    const activeTitle = document.getElementById('active-title');
    const socketBadge = document.getElementById('socket-badge');
    const sessionBadge = document.getElementById('session-badge');

    const screenshotImg = document.getElementById('viewport-screenshot');
    const touchPointer = document.getElementById('tap-pointer');
    const loadSpinner = document.getElementById('load-spinner');
    const lastScreenshotTime = document.getElementById('last-screenshot-time');

    const autoRefreshCheckbox = document.getElementById('toggle-autorefresh');
    const manualRefreshBtn = document.getElementById('btn-refresh-manual');

    // Controls Inputs and Buttons
    const inputX = document.getElementById('input-coord-x');
    const inputY = document.getElementById('input-coord-y');

    const btnScrollUp = document.getElementById('btn-scroll-up');
    const btnScrollDown = document.getElementById('btn-scroll-down');
    const btnClickCenter = document.getElementById('btn-click-center');

    const btnTriggerClick = document.getElementById('btn-trigger-click');
    const btnTriggerMove = document.getElementById('btn-trigger-move');
    const btnClearConsole = document.getElementById('btn-clear-console');
    const logContainer = document.getElementById('log-container');

    const cockpitForm = document.getElementById('cockpit-navigate-form');
    const urlField = document.getElementById('url-field');

    // Interval handler reference
    let screenshotInterval = null;

    // Helper to log console logs to the custom UI panel
    function logMessage(text, status = 'info') {
      const entry = document.createElement('div');
      const timeStr = new Date().toLocaleTimeString();
      let colorClass = 'text-slate-300';
      if (status === 'success') colorClass = 'text-green-400';
      if (status === 'error') colorClass = 'text-rose-400';
      if (status === 'info') colorClass = 'text-indigo-300';
      
      entry.className = "leading-5 break-all " + colorClass;
      entry.innerHTML = '<span class="text-slate-600">[' + timeStr + ']</span> ' + text;
      
      logContainer.appendChild(entry);
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Refresh screenshot view
    function refreshScreenshot() {
      loadSpinner.classList.remove('hidden');
      const cacheBust = "?_t=" + Date.now();
      screenshotImg.src = "/screenshot" + cacheBust;
      lastScreenshotTime.textContent = "Synced: " + new Date().toLocaleTimeString();
    }

    // Error recovery for screenshot loading
    function onScreenshotLoadError() {
      loadSpinner.classList.add('hidden');
      lastScreenshotTime.textContent = "Screenshot fetch failed";
      logMessage("Failed to fetch browser viewport screenshot. Check if target browser crashed or is sleeping.", "error");
    }

    // Trigger API action wrapper
    async function callActionAPI(url, data = {}) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        const result = await response.json();
        
        if (result.success) {
          logMessage(result.message || "Executed command successfully.", "success");
          // Instant screen refresh for visual feedback!
          setTimeout(refreshScreenshot, 400);
        } else {
          logMessage("Error: " + (result.error || "Unknown response"), "error");
        }
      } catch (err) {
        logMessage("HTTP Network Error: " + err.message, "error");
      }
    }

    // Auto-refresh timer coordinator
    function configureAutoRefresh() {
      if (autoRefreshCheckbox.checked) {
        if (!screenshotInterval) {
          logMessage("Enabled live viewport auto-refresh cycle (2000ms).", "info");
          screenshotInterval = setInterval(refreshScreenshot, 2000);
        }
      } else {
        if (screenshotInterval) {
          logMessage("Suspended session auto-refresh cycle.", "info");
          clearInterval(screenshotInterval);
          screenshotInterval = null;
        }
      }
    }

    // Capture touch tap coords on screenshot image
    screenshotImg.addEventListener('click', (e) => {
      const rect = screenshotImg.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      
      // Scale coordinates back to Playwright viewport (1280x720)
      const scaleX = 1280 / rect.width;
      const scaleY = 720 / rect.height;
      
      const realX = Math.round(clickX * scaleX);
      const realY = Math.round(clickY * scaleY);
      
      // Update inputs
      inputX.value = realX;
      inputY.value = realY;

      // Position the nice indicator pointer dynamically
      const percentLeft = (clickX / rect.width) * 100;
      const percentTop = (clickY / rect.height) * 100;
      touchPointer.style.left = percentLeft + '%';
      touchPointer.style.top = percentTop + '%';
      
      touchPointer.classList.remove('scale-0');
      touchPointer.classList.add('scale-100');
      setTimeout(() => {
        touchPointer.classList.remove('scale-100');
        touchPointer.classList.add('scale-0');
      }, 1200);

      logMessage(\`Viewport tap translated: (\${realX}, \${realY})\`, "info");
      
      if (document.getElementById('auto-click-tap').checked) {
        callActionAPI('/click', { x: realX, y: realY });
      }
    });

    // Handle WebSocket session sync updates
    socket.on('connect', () => {
      socketBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 font-mono";
      socketBadge.textContent = "Live Link Sync Active";
      logMessage("Established browser websocket state gateway tunnel.", "success");
    });

    socket.on('disconnect', () => {
      socketBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-red-950/40 text-rose-400 border border-rose-500/30 font-mono";
      socketBadge.textContent = "Sync offline";
      logMessage("Lost websocket gateway tunnel connection.", "error");
    });

    socket.on('browser:state', (data) => {
      activeUrl.textContent = data.currentUrl || 'about:blank';
      activeTitle.textContent = data.title || '(No active documents)';
      
      // Update browser-status in badge
      sessionBadge.textContent = "Viewport: Ready";
      sessionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-950/40 text-indigo-300 border border-indigo-500/30 font-mono";
      
      // Auto refresh immediately on route navigations
      refreshScreenshot();
    });

    // Basic session initialization health checks
    async function checkPlaywrightSession() {
      try {
        const res = await fetch('/session-info');
        const data = await res.json();
        if (data.status === 'connected') {
          sessionBadge.textContent = "Browser Engine: Online";
          sessionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-green-950/40 text-green-400 border border-green-500/30 font-mono";
        } else {
          sessionBadge.textContent = "Browser Engine: " + data.status;
          sessionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-950/40 text-amber-400 border border-amber-500/20 font-mono";
        }
      } catch (err) {
        sessionBadge.textContent = "Browser Engine: Unreachable";
        sessionBadge.className = "px-2.5 py-1 text-xs font-semibold rounded-full bg-rose-950/40 text-rose-400 border border-rose-500/20 font-mono";
      }
    }

    // Actions Listeners Wiring
    btnScrollUp.addEventListener('click', () => callActionAPI('/scroll', { deltaY: -300 }));
    btnScrollDown.addEventListener('click', () => callActionAPI('/scroll', { deltaY: 300 }));
    btnClickCenter.addEventListener('click', () => callActionAPI('/click', { x: 640, y: 360 }));

    btnTriggerClick.addEventListener('click', () => {
      const x = parseInt(inputX.value, 10);
      const y = parseInt(inputY.value, 10);
      callActionAPI('/click', { x, y });
    });

    btnTriggerMove.addEventListener('click', () => {
      const x = parseInt(inputX.value, 10);
      const y = parseInt(inputY.value, 10);
      callActionAPI('/move', { x, y });
    });

    manualRefreshBtn.addEventListener('click', () => {
      refreshScreenshot();
      logMessage("Triggered manual screenshot refresh.", "info");
    });
    autoRefreshCheckbox.addEventListener('change', configureAutoRefresh);

    btnClearConsole.addEventListener('click', () => {
      logContainer.innerHTML = '<div class="text-slate-500">[System] Log cleared. Ready.</div>';
    });

    cockpitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetUrl = urlField.value.trim();
      if (!targetUrl) return;

      const submitBtn = document.getElementById('url-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Hold...';
      logMessage("Instruction sent: Navigating persistent tab to: " + targetUrl, "info");

      try {
        const response = await fetch("/navigate-test?url=" + encodeURIComponent(targetUrl));
        const result = await response.json();
        
        if (result.success) {
          logMessage("Navigation completed successfully.", "success");
          urlField.value = '';
          setTimeout(refreshScreenshot, 600);
        } else {
          logMessage("Fail: " + result.error, "error");
        }
      } catch (err) {
        logMessage("Error navigating: " + err.message, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Go url';
      }
    });

    // Boot Sequences
    checkPlaywrightSession();
    configureAutoRefresh();
    refreshScreenshot();
  </script>
</body>
</html>`);
});

/**
 * 4. Playwright Verification Endpoint (Legacy fallback support)
 * GET /test-browser?url=https://example.com
 */
app.get('/test-browser', async (req, res) => {
  console.log('[Playwright Legacy Endpoint] Running on-demand independent verification browser.');
  let testBrowser = null;
  
  try {
    const targetUrl = req.query.url || 'https://example.com';
    testBrowser = await chromium.launch({
      headless: true,
      args: LAUNCH_ARGS
    });

    const testContext = await testBrowser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const testPage = await testContext.newPage();
    await testPage.goto(targetUrl, { waitUntil: 'load', timeout: 15000 });
    const pageTitle = await testPage.title();

    await testContext.close();
    await testBrowser.close();

    res.json({
      success: true,
      url: targetUrl,
      title: pageTitle,
      browser: 'Playwright Chromium Headless',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Playwright Legacy Endpoint] Error:', error);
    if (testBrowser) {
      await testBrowser.close().catch(() => {});
    }
    res.status(500).json({
      success: false,
      error: error.message || 'Legacy verification test failed'
    });
  }
});

// Warm up persistent browser session on server launch
initPersistentSession()
  .then(() => console.log('[Playwright System] Early persistent browser session warmed up.'))
  .catch((err) => console.error('[Playwright System] Setup failure on startup warmup:', err));

// Start HTTP Server with Socket.IO on 0.0.0.0 (Required for Railway router ingress)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Playwright + Chromium WS Sync API is Online`);
  console.log(`📍 Binding Host: 0.0.0.0`);
  console.log(`📍 Active Port: ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 Session Info: http://localhost:${PORT}/session-info`);
  console.log(`🔗 Navigation: POST http://localhost:${PORT}/navigate`);
  console.log(`🔗 Participants: http://localhost:${PORT}/participants`);
  console.log(`🔗 Debugger Panel: http://localhost:${PORT}/debug`);
  console.log(`🔗 Mobile Controller Dashboard: http://localhost:${PORT}/controls`);
  console.log(`🔗 Screenshot: http://localhost:${PORT}/screenshot`);
  console.log(`🔗 Mouse Click: POST http://localhost:${PORT}/click`);
  console.log(`🔗 Mouse Move: POST http://localhost:${PORT}/move`);
  console.log(`🔗 Mouse Scroll: POST http://localhost:${PORT}/scroll`);
  console.log(`🔗 Keyboard Type: POST http://localhost:${PORT}/type`);
  console.log(`🔗 Keyboard Press: POST http://localhost:${PORT}/press`);
  console.log(`======================================================\n`);
});

