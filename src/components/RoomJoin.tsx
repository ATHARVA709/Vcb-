import React, { useState, useEffect } from "react";
import { Tv, Sparkles, LogIn, ArrowRight } from "lucide-react";

interface RoomJoinProps {
  onJoin: (roomId: string, name: string) => void;
  initialRoomId: string;
}

const GUEST_NAMES = [
  "PixelVibe", "V-Specter", "RedPhoenix", "CrimsonWatcher", 
  "NeonPilot", "DeltaViewer", "ApexStreamer", "ShadowGrid",
  "CyberGaze", "HyperSpark", "V-Quantum", "RedPulse"
];

const generateRandomNickname = () => {
  const randomName = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)];
  const randomId = Math.floor(1000 + Math.random() * 9000);
  return `${randomName}-${randomId}`;
};

export default function RoomJoin({ onJoin, initialRoomId }: RoomJoinProps) {
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [errorChat, setErrorChat] = useState("");

  useEffect(() => {
    if (initialRoomId) {
      setRoomId(initialRoomId);
    }
    setName(generateRandomNickname());
  }, [initialRoomId]);

  const handleCreateRoom = () => {
    // Generate a secure random alphanumeric room id
    const newRoomId = Math.random().toString(36).substring(2, 10).toLowerCase();
    if (!name.trim()) {
      setErrorChat("Please set a valid display name.");
      return;
    }
    onJoin(newRoomId, name.trim());
  };

  const handleJoinExisting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) {
      setErrorChat("Please enter a valid Room ID.");
      return;
    }
    if (!name.trim()) {
      setErrorChat("Please enter a username.");
      return;
    }
    onJoin(roomId.trim().toLowerCase(), name.trim());
  };

  return (
    <div id="room-join-panel" className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center p-4 selection:bg-[#FF2B2B] selection:text-white">
      {/* Background soft red grid overlay glow */}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,43,43,0.01)_1px,transparent_1px),linear-gradient(to_right,rgba(255,43,43,0.01)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-radial from-[rgba(255,43,43,0.04)] to-transparent blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-[#141414]/90 backdrop-blur-md rounded-2xl border border-zinc-800/80 p-8 shadow-[0_0_50px_rgba(255,43,43,0.05)] relative overflow-hidden">
        {/* Top visual red strip */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#FF2B2B]" />

        {/* Brand identity */}
        <div className="flex flex-col items-center mb-8 relative">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[#FF2B2B] shadow-[0_0_20px_rgba(255,43,43,0.15)] mb-4">
            <Tv className="w-9 h-9" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-widest font-sans flex items-center gap-1.5">
            V<span className="text-[#FF2B2B] font-mono font-medium text-2xl">-</span>BROWSER
          </h1>
          <p className="text-zinc-500 text-xs mt-1 text-center max-w-xs font-sans">
            Private 2-person watchparty with synchronous low-latency WebRTC streams
          </p>
        </div>

        {errorChat && (
          <div className="mb-4 p-3 bg-red-950/40 border border-[#FF2B2B]/40 rounded-lg text-[#FF4D4D] text-xs text-center font-sans">
            {errorChat}
          </div>
        )}

        <form onSubmit={handleJoinExisting} className="space-y-6">
          {/* Custom Nickname Setup */}
          <div>
            <label className="block text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2 font-sans">
              Choose Display Name
            </label>
            <div className="relative">
              <input
                id="join-username-field"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                required
                className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-[#FF2B2B]/60 rounded-xl px-4 py-3 text-white text-sm focus:outline-none transition-all duration-200"
                placeholder="Enter nickname..."
              />
              <button
                type="button"
                onClick={() => setName(generateRandomNickname())}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-[#FF4D4D] transition-colors"
                title="Random nickname"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="h-[1px] bg-zinc-800/50 my-6" />

          {/* Create Room Choice */}
          <div className="space-y-4">
            <button
              type="button"
              id="btn-create-room"
              onClick={handleCreateRoom}
              className="w-full bg-[#FF2B2B] hover:bg-[#FF4D4D] active:translate-y-0.5 text-white py-3 px-4 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 shadow-[0_4px_20px_rgba(255,43,43,0.2)] flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Create A New Room
            </button>

            <div className="flex items-center gap-3 text-zinc-600 text-xs my-3 font-mono">
              <div className="h-[1px] bg-zinc-800 flex-1" />
              <span>OR JOIN EXISTING</span>
              <div className="h-[1px] bg-zinc-800 flex-1" />
            </div>

            {/* Join Room Choice */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="join-room-id-field"
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toLowerCase())}
                  placeholder="Paste Room ID..."
                  className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-[#FF2B2B]/40 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF2B2B]/20 transition-all duration-200 uppercase tracking-widest font-mono"
                />
              </div>
              <button
                type="submit"
                id="btn-submit-join"
                className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-[#FF2B2B]/40 text-white rounded-xl px-5 flex items-center justify-center transition-all duration-200"
              >
                <LogIn className="w-5 h-5 text-zinc-400 hover:text-[#FF2B2B] transition-colors" />
              </button>
            </div>
          </div>
        </form>

        <div className="mt-8 text-center">
          <p className="text-zinc-600 text-[10px] font-mono uppercase tracking-wider">
            Optimized for 2 Users • P2P High-Fidelity
          </p>
        </div>
      </div>
    </div>
  );
}
