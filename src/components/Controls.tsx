import React from "react";
import { Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, LogOut, MessageSquare } from "lucide-react";

interface ControlsProps {
  cameraOn: boolean;
  micOn: boolean;
  isSharingScreen: boolean;
  isFullscreenFocus: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  showChatToggle?: boolean;
  onToggleChatPanel?: () => void;
  chatPanelOpen?: boolean;
}

export default function Controls({
  cameraOn,
  micOn,
  isSharingScreen,
  isFullscreenFocus,
  onToggleCamera,
  onToggleMic,
  onToggleScreenShare,
  onLeave,
  showChatToggle = false,
  onToggleChatPanel,
  chatPanelOpen = true,
}: ControlsProps) {
  return (
    <div
      id="controls-section"
      className={`select-none font-sans flex items-center justify-center ${
        isFullscreenFocus
          ? "bg-zinc-950/90 border border-zinc-800/80 rounded-2xl px-6 py-3 shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-md"
          : "bg-[#141414] border border-zinc-800/80 rounded-2xl p-2.5 shadow-lg shrink-0"
      }`}
    >
      <div className={`flex items-center gap-2.5`}>
        {/* Toggle Mic */}
        <button
          id="btn-toggle-mic"
          type="button"
          onClick={onToggleMic}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer border ${
            micOn
              ? "bg-[#FF2B2B]/15 border-[#FF2B2B]/60 text-white shadow-[0_0_10px_rgba(255,43,43,0.12)] hover:bg-[#FF2B2B]/20"
              : "bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
          title={micOn ? "Mute Microphone" : "Unmute Microphone"}
        >
          {micOn ? <Mic className="w-4.5 h-4.5 text-[#FF2B2B]" /> : <MicOff className="w-4.5 h-4.5" />}
        </button>

        {/* Toggle Camera */}
        <button
          id="btn-toggle-cam"
          type="button"
          onClick={onToggleCamera}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer border ${
            cameraOn
              ? "bg-[#FF2B2B]/15 border-[#FF2B2B]/60 text-white shadow-[0_0_10px_rgba(255,43,43,0.12)] hover:bg-[#FF2B2B]/20"
              : "bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
          title={cameraOn ? "Turn Camera Off" : "Turn Camera On"}
        >
          {cameraOn ? <Video className="w-4.5 h-4.5 text-[#FF2B2B]" /> : <VideoOff className="w-4.5 h-4.5" />}
        </button>

        {/* Share Screen */}
        <button
          id="btn-toggle-screen"
          type="button"
          onClick={onToggleScreenShare}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer border ${
            isSharingScreen
              ? "bg-[#FF2B2B]/20 border-[#FF2B2B] text-white shadow-[0_0_15px_rgba(255,43,43,0.25)]"
              : "bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
          }`}
          title={isSharingScreen ? "Stop Screen Sharing" : "Share Browser/Window Screen"}
        >
          {isSharingScreen ? (
            <MonitorOff className="w-4.5 h-4.5 text-[#FF2B2B]" />
          ) : (
            <Monitor className="w-4.5 h-4.5" />
          )}
        </button>

        {/* Optional Chat Overlay Toggle inside Fullscreen Focus */}
        {showChatToggle && onToggleChatPanel && (
          <button
            id="btn-toggle-chat-overlay"
            type="button"
            onClick={onToggleChatPanel}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer border ${
              chatPanelOpen
                ? "bg-[#FF2B2B]/15 border-[#FF2B2B]/50 text-[#FF2B2B]"
                : "bg-zinc-950 hover:bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
            title={chatPanelOpen ? "Hide Overlay Chat" : "Show Overlay Chat"}
          >
            <MessageSquare className="w-4.5 h-4.5" />
          </button>
        )}

        <div className="h-5 w-[1px] bg-zinc-800/80 mx-0.5" />

        {/* Leave Room Button */}
        <button
          id="btn-leave-room"
          type="button"
          onClick={onLeave}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-950 border border-zinc-800 text-zinc-500 hover:text-[#FF4D4D] hover:border-[#FF2B2B]/50 hover:bg-red-950/20 shadow-sm hover:shadow-[0_0_12px_rgba(255,43,43,0.12)] transition-all duration-200 cursor-pointer"
          title="Exit Room"
        >
          <LogOut className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
}
