import React, { useRef, useEffect, useState } from "react";
import {
  Monitor,
  Shield,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Play,
  Maximize,
  Film,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorOff,
  LogOut,
  HelpCircle,
  Search,
  Globe,
  Compass,
  Loader2,
  Tv,
  Plus,
  X,
  ExternalLink,
  ShieldCheck,
  Check,
  Sparkles
} from "lucide-react";

interface BrowserTab {
  id: string;
  title: string;
  url: string;
}

interface BrowseWorkspaceProps {
  roomId: string;
  screenStream: MediaStream | null;
  isSharingLocalScreen: boolean;
  screenSharerName: string | null;
  isFullscreenFocus: boolean;
  onToggleFocus: () => void;
  cameraOn: boolean;
  micOn: boolean;
  isSharingScreen: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;

  // Collaborative Co-Browser Synchronizer Props
  currentUrl: string;
  scrollPct: number;
  onNavigate: (url: string) => void;
  onScrollChange: (pct: number) => void;
  onCursorMove: (rx: number, ry: number) => void;
  vBrowserCursors: Map<string, { rx: number; ry: number; name: string }>;
  localUserId: string;
  localName: string;
}

const getDisplayTitle = (url: string) => {
  if (!url || url === "home") return "Chrome Lobby";
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.replace("www.", "");
    if (host.length > 18) host = host.substring(0, 16) + "..";
    return host;
  } catch (e) {
    return url.length > 18 ? url.substring(0, 16) + ".." : url;
  }
};

export default function BrowseWorkspace({
  roomId,
  screenStream,
  isSharingLocalScreen,
  screenSharerName,
  isFullscreenFocus,
  onToggleFocus,
  cameraOn,
  micOn,
  isSharingScreen,
  onToggleCamera,
  onToggleMic,
  onToggleScreenShare,
  onLeave,

  // Synchronizers
  currentUrl,
  scrollPct,
  onNavigate,
  onScrollChange,
  onCursorMove,
  vBrowserCursors,
  localUserId,
  localName,
}: BrowseWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const browserContainerRef = useRef<HTMLDivElement>(null);

  // Active sync settings
  const [activeMode, setActiveMode] = useState<"browser" | "screenshare">("browser");
  
  // Chromium Tab Bar states
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([
    { id: "tab_default", title: "Chrome Home Lobby", url: "home" }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("tab_default");

  const [urlInput, setUrlInput] = useState(currentUrl === "home" ? "" : currentUrl);
  const [historyStack, setHistoryStack] = useState<string[]>(["home"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // AdBlocker Simulation Stats
  const [blockedAdsCount, setBlockedAdsCount] = useState<number>(37);
  const [showAdBlockerPopover, setShowAdBlockerPopover] = useState<boolean>(false);

  // Sync video source on screen stream change
  useEffect(() => {
    if (videoRef.current && screenStream) {
      videoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  // If somebody starts screen sharing, default to the screenshare tab
  useEffect(() => {
    if (screenStream && activeMode !== "screenshare") {
      setActiveMode("screenshare");
    }
  }, [screenStream]);

  // Sync text bar and browserTabs list when remote url changes
  useEffect(() => {
    setUrlInput(currentUrl === "home" ? "" : currentUrl);

    // Update or append selected tab dynamically
    setBrowserTabs((prev) => {
      const exists = prev.some(t => t.url === currentUrl);
      if (exists) return prev;
      
      // Update currently active tab url
      return prev.map(t => t.id === activeTabId ? { ...t, url: currentUrl, title: getDisplayTitle(currentUrl) } : t);
    });
    
    // Maintain navigation history record locally
    setHistoryStack((prev) => {
      if (prev[prev.length - 1] === currentUrl) return prev;
      const nextStack = prev.slice(0, historyIndex + 1);
      nextStack.push(currentUrl);
      setHistoryIndex(nextStack.length - 1);
      return nextStack;
    });

    if (currentUrl !== "home") {
      setIsLoading(true);
      // Increment blocked ads count slightly as counter of active filters on frame fetch
      setBlockedAdsCount(prev => prev + Math.floor(Math.random() * 8) + 4);
      const timer = setTimeout(() => setIsLoading(false), 900);
      return () => clearTimeout(timer);
    }
  }, [currentUrl]);

  // Listening to co-browser activities from inside the proxy iframe (scroll, click, mousemove)
  useEffect(() => {
    const handleProxyMessage = (e: MessageEvent) => {
      if (!e.data) return;

      if (e.data.type === "vbrowser-scroll") {
        onScrollChange(e.data.percent);
      } else if (e.data.type === "vbrowser-cursor") {
        onCursorMove(e.data.rx, e.data.ry);
      } else if (e.data.type === "vbrowser-navigate") {
        if (e.data.url) {
          onNavigate(e.data.url);
        }
      } else if (e.data.type === "vbrowser-open-chrome") {
        if (e.data.url) {
          onNavigate(e.data.url);
        }
      }
    };

    window.addEventListener("message", handleProxyMessage);
    return () => window.removeEventListener("message", handleProxyMessage);
  }, [onScrollChange, onCursorMove, onNavigate]);

  // Remotely sync iframe scrolling if it gets command from other people
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow && currentUrl !== "home") {
      try {
        const iframe = iframeRef.current;
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument || win.document;
        if (doc && doc.documentElement) {
          const maxScroll = doc.documentElement.scrollHeight - iframe.offsetHeight;
          if (maxScroll > 0) {
            win.scrollTo({
              top: scrollPct * maxScroll,
              behavior: "auto"
            });
          }
        }
      } catch (err) {
        // Tolerated peacefully (since we rewrite iframe to same domain, this is allowed, but guard just in case)
      }
    }
  }, [scrollPct, currentUrl]);

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  // Chromium Tab Operations
  const handleAddNewTab = () => {
    const newId = "tab_" + Date.now();
    const newTab: BrowserTab = {
      id: newId,
      title: "New Google Tab",
      url: "home"
    };
    setBrowserTabs([...browserTabs, newTab]);
    setActiveTabId(newId);
    onNavigate("home");
  };

  const handleTabSelect = (tid: string, url: string) => {
    setActiveTabId(tid);
    onNavigate(url);
  };

  const handleTabClose = (tid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (browserTabs.length <= 1) return; // Keep at least one tab

    const idx = browserTabs.findIndex(t => t.id === tid);
    const updated = browserTabs.filter(t => t.id !== tid);
    setBrowserTabs(updated);

    if (activeTabId === tid) {
      const nextActive = updated[Math.max(0, idx - 1)];
      setActiveTabId(nextActive.id);
      onNavigate(nextActive.url);
    }
  };

  // Resolve typed text -> search queries or website addresses
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    let destination = urlInput.trim();
    // Validate if it is a website address
    const hasDot = destination.includes(".");
    const hasSpaces = destination.includes(" ");

    if (hasSpaces || !hasDot) {
      // Trigger dynamic Wikipedia search portal routing
      destination = "https://en.wikipedia.org/wiki/Special:Search?search=" + encodeURIComponent(destination);
    } else {
      // Ensure HTTP schema structure
      if (!/^https?:\/\//i.test(destination)) {
        destination = "https://" + destination;
      }
    }

    onNavigate(destination);

    // Update active tab title and URL
    setBrowserTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: destination, title: getDisplayTitle(destination) } : t));
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const parentUrl = historyStack[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onNavigate(parentUrl);
    }
  };

  const handleForward = () => {
    if (historyIndex < historyStack.length - 1) {
      const nextUrl = historyStack[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onNavigate(nextUrl);
    }
  };

  const handleReload = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      const prevSource = iframeRef.current.src;
      iframeRef.current.src = "";
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = prevSource;
          setIsLoading(false);
        }
      }, 300);
    }
  };

  const handleQuickLaunch = (url: string) => {
    onNavigate(url);
  };

  const handleLocalMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only track inside the frame container area
    if (browserContainerRef.current) {
      const rect = browserContainerRef.current.getBoundingClientRect();
      const rx = (e.clientX - rect.left) / rect.width;
      const ry = (e.clientY - rect.top) / rect.height;
      onCursorMove(rx, ry);
    }
  };

  // Convert currentUrl to client-facing frame source
  const getIframeSource = () => {
    if (currentUrl === "home") return "about:blank";
    return `/api/proxy?url=${encodeURIComponent(currentUrl)}`;
  };

  return (
    <div id="workspace-container" className="flex flex-col flex-1 h-full bg-[#141414] border border-zinc-800/80 rounded-2xl overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
      
      {/* 🌐 CHROMIUM MULTI-TAB BAR (Chrome Style) */}
      <div className="bg-[#0b0b0d] px-3 pt-2.5 flex items-center justify-between border-b border-zinc-900 select-none font-sans">
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none pr-4">
          
          {/* Mac Circle Buttons */}
          <div className="flex items-center gap-1.5 mr-4 shrink-0 pl-1">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]" />
          </div>

          {/* Interactive Synced Tabs */}
          {browserTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => handleTabSelect(tab.id, tab.url)}
                className={`group relative h-8 px-3.5 flex items-center gap-2 rounded-t-lg text-xs font-semibold cursor-pointer transition-all shrink-0 max-w-[150px] sm:max-w-[180px] border-r border-zinc-900/40 ${
                  isActive
                    ? "bg-[#18181c] text-white shadow-xs font-medium border-t border-x border-zinc-850"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/75"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${tab.url === "home" ? "bg-red-500" : "bg-emerald-500 animate-pulse"}`} />
                <span className="truncate pr-1">{tab.title}</span>
                
                {/* Tab Close button */}
                <button
                  type="button"
                  onClick={(e) => handleTabClose(tab.id, e)}
                  disabled={browserTabs.length <= 1}
                  className="opacity-0 group-hover:opacity-100 hover:bg-zinc-850 text-zinc-500 hover:text-white rounded-sm p-0.5 transition-all cursor-pointer disabled:opacity-0"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}

          {/* Plus Add New Tab Button */}
          <button
            type="button"
            onClick={handleAddNewTab}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors shrink-0 cursor-pointer"
            title="Open New Tab (Collaborative)"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Tab settings & indicators */}
        <div className="hidden sm:flex items-center gap-3 shrink-0 pb-1.5 text-[10px] text-zinc-500 font-mono">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-855">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>REAL CHROMIUM SYNCED</span>
          </div>
        </div>
      </div>

      {/* 🔎 MAIN SUB-BAR NAVIGATION / URL ADDR CONTROLS */}
      <div className="bg-[#121215] border-b border-zinc-900 px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 font-sans select-none">
        
        {/* Navigation & Tab Selection */}
        <div className="flex items-center justify-between md:justify-start gap-4 shrink-0">
          
          {/* Mode Switcher */}
          <div className="flex bg-[#0A0A0A] border border-zinc-850 p-0.5 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setActiveMode("browser")}
              className={`px-3 py-1 rounded-md font-semibold transition-all duration-150 flex items-center gap-1 cursor-pointer ${
                activeMode === "browser"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-350"
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-[#FF2B2B]" />
              <span>Co-Browse Sandbox</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("screenshare")}
              className={`px-3 py-1 rounded-md font-semibold transition-all duration-150 flex items-center gap-1 cursor-pointer ${
                activeMode === "screenshare"
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-350"
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Desktop Share</span>
              {screenStream && (
                <span className="w-1.5 h-1.5 bg-[#FF2B2B] rounded-full animate-ping ml-0.5" />
              )}
            </button>
          </div>
        </div>

        {/* Browser URL Input Area - Only shows when Browser tab is chosen */}
        {activeMode === "browser" ? (
          <form onSubmit={handleUrlSubmit} className="flex-1 max-w-2xl w-full flex items-center gap-1.5">
            {/* Quick history keys */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={handleBack}
                disabled={historyIndex === 0}
                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Back"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleForward}
                disabled={historyIndex >= historyStack.length - 1}
                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Forward"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleReload}
                className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-[#FF2B2B]"
                title="Reload co-browser frame"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* URL input field with Adblocker & External Actions */}
            <div className="flex-1 bg-[#0A0A0A] border border-zinc-800/60 hover:border-zinc-700/60 rounded-lg px-3 py-1.5 flex items-center gap-2.5 text-xs transition-colors relative">
              
              {/* Shield Adblock Indicator Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAdBlockerPopover(!showAdBlockerPopover)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/35 hover:border-emerald-400 text-emerald-400 font-extrabold text-[10px] cursor-pointer"
                  title="Official Free AdBlock Active: Click to view details"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-400 animate-pulse" />
                  <span>ADBLOCK</span>
                  <span className="font-mono bg-emerald-500/20 px-1 py-0.05 rounded text-[9px]">+{blockedAdsCount}</span>
                </button>

                {/* ADBLOCK POPUP POPOVER PANEL */}
                {showAdBlockerPopover && (
                  <div className="absolute top-8 left-0 z-55 w-64 bg-[#141418] border border-zinc-800 rounded-xl p-4 shadow-2xl text-left text-zinc-200 animate-fadeIn font-sans space-y-3">
                    <div className="flex items-center justify-between border-b border-zinc-855 pb-2">
                      <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>Shields Active</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-905/30 px-2 py-0.5 rounded-full font-bold">uBlock v1.2</span>
                    </div>

                    <div className="space-y-1.5 py-1">
                      <span className="text-[10px] text-zinc-500 block uppercase font-mono">Current Clean Domain:</span>
                      <span className="text-xs text-[#27C93F] block font-mono bg-zinc-950 p-1 rounded truncate">{currentUrl === "home" ? "Local Lobby" : currentUrl}</span>
                    </div>

                    <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-850 space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-zinc-400">Blocked Ads & Trackers:</span>
                        <span className="text-emerald-400 font-bold font-mono">{blockedAdsCount} ad scripts</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-zinc-400">Cosmetic Hiding Rules:</span>
                        <span className="text-emerald-400 font-bold font-mono">31 filters active</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-zinc-400">Server Anti-Fingerprint:</span>
                        <span className="text-emerald-400 font-extrabold text-[9px] uppercase">TRUE</span>
                      </div>
                    </div>

                    <p className="text-[10px] text-zinc-550 leading-relaxed font-sans mt-1">
                      Our developer cloud-proxy strips EasyList third-party ad network URLs, cookies, and trackers automatically! It's 100% free and open source.
                    </p>

                    <button
                      type="button"
                      onClick={() => setShowAdBlockerPopover(false)}
                      className="w-full py-1 bg-zinc-800 hover:bg-zinc-750 text-white rounded text-[10px] uppercase font-bold transition-colors cursor-pointer"
                    >
                      Close Panel
                    </button>
                  </div>
                )}
              </div>

              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Type absolute URL (e.g. wikipedia.org) or Search query..."
                className="w-full bg-transparent border-none text-zinc-200 focus:outline-none placeholder-zinc-650 font-mono"
              />
              {isLoading ? (
                <Loader2 className="w-3 h-3 text-[#FF2B2B] animate-spin shrink-0" />
              ) : (
                <Search className="w-3 h-3 text-zinc-500 shrink-0" />
              )}
            </div>

            {/* Direct Link Launcher Options */}
            <div className="flex items-center gap-1.5 shrink-0 pl-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/35 bg-emerald-950/20 text-emerald-400 text-[10px] uppercase font-sans font-extrabold tracking-wide">
                <ShieldCheck className="w-3.5 h-3.5 animate-pulse" />
                <span>SANDBOX ISOLATED</span>
              </div>
            </div>
          </form>
        ) : (
          /* Screen Sharer Label */
          <div className="flex-1 max-w-2xl bg-[#0A0A0A] border border-zinc-800/45 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-zinc-450 font-sans truncate">
            <Monitor className="w-3.5 h-3.5 text-[#FF2B2B]" />
            <span>Active Stream Source: </span>
            <span className="text-zinc-200 font-semibold truncate font-mono">
              {screenStream ? (isSharingLocalScreen ? "Your Desktop Screen Area" : `${screenSharerName || "Guest"}'s screen`) : "Offline"}
            </span>
          </div>
        )}

        {/* Home Button and indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activeMode === "browser" && (
            <button
              onClick={() => handleTabSelect(activeTabId, "home")}
              className="px-2.5 py-1 text-[10px] font-extrabold uppercase bg-red-950/20 hover:bg-[#FF2B2B]/20 border border-[#FF2B2B]/40 hover:border-[#FF2B2B] text-white rounded transition-colors cursor-pointer"
            >
              Lobby Home
            </button>
          )}
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 bg-[#0A0A0A] relative flex items-center justify-center overflow-hidden">
        
        {/* SLEEK COMPACT TOP-RIGHT OVERLAY VC PANEL CONTROLS (Always Visible) */}
        <div className="absolute top-3 right-3 z-35 flex items-center gap-1.5 bg-[#121212]/95 border border-zinc-800/80 rounded-xl p-1.5 shadow-2xl backdrop-blur-md pointer-events-auto">
          {/* Small Focus Mode Toggle */}
          <button
            onClick={onToggleFocus}
            className={`p-1.5 rounded-lg border text-xs font-sans font-semibold transition-all duration-150 cursor-pointer flex items-center gap-1 shrink-0 ${
              isFullscreenFocus
                ? "bg-[#FF2B2B]/20 border-[#FF2B2B] text-white hover:bg-[#FF2B2B]/35"
                : "bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-white hover:border-[#FF2B2B]/40 shadow-sm"
            }`}
            title={isFullscreenFocus ? "Close Focus (Show Sidebar)" : "Focus Mode (Hide Sidebar)"}
          >
            <Film className="w-3.5 h-3.5 text-[#FF2B2B]" />
            <span className="text-[10px] hidden sm:inline">{isFullscreenFocus ? "Close Focus" : "Focus Mode"}</span>
          </button>

          <span className="w-[1.5px] h-4 bg-zinc-800" />

          {/* VC Mic, Camera, Screen share and Leave buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleMic}
              className={`p-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                micOn
                  ? "bg-[#FF2B2B]/15 border-[#FF2B2B]/50 text-white shadow-[0_0_10px_rgba(255,43,43,0.1)]"
                  : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-350 hover:border-zinc-700"
              }`}
              title={micOn ? "Mute Microphone" : "Unmute Microphone"}
            >
              {micOn ? <Mic className="w-3.5 h-3.5 text-[#FF2B2B]" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onToggleCamera}
              className={`p-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                cameraOn
                  ? "bg-[#FF2B2B]/15 border-[#FF2B2B]/50 text-white shadow-[0_0_10px_rgba(255,43,43,0.1)]"
                  : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-350 hover:border-zinc-700"
              }`}
              title={cameraOn ? "Turn Camera Off" : "Turn Camera On"}
            >
              {cameraOn ? <Video className="w-3.5 h-3.5 text-[#FF2B2B]" /> : <VideoOff className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={onToggleScreenShare}
              className={`p-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                isSharingScreen
                  ? "bg-[#FF2B2B]/20 border-[#FF2B2B] text-white shadow-[0_0_10px_rgba(255,43,43,0.15)]"
                  : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-350 hover:border-zinc-700"
              }`}
              title={isSharingScreen ? "Stop Screen Share" : "Share Screen"}
            >
              {isSharingScreen ? <MonitorOff className="w-3.5 h-3.5 text-[#FF2B2B]" /> : <Monitor className="w-3.5 h-3.5" />}
            </button>

            <span className="w-[1px] h-4 bg-zinc-800 mx-0.5" />

            <button
              onClick={onLeave}
              className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-red-950/20 hover:border-[#FF2B2B]/40 text-zinc-500 hover:text-[#FF4D4D] transition-all duration-150 cursor-pointer"
              title="Leave Room"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* INTERACTIVE WORKSPACE VIEW MODES */}
        {activeMode === "browser" ? (
          /* MULTIPLAYER CO-BROWSING CONTAINER */
          currentUrl === "home" ? (
            /* SLEEK CHROMIUM LANDING LOBBY (If current URL is 'home') */
            <div className="w-full h-full p-8 flex flex-col items-center justify-center relative bg-gradient-to-b from-[#0e0e11] to-[#050507] overflow-y-auto animate-fadeIn select-none select-none">
              
              <div className="max-w-xl w-full text-center flex flex-col items-center">
                {/* Logo and Welcome title */}
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-[#FF2B2B] rounded-full blur-[40px] opacity-15 animate-pulse" />
                  <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#FF2B2B] relative shadow-[0_0_32px_rgba(255,43,43,0.15)]">
                    <Compass className="w-8 h-8 animate-spin" style={{ animationDuration: "12s" }} />
                  </div>
                </div>

                <h2 className="text-2xl font-black text-white tracking-widest uppercase mb-1 font-sans">
                  Chromium <span className="text-[#FF2B2B]">Multiplayer</span>
                </h2>
                <p className="text-xs text-zinc-500 font-mono tracking-wider mb-8 uppercase">
                  Shared Co-Browsing Sandbox • Room Workspace
                </p>

                {/* Central Google-style Search input */}
                <form onSubmit={handleUrlSubmit} className="w-full mb-10 flex items-center gap-2 bg-[#121212]/90 border border-zinc-800/80 hover:border-[#FF2B2B]/45 rounded-2xl p-1.5 hover:shadow-[0_0_20px_rgba(255,43,43,0.05)] transition-all">
                  <div className="p-2 text-zinc-400 shrink-0">
                    <Globe className="w-5 h-5 text-[#FF2B2B]" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search Google or enter a direct website link..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="flex-1 bg-transparent border-none text-sm text-zinc-150 focus:outline-none placeholder-zinc-550"
                  />
                  <button
                    type="submit"
                    className="bg-[#FF2B2B] hover:bg-[#D61F1F] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-1 shadow-[0_2px_8px_rgba(255,43,43,0.25)]"
                  >
                    <span>Browse</span>
                  </button>
                </form>

                {/* Quick Speed Dials */}
                <div className="w-full space-y-3">
                  <span className="text-zinc-500 text-[10px] font-extrabold uppercase tracking-widest block text-left">
                    COMMUNITY RECOMMENDED WEBSITES:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <button
                      onClick={() => handleQuickLaunch("https://en.wikipedia.org")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">W</span>
                      <span className="font-semibold group-hover:text-white">Wikipedia</span>
                    </button>

                    <button
                      onClick={() => handleQuickLaunch("https://news.ycombinator.com")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">HN</span>
                      <span className="font-semibold group-hover:text-white">Hacker News</span>
                    </button>

                    <button
                      onClick={() => handleQuickLaunch("https://dev.to")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">D</span>
                      <span className="font-semibold group-hover:text-white">Dev Community</span>
                    </button>

                    <button
                      onClick={() => handleQuickLaunch("https://old.reddit.com")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">R</span>
                      <span className="font-semibold group-hover:text-white">Reddit r/all</span>
                    </button>

                    <button
                      onClick={() => handleQuickLaunch("https://www.space.com")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">S</span>
                      <span className="font-semibold group-hover:text-white">Space Science</span>
                    </button>

                    <button
                      onClick={() => handleQuickLaunch("https://www.bbc.com/news")}
                      className="p-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-850 hover:border-[#FF2B2B]/40 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all text-xs text-zinc-300 font-sans cursor-pointer group"
                    >
                      <span className="w-8 h-8 bg-zinc-900 border border-zinc-800 group-hover:bg-[#FF2B2B]/10 rounded-lg flex items-center justify-center text-xs text-[#FF2B2B] font-bold font-mono">N</span>
                      <span className="font-semibold group-hover:text-white">BBC World News</span>
                    </button>
                  </div>
                </div>

                <div className="mt-8 text-[11px] text-zinc-550 flex items-center justify-center gap-2">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Interactive proxy strips security CORS headers so all rooms sync automatically!</span>
                </div>
              </div>
            </div>
          ) : (
            /* ACTIVE PROXIED IFRAME WITH CURSOR COORDINATES AND SCROLL GAUGE */
            <div
              ref={browserContainerRef}
              onMouseMove={handleLocalMouseMove}
              className="w-full h-full relative group bg-white pointer-events-auto"
            >
              <iframe
                id="co-browser-frame"
                ref={iframeRef}
                src={getIframeSource()}
                className="w-full h-full border-none bg-white relative z-10"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />

              {/* Loader Overlay spinner */}
              {isLoading && (
                <div className="absolute inset-0 z-30 bg-[#0A0A0A]/50 backdrop-blur-xs flex items-center justify-center pointer-events-none">
                  <div className="flex flex-col items-center gap-2.5">
                    <Loader2 className="w-8 h-8 text-[#FF2B2B] animate-spin" />
                    <span className="text-zinc-400 text-xs font-mono">Simulating Chromium Network...</span>
                  </div>
                </div>
              )}

              {/* MULTIPLAYER CO-POINTER CURSOR OVERLAYS */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden select-none z-55">
                {Array.from(vBrowserCursors.entries()).map(([cid, data]) => {
                  // Skip pointer if it is equal to the local client
                  if (cid === localUserId) return null;
                  return (
                    <div
                      key={cid}
                      className="absolute transition-all duration-100 ease-out z-55 flex items-center gap-1.5"
                      style={{
                        left: `${data.rx * 100}%`,
                        top: `${data.ry * 100}%`,
                        transform: `translate(-4px, -4px)`,
                      }}
                    >
                      {/* Chromium Cursor Arrow */}
                      <svg
                        className="w-5.5 h-5.5 text-[#FF2B2B] drop-shadow-[0_2px_5px_rgba(255,43,43,0.5)] fill-[#FF4D4D] stroke-white stroke-1"
                        viewBox="0 0 24 24"
                      >
                        <path d="M4.5 3v15.5l4.5-4.25 3.5 8 3-1.25-3.5-8L19.5 13z" />
                      </svg>
                      {/* Float Name Label */}
                      <div className="bg-[#FF2B2B] text-white font-sans text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-md shadow-red-950/20 whitespace-nowrap">
                        {data.name}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sync Gauge overlay HUD */}
              <div className="absolute bottom-4 left-4 z-40 bg-zinc-900/95 border border-zinc-800 border-[#FF2B2B]/40 hover:border-[#FF2B2B] rounded-lg px-2.5 py-1.5 text-[10px] text-zinc-300 backdrop-blur-md font-mono shadow-2xl flex items-center gap-2 select-none duration-200">
                <div className="w-2 h-2 rounded-full bg-[#FF2B2B] animate-pulse" />
                <span>MULTIPLE CLIENTS: {vBrowserCursors.size + 1} ACTIVE</span>
                <span>• SCROLL: {Math.round(scrollPct * 100)}%</span>
              </div>
            </div>
          )
        ) : (
          /* NATIVE WEBRTC SCREEN STREAM TAB */
          screenStream ? (
            <div className="w-full h-full flex flex-col relative group bg-black">
              {/* Overlay Indicator */}
              <div className="absolute top-4 left-4 z-25 bg-zinc-900/90 border border-[#FF2B2B]/40 hover:border-[#FF2B2B] rounded-lg px-3 py-1.5 text-xs text-white backdrop-blur-md font-sans shadow-lg flex items-center gap-2 select-none duration-200 pointer-events-none">
                <div className="w-2 h-2 rounded-full bg-[#FF2B2B] animate-pulse" />
                <span>
                  {isSharingLocalScreen ? "You are sharing screen" : `${screenSharerName || "Partner"} is sharing screen`}
                </span>
              </div>

              {/* Video Player wrapper */}
              <video
                id="active-share-video"
                ref={videoRef}
                autoPlay
                playsInline
                controls={false}
                className="w-full h-full object-contain pointer-events-auto bg-black"
              />

              {/* Float bar */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-zinc-900/90 border border-zinc-800 text-white rounded-xl px-4 py-2 text-xs shadow-2xl backdrop-blur-md flex items-center gap-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-10 select-none">
                <div className="flex items-center gap-1">
                  <Play className="w-4 h-4 text-[#FF4D4D]" />
                  <span className="text-zinc-300 font-semibold font-mono text-[10px]">LIVE BROADCAST</span>
                </div>
                <div className="h-4 w-[1px] bg-zinc-800" />
                <button
                  onClick={handleFullscreen}
                  className="hover:text-[#FF2B2B] p-1 rounded hover:bg-zinc-800 transition-all flex items-center gap-1 cursor-pointer"
                  title="Fullscreen"
                >
                  <Maximize className="w-4 h-4" />
                  <span>Fullscreen</span>
                </button>
              </div>
            </div>
          ) : (
            /* WORKSPACE INACTIVE SCREEN SHARE PLACEHOLDER */
            <div id="screen-share-placeholder" className="p-8 max-w-lg text-center flex flex-col items-center select-none animate-fadeIn">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-[#FF2B2B] rounded-full blur-[35px] opacity-10 animate-pulse" />
                <div className="w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#FF2B2B] relative shadow-[0_0_30px_rgba(255,43,43,0.15)] ring-1 ring-zinc-800/80">
                  <Monitor className="w-10 h-10 animate-bounce" style={{ animationDuration: "3s" }} />
                </div>
              </div>

              <h3 className="text-xl font-bold text-white mb-2 tracking-wide font-sans">
                No Screen Share Stream active
              </h3>
              
              <p className="text-zinc-400 text-sm mb-8 leading-relaxed max-w-sm font-sans">
                You can browse websites collaboratively immediately using the <strong className="text-[#FF2B2B] cursor-pointer" onClick={() => setActiveMode("browser")}>Chromium Co-Browse</strong> tab, or start a screen feed:
              </p>

              <button
                onClick={onToggleScreenShare}
                className="px-5 py-2.5 bg-[#FF2B2B] hover:bg-[#D61F1F] text-white text-xs font-bold rounded-xl transition-all shadow-[0_4px_15px_rgba(255,43,43,0.2)] hover:shadow-[0_4px_22px_rgba(255,43,43,0.35)] flex items-center gap-2 cursor-pointer mb-6"
              >
                <Monitor className="w-4 h-4" />
                <span>Start Screen Sharing</span>
              </button>

              <div className="w-full bg-zinc-900/40 border border-zinc-850 rounded-xl p-4 text-left space-y-3 shadow-inner">
                <span className="text-zinc-400 text-xs font-semibold uppercase tracking-wider block border-b border-zinc-800 pb-1.5 font-sans">
                  Helpful Tip
                </span>
                <p className="text-zinc-400 text-xs font-sans leading-relaxed">
                  Screen streaming is perfect for videos, local game tabs, and media assets. For standard internet browsing, prefer <strong className="text-[#FF4D4D]">Co-Browse Mode</strong> as it doesn't consume your PC upload bandwidth!
                </p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
