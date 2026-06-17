import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

// Express JSON parsing middleware
app.use(express.json());

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
 * 2. Playwright Verification Endpoint (Required)
 * GET /test-browser?url=https://example.com
 */
app.get('/test-browser', async (req, res) => {
  console.log('[Playwright MVP] Received test request for Chromium verification.');
  let browser = null;
  
  try {
    // Collect url parameter, default to https://example.com
    const targetUrl = req.query.url || 'https://example.com';
    console.log(`[Playwright MVP] Targeted navigation URL: "${targetUrl}"`);

    // Launch Chromium with safe container-optimized arguments
    console.log('[Playwright MVP] Launching browser instance...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Extremely important: prevents Docker memory allocation crashes
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process' // Keeps RAM footprint small on micro container tiers (e.g. Railway free/hobby tiers)
      ]
    });

    console.log('[Playwright MVP] Creating context and virtual page viewport...');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    // Navigate with a generous 15-second timeout
    console.log(`[Playwright MVP] Navigating to target page: ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 15000 });
    
    // Scrape title elements
    const pageTitle = await page.title();
    console.log(`[Playwright MVP] Navigated successfully! Page title retrieved: "${pageTitle}"`);

    // Clean up connections
    console.log('[Playwright MVP] Disposing browser context resources...');
    await context.close();
    await browser.close();

    // Respond with visual title confirmation
    res.json({
      success: true,
      url: targetUrl,
      title: pageTitle,
      browser: 'Playwright Chromium Headless',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Playwright MVP] Error running browser test operations:', error);
    
    // Safety fallback cleanup
    if (browser) {
      try {
        console.log('[Playwright MVP Error Cleanup] Trying to safely close browser processes...');
        await browser.close();
      } catch (closeErr) {
        console.error('[Playwright MVP Error Cleanup] Failed to shut down browser processes:', closeErr);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Browser test execution failed',
      reconciliation: 'Ensure Playwright has accurate native chromium libraries installed via CLI.'
    });
  }
});

// Start Express Listener on 0.0.0.0 (Required for Railway router ingress)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Playwright + Chromium Verification API is Online`);
  console.log(`📍 Binding Host: 0.0.0.0`);
  console.log(`📍 Active Port: ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 Test Browser: http://localhost:${PORT}/test-browser?url=https://example.com`);
  console.log(`======================================================\n`);
});
