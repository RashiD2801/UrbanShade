import React from 'react'
import { useStore } from './store.js'
import AreaPicker from './components/AreaPicker.jsx'
import SplitViewer from './components/SplitViewer.jsx'

export default function App() {
  const phase = useStore((s) => s.phase)
  const error = useStore((s) => s.error)

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {error && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 999, background: '#ef4444', color: '#fff',
          padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
        }}>
          {error}
        </div>
      )}
      {phase === 'picker' && <AreaPicker />}
      {phase === 'viewer' && <SplitViewer />}
    </div>
  )
}
