import type { CSSProperties } from 'react'

export interface MenuBarProps {
  /** Show "Window" menu item (MainPage only) */
  showWindow?: boolean
  /** Called when Help is clicked */
  onHelpClick?: () => void
  /** Called when huddle mic is clicked */
  onHuddleClick?: () => void
  /** Show the huddle mic + command icon on the right */
  showExtras?: boolean
  /** Additional inline styles on the root div */
  style?: CSSProperties
}

export default function MenuBar({
  showWindow = false,
  onHelpClick,
  onHuddleClick,
  showExtras = false,
  style,
}: MenuBarProps) {
  return (
    <div className="mac-menubar" style={style}>
      <span style={{ fontSize: 14 }}>🍎</span>
      <span>File</span>
      <span>Edit</span>
      <span>View</span>
      {showWindow && <span>Window</span>}
      <span
        onClick={onHelpClick}
        style={onHelpClick ? { cursor: 'pointer' } : undefined}
      >
        Help
      </span>
      <div style={{ flex: 1 }} />
      {showExtras && (
        <>
          <span
            onClick={onHuddleClick}
            style={{ cursor: 'pointer', fontSize: 13 }}
            title="Start a Huddle"
          >
            🎙️
          </span>
          <span style={{ fontWeight: 'normal', fontSize: 11 }}>⌘</span>
        </>
      )}
    </div>
  )
}
