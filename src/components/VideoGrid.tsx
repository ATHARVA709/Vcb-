import React, { useRef, useEffect } from "react";
import { Participant } from "../types";
import { Mic, MicOff, Video, VideoOff, User, Radio } from "lucide-react";

interface VideoGridProps {
  localUserId: string;
  localName: string;
  localStream: MediaStream | null;
  localCameraOn: boolean;
  localMicOn: boolean;
  participants: Participant[];
  remoteStreams: Map<string, MediaStream>;
}

interface VideoCardProps {
  stream: MediaStream | null;
  name: string;
  cameraOn: boolean;
  micOn: boolean;
  isLocal: boolean;
  isSpeaking?: boolean;
  key?: string;
}

const VideoTile = ({ stream, name, cameraOn, micOn, isLocal, isSpeaking }: VideoCardProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream && cameraOn) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, cameraOn]);

  // Extract initials if camera is off
  const handleGetInitials = (userName: string) => {
    const parts = userName.trim().split(/[-_\s]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return userName.substring(0, 2).toUpperCase();
  };

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-zinc-950/80 border transition-all duration-300 flex items-center justify-center group ${
        cameraOn && isSpeaking
          ? "border-[#FF2B2B] shadow-[0_0_15px_rgba(255,43,43,0.25)]"
          : isSpeaking
          ? "border-[#FF4D4D] shadow-[0_0_20px_rgba(255,77,77,0.15)]"
          : "border-zinc-800/80 hover:border-zinc-700/80"
      } aspect-video min-h-[140px] w-full`}
    >
      {cameraOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal} // Force local video mute to absolutely prevent feedback howling
          className={`w-full h-full object-cover select-none pointer-events-none ${isLocal ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        /* CAMERA OFF EMBLEM */
        <div className="flex flex-col items-center justify-center select-none p-4">
          <div
            className={`w-14 h-14 rounded-full bg-zinc-900 border flex items-center justify-center text-lg font-bold tracking-widest text-[#FF4D4D] mb-2 transition-all duration-300 relative ${
              isSpeaking
                ? "border-[#FF2B2B] bg-[#FF2B2B]/5 shadow-[0_0_20px_rgba(255,43,43,0.3)] animate-pulse"
                : "border-zinc-800"
            }`}
          >
            {handleGetInitials(name)}
            {isSpeaking && (
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF2B2B] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF2B2B]"></span>
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase">CAMERA OFF</span>
        </div>
      )}

      {/* Floating Indicators */}
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none select-none bg-black/60 backdrop-blur-md border border-zinc-800/50 rounded-lg px-2.5 py-1 z-10">
        <div className="flex items-center gap-1.5 min-w-0">
          {isLocal && (
            <span className="bg-[#FF2B2B] text-white text-[9px] font-bold px-1 rounded uppercase shrink-0 font-mono">
              YOU
            </span>
          )}
          <span className="text-white text-xs font-medium truncate font-sans tracking-wide">
            {name}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isSpeaking && (
            <div className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-[#FF2B2B]/10 border border-[#FF2B2B]/20 text-[#FF4D4D] text-[9.5px] font-bold font-mono tracking-wider transition-all">
              <Radio className="w-3 h-3 animate-spin" style={{ animationDuration: '4s' }} />
              <span>TALK</span>
            </div>
          )}
          <div className="p-1 rounded-md bg-zinc-900/60 text-zinc-300 flex items-center justify-center">
            {micOn ? <Mic className="w-3.5 h-3.5 text-[#FF2B2B]" /> : <MicOff className="w-3.5 h-3.5 text-zinc-500" />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function VideoGrid({
  localUserId,
  localName,
  localStream,
  localCameraOn,
  localMicOn,
  participants,
  remoteStreams,
}: VideoGridProps) {
  const totalPeers = participants.length + 1;
  
  // Arrange grid dynamically:
  // - 2 users -> Two large stacked list tiles
  // - 3-4 users -> Rectangular 2-column grid
  const gridLayoutClass = totalPeers <= 2
    ? "flex flex-col gap-3"
    : "grid grid-cols-2 gap-3";

  return (
    <div id="videos-field" className="bg-[#141414] border border-zinc-800/80 rounded-2xl p-4 shadow-lg flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-3 border-b border-zinc-800 pb-2 select-none font-sans">
        <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">
          PEERS IN SESSION ({totalPeers})
        </span>
        <span className="text-[10px] text-zinc-500 font-mono">P2P MESH</span>
      </div>

      <div className={`overflow-y-auto pr-1 flex-1 gap-2 ${gridLayoutClass}`}>
        {/* Render Local Video tile */}
        <VideoTile
          stream={localStream}
          name={localName}
          cameraOn={localCameraOn}
          micOn={localMicOn}
          isLocal={true}
          isSpeaking={localMicOn && localCameraOn} // simple status toggle placeholder
        />

        {/* Render Remote Video tiles */}
        {participants.map((p) => {
          const stream = remoteStreams.get(p.id) || null;
          return (
            <VideoTile
              key={p.id}
              stream={stream}
              name={p.name}
              cameraOn={p.cameraOn}
              micOn={p.micOn}
              isLocal={false}
              isSpeaking={p.micOn && p.cameraOn}
            />
          );
        })}
      </div>
    </div>
  );
}
