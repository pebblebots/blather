import { useState, useEffect, useCallback, useRef } from 'react';
import { api, unreadApi, presenceApi, statusApi, clearToken } from '../lib/api';
import { useApp } from '../lib/store';
import { useWebSocket } from '../hooks/useWebSocket';
import { useIsMobile } from '../hooks/useIsMobile';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { CreateChannelModal } from '../components/CreateChannelModal';
import { ChannelContextMenu } from '../components/ChannelContextMenu';
import { InviteMemberModal } from '../components/InviteMemberModal';
import { TypingIndicator } from '../components/TypingIndicator';
import { TaskPanel } from '../components/TaskPanel';
import { SearchPanel } from '../components/SearchPanel';
import { ThreadPanel } from '../components/ThreadPanel';
import MenuBar from '../components/MenuBar';
import { HuddleModal } from '../components/HuddleModal';
import { NewHuddleModal } from '../components/NewHuddleModal';
import { HelpModal } from '../components/HelpModal';
import { useToast } from '../components/Toast';

export function MainPage() {
  const { user, setUser } = useApp();
  const isMobile = useIsMobile();
  const { showToast } = useToast();
  
  // Mobile-specific state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('blather:sidebarWidth');
    return saved ? parseInt(saved, 10) : 210;
  });
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(210);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const next = Math.min(400, Math.max(140, dragStartWidthRef.current + delta));
      setSidebarWidth(next);
      localStorage.setItem('blather:sidebarWidth', String(next));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);
  
  const [channels, setChannels] = useState<any[]>([]);
  const [selectedCh, _setSelectedCh] = useState<string | null>(null);
  const setSelectedCh = (valOrFn: string | null | ((prev: string | null) => string | null)) => {
    _setSelectedCh((prev) => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if (next) localStorage.setItem('blather_last_channel', next);
      // Auto-close sidebar on mobile when channel is selected
      if (isMobile) setIsSidebarOpen(false);
      return next;
    });
  };
  const [messages, setMessages] = useState<any[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [usersMap, setUsersMap] = useState<Map<string, { displayName: string; isAgent: boolean }>>(new Map());
  const [allMembers, setAllMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, { timestamp: number; channelId: string }>>(new Map());
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const skipChannelLoadRef = useRef(false);
  const [activeHuddle, setActiveHuddle] = useState<any>(null);
  const [showNewHuddle, setShowNewHuddle] = useState(false);
  const [showHuddle, setShowHuddle] = useState(false);
  const [currentHuddleId, setCurrentHuddleId] = useState<string | null>(null);
  const [huddleEvents, setHuddleEvents] = useState<any[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [threadMessage, setThreadMessage] = useState<any>(null);
  const [threadNewReply, setThreadNewReply] = useState<any>(null);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; channel: any} | null>(null);
  const [inviteChannelId, setInviteChannelId] = useState<string | null>(null);
  const usersMapRef = useRef<Map<string, { displayName: string; isAgent: boolean }>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [presence, setPresence] = useState<Map<string, string>>(new Map());
  const [agentStatuses, setAgentStatuses] = useState<Map<string, { text: string; progress?: number; eta?: string }>>(new Map());

  // Mobile tab handlers

  useEffect(() => {
    api.getChannels().then((chs) => {
      setChannels(chs);
      if (chs.length > 0) {
        const saved = localStorage.getItem('blather_last_channel');
        const match = saved && chs.find((c: any) => c.id === saved);
        setSelectedCh(match ? saved : chs[0].id);
      } else setSelectedCh(null);
    }).catch(() => {});

    api.getMembers().then((members) => {
      setAllMembers(members);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Fetch unread counts and presence on mount
  useEffect(() => {
    unreadApi.getUnreadCounts().then(setUnreadCounts).catch(() => {});
    presenceApi.getPresence().then((data) => {
      const map = new Map<string, string>();
      for (const p of data) map.set(p.userId, p.status);
      setPresence(map);
    }).catch(() => {});
    statusApi.getAll().then((data) => {
      const map = new Map<string, { text: string; progress?: number; eta?: string }>();
      for (const [userId, s] of Object.entries(data)) map.set(userId, s as any);
      setAgentStatuses(map);
    }).catch(() => {});
  }, []);

  // Fetch active huddles
  useEffect(() => {
    api.getActiveHuddles()
      .then(huddles => { if (huddles.length > 0) setActiveHuddle(huddles[0]); else setActiveHuddle(null); })
      .catch(() => {});
  }, []);

  // Mark channel as read when selecting it, and clear local badge
  useEffect(() => {
    if (!selectedCh) return;
    unreadApi.markRead(selectedCh).catch(() => {});
    setUnreadCounts((prev) => {
      if (!prev[selectedCh]) return prev;
      const next = { ...prev };
      delete next[selectedCh];
      return next;
    });
  }, [selectedCh]);


  useEffect(() => {
    if (!selectedCh) { setMessages([]); setHasMoreOlder(true); return; }
    if (skipChannelLoadRef.current) { skipChannelLoadRef.current = false; return; }
    setThreadMessage(null);
    api.getMessages(selectedCh).then((msgs) => {
      const sorted = msgs.reverse();
      // Populate usersMap from message user data
      setUsersMap((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const m of msgs) {
          if (m.user && !next.has(m.userId)) { next.set(m.userId, { displayName: m.user.displayName, isAgent: m.user.isAgent }); changed = true; }
        }
        return changed ? next : prev;
      });
      setMessages(sorted);
      setHasMoreOlder(msgs.length >= 50);
    }).catch(() => {});
  }, [selectedCh]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedCh || isLoadingOlder || !hasMoreOlder || messages.length === 0) return;
    setIsLoadingOlder(true);
    try {
      const oldest = messages[0]?.createdAt;
      const older = await api.getMessages(selectedCh, 50, undefined, oldest);
      const sorted = older.reverse();
        setUsersMap((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const m of older) {
            if (m.user && !next.has(m.userId)) { next.set(m.userId, { displayName: m.user.displayName, isAgent: m.user.isAgent }); changed = true; }
          }
          return changed ? next : prev;
        });
      if (sorted.length === 0) {
        setHasMoreOlder(false);
      } else {
        setMessages((prev) => { const ids = new Set(prev.map(m => m.id)); const unique = sorted.filter(m => !ids.has(m.id)); return [...unique, ...prev]; });
        if (sorted.length < 50) setHasMoreOlder(false);
      }
    } catch (e) {
      console.error("Failed to load older messages:", e);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [selectedCh, isLoadingOlder, hasMoreOlder, messages]);

  useEffect(() => { usersMapRef.current = usersMap; }, [usersMap]);

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


  useEffect(() => {
    for (const member of allMembers) {
      addUserInfo(member.id, member.displayName, member.isAgent);
    }
  }, [allMembers, addUserInfo]);
  // Use refs for values needed in WS callback to avoid reconnecting on every selection change
  const selectedChRef = useRef(selectedCh);
  selectedChRef.current = selectedCh;
  const userRef = useRef(user);
  userRef.current = user;

  const onWsEvent = useCallback((event: any) => {
    if (event.type === 'message.created' && event.data) {
      const p = event.data;
      // Add user info if present and not yet known
      if (p.user && p.userId) addUserInfo(p.userId, p.user.displayName, p.user.isAgent);
      // If it's a thread reply, route to thread panel instead of main list
      if (p.threadId) {
        setThreadNewReply({ ...p, _ts: Date.now() });
        // Don't add to main message list
      } else if (p.channelId === selectedChRef.current) {
        setMessages((prev) => [...prev, p]);
        // Mark channel as read so server stays in sync
        unreadApi.markRead(p.channelId).catch(() => {});
        // Clear typing indicator for this user in this channel
        setTypingUsers((prev) => {
          const key = `${p.channelId}:${p.userId}`;
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } else if (p.userId !== userRef.current?.id) {
        // Increment unread count for other channels (skip own messages)
        setUnreadCounts((prev) => ({ ...prev, [p.channelId]: (prev[p.channelId] || 0) + 1 }));
      }
    }
    if (event.type === 'typing.started' && event.data) {
      const p = event.data;
      // Add user info to usersMap if provided
      if (p.user && p.userId) addUserInfo(p.userId, p.user.displayName, p.user.isAgent);
      const typingKey = `${p.channelId}:${p.userId}`;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(typingKey, { timestamp: Date.now(), channelId: p.channelId });
        return next;
      });
      const existing = typingTimers.current.get(typingKey);
      if (existing) clearTimeout(existing);
      // For agents, no timeout - indicator stays until their message arrives
      const userInfo = usersMapRef.current.get(p.userId);
      const isAgent = userInfo?.isAgent ?? false;
      if (!isAgent) {
        typingTimers.current.set(typingKey, setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(typingKey);
            return next;
          });
          typingTimers.current.delete(typingKey);
        }, 30000));
      }
    }
    // Huddle events
    if (event.type === 'huddle.created' && event.data) {
      setActiveHuddle(event.data);
    }
    if (event.type === 'huddle.ended' && event.data) {
      setActiveHuddle(null);
      setShowHuddle(false);
      setCurrentHuddleId(null);
    }
    if (event.type?.startsWith('huddle.') && event.data) {
      setHuddleEvents(prev => [...prev, { type: event.type, ...event.data, _ts: Date.now() }]);
    }
    if (event.type === 'presence.changed' && event.data) {
      const p = event.data;
      setPresence((prev) => {
        const next = new Map(prev);
        next.set(p.userId, p.status);
        return next;
      });
    }
    if (event.type === 'status.changed' && event.data) {
      const p = event.data;
      setAgentStatuses((prev) => {
        const next = new Map(prev);
        if (p.status) next.set(p.userId, p.status);
        else next.delete(p.userId);
        return next;
      });
    }
    if (event.type === 'thread.updated' && event.data) {
      const p = event.data;
      // Update reply count on the parent message
      setMessages((prev) => prev.map((m) =>
        m.id === p.parentMessageId ? { ...m, replyCount: p.replyCount } : m
      ));
    }
    if (event.type === 'reaction.added' && event.data) {
      const p = event.data;
      // Skip own reactions — handled by the API response in handleToggleReaction
      if (p.userId === user?.id) return;
      setMessages((prev) => prev.map((m) => {
        if (m.id !== p.messageId) return m;
        const existing = (m.reactions || []).some((r: any) => r.id === p.id);
        if (existing) return m;
        return { ...m, reactions: [...(m.reactions || []), { id: p.id, userId: p.userId, emoji: p.emoji, createdAt: p.createdAt }] };
      }));
    }
    if (event.type === 'reaction.removed' && event.data) {
      const p = event.data;
      // Skip own reactions — handled by the API response in handleToggleReaction
      if (p.userId === user?.id) return;
      setMessages((prev) => prev.map((m) => {
        if (m.id !== p.messageId) return m;
        return { ...m, reactions: (m.reactions || []).filter((r: any) => r.id !== p.id) };
      }));
    }
    if (event.type === 'channel.created' && event.data) {
      setChannels((prev) => {
        const exists = prev.some((c) => c.id === event.data.id);
        return exists ? prev : [...prev, event.data];
      });
    }
    if (event.type === 'channel.deleted' && event.data) {
      const deletedId = event.data.id;
      setChannels((prev) => prev.filter((c) => c.id !== deletedId));
      setSelectedCh((prev) => prev === deletedId ? null : prev);
    }
    if (event.type === 'channel.archived' && event.data) {
      const archivedId = event.data.id;
      setChannels((prev) => prev.filter((c) => c.id !== archivedId));
      setSelectedCh((prev) => prev === archivedId ? null : prev);
    }
    if (event.type === 'member.joined' && event.data) {
      const m = event.data;
      setAllMembers((prev) => {
        const exists = prev.some((u: any) => u.id === m.id);
        return exists ? prev : [...prev, m];
      });
      addUserInfo(m.id, m.displayName, m.isAgent);
    }
    if (event.type === 'message.updated' && event.data) {
      const p = event.data;
      setMessages((prev) => prev.map((m) => m.id === p.id ? { ...m, content: p.content, updatedAt: p.updatedAt } : m));
    }
    if (event.type === 'message.deleted' && event.data) {
      const p = event.data;
      setMessages((prev) => prev.filter((m) => m.id !== p.id));
    }
  }, []);

  const wsConnected = useWebSocket(onWsEvent, selectedCh);

  const handleOpenThread = (msg: any) => {
    setThreadMessage(msg);
    setThreadNewReply(null);
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    if (!selectedCh) return;
    try {
      const updated = await api.editMessage(selectedCh, messageId, content);
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: updated.content, updatedAt: updated.updatedAt || updated.updated_at } : m));
    } catch (e: any) { showToast(e.message || 'Failed to edit message', 'error'); }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedCh) return;
    try {
      await api.deleteMessage(selectedCh, messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e: any) { showToast(e.message || 'Failed to delete message', 'error'); }
  };

  const handleToggleReaction = async (messageId: string, emoji: string, hasReacted: boolean) => {
    if (!selectedCh) return;
    try {
      if (hasReacted) {
        await api.removeReaction(selectedCh, messageId, emoji);
        // Remove from local state
        setMessages((prev) => prev.map((m) => {
          if (m.id !== messageId) return m;
          return { ...m, reactions: (m.reactions || []).filter((r: any) => !(r.emoji === emoji && r.userId === user?.id)) };
        }));
      } else {
        const reaction = await api.addReaction(selectedCh, messageId, emoji);
        // Add to local state (dedup: WS event may have arrived first)
        setMessages((prev) => prev.map((m) => {
          if (m.id !== messageId) return m;
          const alreadyExists = (m.reactions || []).some((r: any) => r.id === reaction.id);
          if (alreadyExists) return m;
          return { ...m, reactions: [...(m.reactions || []), { id: reaction.id, userId: user?.id, emoji, createdAt: reaction.createdAt }] };
        }));
      }
    } catch (e: any) {
      console.error('Reaction error:', e);
      showToast(e?.message ? `Reaction failed: ${e.message}` : 'Couldn\u2019t add reaction', 'error');
    }
  };

  const handleSend = async (content: string, attachments?: any[]) => {
    if (!selectedCh) return;
    try {
      const msg = await api.sendMessage(selectedCh, content, attachments);
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    } catch {}
  };

  const logout = () => { clearToken(); setUser(null); };

  const handleUserClick = async (targetUserId: string) => {
    try {
      const dmChannel = await api.getOrCreateDM(targetUserId);
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

  const handleTyping = useCallback(() => {
    if (!selectedCh) return;
    api.sendTyping(selectedCh).catch(() => {});
  }, [selectedCh]);

  const handleArchiveChannel = async (channelId: string) => {
    try {
      await api.archiveChannel(channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      if (selectedCh === channelId) setSelectedCh(null);
    } catch (e: any) { showToast(e.message || 'Failed to archive', 'error'); }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm('Are you sure you want to delete this channel? All messages will be lost.')) return;
    try {
      await api.deleteChannel(channelId);
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      if (selectedCh === channelId) setSelectedCh(null);
    } catch (e: any) { showToast(e.message || 'Failed to delete', 'error'); }
  };

  const handleChannelContextMenu = (e: React.MouseEvent, ch: any) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel: ch });
  };

  const handleToggleMute = async (channelId: string, mute: boolean) => {
    try {
      if (mute) {
        await api.muteChannel(channelId);
      } else {
        await api.unmuteChannel(channelId);
      }
      setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, muted: mute } : ch));
    } catch (e: any) { showToast(e.message || 'Failed to toggle mute', 'error'); }
  };

  // Keyboard shortcut: Cmd+K or Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedChannel = channels.find((c) => c.id === selectedCh);

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: '#DDDDDD', 
        fontSize: isMobile ? 16 : 12 
      }}>
        ⏳ Loading...
      </div>
    );
  }

  // Render mobile layout
  if (isMobile) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        flexDirection: 'column', 
        background: '#DDDDDD',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Mobile header */}
        <div style={{
          background: '#FFFFFF',
          borderBottom: '1px solid #999999',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: '44px',
          fontSize: '16px',
          fontWeight: 'bold',
        }}>
          <button
            onClick={() => setIsSidebarOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              padding: '8px',
              minWidth: '44px',
              minHeight: '44px',
              cursor: 'pointer',
            }}
          >
            ☰
          </button>
          
          <div style={{ flex: 1, textAlign: 'center', fontSize: '14px' }}>
            {showTasks ? "📋 Tasks" : selectedChannel ? (() => {
              if (selectedChannel.channelType === 'dm') {
                const uuids = selectedChannel.slug.replace('dm-', '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []; 
                const otherUserId = uuids.find((id: string) => id !== user?.id);
                const otherUser = allMembers.find(member => member.id === otherUserId);
                return `💬 ${otherUser?.displayName || 'Unknown User'}`;
              } else {
                return `# ${selectedChannel.name}`;
              }
            })() : 'Blather'}
          </div>
          
          <button
            onClick={() => setShowSearch(true)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16px',
              padding: '8px',
              minWidth: '44px',
              minHeight: '44px',
              cursor: 'pointer',
            }}
          >
            🔍
          </button>
        </div>

        {/* Mobile content area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FFFFFF' }}>
          {showTasks ? (
            <TaskPanel members={allMembers} />
          ) : selectedCh ? (
            <>
              <MessageList
                messages={messages}
                usersMap={usersMap}
                currentUserId={user?.id}
                channelId={selectedCh ?? undefined}
                onLoadOlder={loadOlderMessages}
                isLoadingOlder={isLoadingOlder}
                hasMoreOlder={hasMoreOlder}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onOpenThread={handleOpenThread}
                highlightMessageId={highlightMessageId}
                onToggleReaction={handleToggleReaction}
              />
              <TypingIndicator
                typingUsers={typingUsers}
                usersMap={usersMap}
                currentUserId={user?.id}
                selectedChannelId={selectedCh}
              />
              <MessageInput
                onSend={handleSend}
                onTyping={handleTyping}
                disabled={!selectedCh}
              />
            </>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              color: '#999999',
              padding: '16px',
              textAlign: 'center',
            }}>
              Select a channel from the menu
            </div>
          )}
        </div>


                {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <>
            <div 
              style={{ 
                position: 'fixed', 
                top: 0, 
                left: 0, 
                right: 0, 
                bottom: 0, 
                background: 'rgba(0,0,0,0.3)', 
                zIndex: 999 
              }}
              onClick={() => setIsSidebarOpen(false)}
            />
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              background: '#FFFFFF',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}>
              {/* Mobile sidebar header */}
              <div style={{
                background: '#FFFFFF',
                borderBottom: '1px solid #999999',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minHeight: '44px',
              }}>
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Menu</span>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    padding: '8px',
                    minWidth: '44px',
                    minHeight: '44px',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Mobile sidebar content */}
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {/* Huddle Banner */}
                {activeHuddle && (
                  <div style={{
                    background: '#CC3333', 
                    color: '#FFFFFF', 
                    padding: '12px',
                    fontSize: '16px',
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    margin: '0 0 16px 0',
                    borderRadius: '8px',
                    minHeight: '44px',
                  }} onClick={() => {
                    setCurrentHuddleId(activeHuddle.huddleId || activeHuddle.id);
                    setShowHuddle(true);
                    setHuddleEvents([]);
                    setIsSidebarOpen(false);
                  }}>
                    <span style={{ animation: 'pulse 1s infinite' }}>🔴</span>
                    <span>Huddle: {activeHuddle.topic}</span>
                  </div>
                )}

                <div style={{ borderTop: "1px solid #DDDDDD", margin: "8px 0" }} />
                {/* Channels */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Channels</span>
                      <button
                        style={{ 
                          background: '#3366CC', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '4px', 
                          padding: '4px 8px', 
                          fontSize: '14px',
                          minHeight: '32px',
                          cursor: 'pointer',
                        }}
                        onClick={() => setShowCreateCh(true)}
                      >
                        + New
                      </button>
                    </div>
                    {channels.filter(ch => ch.channelType !== 'dm').map((ch) => (
                      <div
                        key={ch.id}
                        onClick={() => {
                          setSelectedCh(ch.id);
                          setShowTasks(false);
                          setIsSidebarOpen(false);
                        }}
                        onContextMenu={(e) => handleChannelContextMenu(e, ch)}
                        style={{
                          padding: '12px',
                          fontSize: '16px',
                          cursor: 'pointer',
                          background: ch.id === selectedCh ? '#3366CC' : 'transparent',
                          color: ch.id === selectedCh ? '#FFFFFF' : (ch.muted ? '#999999' : '#000000'),
                          borderRadius: '8px',
                          marginBottom: '4px',
                          minHeight: '44px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>💬 # {ch.name} {ch.channelType === 'private' && '🔒'}{ch.muted && ' 🔇'}</span>
                        {!ch.muted && unreadCounts[ch.id] > 0 && (
                          <span style={{
                            minWidth: '20px',
                            height: '20px',
                            lineHeight: '20px',
                            borderRadius: '10px',
                            background: '#CC3333',
                            color: '#FFFFFF',
                            fontSize: '12px',
                            textAlign: 'center' as const,
                            padding: '0 6px',
                            fontWeight: 'bold',
                          }}>
                            {unreadCounts[ch.id] > 99 ? '99+' : unreadCounts[ch.id]}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                <div style={{ borderTop: "1px solid #DDDDDD", margin: "8px 0" }} />
                {/* Tasks */}
                <div style={{ marginBottom: '16px' }}>
                    <div
                      onClick={() => { setShowTasks(true); setSelectedCh(null); setIsSidebarOpen(false); }}
                      style={{
                        padding: '12px',
                        fontSize: '16px',
                        cursor: 'pointer',
                        background: showTasks ? '#3366CC' : '#F0F0F0',
                        color: showTasks ? '#FFFFFF' : '#000000',
                        borderRadius: '8px',
                        minHeight: '44px',
                        display: 'flex',
                        alignItems: 'center',
                        fontWeight: 'bold',
                      }}
                    >
                      📋 Tasks
                    </div>
                  </div>

                <div style={{ borderTop: "1px solid #DDDDDD", margin: "8px 0" }} />
                {/* Users */}
                {allMembers.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 'bold' }}>Users</span>
                    </div>
                    {allMembers.filter(member => member.id !== user?.id).sort((a, b) => {
                      const order: Record<string, number> = { online: 0, idle: 1, offline: 2 };
                      const sa = order[presence.get(a.id) || 'offline'] ?? 2;
                      const sb = order[presence.get(b.id) || 'offline'] ?? 2;
                      return sa - sb;
                    }).map((member) => {
                      const status = presence.get(member.id) || 'offline';
                      return (
                        <div
                          key={member.id}
                          onClick={() => {
                            handleUserClick(member.id);
                            setIsSidebarOpen(false);
                          }}
                          style={{
                            padding: '12px',
                            fontSize: '16px',
                            cursor: 'pointer',
                            background: 'transparent',
                            color: status === 'offline' ? '#999999' : '#000000',
                            fontStyle: status === 'offline' ? 'italic' : 'normal',
                            borderRadius: '8px',
                            marginBottom: '4px',
                            minHeight: '44px',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            minWidth: '12px',
                            borderRadius: '50%',
                            background: status === 'online'
                              ? 'radial-gradient(circle at 4px 4px, #44dd44, #009900)'
                              : status === 'idle'
                              ? 'radial-gradient(circle at 4px 4px, #ffcc44, #cc9900)'
                              : 'radial-gradient(circle at 4px 4px, #cccccc, #999999)',
                            border: status === 'online' ? '1px solid #007700' : status === 'idle' ? '1px solid #aa7700' : '1px solid #888888',
                            marginRight: '12px',
                            flexShrink: 0,
                          }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block' }}>{member.displayName}</span>
                            {agentStatuses.has(member.id) && (() => {
                              const s = agentStatuses.get(member.id)!;
                              return (
                                <span style={{ display: 'block', fontSize: 12, color: '#777', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'normal' }}>
                                  {s.text}{s.eta ? ` (${s.eta})` : ''}
                                  {s.progress != null && (
                                    <span style={{ display: 'inline-block', width: 48, height: 5, background: '#ddd', borderRadius: 2, marginLeft: 6, verticalAlign: 'middle' }}>
                                      <span style={{ display: 'block', width: `${Math.round(s.progress * 100)}%`, height: '100%', background: '#4488cc', borderRadius: 2 }} />
                                    </span>
                                  )}
                                </span>
                              );
                            })()}
                          </span>
                          {(() => {
                            const sortedIds = [user?.id, member.id].sort();
                            const dmSlug = `dm-${sortedIds[0]}-${sortedIds[1]}`;
                            const dmCh = channels.find(c => c.channelType === 'dm' && c.slug === dmSlug);
                            const count = dmCh ? (unreadCounts[dmCh.id] || 0) : 0;
                            return count > 0 ? (
                              <span style={{
                                minWidth: "20px", height: "20px", borderRadius: "10px",
                                background: status === "offline" ? "#AAAAAA" : "#CC3333", color: "#FFFFFF", fontSize: "11px",
                                fontWeight: "bold", display: "flex", alignItems: "center",
                                justifyContent: "center", padding: "0 6px", flexShrink: 0,
                              }}>
                                {count > 99 ? "99+" : count}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* User info and logout */}
                <div style={{
                  borderTop: '1px solid #999999',
                  paddingTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      color: wsConnected ? '#009900' : '#999999', 
                      fontSize: '12px',
                    }}>●</span>
                    <span style={{ fontSize: '16px' }}>{user?.displayName}</span>
                  </div>
                  <button
                    onClick={logout}
                    style={{
                      background: '#CC3333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '8px 16px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      minHeight: '36px',
                    }}
                  >
                    Logout
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Thread panel (mobile) */}
        {threadMessage && selectedCh && (
          <ThreadPanel
            channelId={selectedCh}
            parentMessage={threadMessage}
            usersMap={usersMap}
            currentUserId={user?.id}
            onClose={() => setThreadMessage(null)}
            newReplyFromWs={threadNewReply}
          />
        )}

        {/* Modals - same as desktop */}
        {contextMenu && (
          <ChannelContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            channel={contextMenu.channel}
            onClose={() => setContextMenu(null)}
            onArchive={handleArchiveChannel}
            onDelete={handleDeleteChannel}
            onInvite={(id) => setInviteChannelId(id)}
            onToggleMute={handleToggleMute}
          />
        )}
        {inviteChannelId && (
          <InviteMemberModal
            channelId={inviteChannelId}
            members={allMembers}
            onClose={() => setInviteChannelId(null)}
          />
        )}
        {showSearch && (
          <SearchPanel
            onClose={() => setShowSearch(false)}
            onNavigate={(channelId, messageId) => {
              setShowTasks(false);
              setShowSearch(false);
              api.getMessagesAround(channelId, messageId, 50).then((msgs) => {
                const sorted = msgs;
                setUsersMap((prev) => {
                  const next = new Map(prev);
                  let changed = false;
                  for (const m of msgs) {
                    if (m.user && !next.has(m.userId)) { next.set(m.userId, { displayName: m.user.displayName, isAgent: m.user.isAgent }); changed = true; }
                  }
                  return changed ? next : prev;
                });
                setMessages(sorted);
                setHasMoreOlder(true);
                skipChannelLoadRef.current = true;
                setSelectedCh(channelId);
                setTimeout(() => {
                  setHighlightMessageId(messageId);
                  setTimeout(() => setHighlightMessageId(null), 4000);
                }, 100);
              }).catch(() => {
                setSelectedCh(channelId);
              });
            }}
          />
        )}
        {showCreateCh && (
          <CreateChannelModal
            onClose={() => setShowCreateCh(false)}
            onCreated={(ch) => { setChannels((prev) => prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]); setSelectedCh(ch.id); setIsSidebarOpen(false); }}
          />
        )}
        {showNewHuddle && (
          <NewHuddleModal
            members={allMembers}
            onClose={() => setShowNewHuddle(false)}
            onCreated={(huddle) => {
              setActiveHuddle(huddle);
              setCurrentHuddleId(huddle.id);
              setShowHuddle(true);
              setHuddleEvents([]);
              setIsSidebarOpen(false);
            }}
          />
        )}
        {showHuddle && currentHuddleId && (
          <HuddleModal
            huddleId={currentHuddleId}
            topic={activeHuddle?.topic || ''}
            createdBy={activeHuddle?.createdBy || ''}
            currentUserId={user?.id}
            usersMap={usersMap}
            onClose={() => setShowHuddle(false)}
            onEnded={() => { setShowHuddle(false); setActiveHuddle(null); setCurrentHuddleId(null); setHuddleEvents([]); }}
            huddleEvents={huddleEvents}
          />
        )}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    );
  }

  // Desktop layout - completely unchanged from original
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#DDDDDD' }}>
      {/* Menu bar */}
      <MenuBar
        showWindow
        showExtras
        onHelpClick={() => setShowHelp(true)}
        onHuddleClick={() => setShowNewHuddle(true)}
        style={{ display: isMobile ? 'none' : 'flex' }}
      />

      {/* Main window */}
      <div className="mac-window" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', margin: isMobile ? 0 : 4, borderRadius: 0 }}>
        {/* Main title bar */}
        <div className="mac-titlebar" style={{ display: isMobile ? 'none' : 'flex' }}>
          <div className="mac-close-box" style={{ display: isMobile ? 'none' : 'block' }} />
          <div style={{ flex: 1, textAlign: 'center' }}>
            Blather
          </div>
        </div>

        {/* Main body: sidebar + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Sidebar - Finder-style navigator */}
          <div style={{ width: isMobile ? undefined : sidebarWidth, display: isMobile ? 'none' : 'flex', flexDirection: 'column', borderRight: '1px solid #999999', background: '#FFFFFF', flexShrink: 0 }}>
            <div className="mac-titlebar" style={{ fontSize: 11 }}>
              <div className="mac-close-box" style={{ width: 10, height: 10 }} />
              <div style={{ flex: 1, textAlign: 'center' }}>📁 Navigator</div>
            </div>

            <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
              {/* Huddle Banner */}
              {activeHuddle && (
                <div style={{
                  background: '#CC3333', color: '#FFFFFF', padding: '4px 8px',
                  fontSize: 11, fontFamily: 'Monaco, IBM Plex Mono, monospace',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, margin: '0 0 4px 0',
                }} onClick={() => {
                  setCurrentHuddleId(activeHuddle.huddleId || activeHuddle.id);
                  setShowHuddle(true);
                  setHuddleEvents([]);
                }}>
                  <span style={{ animation: 'pulse 1s infinite' }}>🔴</span>
                  <span>Huddle: {activeHuddle.topic}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10 }}>Join →</span>
                </div>
              )}

              {/* Channels */}
              <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, fontWeight: "bold" }}>Channels</span>
                    <button
                      className="mac-btn"
                      style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, marginRight: 2 }}
                      onClick={() => setShowSearch(true)}
                      title="Search messages"
                    >🔍</button>
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
                      onClick={() => { setSelectedCh(ch.id); setShowTasks(false); }}
                      onContextMenu={(e) => handleChannelContextMenu(e, ch)}
                      style={{
                        padding: '2px 6px 2px 14px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: ch.id === selectedCh ? '#3366CC' : 'transparent',
                        color: ch.id === selectedCh ? '#FFFFFF' : (ch.muted ? '#999999' : '#000000'),
                        borderRadius: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      💬 # {ch.name} {ch.channelType === 'private' && '🔒'}{ch.muted && ' 🔇'}
                      {!ch.muted && unreadCounts[ch.id] > 0 && (
                        <span style={{
                          display: 'inline-block',
                          marginLeft: 4,
                          minWidth: 14,
                          height: 14,
                          lineHeight: '14px',
                          borderRadius: 7,
                          background: '#CC3333',
                          color: '#FFFFFF',
                          fontSize: 9,
                          textAlign: 'center' as const,
                          padding: '0 3px',
                          fontWeight: 'bold',
                        }}>{unreadCounts[ch.id] > 99 ? '99+' : unreadCounts[ch.id]}</span>
                      )}
                    </div>
                  ))}
                  {channels.filter(ch => ch.channelType !== 'dm').length === 0 && (
                    <div style={{ padding: '2px 6px', fontSize: 11, color: '#999999' }}>No channels</div>
                  )}
                </div>

              {/* Tasks */}
              <div style={{ marginTop: 4, marginBottom: 4 }}>
                  <hr className="mac-separator" />
                  <div
                    onClick={() => { setShowTasks(true); setSelectedCh(null); setIsSidebarOpen(false); }}
                    style={{
                      padding: "2px 6px",
                      fontSize: 12,
                      cursor: "pointer",
                      background: showTasks ? "#3366CC" : "transparent",
                      color: showTasks ? "#FFFFFF" : "#000000",
                      borderRadius: 2,
                      fontWeight: "bold",
                    }}
                  >
                    📋 Tasks
                  </div>
                </div>

              {/* Users */}
              {allMembers.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <hr className="mac-separator" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, fontWeight: 'bold' }}>Users</span>
                  </div>
                  {allMembers.filter(member => member.id !== user?.id).sort((a, b) => {
                    const order: Record<string, number> = { online: 0, idle: 1, offline: 2 };
                    const sa = order[presence.get(a.id) || 'offline'] ?? 2;
                    const sb = order[presence.get(b.id) || 'offline'] ?? 2;
                    return sa - sb;
                  }).map((member) => {
                    const status = presence.get(member.id) || 'offline';
                    return (
                    <div
                      key={member.id}
                      onClick={() => handleUserClick(member.id)}
                      style={{
                        padding: '2px 6px 2px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                        background: 'transparent',
                        color: status === 'offline' ? '#999999' : '#000000',
                        fontStyle: status === 'offline' ? 'italic' : 'normal',
                        borderRadius: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#EEEEEE'}
                      onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        minWidth: 8,
                        borderRadius: '50%',
                        background: status === 'online'
                          ? 'radial-gradient(circle at 3px 3px, #44dd44, #009900)'
                          : status === 'idle'
                          ? 'radial-gradient(circle at 3px 3px, #ffcc44, #cc9900)'
                          : 'radial-gradient(circle at 3px 3px, #cccccc, #999999)',
                        boxShadow: status === 'online'
                          ? '0 0 3px rgba(0,153,0,0.5)'
                          : status === 'idle'
                          ? '0 0 3px rgba(204,153,0,0.4)'
                          : 'none',
                        border: status === 'online' ? '0.5px solid #007700' : status === 'idle' ? '0.5px solid #aa7700' : '0.5px solid #888888',
                        marginRight: 5,
                        flexShrink: 0,
                      }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.displayName}</span>
                        {agentStatuses.has(member.id) && (() => {
                          const s = agentStatuses.get(member.id)!;
                          return (
                            <span style={{ display: 'block', fontSize: 9, color: '#777', lineHeight: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'normal' }}>
                              {s.text}{s.eta ? ` (${s.eta})` : ''}
                              {s.progress != null && (
                                <span style={{ display: 'inline-block', width: 32, height: 4, background: '#ddd', borderRadius: 2, marginLeft: 4, verticalAlign: 'middle' }}>
                                  <span style={{ display: 'block', width: `${Math.round(s.progress * 100)}%`, height: '100%', background: '#4488cc', borderRadius: 2 }} />
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </span>
                      {(() => {
                        const sortedIds = [user?.id, member.id].sort();
                        const dmSlug = `dm-${sortedIds[0]}-${sortedIds[1]}`;
                        const dmCh = channels.find(c => c.channelType === 'dm' && c.slug === dmSlug);
                        const count = dmCh ? (unreadCounts[dmCh.id] || 0) : 0;
                        return count > 0 ? (
                          <span style={{
                            minWidth: "20px", height: "20px", borderRadius: "10px",
                            background: status === 'offline' ? "#AAAAAA" : "#CC3333", color: "#FFFFFF", fontSize: "11px",
                            fontWeight: "bold", display: "flex", alignItems: "center",
                            justifyContent: "center", padding: "0 6px", flexShrink: 0,
                          }}>
                            {count > 99 ? "99+" : count}
                          </span>
                        ) : null;
                      })()}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Resize handle — invisible, sits over the border */}
          {!isMobile && (
            <div
              onMouseDown={onResizeMouseDown}
              style={{
                width: 5,
                marginLeft: -3,
                flexShrink: 0,
                cursor: 'col-resize',
                zIndex: 10,
              }}
            />
          )}

          {/* Chat panel */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FFFFFF' }}>
            {/* Channel title bar */}
            <div className="mac-titlebar" style={{ fontSize: 11, display: isMobile ? 'none' : 'flex' }}>
              <div className="mac-close-box" style={{ width: 10, height: 10, display: isMobile ? 'none' : 'block' }} />
              <div style={{ flex: 1, textAlign: 'center' }}>
                {showTasks ? "📋 Tasks" : selectedChannel ? (() => {
                  if (selectedChannel.channelType === 'dm') {
                    // For DMs, show the other user's display name
                    const uuids = selectedChannel.slug.replace('dm-', '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []; const otherUserId = uuids.find((id: string) => id !== user?.id);
                    const otherUser = allMembers.find(member => member.id === otherUserId);
                    return `💬 ${otherUser?.displayName || 'Unknown User'}`;
                  } else {
                    // For regular channels, show channel name and topic
                    return `# ${selectedChannel.name}${selectedChannel.topic ? ' — ' + selectedChannel.topic : ''}`;
                  }
                })() : 'Select a Channel'}
              </div>
            </div>

            {showTasks ? (
              <TaskPanel members={allMembers} />
            ) : selectedCh ? (
              <>
                <MessageList messages={messages} usersMap={usersMap} currentUserId={user?.id} channelId={selectedCh ?? undefined} onLoadOlder={loadOlderMessages} isLoadingOlder={isLoadingOlder} hasMoreOlder={hasMoreOlder} onEditMessage={handleEditMessage} onDeleteMessage={handleDeleteMessage} onOpenThread={handleOpenThread} highlightMessageId={highlightMessageId} onToggleReaction={handleToggleReaction} />
                <TypingIndicator typingUsers={typingUsers} usersMap={usersMap} currentUserId={user?.id} selectedChannelId={selectedCh} />
                <MessageInput onSend={handleSend} onTyping={handleTyping} disabled={!selectedCh} />
              </>
            ) : (
              <div className="mac-inset" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#999999', margin: 4 }}>
                Select or create a channel
              </div>
            )}
          </div>

          {/* Thread panel */}
          {threadMessage && selectedCh && (
            <ThreadPanel
              channelId={selectedCh}
              parentMessage={threadMessage}
              usersMap={usersMap}
              currentUserId={user?.id}
              onClose={() => setThreadMessage(null)}
              newReplyFromWs={threadNewReply}
            />
          )}
        </div>

        {/* Status bar */}
        <div className="mac-statusbar" style={{ display: isMobile ? 'none' : 'flex' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: wsConnected ? '#009900' : '#999999', fontSize: 8 }}>●</span>
            <span>{wsConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{user?.displayName}</span>
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
      {contextMenu && (
        <ChannelContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          channel={contextMenu.channel}
          onClose={() => setContextMenu(null)}
          onArchive={handleArchiveChannel}
          onDelete={handleDeleteChannel}
          onInvite={(id) => setInviteChannelId(id)}
          onToggleMute={handleToggleMute}
        />
      )}
      {inviteChannelId && (
        <InviteMemberModal
          channelId={inviteChannelId}
          members={allMembers}
          onClose={() => setInviteChannelId(null)}
        />
      )}
      {showSearch && (
        <SearchPanel
          onClose={() => setShowSearch(false)}
          onNavigate={(channelId, messageId) => {
            setShowTasks(false);
            setShowSearch(false);
            // Fetch messages around the target
            api.getMessagesAround(channelId, messageId, 50).then((msgs) => {
              const sorted = msgs;
              setUsersMap((prev) => {
                const next = new Map(prev);
                let changed = false;
                for (const m of msgs) {
                  if (m.user && !next.has(m.userId)) { next.set(m.userId, { displayName: m.user.displayName, isAgent: m.user.isAgent }); changed = true; }
                }
                return changed ? next : prev;
              });
              setMessages(sorted);
              setHasMoreOlder(true);
              skipChannelLoadRef.current = true;
              setSelectedCh(channelId);
              // Delay highlight until after React renders the new messages
              setTimeout(() => {
                setHighlightMessageId(messageId);
                setTimeout(() => setHighlightMessageId(null), 4000);
              }, 100);
            }).catch(() => {
              setSelectedCh(channelId);
            });
          }}
        />
      )}
      {showCreateCh && (
        <CreateChannelModal
          onClose={() => setShowCreateCh(false)}
          onCreated={(ch) => { setChannels((prev) => prev.some((c) => c.id === ch.id) ? prev : [...prev, ch]); setSelectedCh(ch.id); }}
        />
      )}
      {showNewHuddle && (
        <NewHuddleModal
          members={allMembers}
          onClose={() => setShowNewHuddle(false)}
          onCreated={(huddle) => {
            setActiveHuddle(huddle);
            setCurrentHuddleId(huddle.id);
            setShowHuddle(true);
            setHuddleEvents([]);
          }}
        />
      )}
      {showHuddle && currentHuddleId && (
        <HuddleModal
          huddleId={currentHuddleId}
          topic={activeHuddle?.topic || ''}
          createdBy={activeHuddle?.createdBy || ''}
          currentUserId={user?.id}
          usersMap={usersMap}
          onClose={() => setShowHuddle(false)}
          onEnded={() => { setShowHuddle(false); setActiveHuddle(null); setCurrentHuddleId(null); setHuddleEvents([]); }}
          huddleEvents={huddleEvents}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}