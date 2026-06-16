import React, { useState, useRef, useEffect } from "react";
import { Message } from "../types";
import { Send, MessageSquareDot, Lock } from "lucide-react";

interface ChatAreaProps {
  localUserId: string;
  messages: Message[];
  onSendMessage: (text: string) => void;
}

export default function ChatArea({ localUserId, messages, onSendMessage }: ChatAreaProps) {
  const [text, setText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Smooth auto-scroll to bottom of chat area when messages populate
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText("");
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div id="chat-section" className="bg-[#141414] border border-zinc-800/80 rounded-2xl flex flex-col h-full flex-1 min-h-0 shadow-lg select-none">
      {/* Chat Area Header Label */}
      <div className="flex items-center justify-between p-3.5 border-b border-zinc-800 font-sans">
        <div className="flex items-center gap-2">
          <MessageSquareDot className="w-4 h-4 text-[#FF2B2B]" />
          <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
            Room Discussion
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono tracking-wide">
          <Lock className="w-3 h-3 text-zinc-600" />
          <span>END-TO-END</span>
        </div>
      </div>

      {/* Message List Log with AutoScroll */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 select-text">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <span className="text-zinc-600 text-xs font-mono uppercase tracking-wider">
              No messages yet
            </span>
            <p className="text-zinc-500 text-[10.5px] mt-1 pr-2 max-w-xs font-sans">
              Type a secure message in the channel and sync coordinates with your buddy.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isLocal = m.senderId === localUserId;
            return (
              <div
                key={m.id}
                className={`flex flex-col max-w-[85%] ${isLocal ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                {/* Meta details */}
                <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono text-zinc-500">
                  <span className={isLocal ? "text-[#FF4D4D] font-bold" : "text-zinc-400 font-bold"}>
                    {m.senderName}
                  </span>
                  <span>•</span>
                  <span>{formatTime(m.timestamp)}</span>
                </div>

                {/* Msg text body */}
                <div
                  className={`rounded-xl px-3.5 py-2 text-xs leading-relaxed break-all shadow ${
                    isLocal
                      ? "bg-[#FF2B2B] text-white rounded-tr-none shadow-[0_2px_10px_rgba(255,43,43,0.15)] font-sans"
                      : "bg-[#0E0E0E] text-zinc-200 rounded-tl-none border border-zinc-800/80 font-sans"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Chat Sender Form and Input bind */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-zinc-805 bg-[#101010] rounded-b-2xl">
        <div className="flex gap-2">
          <input
            id="chat-input-field"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            maxLength={300}
            className="flex-1 bg-zinc-950/80 border border-zinc-850 hover:border-zinc-800 focus:border-[#FF2B2B]/50 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none transition-all duration-200 placeholder:text-zinc-600 selection:bg-[#FF2B2B] text-pretty"
          />
          <button
            id="btn-send-message"
            type="submit"
            className="bg-[#FF2B2B] hover:bg-[#FF4D4D] active:translate-y-0.5 text-white rounded-xl p-2.5 flex items-center justify-center transition-all duration-200 outline-none select-none shrink-0 cursor-pointer shadow-[0_2px_10px_rgba(255,43,43,0.2)]"
            title="Send chat message"
            disabled={!text.trim()}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
