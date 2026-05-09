import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { api } from '../lib/api';
import { apiUrl } from '../lib/urls';

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

// LocalStorage key for remembering the user's preferred fullscreen state
// across huddles. Opt-in: if the key is missing we default to the windowed
// size so the UX stays familiar for first-time users.
const FULLSCREEN_PREF_KEY = 'huddle:fullscreen';

function readFullscreenPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(FULLSCREEN_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFullscreenPref(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FULLSCREEN_PREF_KEY, value ? '1' : '0');
  } catch {
    /* localStorage can throw in private-mode / blocked contexts; ignore. */
  }
}

// Huddle audio speed-up is applied server-side via the ElevenLabs native
// `speed` parameter in tts.ts (HUDDLE_TTS_SPEED). We no longer touch
// HTMLAudio.playbackRate here — the native TTS path preserves pitch and
// reports the correct duration, while a client-side rate change would
// pitch-shift the voice and desync from the transcript teleprompter.

export function HuddleModal({ huddleId, topic, createdBy, currentUserId, usersMap, onClose, onEnded, huddleEvents }: HuddleModalProps) {
  const [participants, setParticipants] = useState<HuddleParticipant[]>([]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [speakingUserId, setSpeakingUserId] = useState<string | null>(null);
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ended, setEnded] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(readFullscreenPref);
  const startTime = useRef(Date.now());
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioQueue = useRef<{ url: string; messageId: string }[]>([]);
  const isPlaying = useRef(false);
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const processedEvents = useRef(new Set<string>());
  // Keep a ref mirror of transcript so playNext can read without misusing setState
  const transcriptData = useRef<TranscriptEntry[]>([]);

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

  // Keep transcriptData ref in sync with state
  useEffect(() => {
    transcriptData.current = transcript;
  }, [transcript]);

  // Fetch huddle details + message history on mount
  useEffect(() => {
    api.getHuddle(huddleId)
      .then(data => {
        if (data.participants) setParticipants(data.participants);
        if (data.startedAt) startTime.current = new Date(data.startedAt).getTime();
        if (data.status === 'ended') setEnded(true);
        // Fetch message history for the huddle channel
        if (data.channel?.id) {
          api.getMessages(data.channel.id, 100)
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
    api.joinHuddle(huddleId).catch(() => {});

    // Cleanup on unmount
    return () => killAudio();
  }, [huddleId, killAudio]);

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
        api.getHuddle(huddleId)
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
    const fullUrl = apiUrl(url);
    setCurrentPlayingId(messageId);

    // Read transcript from ref to find the speaker
    const entry = transcriptData.current.find(t => t.id === messageId);
    if (entry) setSpeakingUserId(entry.userId);

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
      await api.speak(huddleId, input.trim());
      setInput('');
    } catch {}
    setSending(false);
  };

  const handleEnd = async () => {
    if (!confirm('End this huddle for everyone?')) return;
    killAudio();
    try {
      await api.endHuddle(huddleId);
    } catch {}
    setEnded(true);
    onEnded();
  };

  const handleClose = () => {
    killAudio();
    onClose();
  };

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen(prev => {
      const next = !prev;
      writeFullscreenPref(next);
      return next;
    });
  }, []);

  // Keyboard shortcuts:
  //   ESC  — exit full-screen (if active), otherwise close the huddle
  //   F    — toggle full-screen (skipped while typing in the input box,
  //          so users can still type the letter f normally)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullScreen) {
          e.preventDefault();
          toggleFullScreen();
          return;
        }
        handleClose();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        toggleFullScreen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // handleClose is stable enough for this scope; we don't rebind on
    // every render because the cleanup + rebind cost would be paid on
    // every transcript/elapsed tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreen, toggleFullScreen]);

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

  // Full-screen vs windowed dimensions. Full-screen takes the viewport
  // minus a small margin so the Mac-style border still reads as a window,
  // matches the retro aesthetic, and leaves room for the scrim underneath.
  const windowStyle: CSSProperties = isFullScreen
    ? {
        width: 'calc(100vw - 24px)',
        height: 'calc(100vh - 24px)',
        maxHeight: 'calc(100vh - 24px)',
        display: 'flex',
        flexDirection: 'column',
      }
    : {
        width: 480,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
      };

  // In full-screen the transcript should expand to fill available space
  // instead of hitting a 300px cap. minHeight stays so the pane is never
  // collapsed when the transcript is empty.
  const transcriptStyle: CSSProperties = isFullScreen
    ? {
        flex: 1,
        overflow: 'auto',
        margin: 8,
        padding: 8,
        minHeight: 200,
        fontFamily: 'Monaco, IBM Plex Mono, monospace',
        fontSize: 11,
      }
    : {
        flex: 1,
        overflow: 'auto',
        margin: 8,
        padding: 8,
        minHeight: 200,
        maxHeight: 300,
        fontFamily: 'Monaco, IBM Plex Mono, monospace',
        fontSize: 11,
      };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(221,221,221,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={handleClose}>
      <div className="mac-window" style={windowStyle} onClick={e => e.stopPropagation()}>
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={handleClose} aria-label="Close huddle" role="button" />
          <div style={{ flex: 1, textAlign: 'center' }}>🎙️ Huddle: &ldquo;{topic}&rdquo;</div>
          <span style={{ fontSize: 11, fontWeight: 'normal', fontFamily: 'Monaco, IBM Plex Mono, monospace' }}>⏱️ {mm}:{ss} / 30:00</span>
          <div
            className="mac-zoom-box"
            onClick={toggleFullScreen}
            aria-label={isFullScreen ? 'Exit full-screen (Esc or F)' : 'Enter full-screen (F)'}
            role="button"
            title={isFullScreen ? 'Exit full-screen (Esc or F)' : 'Full-screen (F)'}
          />
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
        <div ref={transcriptRef} className="mac-inset" style={transcriptStyle}>
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
