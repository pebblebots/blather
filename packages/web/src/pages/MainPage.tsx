import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { clearToken } from '../lib/api';
import { useApp } from '../lib/store';
import { useWebSocket } from '../hooks/useWebSocket';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { CreateWorkspaceModal } from '../components/CreateWorkspaceModal';
import { CreateChannelModal } from '../components/CreateChannelModal';

export function MainPage() {
  const { user, setUser } = useApp();
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [selectedWs, setSelectedWs] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [selectedCh, setSelectedCh] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, { displayName: string; isAgent: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [showCreateCh, setShowCreateCh] = useState(false);

  useEffect(() => {
    api.getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws.length > 0 && !selectedWs) setSelectedWs(ws[0].id);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWs) { setChannels([]); return; }
    api.getChannels(selectedWs).then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setSelectedCh(chs[0].id);
      else setSelectedCh(null);
    }).catch(() => {});
  }, [selectedWs]);

  useEffect(() => {
    if (!selectedCh) { setMessages([]); return; }
    api.getMessages(selectedCh).then((msgs) => {
      setMessages(msgs.reverse());
    }).catch(() => {});
  }, [selectedCh]);

  const addUserInfo = useCallback((userId: string, displayName: string, isAgent: boolean) => {
    setUsersMap((prev) => {
      if (prev.has(userId)) return prev;
      const next = new Map(prev);
      next.set(userId, { displayName, isAgent });
      return next;
    });
  }, []);

  useEffect(() => {
    if (user) addUserInfo(user.id, user.displayName, user.isAgent);
  }, [user, addUserInfo]);

  const onWsEvent = useCallback((event: any) => {
    if (event.type === 'message.created' && event.payload) {
      const p = event.payload;
      if (p.channelId === selectedCh) {
        setMessages((prev) => [...prev, p]);
      }
    }
    if (event.type === 'channel.created' && event.payload && selectedWs) {
      setChannels((prev) => [...prev, event.payload]);
    }
  }, [selectedCh, selectedWs]);

  const wsConnected = useWebSocket(selectedWs, onWsEvent);

  const handleSend = async (content: string) => {
    if (!selectedCh) return;
    try {
      const msg = await api.sendMessage(selectedCh, content);
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    } catch {}
  };

  const logout = () => { clearToken(); setUser(null); };

  const selectedChannel = channels.find((c) => c.id === selectedCh);
  const selectedWorkspace = workspaces.find((w) => w.id === selectedWs);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#C0C0C0' }}>
        ⏳ Loading...
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#C0C0C0', padding: 4 }}>
      {/* Outer window */}
      <div className="win-raised" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Main title bar */}
        <div className="win-titlebar">
          <span>BLATHER v0.1 — {selectedWorkspace?.name?.toUpperCase() || 'NO WORKSPACE'}</span>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="win-titlebar-btn">_</button>
            <button className="win-titlebar-btn">□</button>
            <button className="win-titlebar-btn">╳</button>
          </div>
        </div>

        {/* Main body: sidebar + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Sidebar - Explorer panel */}
          <div className="win-raised" style={{ width: 220, display: 'flex', flexDirection: 'column', margin: 2, flexShrink: 0 }}>
            <div className="win-titlebar" style={{ fontSize: 11 }}>
              <span>EXPLORER</span>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {/* Workspaces */}
              <div style={{ padding: '6px 4px 2px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, padding: '0 4px' }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>WORKSPACES</span>
                  <button
                    className="win-titlebar-btn"
                    style={{ width: 14, height: 14, fontSize: 10 }}
                    onClick={() => setShowCreateWs(true)}
                    title="Create workspace"
                  >+</button>
                </div>
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    onClick={() => setSelectedWs(ws.id)}
                    style={{
                      padding: '2px 6px',
                      fontSize: 12,
                      cursor: 'pointer',
                      background: ws.id === selectedWs ? '#000000' : 'transparent',
                      color: ws.id === selectedWs ? '#FFFFFF' : '#000000',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    📁 {ws.name}
                  </div>
                ))}
                {workspaces.length === 0 && (
                  <div style={{ padding: '2px 6px', fontSize: 11, color: '#808080' }}>NO WORKSPACES</div>
                )}
              </div>

              <hr className="win-separator" />

              {/* Channels */}
              {selectedWs && (
                <div style={{ padding: '2px 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>CHANNELS</span>
                    <button
                      className="win-titlebar-btn"
                      style={{ width: 14, height: 14, fontSize: 10 }}
                      onClick={() => setShowCreateCh(true)}
                      title="Create channel"
                    >+</button>
                  </div>
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      onClick={() => setSelectedCh(ch.id)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: ch.id === selectedCh ? '#000000' : 'transparent',
                        color: ch.id === selectedCh ? '#FFFFFF' : '#000000',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      📄 # {ch.name}
                    </div>
                  ))}
                  {channels.length === 0 && (
                    <div style={{ padding: '2px 6px', fontSize: 11, color: '#808080' }}>NO CHANNELS</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Chat panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '2px 2px 2px 0', overflow: 'hidden' }}>
            {/* Channel title bar */}
            <div className="win-raised" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="win-titlebar" style={{ fontSize: 11 }}>
                <span>
                  {selectedChannel
                    ? `# ${selectedChannel.name.toUpperCase()}${selectedChannel.topic ? ` — ${selectedChannel.topic}` : ''}`
                    : 'SELECT A CHANNEL'}
                </span>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="win-titlebar-btn">_</button>
                  <button className="win-titlebar-btn">╳</button>
                </div>
              </div>
            </div>

            {selectedCh ? (
              <>
                <MessageList messages={messages} usersMap={usersMap} />
                <MessageInput onSend={handleSend} disabled={!selectedCh} />
              </>
            ) : (
              <div className="win-sunken" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#808080', margin: '0' }}>
                {selectedWs ? '> SELECT OR CREATE A CHANNEL' : '> SELECT OR CREATE A WORKSPACE'}
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="win-statusbar">
          <div className="win-statusbar-field" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: wsConnected ? '#000000' : '#808080' }}>{wsConnected ? '■' : '□'}</span>
            <span>{wsConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          </div>
          <div className="win-statusbar-field" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{user?.displayName}</span>
            {user?.isAgent && <span style={{ fontWeight: 'bold' }}>[BOT]</span>}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={logout}
            style={{ background: 'none', border: 'none', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            LOGOUT
          </button>
        </div>
      </div>

      {/* Modals */}
      {showCreateWs && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWs(false)}
          onCreated={(ws) => { setWorkspaces((prev) => [...prev, ws]); setSelectedWs(ws.id); }}
        />
      )}
      {showCreateCh && selectedWs && (
        <CreateChannelModal
          workspaceId={selectedWs}
          onClose={() => setShowCreateCh(false)}
          onCreated={(ch) => { setChannels((prev) => [...prev, ch]); setSelectedCh(ch.id); }}
        />
      )}
    </div>
  );
}
