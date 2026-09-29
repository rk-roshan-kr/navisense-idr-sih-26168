import { create } from 'zustand';
import { MovementMode, SessionInfo, SessionRole } from '../types';
import { SessionBridge } from '../native/SessionBridge';

interface SessionStoreState {
  activeSessionId: string | null;
  role: SessionRole;
  movementMode: MovementMode;
  participant: string;
  isRecording: boolean;
  sessions: SessionInfo[];
  isLoading: boolean;

  setRole: (role: SessionRole) => void;
  setMovementMode: (mode: MovementMode) => void;
  setParticipant: (name: string) => void;
  setActiveSessionId: (id: string | null) => void;
  setIsRecording: (recording: boolean) => void;
  loadSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  activeSessionId: null,
  role: 'COLLECT',
  movementMode: 'Walking',
  participant: 'Participant_1',
  isRecording: false,
  sessions: [],
  isLoading: false,

  setRole: (role) => set({ role }),
  setMovementMode: (movementMode) => set({ movementMode }),
  setParticipant: (participant) => set({ participant }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setIsRecording: (isRecording) => set({ isRecording }),

  loadSessions: async () => {
    set({ isLoading: true });
    try {
      const list = await SessionBridge.listSessions();
      set({ sessions: list, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  deleteSession: async (sessionId: string) => {
    await SessionBridge.deleteSession(sessionId);
    await get().loadSessions();
  },
}));
