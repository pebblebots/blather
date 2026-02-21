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
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ended, setEnded] = useState(false);
  const startTime = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioQueue = useRef<{ url: string; messageId: string }[]>([]);
  const isPlaying = useRef(false);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const processedEvents = useRef(new Set<string>());

  // Kill all audio helper
  const killAudio = useCallback(() => {
    if (currentAudio.current) {
      currentAudio.current.pause();
      currentAudio.current.src = '';
      currentAudio.current.onended = null;
      currentAudio.current.onerror = null;
      currentAudio.current = null;
    }
    audioQueue.current = [];
    isPlaying.current = false;
    setSpeakingUserId(null);
    setCurrentPlayingId(null);
  }, []);

  // Fetch huddle details + message history on mount
  useEffect(() => {
    fetch(`${BASE}/huddles/${huddleId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.participants) setParticipants(data.participants);
        if (data.startedAt) startTime.current = new Date(data.startedAt).getTime();
        if (data.status === 'ended') setEnded(true);
        // Fetch message history for the huddle channel
        if (data.channel?.id) {
          fetch(`${BASE}/channels/${data.channel.id}/messages?limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(r => r.json())
            .then((messages: any[]) => {
              if (!Array.isArray(messages)) return;
              // Messages come newest-first, reverse for chronological
              const sorted = [...messages].reverse();
              setTranscript(prev => {
                const existingIds = new Set(prev.map(t => t.id));
                const newEntries = sorted
                  .filter(m => !existingIds.has(m.id))
                  .map(m => ({
                    id: m.id,
                    userId: m.userId,
                    content: m.content,
                    timestamp: m.createdAt,
                    audioUrl: undefined,
                  }));
                // Merge: history first, then any live entries
                return [...newEntries, ...prev.filter(t => !newEntries.some(n => n.id === t.id))];
              });
              // Mark all history messages as processed so we don't try to play old audio
              sorted.forEach(m => processedEvents.current.add(m.id));
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    // Join as listener
    fetch(`${BASE}/huddles/${huddleId}/join`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }).catch(() => {});

    // Cleanup on unmount — kill audio
    return () => {
      if (currentAudio.current) {
        currentAudio.current.pause();
        currentAudio.current.src = '';
        currentAudio.current.onended = null;
        currentAudio.current.onerror = null;
        currentAudio.current = null;
      }
      audioQueue.current = [];
      isPlaying.current = false;
    };
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
    if (ended) return;
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
          audioQueue.current.push({ url: event.audioUrl, messageId: event.messageId });
          playNext();
        }
      }
      if (event.type === 'huddle.joined') {
        fetch(`${BASE}/huddles/${huddleId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(data => { if (data.participants) setParticipants(data.participants); })
          .catch(() => {});
      }
      if (event.type === 'huddle.ended') {
        killAudio();
        setEnded(true);
        onEnded();
      }
    }
  }, [huddleEvents, ended]);

  // Auto-scroll to currently playing message (teleprompter)
  useEffect(() => {
    if (currentPlayingId) {
      const el = document.getElementById(`transcript-${currentPlayingId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (transcriptRef.current) {
      // When not playing, scroll to bottom for latest
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [currentPlayingId, transcript]);

  // Unlock audio on first user interaction
  const audioUnlocked = useRef(false);
  const unlockAudio = useCallback(() => {
    if (audioUnlocked.current) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    ctx.resume().then(() => { audioUnlocked.current = true; ctx.close(); });
    const silent = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
    silent.play().catch(() => {});
  }, []);

  useEffect(() => {
    document.addEventListener('click', unlockAudio, { once: true });
    return () => document.removeEventListener('click', unlockAudio);
  }, [unlockAudio]);

  const playNext = useCallback(() => {
    if (isPlaying.current || audioQueue.current.length === 0) return;
    isPlaying.current = true;
    const { url, messageId } = audioQueue.current.shift()!;
    const fullUrl = url.startsWith('http') ? url : `https://blather.pbd.bot/api${url}`;
    setCurrentPlayingId(messageId);

    // Find the userId for this message to set speakingUserId
    setTranscript(prev => {
      const entry = prev.find(t => t.id === messageId);
      if (entry) setSpeakingUserId(entry.userId);
      return prev;
    });

    const audio = new Audio(fullUrl);
    currentAudio.current = audio;
    audio.onended = () => {
      isPlaying.current = false;
      currentAudio.current = null;
      setSpeakingUserId(null);
      setCurrentPlayingId(null);
      playNext();
    };
    audio.onerror = (e) => {
      console.error('[Huddle] Audio error:', url, e);
      isPlaying.current = false;
      currentAudio.current = null;
      setCurrentPlayingId(null);
      playNext();
    };
    audio.play().catch((err) => {
      console.warn('[Huddle] Audio play blocked:', err.message);
      isPlaying.current = false;
      audioQueue.current.unshift({ url, messageId });
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
    killAudio();
    try {
      await fetch(`${BASE}/huddles/${huddleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
    setEnded(true);
    onEnded();
  };

  // Close button also kills audio
  const handleClose = () => {
    killAudio();
    onClose();
  };

  const toggleMute = () => {
    setMuted(m => {
      if (!m) {
        killAudio();
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(221,221,221,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={handleClose}>
      <div className="mac-window" style={{ width: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={handleClose} />
          <div style={{ flex: 1, textAlign: 'center' }}>🎙️ Huddle: &ldquo;{topic}&rdquo;</div>
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
              <div key={p.userId} style={{ textAlign: 'center' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', background: color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#FFFFFF', fontWeight: 'bold', fontSize: 14,
                  border: isSpeaking ? '3px solid #00CC00' : '2px solid #999999',
                  boxShadow: isSpeaking ? '0 0 8px rgba(0,204,0,0.6)' : 'none',
                  animation: isSpeaking ? 'pulse 1s infinite' : 'none',
                  transition: 'border 0.2s, box-shadow 0.2s',
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
          {transcript.map(entry => {
            const isActive = currentPlayingId === entry.id;
            return (
              <div
                key={entry.id}
                id={`transcript-${entry.id}`}
                style={{
                  marginBottom: 4,
                  padding: '2px 4px',
                  borderRadius: 3,
                  background: isActive ? 'rgba(0, 204, 0, 0.1)' : 'transparent',
                  borderLeft: isActive ? '3px solid #00CC00' : '3px solid transparent',
                  transition: 'background 0.3s, border-left 0.3s',
                }}
              >
                <span style={{ color: '#999999' }}>{formatTime(entry.timestamp)}</span>{' '}
                <span style={{ color: getNickColor(entry.userId), fontWeight: 'bold' }}>{getUserName(entry.userId)}</span>{' '}
                <span>{entry.content}</span>
              </div>
            );
          })}
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
              disabled={sending || ended}
            />
            <button type="submit" className="mac-btn" disabled={sending || !input.trim() || ended} style={{ minWidth: 50, fontSize: 11 }}>
              {sending ? '⏳' : 'Send'}
            </button>
          </form>
          <button className="mac-btn" onClick={toggleMute} style={{ minWidth: 0, padding: '4px 8px', fontSize: 13 }} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
          {currentUserId === createdBy && !ended && (
            <button className="mac-btn" onClick={handleEnd} style={{ minWidth: 0, padding: '4px 8px', fontSize: 11, color: '#CC0000' }}>
              End
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
