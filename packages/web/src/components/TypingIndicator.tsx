interface TypingIndicatorProps {
  typingUsers: Map<string, number>;
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
  selectedChannelId: string | null;
}

export function TypingIndicator({ typingUsers, usersMap, currentUserId }: TypingIndicatorProps) {
  const others = Array.from(typingUsers.keys()).filter(id => id !== currentUserId);
  if (others.length === 0) return <div style={{ height: 18, padding: '0 10px', fontSize: 11 }} />;

  const names = others.map(id => {
    const u = usersMap.get(id);
    return u?.displayName ?? id.slice(0, 8);
  });

  const isAgent = others.some(id => usersMap.get(id)?.isAgent);

  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is ${isAgent ? 'boffinating' : 'typing'}`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are ${isAgent ? 'ventriculating' : 'typing'}`;
  } else {
    text = `${names.length} users are typing`;
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
