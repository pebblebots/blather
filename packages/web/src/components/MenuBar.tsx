import { useEffect, useRef, useState } from 'react'

export default function MenuBar(props: {
  onNewChannel: () => void
  onExportChat: () => void
  onLogout: () => void
  onSearch: () => void
  onToggleTasks: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey) }
  }, [])

  const toggle = (name: string) => setOpen(o => o === name ? null : name)
  const hover = (name: string) => { if (open) setOpen(name) }
  const close = () => setOpen(null)

  return (
    <div className="mac-menubar" ref={rootRef}>
      <span style={{ fontSize: 14 }}>🍎</span>

      <div className="menu-label" onClick={() => toggle('File')} onMouseEnter={() => hover('File')}>
        File
        {open === 'File' && (
          <div className="menu-dropdown">
            <div className="menu-item" onClick={() => { props.onNewChannel(); close() }}>New Channel<span className="menu-hint">⌘N</span></div>
            <div className="menu-item" onClick={() => { props.onExportChat(); close() }}>Export Chat History<span className="menu-hint">⤓</span></div>
            <div className="menu-item" onClick={() => { alert('Coming soon'); close() }}>Preferences...<span className="menu-hint">⌘,</span></div>
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { props.onLogout(); close() }}>Logout</div>
          </div>
        )}
      </div>

      <div className="menu-label" onClick={() => toggle('Edit')} onMouseEnter={() => hover('Edit')}>
        Edit
        {open === 'Edit' && (
          <div className="menu-dropdown">
            <div className="menu-item" onClick={() => { props.onSearch(); close() }}>Find<span className="menu-hint">⌘K</span></div>
            <div className="menu-sep" />
            <div className="menu-item disabled">Cut<span className="menu-hint">⌘X</span></div>
            <div className="menu-item disabled">Copy<span className="menu-hint">⌘C</span></div>
            <div className="menu-item disabled">Paste<span className="menu-hint">⌘V</span></div>
          </div>
        )}
      </div>

      <div className="menu-label" onClick={() => toggle('View')} onMouseEnter={() => hover('View')}>
        View
        {open === 'View' && (
          <div className="menu-dropdown">
            <div className="menu-item" onClick={() => { props.onToggleTasks(); close() }}>Toggle Tasks Panel</div>
            <div className="menu-sep" />
            <div className="menu-item disabled">Theme ▸</div>
          </div>
        )}
      </div>

      <div className="menu-label" onClick={() => toggle('Window')} onMouseEnter={() => hover('Window')}>
        Window
        {open === 'Window' && (
          <div className="menu-dropdown">
            <div className="menu-item disabled">Minimize</div>
            <div className="menu-item disabled">Zoom</div>
          </div>
        )}
      </div>

      <div className="menu-label" onClick={() => toggle('Help')} onMouseEnter={() => hover('Help')}>
        Help
        {open === 'Help' && (
          <div className="menu-dropdown">
            <div className="menu-item" onClick={() => { alert('Shortcuts:\n⌘K — Search\nEnter — Send message\nEsc — Close panels'); close() }}>Keyboard Shortcuts</div>
            <div className="menu-item" onClick={() => { alert('Blather v1.0\nA retro Mac-style chat app'); close() }}>About Blather</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />
      <span style={{ fontWeight: 'normal', fontSize: 11 }}>⌘</span>
    </div>
  )
}
