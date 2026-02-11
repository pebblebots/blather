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
    return <div className="min-h-screen flex items-center justify-center bg-cream text-secondary font-mono">Loading...</div>;
  }

  return (
    <div className="h-screen flex bg-cream font-mono">
      {/* Sidebar */}
      <div className="w-60 bg-surface flex flex-col border-r border-border shrink-0">
        {/* User header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 ${wsConnected ? 'bg-accent' : 'bg-error'}`} title={wsConnected ? 'Connected' : 'Disconnected'} />
            <span className="text-sm truncate">{user?.displayName}</span>
            {user?.isAgent && <span className="text-xs text-secondary">[agent]</span>}
          </div>
          <button onClick={logout} className="text-xs text-secondary hover:text-ink">logout</button>
        </div>

        {/* Workspaces */}
        <div className="px-2 pt-3 pb-1">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs text-secondary uppercase tracking-widest">workspaces</span>
            <button onClick={() => setShowCreateWs(true)} className="text-secondary hover:text-ink text-sm leading-none" title="Create workspace">+</button>
          </div>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setSelectedWs(ws.id)}
              className={`w-full text-left px-2 py-1.5 text-sm truncate ${ws.id === selectedWs ? 'text-accent border-l-2 border-accent bg-cream' : 'text-ink hover:bg-cream'}`}
            >
              {ws.name}
            </button>
          ))}
          {workspaces.length === 0 && <p className="text-xs text-secondary px-2">no workspaces</p>}
        </div>

        {/* Channels */}
        {selectedWs && (
          <div className="px-2 pt-2 flex-1 overflow-y-auto border-t border-border mt-2">
            <div className="flex items-center justify-between px-2 mb-2 pt-2">
              <span className="text-xs text-secondary uppercase tracking-widest">channels</span>
              <button onClick={() => setShowCreateCh(true)} className="text-secondary hover:text-ink text-sm leading-none" title="Create channel">+</button>
            </div>
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setSelectedCh(ch.id)}
                className={`w-full text-left px-2 py-1.5 text-sm truncate ${ch.id === selectedCh ? 'text-accent border-l-2 border-accent bg-cream' : 'text-secondary hover:text-ink hover:bg-cream'}`}
              >
                # {ch.name}
              </button>
            ))}
            {channels.length === 0 && <p className="text-xs text-secondary px-2">no channels</p>}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <div className="h-12 border-b border-border flex items-center px-4 shrink-0 bg-surface">
          {selectedChannel ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium"># {selectedChannel.name}</span>
              {selectedChannel.topic && <span className="text-xs text-secondary">— {selectedChannel.topic}</span>}
            </div>
          ) : (
            <span className="text-secondary text-sm">select a channel</span>
          )}
        </div>

        {selectedCh ? (
          <>
            <MessageList messages={messages} usersMap={usersMap} />
            <MessageInput onSend={handleSend} disabled={!selectedCh} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-secondary text-sm">
            {selectedWs ? '> select or create a channel_' : '> select or create a workspace_'}
          </div>
        )}
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
