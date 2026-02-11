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

  // Load workspaces
  useEffect(() => {
    api.getWorkspaces().then((ws) => {
      setWorkspaces(ws);
      if (ws.length > 0 && !selectedWs) setSelectedWs(ws[0].id);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Load channels when workspace changes
  useEffect(() => {
    if (!selectedWs) { setChannels([]); return; }
    api.getChannels(selectedWs).then((chs) => {
      setChannels(chs);
      if (chs.length > 0) setSelectedCh(chs[0].id);
      else setSelectedCh(null);
    }).catch(() => {});
  }, [selectedWs]);

  // Load messages when channel changes
  useEffect(() => {
    if (!selectedCh) { setMessages([]); return; }
    api.getMessages(selectedCh).then((msgs) => {
      setMessages(msgs.reverse());
    }).catch(() => {});
  }, [selectedCh]);

  // Track user info from messages
  const addUserInfo = useCallback((userId: string, displayName: string, isAgent: boolean) => {
    setUsersMap((prev) => {
      if (prev.has(userId)) return prev;
      const next = new Map(prev);
      next.set(userId, { displayName, isAgent });
      return next;
    });
  }, []);

  // Add current user to map
  useEffect(() => {
    if (user) addUserInfo(user.id, user.displayName, user.isAgent);
  }, [user, addUserInfo]);

  // WebSocket
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
      // Optimistic: add if not already from WS
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    } catch {}
  };

  const logout = () => { clearToken(); setUser(null); };

  const selectedChannel = channels.find((c) => c.id === selectedCh);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-800 flex flex-col border-r border-gray-700 shrink-0">
        {/* User header */}
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-red-400'}`} title={wsConnected ? 'Connected' : 'Disconnected'} />
            <span className="text-sm font-medium truncate">{user?.displayName}</span>
            {user?.isAgent && <span className="text-xs">🤖</span>}
          </div>
          <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-200">Logout</button>
        </div>

        {/* Workspaces */}
        <div className="p-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Workspaces</span>
            <button onClick={() => setShowCreateWs(true)} className="text-gray-400 hover:text-gray-200 text-lg leading-none" title="Create workspace">+</button>
          </div>
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setSelectedWs(ws.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${ws.id === selectedWs ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-300 hover:bg-gray-700'}`}
            >
              {ws.name}
            </button>
          ))}
          {workspaces.length === 0 && <p className="text-xs text-gray-500 px-2">No workspaces yet</p>}
        </div>

        {/* Channels */}
        {selectedWs && (
          <div className="p-2 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Channels</span>
              <button onClick={() => setShowCreateCh(true)} className="text-gray-400 hover:text-gray-200 text-lg leading-none" title="Create channel">+</button>
            </div>
            {channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setSelectedCh(ch.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${ch.id === selectedCh ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
              >
                # {ch.name}
              </button>
            ))}
            {channels.length === 0 && <p className="text-xs text-gray-500 px-2">No channels yet</p>}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Channel header */}
        <div className="h-12 border-b border-gray-700 flex items-center px-4 shrink-0">
          {selectedChannel ? (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm"># {selectedChannel.name}</span>
              {selectedChannel.topic && <span className="text-xs text-gray-500 truncate">— {selectedChannel.topic}</span>}
            </div>
          ) : (
            <span className="text-gray-500 text-sm">Select a channel</span>
          )}
        </div>

        {selectedCh ? (
          <>
            <MessageList messages={messages} usersMap={usersMap} />
            <MessageInput onSend={handleSend} disabled={!selectedCh} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            {selectedWs ? 'Select or create a channel to get started' : 'Select or create a workspace'}
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
