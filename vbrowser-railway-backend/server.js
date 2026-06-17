import express from 'express';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const PORT = process.env.PORT || 3000;

// Wrap default Express instance into a native Node HTTP Server for Socket.IO support
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
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
  console.log(`======================================================\n`);
});

