import express from "express";
import path from "path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

interface User {
  id: string; // socket connection uuid / hash
  name: string;
  cameraOn: boolean;
  micOn: boolean;
  screenSharing: boolean;
  camStreamId: string | null;
  screenStreamId: string | null;
}

interface BrowserState {
  currentUrl: string;
  scrollPct: number;
  lastChangedBy: string | null;
}

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface Room {
  id: string;
  users: User[];
  messages: Message[];
  screenSharerId: string | null;
  browserState?: BrowserState;
}

const rooms = new Map<string, Room>();

// Track socket to room & user ID
const clientRoomMap = new Map<WebSocket, { roomId: string; userId: string }>();

// Helper to broadcast to a room
function broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const rawMessage = JSON.stringify(message);

  clientRoomMap.forEach((info, ws) => {
    if (info.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      if (!excludeClientId || info.userId !== excludeClientId) {
        ws.send(rawMessage);
      }
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", activeRooms: rooms.size });
  });

  // Get current state of a room
  app.get("/api/room/:roomId", (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json({
      id: room.id,
      userCount: room.users.length,
      screenSharerId: room.screenSharerId,
      browserState: room.browserState,
    });
  });

  // Chromium Web Proxy to safely load webpages cross-origin inside our collaborative frame
  app.get("/api/proxy", async (req, res) => {
    let targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).send("Missing target url parameter");
    }

    // Quick sanitization & protocol insertion
    if (!/^https?:\/\//i.test(targetUrl)) {
      // If it looks like a local page name (home), pass it through
      if (targetUrl === "home") {
        return res.send("home");
      }
      targetUrl = "https://" + targetUrl;
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        }
      });

      if (!response.ok) {
        throw new Error(`External URL fetched with bad status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        // Redirection for images, stylesheets or other static file buffers directly to absolute target url
        return res.redirect(targetUrl);
      }

      let html = await response.text();

      // --- INTEGRATED ACTIVE ADBLOCKER ENGINE ---
      const adDomainsList = [
        "doubleclick.net", "googleadservices.com", "googlesyndication.com",
        "google-analytics.com", "adnxs.com", "amazon-adsystem.com",
        "carbonads.net", "adservice.google.com", "taboola.com",
        "outbrain.com", "popads.net", "adcolony.com", "applovin.com",
        "unity3d.com/ads", "exponential.com", "conversantmedia.com",
        "pubmatic.com", "rubiconproject.com", "openx.net", "criteo.com",
        "analytics.google.com", "scorecardresearch.com"
      ];

      // Remove third-party script linkages pointing to known ad companies completely
      adDomainsList.forEach((domain) => {
        const scriptRegex = new RegExp(`<script[^>]*src=["'][^"']*${domain}[^"']*["'][^>]*><\\/script>`, "gi");
        html = html.replace(scriptRegex, "<!-- [AdBlocker: Blocked Ad Network Script] -->");
      });

      // Inject stylistic shields to cosmetically collapse and hide all banner spaces and ad layout models
      const adblockStyle = `
        <style id="adblock-cosmetic-shields">
          /* Curated AdBlock Plus / uBlock Ruleset */
          iframe[src*="doubleclick"], iframe[src*="bounce"], iframe[src*="adsystem"], iframe[id*="google_ads_iframe"], iframe[src*="googleads"] {
            display: none !important; width: 0 !important; height: 0 !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
          }
          .ads, .ad, .ad-banner, .banner-ad, .google-ads, .google-ad, .ad-slot, .ad-wrapper, .sponsored-content,
          [class*="ad-banner"], [class*="banner-ad"], [class*="google-ads"], [class*="sponsored-"],
          [id*="google_ads_iframe"], [id*="ad-"], .sponsor-box, .ad-box, #ad-slot, .adsbygoogle {
            display: none !important; width: 0 !important; height: 0 !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
          }
        </style>
      `;

      if (html.includes("</head>")) {
         html = html.replace("</head>", adblockStyle + "</head>");
      } else if (html.includes("<body")) {
         html = html.replace("<body", adblockStyle + "<body");
      } else {
         html += adblockStyle;
      }

      // 1. Rewrite relative anchor links (href="/wiki/Hello") to load through our proxy!
      html = html.replace(/href=(["'])([^"'\s>]+)\1/gi, (match, quote, val) => {
        if (
          val.startsWith("#") ||
          val.startsWith("javascript:") ||
          val.startsWith("mailto:") ||
          val.startsWith("tel:") ||
          val.startsWith("data:")
        ) {
          return match;
        }
        try {
          const absoluteUrl = new URL(val, targetUrl).href;
          return `href=${quote}/api/proxy?url=${encodeURIComponent(absoluteUrl)}${quote}`;
        } catch (e) {
          return match;
        }
      });

      // 2. Rewrite images, stylesheet styles, or script references directly to absolute target hosts
      html = html.replace(/src=(["'])([^"'\s>]+)\1/gi, (match, quote, val) => {
        if (val.startsWith("data:")) return match;
        try {
          const absoluteUrl = new URL(val, targetUrl).href;
          return `src=${quote}${absoluteUrl}${quote}`;
        } catch (e) {
          return match;
        }
      });

      html = html.replace(/srcset=(["'])([^"'\s>]+)\1/gi, (match, quote, val) => {
        const parts = val.split(",").map((part: string) => {
          const trimmed = part.trim();
          const firstSpace = trimmed.indexOf(" ");
          if (firstSpace === -1) {
            try { return new URL(trimmed, targetUrl).href; } catch (e) { return trimmed; }
          }
          const urlPart = trimmed.substring(0, firstSpace);
          const spaceSuffix = trimmed.substring(firstSpace);
          try {
            return new URL(urlPart, targetUrl).href + spaceSuffix;
          } catch (e) { return trimmed; }
        });
        return `srcset=${quote}${parts.join(", ")}${quote}`;
      });

      // 3. Inject collaborative monitoring scripts to pass scroll, cursor movements, and link clicks up
      const trackingCode = `
        <script>
          (function() {
            // Prevent frame-busting scripts from throwing or escaping our viewport
            if (window.top !== window.self) {
              window.top.location = null;
              window.confirm = () => true;
              window.alert = () => {};
            }

            // Sync Scrolling
            document.addEventListener('scroll', function() {
              const docHeight = document.documentElement.scrollHeight - window.innerHeight;
              const scrollPct = docHeight > 0 ? window.scrollY / docHeight : 0;
              window.parent.postMessage({ type: 'vbrowser-scroll', percent: scrollPct }, '*');
            }, { passive: true });

            // Sync Pointer/Cursor coords
            document.addEventListener('mousemove', function(e) {
              const rx = e.clientX / window.innerWidth;
              const ry = e.clientY / window.innerHeight;
              window.parent.postMessage({ type: 'vbrowser-cursor', rx: rx, ry: ry }, '*');
            });

            // COMPREHENSIVE WINDOW.OPEN OVERRIDE (Self-contained Collaborative Redirection)
            const originalWindowOpen = window.open;
            window.open = function(url, target, features) {
              console.log("[V-Browser Sandbox] Intercepted window.open attempt:", url);
              if (url) {
                let absoluteUrl = url;
                try {
                  absoluteUrl = new URL(url, window.location.href).href;
                } catch (e) {}
                
                // Parse helper
                try {
                  const urlObj = new URL(absoluteUrl);
                  if (urlObj.pathname === '/api/proxy') {
                    const param = urlObj.searchParams.get('url');
                    if (param) absoluteUrl = param;
                  }
                } catch (e) {}

                // Send unified navigation event to sync with ALL participants
                window.parent.postMessage({ type: 'vbrowser-navigate', url: absoluteUrl }, '*');
              }
              // Return a mock window object to avoid script crashes
              return {
                close: function() {},
                focus: function() {},
                blur: function() {},
                postMessage: function() {}
              };
            };

            // INTERCEPT ALL CLICK EVENTS ON SHARED WEBPAGE
            document.addEventListener('click', function(e) {
              const a = e.target.closest('a');
              if (a) {
                // Instantly capture and sanitize targets to prevent local empty tab launches
                if (a.getAttribute('target') === '_blank') {
                  a.setAttribute('target', '_self');
                }
                
                if (a.href) {
                  try {
                    const urlObj = new URL(a.href);
                    let dest = urlObj.href;
                    if (urlObj.pathname === '/api/proxy') {
                      const param = urlObj.searchParams.get('url');
                      if (param) dest = param;
                    }
                    
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Unified event to update the shared Chromium session for everyone!
                    window.parent.postMessage({ type: 'vbrowser-navigate', url: dest }, '*');
                  } catch(err) {}
                }
              }
            }, true); // High-priority capture phase

            // INTERCEPT ALL FORM SUBMISSIONS WITH TARGET="_BLANK"
            document.addEventListener('submit', function(e) {
              const form = e.target;
              if (form && form.getAttribute('target') === '_blank') {
                form.setAttribute('target', '_self');
              }
            }, true);

            // PERIODIC AND OBSERVATIONAL SANITIZATION RULES
            function sanitizeTargets() {
              document.querySelectorAll('a[target="_blank"]').forEach(function(el) {
                el.setAttribute('target', '_self');
              });
              document.querySelectorAll('form[target="_blank"]').forEach(function(el) {
                el.setAttribute('target', '_self');
              });
            }
            
            // Run on loaded, every 800ms, and on mutation changes
            sanitizeTargets();
            setInterval(sanitizeTargets, 800);
            
            if (window.MutationObserver) {
              const observer = new MutationObserver(sanitizeTargets);
              observer.observe(document.documentElement, { childList: true, subtree: true });
            }
          })();
        </script>
      `;

      if (html.includes("</body>")) {
         html = html.replace("</body>", trackingCode + "</body>");
      } else {
         html += trackingCode;
      }

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      // Strip restrictive sandboxing headers so that page works correctly
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.send(html);
    } catch (err) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`
        <html>
          <body style="background-color: #0c0c0c; color: #f5f5f5; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 24px;">
            <div style="background-color: #16161a; border: 1px solid #242428; padding: 32px; border-radius: 12px; max-width: 440px; box-shadow: 0 8px 32px rgba(0,0,0,0.4)">
              <h2 style="color: #ff3c3c; margin-top: 0;">Multiplayer Chromium Proxy Alert</h2>
              <p style="color: #a0a0ab; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
                The website <strong>${targetUrl}</strong> keeps security limits (bot-protection or anti-framing blocks) that can't be fetched on cloud servers.<br/><br/>
                No worries! Try other websites (like wikipedia.org, techblogs, reddit, news), type keywords to search inside V-Browser directly, or use native Screen Sharing!
              </p>
              <button onclick="window.parent.postMessage({ type: 'vbrowser-navigate', url: 'home' }, '*')" style="background-color: #ff2b2b; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px;">Go to Search Lobby</button>
            </div>
          </body>
        </html>
      `);
    }
  });

  // Setup WebSockets
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    let currentUserId: string | null = null;
    let currentRoomId: string | null = null;

    ws.on("message", (rawMessage: string) => {
      try {
        const data = JSON.parse(rawMessage);
        const { type, payload } = data;

        switch (type) {
          case "join-room": {
            const { roomId, userId, name } = payload;
            currentUserId = userId;
            currentRoomId = roomId;

            // Associate client socket
            clientRoomMap.set(ws, { roomId, userId });

            // Initialize or get room
            let room = rooms.get(roomId);
            if (!room) {
              room = {
                id: roomId,
                users: [],
                messages: [],
                screenSharerId: null,
                browserState: {
                  currentUrl: "home",
                  scrollPct: 0,
                  lastChangedBy: null,
                },
              };
              rooms.set(roomId, room);
            }

            // Clean existing user instances if reconnecting
            const userAlreadyInRoom = room.users.some((u) => u.id === userId);

            if (!userAlreadyInRoom && room.users.length >= 4) {
              ws.send(
                JSON.stringify({
                  type: "room-full",
                  payload: { roomId }
                })
              );
              return;
            }

            room.users = room.users.filter((u) => u.id !== userId);

            // Add client user state with safety limit checks
            const newUser: User = {
              id: userId,
              name: name || `User-${userId.substring(0, 4)}`,
              cameraOn: false,
              micOn: false,
              screenSharing: false,
              camStreamId: null,
              screenStreamId: null,
            };
            room.users.push(newUser);

            // Send initial room snapshot to joining user
            ws.send(
              JSON.stringify({
                type: "room-state",
                payload: {
                  id: room.id,
                  users: room.users,
                  messages: room.messages,
                  screenSharerId: room.screenSharerId,
                  browserState: room.browserState,
                },
              })
            );

            // Broadcast join notification to others
            broadcastToRoom(
              roomId,
              {
                type: "user-joined",
                payload: { user: newUser },
              },
              userId
            );
            break;
          }

          case "signal": {
            const { targetUserId, signal } = payload;
            if (!currentRoomId || !currentUserId) return;

            // Find target WebSocket and relay Webrtc signaling
            clientRoomMap.forEach((info, targetWs) => {
              if (
                info.roomId === currentRoomId &&
                info.userId === targetUserId &&
                targetWs.readyState === WebSocket.OPEN
              ) {
                targetWs.send(
                  JSON.stringify({
                    type: "signal",
                    payload: {
                      fromUserId: currentUserId,
                      signal,
                    },
                  })
                );
              }
            });
            break;
          }

          case "state-update": {
            if (!currentRoomId || !currentUserId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            const user = room.users.find((u) => u.id === currentUserId);
            if (user) {
              user.cameraOn = payload.cameraOn ?? user.cameraOn;
              user.micOn = payload.micOn ?? user.micOn;
              user.screenSharing = payload.screenSharing ?? user.screenSharing;
              user.camStreamId = payload.camStreamId ?? user.camStreamId;
              user.screenStreamId = payload.screenStreamId ?? user.screenStreamId;

              // Synthesize screen sharer state
              if (user.screenSharing) {
                room.screenSharerId = user.id;
              } else if (room.screenSharerId === user.id) {
                room.screenSharerId = null;
              }

              // Broadcast updated room participant state
              broadcastToRoom(currentRoomId, {
                type: "state-updated",
                payload: {
                  userId: currentUserId,
                  user: user,
                  screenSharerId: room.screenSharerId,
                },
              });
            }
            break;
          }

          case "browser-navigate": {
            if (!currentRoomId || !currentUserId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            room.browserState = {
              currentUrl: payload.url,
              scrollPct: 0,
              lastChangedBy: currentUserId,
            };

            broadcastToRoom(currentRoomId, {
              type: "browser-state",
              payload: {
                browserState: room.browserState,
                senderId: currentUserId,
              },
            });
            break;
          }

          case "browser-scroll": {
            if (!currentRoomId || !currentUserId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            if (room.browserState) {
              room.browserState.scrollPct = payload.scrollPct;
            }

            broadcastToRoom(
              currentRoomId,
              {
                type: "browser-scroll",
                payload: {
                  scrollPct: payload.scrollPct,
                  senderId: currentUserId,
                },
              },
              currentUserId
            );
            break;
          }

          case "browser-cursor": {
            if (!currentRoomId || !currentUserId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            const user = room.users.find((u) => u.id === currentUserId);
            const userName = user ? user.name : "Member";

            broadcastToRoom(
              currentRoomId,
              {
                type: "browser-cursor",
                payload: {
                  rx: payload.rx,
                  ry: payload.ry,
                  userId: currentUserId,
                  userName: userName,
                },
              },
              currentUserId
            );
            break;
          }

          case "chat-message": {
            if (!currentRoomId || !currentUserId) return;
            const room = rooms.get(currentRoomId);
            if (!room) return;

            const user = room.users.find((u) => u.id === currentUserId);
            const senderName = user ? user.name : "Guest";

            const newMessage: Message = {
              id: Math.random().toString(36).substring(2, 11),
              senderId: currentUserId,
              senderName,
              text: payload.text,
              timestamp: Date.now(),
            };

            // Store message history (capped to last 150 for space effectiveness)
            room.messages.push(newMessage);
            if (room.messages.length > 150) {
              room.messages.shift();
            }

            // Sync with all peers
            broadcastToRoom(currentRoomId, {
              type: "chat-message",
              payload: { message: newMessage },
            });
            break;
          }

          default:
            console.warn(`[WS] Unknown command: ${type}`);
        }
      } catch (err) {
        console.error("[WS] Message error:", err);
      }
    });

    ws.on("close", () => {
      // Clean up client context
      const info = clientRoomMap.get(ws);
      clientRoomMap.delete(ws);

      if (info) {
        const { roomId, userId } = info;
        const room = rooms.get(roomId);
        if (room) {
          // Remove from list
          room.users = room.users.filter((u) => u.id !== userId);

          // Reset screen sharing if this user was sharing
          if (room.screenSharerId === userId) {
            room.screenSharerId = null;
          }

          // Broadcast leave notification
          broadcastToRoom(roomId, {
            type: "user-left",
            payload: { userId, screenSharerId: room.screenSharerId },
          });

          // Delete room if vacant
          if (room.users.length === 0) {
            rooms.delete(roomId);
          }
        }
      }
    });

    ws.on("error", (e) => {
      console.error("[WS] Client connection error:", e);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Bind port 3000 (Required container ingress channel)
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[V-Browser Server] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server bootstrap failure:", err);
});
