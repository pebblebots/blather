interface TypingIndicatorProps {
  typingUsers: Map<string, { timestamp: number; channelId: string }>;
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
  selectedChannelId: string | null;
}

const AGENT_VERBS = [
  'boffinating', 'cogitating', 'ruminating', 'ventriculating', 'scheming',
  'pondering', 'hallucinating', 'confabulating', 'machinating', 'percolating',
  'computing', 'plotting', 'manifesting', 'overcooking', 'yapping',
];

const HUMAN_VERBS = [
  'typing', 'scribbling', 'pecking away', 'mashing keys', 'composing',
  'hunting and pecking', 'yapping', 'cooking something up', 'doing their best',
  'banging on the keyboard', 'thinking out loud', 'wordsmithing',
];

function getVerb(userId: string, isAgent: boolean): string {
  const verbs = isAgent ? AGENT_VERBS : HUMAN_VERBS;
  // Deterministic per user so it doesn't flicker
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return verbs[Math.abs(hash) % verbs.length];
}

export function TypingIndicator({ typingUsers, usersMap, currentUserId, selectedChannelId }: TypingIndicatorProps) {
  const others = Array.from(typingUsers.entries())
    .filter(([key, val]) => val.channelId === selectedChannelId)
    .map(([key]) => key.split(':')[1])
    .filter(id => id !== currentUserId);
  if (others.length === 0) return <div style={{ height: 18, padding: '0 10px', fontSize: 11 }} />;

  const getName = (id: string) => usersMap.get(id)?.displayName ?? id.slice(0, 8);
  const isAgent = (id: string) => usersMap.get(id)?.isAgent ?? false;

  let text: string;
  if (others.length === 1) {
    const id = others[0];
    text = `${getName(id)} is ${getVerb(id, isAgent(id))}`;
  } else if (others.length === 2) {
    text = `${getName(others[0])} and ${getName(others[1])} are going at it`;
  } else {
    text = `${others.length} people are having a moment`;
  }

  return (
    <div style={{
      height: 18,
      padding: '0 10px',
      fontSize: 11,
      fontFamily: "'Monaco', 'IBM Plex Mono', monospace",
      color: '#666666',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    }}>
      <span className="typing-dots">
        <span>●</span><span>●</span><span>●</span>
      </span>
      {' '}{text}
    </div>
  );
}
