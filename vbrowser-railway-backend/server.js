import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

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

// Start Express Listener on 0.0.0.0 (Required for Railway router ingress)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Playwright + Chromium Verification API is Online`);
  console.log(`📍 Binding Host: 0.0.0.0`);
  console.log(`📍 Active Port: ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 Session Info: http://localhost:${PORT}/session-info`);
  console.log(`🔗 Navigation: POST http://localhost:${PORT}/navigate`);
  console.log(`======================================================\n`);
});

