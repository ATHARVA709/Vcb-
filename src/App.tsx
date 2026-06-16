import React, { useState, useEffect, useRef } from "react";
import { Participant, Message, RoomState } from "./types";
import RoomJoin from "./components/RoomJoin";
import BrowseWorkspace from "./components/BrowseWorkspace";
import Controls from "./components/Controls";
import VideoGrid from "./components/VideoGrid";
import ChatArea from "./components/ChatArea";
import FloatingVideoBubble from "./components/FloatingVideoBubble";
import { Copy, Check, Info, Users, Tv, Settings, LogOut, Radio, Sparkles } from "lucide-react";

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localName, setLocalName] = useState<string>("");
  const [localUserId, setLocalUserId] = useState<string>("");

  // Room state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [screenSharerId, setScreenSharerId] = useState<string | null>(null);

  // Local media states
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);

  // Streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  // Refs for tracking
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewportRef = useRef<HTMLDivElement>(null);

  // Collaborative Co-Browser States
  const [browserUrl, setBrowserUrl] = useState<string>("home");
  const [browserScrollPct, setBrowserScrollPct] = useState<number>(0);
  const [vBrowserCursors, setVBrowserCursors] = useState<Map<string, { rx: number; ry: number; name: string }>>(new Map());

  // UI state
  const [isCopied, setIsCopied] = useState(false);
  const [connStatus, setConnStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [errorText, setErrorText] = useState<string | null>(null);

  // Immersive watchparty controls & HUD notifications
  const [isFullscreenFocus, setIsFullscreenFocus] = useState(false);
  const [isFullscreenChatOpen, setIsFullscreenChatOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; senderName: string; text: string; timestamp: number }[]>([]);

  // Parse initial room parameter from query url
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomId(roomParam.toLowerCase());
    }

    // Set stable local user identity in sessionStorage
    let persistentId = sessionStorage.getItem("v_browser_user_id");
    if (!persistentId) {
      persistentId = "user_" + Math.random().toString(36).substring(2, 11);
      sessionStorage.setItem("v_browser_user_id", persistentId);
    }
    setLocalUserId(persistentId);
  }, []);

  // WebRTC Configuration
  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  // Helper to send messages over WebSocket
  const sendWsMessage = (type: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  };

  // Clear up all WebRTC & Streams, back to join
  const handleLeaveRoom = () => {
    // 1. Alert signaling channel
    sendWsMessage("leave-room", {});

    // 2. Shut off camera streams
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    // 3. Clear peers
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();

    // 4. Close sockets
    if (wsRef.current) {
      wsRef.current.close();
    }

    // 5. Reset states
    setLocalStream(null);
    setLocalScreenStream(null);
    setRemoteStreams(new Map());
    setParticipants([]);
    setMessages([]);
    setScreenSharerId(null);
    setCameraOn(false);
    setMicOn(false);
    setIsSharingScreen(false);
    setConnStatus("disconnected");
    setRoomId(null);

    // Clean address bar parameter without reloading
    const newUrl = window.location.origin + window.location.pathname;
    window.history.pushState({}, "", newUrl);
  };

  // Setup Peer Connection for a user
  const createPeerConnection = (targetUserId: string, isInitiator: boolean) => {
    if (pcs.current.has(targetUserId)) {
      // Clean stale connections first
      pcs.current.get(targetUserId)?.close();
    }

    const pc = new RTCPeerConnection(rtcConfig);

    // Attach any existing audio/video camera tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Attach screen share tracks
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localScreenStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsMessage("signal", {
          targetUserId,
          signal: {
            type: "candidate",
            candidate: event.candidate,
          },
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(targetUserId, stream);
          return next;
        });
      }
    };

    // Auto-Negotiation handler for Initiators
    if (isInitiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendWsMessage("signal", {
            targetUserId,
            signal: {
              type: "offer",
              sdp: offer,
            },
          });
        } catch (e) {
          console.error("Negotiation needed error:", e);
        }
      };
    }

    pcs.current.set(targetUserId, pc);
    return pc;
  };

  // Initiate dynamic renegotiation layout whenever we start sharing streams
  const triggerRenegotiation = () => {
    pcs.current.forEach(async (pc, targetUserId) => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWsMessage("signal", {
          targetUserId,
          signal: {
            type: "offer",
            sdp: offer,
          },
        });
      } catch (error) {
        console.error(`Renegotiation error for target ${targetUserId}:`, error);
      }
    });
  };

  // Join handler
  const handleJoinOrCreate = (selectedRoomId: string, name: string) => {
    setRoomId(selectedRoomId);
    setLocalName(name);
    setConnStatus("connecting");
    setErrorText(null);

    // Update query string in the address bar
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${selectedRoomId}`;
    window.history.pushState({}, "", newUrl);

    // Connect to WebSocket Server on port 3000
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host; // Matches domain/port perfectly
    const wsUrl = `${protocol}//${host}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnStatus("connected");
      // Request joining
      ws.send(
        JSON.stringify({
          type: "join-room",
          payload: {
            roomId: selectedRoomId,
            userId: localUserId,
            name: name,
          },
        })
      );
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, payload } = data;

        switch (type) {
          case "room-state": {
            const roomSnapshot: RoomState = payload;
            
            // Filter other participants
            const others = roomSnapshot.users.filter((u) => u.id !== localUserId);
            setParticipants(others);
            setMessages(roomSnapshot.messages);
            setScreenSharerId(roomSnapshot.screenSharerId);

            if (roomSnapshot.browserState) {
              setBrowserUrl(roomSnapshot.browserState.currentUrl || "home");
              setBrowserScrollPct(roomSnapshot.browserState.scrollPct || 0);
            }

            // Initiate peer connections to anyone already present in the workspace
            others.forEach((p) => {
              createPeerConnection(p.id, true);
            });
            break;
          }

          case "user-joined": {
            const newUser: Participant = payload.user;
            setParticipants((prev) => {
              // Deduplicate
              if (prev.some((u) => u.id === newUser.id)) return prev;
              return [...prev, newUser];
            });

            // Target will initiate the connection to us, but we can also set up the passive Peer
            createPeerConnection(newUser.id, false);
            break;
          }

          case "user-left": {
            const { userId, screenSharerId: activeSharer } = payload;
            setParticipants((prev) => prev.filter((p) => p.id !== userId));
            setScreenSharerId(activeSharer);

            // Clear their mouse pointer indicator safely
            setVBrowserCursors((prev) => {
              const next = new Map(prev);
              next.delete(userId);
              return next;
            });

            // Tear down peer connection
            const pc = pcs.current.get(userId);
            if (pc) {
              pc.close();
              pcs.current.delete(userId);
            }

            setRemoteStreams((prev) => {
              const next = new Map(prev);
              next.delete(userId);
              return next;
            });
            break;
          }

          case "browser-state": {
            const { browserState } = payload;
            if (browserState) {
              setBrowserUrl(browserState.currentUrl || "home");
              setBrowserScrollPct(browserState.scrollPct || 0);
            }
            break;
          }

          case "browser-scroll": {
            const { scrollPct } = payload;
            setBrowserScrollPct(scrollPct || 0);
            break;
          }

          case "browser-cursor": {
            const { userId, userName, rx, ry } = payload;
            setVBrowserCursors((prev) => {
              const next = new Map(prev);
              next.set(userId, { rx, ry, name: userName || "Guest" });
              return next;
            });
            break;
          }

          case "signal": {
            const { fromUserId, signal } = payload;
            let pc = pcs.current.get(fromUserId);
            if (!pc) {
              pc = createPeerConnection(fromUserId, false);
            }

            if (signal.type === "offer") {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              sendWsMessage("signal", {
                targetUserId: fromUserId,
                signal: {
                  type: "answer",
                  sdp: answer,
                },
              });
            } else if (signal.type === "answer") {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            } else if (signal.type === "candidate") {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
              } catch (e) {
                console.warn("[WebRTC] ICE candidate ignored:", e);
              }
            }
            break;
          }

          case "state-updated": {
            const { userId, user, screenSharerId: activeSharer } = payload;
            setScreenSharerId(activeSharer);

            if (userId !== localUserId) {
              setParticipants((prev) =>
                prev.map((p) => (p.id === userId ? { ...p, ...user } : p))
              );
            }
            break;
          }

          case "chat-message": {
            const newMsg: Message = payload.message;
            setMessages((prev) => [...prev, newMsg]);

            // Append floating temporary overlay chat notification if not self-sent
            if (newMsg.senderId !== localUserId) {
              const toastId = "toast_" + Math.random().toString(36).substring(2, 9);
              setToasts((prev) => [
                ...prev,
                { id: toastId, senderName: newMsg.senderName, text: newMsg.text, timestamp: Date.now() },
              ]);
              setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== toastId));
              }, 4500);
            }
            break;
          }

          case "room-full": {
            alert("This virtual room is full (maximum 4 participants). Please try a different room code!");
            handleLeaveRoom();
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error("[WS CLIENT] Processing error:", err);
      }
    };

    ws.onclose = () => {
      setConnStatus("disconnected");
    };

    ws.onerror = (e) => {
      console.error("[WS CLIENT] Connection error:", e);
      setErrorText("Signaling connection disrupted. Please refresh.");
    };
  };

  // Toggle Camera
  const handleToggleCamera = async () => {
    try {
      if (cameraOn) {
        // Toggle tracks off
        if (localStream) {
          const videoTrack = localStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = false;
          }
        }
        setCameraOn(false);
        sendWsMessage("state-update", { cameraOn: false });
      } else {
        // Turning camera ON
        let stream = localStream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, frameRate: 15 },
            audio: true, // Request both together to avoid multiple permissions popups
          });
          setLocalStream(stream);
          localStreamRef.current = stream;

          // Enable Mic state if we successfully retrieve audio track
          const audioTrack = stream.getAudioTracks()[0];
          setMicOn(!!audioTrack && audioTrack.enabled);

          // Add to all peer connections
          stream.getTracks().forEach((track) => {
            pcs.current.forEach((pc) => {
              pc.addTrack(track, stream!);
            });
          });
        } else {
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.enabled = true;
          } else {
            // Need to retrieve new video track
            const canvasDeviceStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = canvasDeviceStream.getVideoTracks()[0];
            stream.addTrack(newVideoTrack);
            pcs.current.forEach((pc) => {
              pc.addTrack(newVideoTrack, stream!);
            });
          }
        }

        setCameraOn(true);
        sendWsMessage("state-update", {
          cameraOn: true,
          camStreamId: stream.id,
        });

        triggerRenegotiation();
      }
    } catch (err) {
      console.error("Camera access denied or failed:", err);
      alert("Could not access camera. Ensure permissions are allowed in frame config.");
    }
  };

  // Toggle Microphone
  const handleToggleMic = async () => {
    try {
      if (micOn) {
        // Disable local audio tracks
        if (localStream) {
          const audioTrack = localStream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = false;
          }
        }
        setMicOn(false);
        sendWsMessage("state-update", { micOn: false });
      } else {
        // Enable microphone
        let stream = localStream;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });
          setLocalStream(stream);
          localStreamRef.current = stream;

          stream.getTracks().forEach((track) => {
            pcs.current.forEach((pc) => {
              pc.addTrack(track, stream!);
            });
          });
        } else {
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = true;
          }
        }
        setMicOn(true);
        sendWsMessage("state-update", { micOn: true });
        triggerRenegotiation();
      }
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Could not access microphone.");
    }
  };

  // Start Screen Sharing
  const handleStartScreenShare = async () => {
    try {
      if (isSharingScreen) {
        handleStopScreenSharing();
        return;
      }

      const mediaDevicesObject = navigator.mediaDevices;
      if (!mediaDevicesObject || !mediaDevicesObject.getDisplayMedia) {
        alert(
          "Screen sharing is not supported directly in this preview frame.\n\n" +
          "To start sharing with your friends:\n" +
          "1. Click the 'Open in New Tab' icon in the top toolbar to open V-Browser fully.\n" +
          "2. Ensure you are using Chrome, Firefox, or Safari on your PC or Android dev."
        );
        return;
      }

      let stream: MediaStream;
      try {
        // Attempt high-fidelity stream capturing tab audio
        stream = await mediaDevicesObject.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });
      } catch (audioErr) {
        console.warn("Display media capturing without audio (often required on Android):", audioErr);
        // Fallback for Android/Chrome/Firefox where system audio prompts may fail (e.g. mobile views)
        stream = await mediaDevicesObject.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
      }

      setLocalScreenStream(stream);
      localScreenStreamRef.current = stream;
      setIsSharingScreen(true);
      setScreenSharerId(localUserId);

      // Listen for browser's manual "stop sharing" click
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          handleStopScreenSharing();
        };
      }

      // Add screen tracks to all peer connections
      stream.getTracks().forEach((track) => {
        pcs.current.forEach((pc) => {
          pc.addTrack(track, stream);
        });
      });

      sendWsMessage("state-update", {
        screenSharing: true,
        screenStreamId: stream.id,
      });

      triggerRenegotiation();
    } catch (err) {
      console.error("Screen share start canceled or failed:", err);
    }
  };

  const handleStopScreenSharing = () => {
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    // Remove screen tracks from peer senders
    pcs.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        if (
          sender.track &&
          localScreenStreamRef.current?.getTracks().includes(sender.track)
        ) {
          try {
            pc.removeTrack(sender);
          } catch (e) {
            console.warn(e);
          }
        }
      });
    });

    setLocalScreenStream(null);
    localScreenStreamRef.current = null;
    setIsSharingScreen(false);

    if (screenSharerId === localUserId) {
      setScreenSharerId(null);
    }

    sendWsMessage("state-update", {
      screenSharing: false,
      screenStreamId: null,
    });

    triggerRenegotiation();
  };

  // Co-Browsing Sync Helpers
  const handleBrowserNavigate = (url: string) => {
    setBrowserUrl(url);
    setBrowserScrollPct(0);
    sendWsMessage("browser-navigate", { url });
  };

  const handleBrowserScroll = (pct: number) => {
    setBrowserScrollPct(pct);
    sendWsMessage("browser-scroll", { scrollPct: pct });
  };

  const handleBrowserCursorMove = (rx: number, ry: number) => {
    sendWsMessage("browser-cursor", { rx, ry });
  };

  // Chat message send
  const handleSendMessage = (text: string) => {
    sendWsMessage("chat-message", { text });
  };

  // Copy or share invite link beautifully (compatible with native Android Share and PC Clipboard)
  const handleCopyLink = async () => {
    if (!roomId) return;
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    
    // Check for native share support (superb for Android and iOS mobile devices)
    if (navigator.share) {
      try {
        await navigator.share({
          title: "V-Browser Watchparty",
          text: `Join my collaborative workspace on V-Browser (Room ${roomId})!`,
          url: inviteUrl,
        });
        return;
      } catch (err) {
        console.warn("Native sharing cancelled or skipped:", err);
      }
    }

    // Standard PC high-fidelity clipboard copy fallback
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.warn("Clipboard access issue, display link directly:", err);
    }
  };

  // If not entered a room, render the lobby setup
  if (!roomId || connStatus === "disconnected") {
    return <RoomJoin onJoin={handleJoinOrCreate} initialRoomId={roomId || ""} />;
  }

  // Find active screen share stream
  let displayScreenStream: MediaStream | null = null;
  let screenSharerName: string | null = null;

  if (screenSharerId === localUserId) {
    displayScreenStream = localScreenStream;
    screenSharerName = "You";
  } else if (screenSharerId) {
    const sharer = participants.find((p) => p.id === screenSharerId);
    if (sharer && sharer.screenStreamId) {
      displayScreenStream = remoteStreams.get(screenSharerId) || null;
      screenSharerName = sharer.name;
    }
  }

  return (
    <div
      id="app-workspace-viewport"
      ref={viewportRef}
      className="h-screen max-h-screen overflow-hidden bg-[#0A0A0A] text-zinc-105 flex flex-col p-3 md:p-4 select-none selection:bg-[#FF2B2B] selection:text-white relative"
    >
      {/* Background neon style details */}
      <div className="absolute inset-x-0 top-0 h-[100px] bg-gradient-to-b from-[#FF2B2B]/5 to-transparent pointer-events-none" />

      {/* RENDER NORMAL (NON-FOCUS) HEADER ONLY */}
      {!isFullscreenFocus && (
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800/60 pb-2.5 mb-2.5 font-sans relative z-15 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#FF2B2B] shadow-[0_0_12px_rgba(255,43,43,0.12)] ring-1 ring-zinc-805">
              <Tv className="w-4.5 h-4.5 animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-widest text-white flex items-center gap-1">
                V<span className="text-[#FF2B2B]">-</span>BROWSER
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-[#FF2B2B]/10 border border-[#FF2B2B]/20 text-[9px] text-[#FF4D4D] font-bold font-mono uppercase">
                  COLLABORATIVE WATCHPARTY ACTIVE ({participants.length + 1}/4)
                </span>
              </div>
            </div>
          </div>

          {/* Copy Link / Android Share */}
          <div className="flex items-center gap-2.5 bg-zinc-900/90 border border-zinc-850 rounded-xl p-1.5 pl-3 backdrop-blur-sm">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="text-zinc-500 text-[11px] font-semibold">ROOM:</span>
              <span className="text-white text-[11px] font-mono font-bold tracking-wider uppercase bg-zinc-950 px-1.5 py-0.5 border border-zinc-850 rounded-md">
                {roomId}
              </span>
            </div>

            <button
              id="btn-copy-link"
              onClick={handleCopyLink}
              className={`flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg border font-medium cursor-pointer transition-all ${
                isCopied
                  ? "bg-emerald-950/20 border-emerald-500/50 text-emerald-400"
                  : "bg-zinc-950 border-zinc-800 text-zinc-300 hover:text-white hover:border-[#FF2B2B]/40 animate-pulse"
              }`}
              title="Copy or share watchparty link with friends"
            >
              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? "Shared!" : "Invite Friends"}</span>
            </button>
          </div>
        </header>
      )}

      {/* MAIN WATCHPARTY AREA */}
      <div className="flex-1 flex gap-3 min-h-0 h-full overflow-hidden relative">
        
        {/* LEFT COMPONENT: Shared Movie Theater Content Canvas */}
        <div className={`flex flex-col h-full min-h-0 transition-all duration-300 ${isFullscreenFocus ? "w-full" : "w-[72%]"} relative`}>
          <BrowseWorkspace
            roomId={roomId}
            screenStream={displayScreenStream}
            isSharingLocalScreen={screenSharerId === localUserId}
            screenSharerName={screenSharerName}
            isFullscreenFocus={isFullscreenFocus}
            onToggleFocus={() => setIsFullscreenFocus(!isFullscreenFocus)}
            cameraOn={cameraOn}
            micOn={micOn}
            isSharingScreen={isSharingScreen}
            onToggleCamera={handleToggleCamera}
            onToggleMic={handleToggleMic}
            onToggleScreenShare={handleStartScreenShare}
            onLeave={handleLeaveRoom}
            currentUrl={browserUrl}
            scrollPct={browserScrollPct}
            onNavigate={handleBrowserNavigate}
            onScrollChange={handleBrowserScroll}
            onCursorMove={handleBrowserCursorMove}
            vBrowserCursors={vBrowserCursors}
            localUserId={localUserId}
            localName={localName}
          />

          {/* TRANSITIONAL FLOATING OVERLAY BAR IN FULLSCREEN THEATER MODE */}
          {isFullscreenFocus && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1 pointer-events-auto">
              <button
                type="button"
                onClick={() => setIsFullscreenChatOpen(!isFullscreenChatOpen)}
                className={`px-4 py-2 bg-[#121212] hover:bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white rounded-xl text-xs font-sans font-bold flex items-center gap-2 shadow-2xl backdrop-blur-md cursor-pointer`}
              >
                <span>{isFullscreenChatOpen ? "Hide Overlay Chat" : "Show Overlay Chat"}</span>
              </button>
            </div>
          )}
        </div>

        {/* RIGHT COMPONENT: Classic sidebar, fully hides during focus mode */}
        {!isFullscreenFocus && (
          <div className="w-[28%] flex flex-col h-full min-h-0 overflow-hidden justify-start shrink-0">
            {/* Premium Full-Height Chat - Stretches fully down to the very bottom! */}
            <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col">
              <ChatArea
                localUserId={localUserId}
                messages={messages}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>
        )}

        {/* FLOATING OVERLAY CHAT IN FOCUS MODE */}
        {isFullscreenFocus && isFullscreenChatOpen && (
          <div className="absolute right-4 top-4 bottom-20 w-80 bg-zinc-950/90 border border-zinc-800/80 rounded-2xl p-0.5 flex flex-col shadow-2xl backdrop-blur-md z-45 overflow-hidden ring-1 ring-zinc-805">
            <div className="flex-1 min-h-0 h-full flex flex-col">
              <ChatArea
                localUserId={localUserId}
                messages={messages}
                onSendMessage={handleSendMessage}
              />
            </div>
          </div>
        )}

        {/* FLOATING TEMPORARY MSG TOAST NOTIFICATIONS (For Watchparty HUD Feel) */}
        <div className="absolute bottom-5 left-5 max-w-sm flex flex-col gap-2 z-50 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="bg-black/85 border border-[#FF2B2B]/40 hover:border-[#FF2B2B] px-4 py-2.5 rounded-xl block text-white text-xs font-sans shadow-[0_5px_15px_rgba(0,0,0,0.5)] backdrop-blur-md animate-fadeIn transition-all duration-300 pointer-events-auto"
            >
              <span className="text-[#FF4D4D] font-extrabold text-[10.5px] block uppercase font-mono tracking-wide mb-0.5">
                {t.senderName} says:
              </span>
              <span className="text-zinc-200 block text-pretty">{t.text}</span>
            </div>
          ))}
        </div>

      </div>

      {/* DRAGGABLE CIRCULAR VIDEO BUBBLES FLOATING (Always visible, always interactive in entire viewport) */}
      {/* Local User Bubble */}
      <FloatingVideoBubble
        id={localUserId}
        name={`${localName || "Member"} (You)`}
        stream={localStream}
        cameraOn={cameraOn}
        micOn={micOn}
        isLocal={true}
        isSpeaking={micOn && cameraOn}
        dragConstraintsRef={viewportRef}
        initialPosition={{
          x: typeof window !== "undefined" ? window.innerWidth - 135 : 820,
          y: 80,
        }}
      />

      {/* Remote Peers Bubbles */}
      {participants.map((p, idx) => {
        const stream = remoteStreams.get(p.id) || null;
        return (
          <FloatingVideoBubble
            key={p.id}
            id={p.id}
            name={p.name}
            stream={stream}
            cameraOn={p.cameraOn}
            micOn={p.micOn}
            isLocal={false}
            isSpeaking={p.micOn && p.cameraOn}
            dragConstraintsRef={viewportRef}
            initialPosition={{
              x: typeof window !== "undefined" ? window.innerWidth - 135 : 820,
              y: 190 + idx * 110,
            }}
          />
        );
      })}
    </div>
  );
}
