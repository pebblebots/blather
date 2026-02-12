import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [showCreateCh, setShowCreateCh] = useState(false);

  useEffect(() => {
    api.getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws.length > 0 && !selectedWs) setSelectedWs(ws[0].id);
      // Auto-show create workspace if user has none
      if (ws.length === 0) setShowCreateWs(true);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedWs) { 
      setChannels([]);
      setWorkspaceMembers([]);
      return; 
    }
    api.getChannels(selectedWs).then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setSelectedCh(chs[0].id);
      else setSelectedCh(null);
    }).catch(() => {});

    api.getWorkspaceMembers(selectedWs).then((members) => {
      setWorkspaceMembers(members);
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

  // Use refs for values needed in WS callback to avoid reconnecting on every selection change
  const selectedChRef = useRef(selectedCh);
  selectedChRef.current = selectedCh;

  const onWsEvent = useCallback((event: any) => {
    if (event.type === 'message.created' && event.data) {
      const p = event.data;
      if (p.channelId === selectedChRef.current) {
        setMessages((prev) => [...prev, p]);
      }
    }
    if (event.type === 'channel.created' && event.data) {
      setChannels((prev) => {
        const exists = prev.some((c) => c.id === event.data.id);
        return exists ? prev : [...prev, event.data];
      });
    }
  }, []);

  const wsConnected = useWebSocket(selectedWs, onWsEvent);

  const handleSend = async (content: string) => {
    if (!selectedCh) return;
    try {
      const msg = await api.sendMessage(selectedCh, content);
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    } catch {}
  };

  const logout = () => { clearToken(); setUser(null); };

  const handleUserClick = async (targetUserId: string) => {
    if (!selectedWs) return;
    try {
      const dmChannel = await api.getOrCreateDM(selectedWs, targetUserId);
      // Add to channels list if not already there
      setChannels((prev) => {
        const exists = prev.some((c) => c.id === dmChannel.id);
        return exists ? prev : [...prev, dmChannel];
      });
      setSelectedCh(dmChannel.id);
    } catch (error) {
      console.error('Failed to create/open DM:', error);
    }
  };

  const selectedChannel = channels.find((c) => c.id === selectedCh);
  const selectedWorkspace = workspaces.find((w) => w.id === selectedWs);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#DDDDDD', fontSize: 12 }}>
        ⏳ Loading...
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#DDDDDD' }}>
      {/* Menu bar */}
      <div className="mac-menubar">
        <span style={{ fontSize: 14 }}>🍎</span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Window</span>
        <span>Help</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontWeight: 'normal', fontSize: 11 }}>⌘</span>
      </div>

      {/* Main window */}
      <div className="mac-window" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: 4, borderRadius: 0 }}>
        {/* Main title bar */}
        <div className="mac-titlebar">
          <div className="mac-close-box" />
          <div style={{ flex: 1, textAlign: 'center' }}>
            Blather — {selectedWorkspace?.name || 'No Workspace'}
          </div>
        </div>

        {/* Main body: sidebar + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Sidebar - Finder-style navigator */}
          <div style={{ width: 210, display: 'flex', flexDirection: 'column', borderRight: '1px solid #999999', background: '#FFFFFF', flexShrink: 0 }}>
            <div className="mac-titlebar" style={{ fontSize: 11 }}>
              <div className="mac-close-box" style={{ width: 10, height: 10 }} />
              <div style={{ flex: 1, textAlign: 'center' }}>📁 Navigator</div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
              {/* Workspaces */}
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '0 4px' }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold' }}>Workspaces</span>
                  <button
                    className="mac-btn"
                    style={{ minWidth: 0, padding: '0 4px', fontSize: 10, borderRadius: 3 }}
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
                      background: ws.id === selectedWs ? '#3366CC' : 'transparent',
                      color: ws.id === selectedWs ? '#FFFFFF' : '#000000',
                      borderRadius: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    📁 {ws.name}
                  </div>
                ))}
                {workspaces.length === 0 && (
                  <div style={{ padding: '2px 6px', fontSize: 11, color: '#999999' }}>No workspaces</div>
                )}
              </div>

              <hr className="mac-separator" />

              {/* Channels */}
              {selectedWs && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, fontWeight: 'bold' }}>Channels</span>
                    <button
                      className="mac-btn"
                      style={{ minWidth: 0, padding: '0 4px', fontSize: 10, borderRadius: 3 }}
                      onClick={() => setShowCreateCh(true)}
                      title="Create channel"
                    >+</button>
                  </div>
                  {channels.filter(ch => ch.channelType !== 'dm').map((ch) => (
                    <div
                      key={ch.id}
                      onClick={() => setSelectedCh(ch.id)}
                      style={{
                        padding: '2px 6px 2px 14px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: ch.id === selectedCh ? '#3366CC' : 'transparent',
                        color: ch.id === selectedCh ? '#FFFFFF' : '#000000',
                        borderRadius: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      💬 # {ch.name} {ch.channelType === 'private' && '🔒'}
                    </div>
                  ))}
                  {channels.filter(ch => ch.channelType !== 'dm').length === 0 && (
                    <div style={{ padding: '2px 6px', fontSize: 11, color: '#999999' }}>No channels</div>
                  )}
                </div>
              )}

              {/* Users */}
              {selectedWs && workspaceMembers.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <hr className="mac-separator" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, fontWeight: 'bold' }}>Users</span>
                  </div>
                  {workspaceMembers.filter(member => member.id !== user?.id).map((member) => (
                    <div
                      key={member.id}
                      onClick={() => handleUserClick(member.id)}
                      style={{
                        padding: '2px 6px 2px 14px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: 'transparent',
                        color: '#000000',
                        borderRadius: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#EEEEEE'}
                      onMouseLeave={(e) => (e.target as HTMLElement).style.background = 'transparent'}
                    >
                      👤 {member.displayName} {member.isAgent && '[BOT]'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Chat panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FFFFFF' }}>
            {/* Channel title bar */}
            <div className="mac-titlebar" style={{ fontSize: 11 }}>
              <div className="mac-close-box" style={{ width: 10, height: 10 }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                {selectedChannel ? (() => {
                  if (selectedChannel.channelType === 'dm') {
                    // For DMs, show the other user's display name
                    const otherUserId = selectedChannel.slug.replace('dm-', '').split('-').find((id: string) => id !== user?.id);
                    const otherUser = workspaceMembers.find(member => member.id === otherUserId);
                    return `💬 ${otherUser?.displayName || 'Unknown User'}`;
                  } else {
                    // For regular channels, show channel name and topic
                    return `# ${selectedChannel.name}${selectedChannel.topic ? ' — ' + selectedChannel.topic : ''}`;
                  }
                })() : 'Select a Channel'}
              </div>
            </div>

            {selectedCh ? (
              <>
                <MessageList messages={messages} usersMap={usersMap} />
                <MessageInput onSend={handleSend} disabled={!selectedCh} />
              </>
            ) : (
              <div className="mac-inset" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#999999', margin: 4 }}>
                {selectedWs ? 'Select or create a channel' : 'Select or create a workspace'}
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="mac-statusbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: wsConnected ? '#009900' : '#999999', fontSize: 8 }}>●</span>
            <span>{wsConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{user?.displayName}</span>
            {user?.isAgent && <span style={{ fontWeight: 'bold', fontSize: 10 }}>[BOT]</span>}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={logout}
            className="mac-btn"
            style={{ minWidth: 0, padding: '1px 8px', fontSize: 10, borderRadius: 3 }}
          >
            Logout
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
