import React, { useRef, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Mic, MicOff, VideoOff, Maximize, Minimize, Move, Radio } from "lucide-react";

interface FloatingVideoBubbleProps {
  id: string;
  name: string;
  stream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  isLocal: boolean;
  isSpeaking: boolean;
  dragConstraintsRef: React.RefObject<HTMLDivElement | null>;
  initialPosition: { x: number; y: number };
  key?: string;
}

export default function FloatingVideoBubble({
  id,
  name,
  stream,
  cameraOn,
  micOn,
  isLocal,
  isSpeaking,
  dragConstraintsRef,
  initialPosition,
}: FloatingVideoBubbleProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Support three beautiful bubble sizes: Small (76px), Medium (120px), Large (160px)
  const [bubbleScale, setBubbleScale] = useState<"sm" | "md" | "lg">("md");
  const [isHovered, setIsHovered] = useState(false);

  // Position state with pointer-events tracking
  const [position, setPosition] = useState(initialPosition);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  // Coordinate adjustments on initial position change or window resizing
  useEffect(() => {
    if (!dragStartRef.current) {
      let x = initialPosition.x;
      let y = initialPosition.y;
      if (typeof window !== "undefined") {
        if (x > window.innerWidth - 100) x = window.innerWidth - 130;
        if (y > window.innerHeight - 100) y = window.innerHeight - 130;
      }
      setPosition({ x, y });
    }
  }, [initialPosition]);

  // Touch event handlers specifically optimized for Android, iOS, and Tablets
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    const touch = e.touches[0];
    dragStartRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    // CRITICAL: prevents native page pan and viewport zoom cancellations on Android/Chrome!
    if (e.cancelable) {
      e.preventDefault();
    }
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.startX;
    const dy = touch.clientY - dragStartRef.current.startY;

    let newX = dragStartRef.current.posX + dx;
    let newY = dragStartRef.current.posY + dy;

    if (typeof window !== "undefined") {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (newX < 10) newX = 10;
      if (newX > width - 90) newX = width - 90;
      if (newY < 10) newY = 10;
      if (newY > height - 90) newY = height - 90;
    }

    setPosition({ x: newX, y: newY });
  };

  const handleTouchEnd = () => {
    dragStartRef.current = null;
  };

  // High-precision Mouse event handlers for Laptop, Desktop, and Tablet pointer mice
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    
    // Bind listeners globally so rapid drag-actions never drift or lose tracking
    document.addEventListener("mousemove", handleGlobalMouseMove);
    document.addEventListener("mouseup", handleGlobalMouseUp);
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    let newX = dragStartRef.current.posX + dx;
    let newY = dragStartRef.current.posY + dy;

    if (typeof window !== "undefined") {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (newX < 10) newX = 10;
      if (newX > width - 90) newX = width - 90;
      if (newY < 10) newY = 10;
      if (newY > height - 90) newY = height - 90;
    }

    setPosition({ x: newX, y: newY });
  };

  const handleGlobalMouseUp = () => {
    dragStartRef.current = null;
    document.removeEventListener("mousemove", handleGlobalMouseMove);
    document.removeEventListener("mouseup", handleGlobalMouseUp);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, []);

  // Sync stream to video element
  useEffect(() => {
    if (videoRef.current && stream && cameraOn) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, cameraOn]);

  const handleCycleSize = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBubbleScale((prev) => {
      if (prev === "sm") return "md";
      if (prev === "md") return "lg";
      return "sm";
    });
  };

  const getBubbleDimensions = () => {
    switch (bubbleScale) {
      case "sm":
        return "w-16 h-16 sm:w-20 sm:h-20";
      case "lg":
        return "w-28 h-28 sm:w-36 sm:h-36";
      case "md":
      default:
        return "w-20 h-20 sm:w-28 sm:h-28";
    }
  };

  // Convert name to high-contrast initials
  const getInitials = (userName: string) => {
    const parts = userName.trim().split(/[-_\s]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return userName.substring(0, 2).toUpperCase();
  };

  const activeGlowClass = isSpeaking
    ? "ring-4 ring-[#FF2B2B] shadow-[0_0_25px_rgba(255,43,43,0.7)]"
    : "ring-2 ring-zinc-800/80 hover:ring-[#FF2B2B]/40";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      className={`absolute z-40 pointer-events-auto touch-none group select-none flex flex-col items-center justify-center cursor-move`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {/* Bubble Shell */}
      <div
        className={`relative rounded-full overflow-hidden bg-zinc-950 flex items-center justify-center transition-all duration-300 ${getBubbleDimensions()} ${activeGlowClass}`}
      >
        {cameraOn && stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className={`w-full h-full object-cover rounded-full pointer-events-none ${
              isLocal ? "scale-x-[-1]" : ""
            }`}
          />
        ) : (
          /* Camera Off Placeholder with nice initials & gradient */
          <div className="w-full h-full rounded-full bg-gradient-to-br from-zinc-900 to-zinc-950 flex flex-col items-center justify-center transition-colors">
            <span className="text-zinc-300 font-extrabold text-sm sm:text-lg tracking-wider">
              {getInitials(name)}
            </span>
            <VideoOff className="w-3.5 h-3.5 mt-0.5 text-zinc-650" />
          </div>
        )}

        {/* Outer Glow Overlay */}
        <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none" />

        {/* Small muted icon overlay to show silent/speaking state inside bubble */}
        {!micOn && (
          <div className="absolute bottom-1 right-1 bg-zinc-900/90 border border-zinc-805 rounded-full p-1 text-zinc-400 shadow">
            <MicOff className="w-2.5 h-2.5 text-red-500" />
          </div>
        )}

        {/* Hover UI Overlays (For size controllers & meta details) */}
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-[1px] flex flex-col items-center justify-center transition-all duration-250 ${
            isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Quick tool buttons */}
          <div className="flex items-center gap-1.5 z-10">
            {/* Cycle bubble size */}
            <button
              onClick={handleCycleSize}
              className="p-1.5 rounded-full bg-zinc-900/90 hover:bg-[#FF2B2B] text-white border border-zinc-800 transition-all hover:scale-110 cursor-pointer"
              title="Change bubble size"
            >
              <Maximize className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="absolute bottom-1.5 left-0 right-0 text-center px-1">
            <span className="text-[9px] text-zinc-300 truncate max-w-full block font-mono font-medium tracking-wide">
              {name}
            </span>
          </div>

          {/* Drag Indicator */}
          <div className="absolute top-1.5 text-zinc-400 font-bold flex items-center justify-center">
            <Move className="w-3 h-3 text-zinc-400 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Floating active mic volume pulse helper */}
      {isSpeaking && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF2B2B] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-[#FF2B2B] flex items-center justify-center text-white text-[7px]">
            <Radio className="w-2.5 h-2.5 text-white" />
          </span>
        </span>
      )}
    </motion.div>
  );
}
