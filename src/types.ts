export interface Participant {
  id: string;
  name: string;
  cameraOn: boolean;
  micOn: boolean;
  screenSharing: boolean;
  camStreamId: string | null;
  screenStreamId: string | null;
}

export interface BrowserState {
  currentUrl: string;
  scrollPct: number;
  lastChangedBy: string | null;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface RoomState {
  id: string;
  users: Participant[];
  messages: Message[];
  screenSharerId: string | null;
  browserState?: BrowserState;
}

export type WebRTCSignalPacket = {
  type: "offer" | "answer" | "candidate";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
