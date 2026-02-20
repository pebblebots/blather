import { useState, useEffect, useRef, useCallback } from 'react';

const NICK_COLORS = [
  "#c41e3a", "#0057b7", "#16a34a", "#9333ea", "#d97706", "#0891b2",
  "#c026d3", "#854d0e", "#4338ca", "#dc2626", "#059669", "#db2777", "#1d4ed8",
];

function getNickColor(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(-8);
  const num = parseInt(hex, 16) >>> 0;
  return NICK_COLORS[num % NICK_COLORS.length];
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface HuddleParticipant {
  id: string;
  userId: string;
  role: string;
  user?: { id: string; displayName: string; isAgent: boolean };
}

interface TranscriptEntry {
  id: string;
  userId: string;
  content: string;
  timestamp: string;
  audioUrl?: string;
}

interface HuddleModalProps {
  huddleId: string;
  topic: string;
  createdBy: string;
  currentUserId?: string;
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  onClose: () => void;
  onEnded: () => void;
  huddleEvents: any[];
}

export function HuddleModal({ huddleId, topic, createdBy, currentUserId, usersMap, onClose, onEnded, huddleEvents }: HuddleModalProps) {
  const BASE = (import.meta as any).env?.VITE_API_URL || '';
  const token = localStorage.getItem('blather_token');
  const [participants, setParticipants] = useState<HuddleParticipant[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [speakingUserId, setSpeakingUserId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const processedEvents = useRef(new Set<string>());

  // Fetch huddle details on mount
  useEffect(() => {
    fetch(`${BASE}/huddles/${huddleId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.participants) setParticipants(data.participants);
        if (data.createdAt) startTime.current = new Date(data.createdAt).getTime();
      })
      .catch(() => {});

    // Join as listener
    fetch(`${BASE}/huddles/${huddleId}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }).catch(() => {});
  }, [huddleId]);

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Process huddle events — only new ones
  const lastProcessedIndex = useRef(0);
  useEffect(() => {
    const newEvents = huddleEvents.slice(lastProcessedIndex.current);
    lastProcessedIndex.current = huddleEvents.length;
    for (const event of newEvents) {
      if (event.huddleId !== huddleId) continue;

      if (event.type === 'huddle.audio') {
        setTranscript(prev => {
          if (prev.some(t => t.id === event.messageId)) return prev;
          return [...prev, {
            id: event.messageId,
            userId: event.userId,
            content: event.content,
            timestamp: new Date().toISOString(),
            audioUrl: event.audioUrl,
          }];
        });
        if (event.audioUrl && !muted && !processedEvents.current.has(event.messageId)) {
          processedEvents.current.add(event.messageId);
          console.log('[Huddle] Audio event received:', event.audioUrl);
          audioQueue.current.push(event.audioUrl);
          playNext();
        }
      }
      if (event.type === 'huddle.speaking') {
        setSpeakingUserId(event.userId);
      }
      if (event.type === 'huddle.joined') {
        // Refetch participants
        fetch(`${BASE}/huddles/${huddleId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(data => { if (data.participants) setParticipants(data.participants); })
          .catch(() => {});
      }
      if (event.type === 'huddle.ended') {
        // Kill audio immediately
        if (currentAudio.current) {
          currentAudio.current.pause();
          currentAudio.current.src = '';
          currentAudio.current = null;
        }
        audioQueue.current = [];
        isPlaying.current = false;
        onEnded();
      }
    }
  }, [huddleEvents]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Unlock audio on first user interaction
  const audioUnlocked = useRef(false);
  const unlockAudio = useCallback(() => {
    if (audioUnlocked.current) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ctx.resume().then(() => { audioUnlocked.current = true; ctx.close(); });
    // Also play a silent buffer
    const silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    silent.play().catch(() => {});
  }, []);

  useEffect(() => {
    const el = document.addEventListener('click', unlockAudio, { once: true });
    return () => document.removeEventListener('click', unlockAudio);
  }, [unlockAudio]);

  const playNext = useCallback(() => {
    if (isPlaying.current || audioQueue.current.length === 0) return;
    isPlaying.current = true;
    const url = audioQueue.current.shift()!;
    const fullUrl = url.startsWith('http') ? url : `https://blather.pbd.bot/api${url}`;
    const audio = new Audio(fullUrl);
    currentAudio.current = audio;
    audio.onended = () => {
      isPlaying.current = false;
      currentAudio.current = null;
      setSpeakingUserId(null);
      playNext();
    };
    audio.onerror = (e) => {
      console.error('[Huddle] Audio error:', url, e);
      isPlaying.current = false;
      currentAudio.current = null;
      playNext();
    };
    audio.play().catch((err) => {
      console.warn('[Huddle] Audio play blocked:', err.message, '- will retry on next interaction');
      isPlaying.current = false;
      // Don't skip - push back to front of queue for retry
      audioQueue.current.unshift(url);
    });
  }, []);

  const handleSpeak = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${BASE}/huddles/${huddleId}/speak`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.trim() }),
      });
      setInput('');
    } catch {}
    setSending(false);
  };

  const handleEnd = async () => {
    if (!confirm('End this huddle for everyone?')) return;
    try {
      await fetch(`${BASE}/huddles/${huddleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      onEnded();
    } catch {}
  };

  const toggleMute = () => {
    setMuted(m => {
      if (!m && currentAudio.current) {
        currentAudio.current.pause();
        currentAudio.current = null;
        isPlaying.current = false;
        audioQueue.current = [];
      }
      return !m;
    });
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const getUserName = (userId: string) => {
    const u = usersMap.get(userId);
    return u?.displayName || 'Unknown';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(221,221,221,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div className="mac-window" style={{ width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={onClose} />
          <div style={{ flex: 1, textAlign: 'center' }}>🎙️ Huddle: "{topic}"</div>
          <span style={{ fontSize: 11, fontWeight: 'normal', fontFamily: 'Monaco, IBM Plex Mono, monospace' }}>⏱️ {mm}:{ss} / 30:00</span>
        </div>

        {/* Agent avatars */}
        <div style={{ display: 'flex', gap: 12, padding: '12px 16px', justifyContent: 'center', borderBottom: '1px solid #CCCCCC', background: '#F5F5F0' }}>
          {participants.filter(p => {
            const u = usersMap.get(p.userId);
            return u?.isAgent;
          }).map(p => {
            const isSpeaking = speakingUserId === p.userId;
            const color = getNickColor(p.userId);
            return (
              <div key={p.id} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#FFFFFF', fontWeight: 'bold', fontSize: 14,
                  border: isSpeaking ? '3px solid #00CC00' : '2px solid #999999',
                  boxShadow: isSpeaking ? '0 0 8px rgba(0,204,0,0.6)' : 'none',
                  animation: isSpeaking ? 'pulse 1s infinite' : 'none',
                }}>
                  {getUserName(p.userId).charAt(0).toUpperCase()}
                </div>
                <div style={{ fontSize: 10, marginTop: 2, fontFamily: 'Monaco, IBM Plex Mono, monospace', color: color, fontWeight: 'bold' }}>
                  {getUserName(p.userId)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Transcript */}
        <div ref={transcriptRef} className="mac-inset" style={{ flex: 1, overflow: 'auto', margin: 8, padding: 8, minHeight: 200, maxHeight: 300, fontFamily: 'Monaco, IBM Plex Mono, monospace', fontSize: 11 }}>
          {transcript.length === 0 && (
            <div style={{ color: '#999999', textAlign: 'center', padding: 20 }}>Waiting for agents to speak...</div>
          )}
          {transcript.map(entry => (
            <div key={entry.id} style={{ marginBottom: 4 }}>
              <span style={{ color: '#999999' }}>{formatTime(entry.timestamp)}</span>{' '}
              <span style={{ color: getNickColor(entry.userId), fontWeight: 'bold' }}>{getUserName(entry.userId)}</span>{' '}
              <span>{entry.content}</span>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #CCCCCC', display: 'flex', gap: 6, alignItems: 'center' }}>
          <form onSubmit={handleSpeak} style={{ flex: 1, display: 'flex', gap: 6 }}>
            <input
              className="mac-input"
              style={{ flex: 1, fontFamily: 'Monaco, IBM Plex Mono, monospace', fontSize: 11 }}
              placeholder="Say something..."
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="mac-btn" disabled={sending || !input.trim()} style={{ minWidth: 50, fontSize: 11 }}>
              {sending ? '⏳' : 'Send'}
            </button>
          </form>
          <button className="mac-btn" onClick={toggleMute} style={{ minWidth: 0, padding: '4px 8px', fontSize: 13 }} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
          {currentUserId === createdBy && (
            <button className="mac-btn" onClick={handleEnd} style={{ minWidth: 0, padding: '4px 8px', fontSize: 11, color: '#CC0000' }}>
              End
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
