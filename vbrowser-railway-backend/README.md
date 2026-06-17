# Playwright Chromium Collaborative Browser Backend (MVP)

This is a minimum viable deployment setup to verify that **Playwright and Chromium** can launch and execute successfully inside **Railway** before integrating complex real-time video/audio streaming (WebRTC) and multi-user room systems.

## Project Architecture

```
/vbrowser-railway-backend
  ├── Dockerfile         <- Builds the microservice on top of Microsoft's official browser environment
  ├── railway.json       <- Railway configuration declaring DOCKER deployment model
  ├── package.json       <- Defines Node dependencies
  └── server.js          <- Express application running health checks and browser tests
```

---

## 🚀 How to Deploy on Railway

You can deploy this in three simple ways:

### Option A: Railway Dashboard (No CLI)
1. Go to your **[Railway Dashboard](https://railway.app/)**.
2. Click **New Project** -> **Deploy from GitHub repository**.
3. Point to your repository and make sure Railway is targeting the `/vbrowser-railway-backend` subdirectory (or create a dedicated GitHub repo with just the files inside this directory).
4. Railway will automatically pick up the `Dockerfile` and start the build immediately!

### Option B: Railway CLI (Quickest)
1. Install the Railway CLI:
   ```bash
   npm i -g @railway/cli
   ```
2. Login to your account:
   ```bash
   railway login
   ```
3. Initialize a new service inside this directory:
   ```bash
   cd vbrowser-railway-backend
   railway init
   ```
4. Deploy instantly:
   ```bash
   railway up
   ```

---

## 🧪 Testing the Deployment

Once deployed, Railway will provide you with a public URL (e.g., `https://your-service.up.railway.app`). Try calling these endpoints to test:

### 1. Simple Health Check
Request:
```
GET https://your-service.up.railway.app/health
```
Response:
```json
{
  "status": "ok",
  "timestamp": "2026-06-16T16:19:34.000Z",
  "environment": "production",
  "service": "Playwright Chromium Minimal Verification Layer"
}
```

### 2. Live Chromium Playwright Execution
This logs into Railway, launches Playwright, opens Chromium, loads the webpage, reads the document title elements, and closes automatically:
Request:
```
GET https://your-service.up.railway.app/test-browser?url=https://wikipedia.org
```
Response:
```json
{
  "success": true,
  "url": "https://wikipedia.org",
  "title": "Wikipedia, the free encyclopedia",
  "browser": "Playwright Chromium Headless",
  "timestamp": "2026-06-16T16:20:00.000Z"
}
```

---

## 🛠️ Safe Container Arguments Used
Our Playwright launcher configures several vital kernel flags to ensure smooth operations on shared container CPU environments:
* `--no-sandbox` & `--disable-setuid-sandbox`: Bypasses namespace sandbox checks inside default Docker runtimes.
* `--disable-dev-shm-usage`: Disables shared memory buffers in favor of `/tmp`, preventing sudden out-of-memory crashes on cloud platforms.
* `--single-process`: Cuts RAM consumption to the absolute bare minimum, allowing perfect execution on any small hobby/free container instance.
