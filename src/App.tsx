import { useState } from 'react';
import { useOllama, usePersistent } from './store';
import { ChatView } from './views/ChatView';
import { ModelsView } from './views/ModelsView';
import { DiscoverView } from './views/DiscoverView';
import { useDownloads } from './downloads';
import { DeveloperView } from './views/DeveloperView';
import { FolderOpen, MessageSquare, Telescope, Terminal } from './components/icons';
import { ContextMenuProvider } from './components/ContextMenu';
import { Logo } from './components/Logo';
import { isElectron, isMac } from './platform';

type View = 'chat' | 'models' | 'discover' | 'developer';

const NAV: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'developer', label: 'Developer', icon: Terminal },
  { id: 'models', label: 'My Models', icon: FolderOpen },
  { id: 'discover', label: 'Discover', icon: Telescope },
];


export default function App() {
  const [view, setView] = usePersistent<View>('ollama-gui.view', 'chat');
  const ollama = useOllama();
  const dl = useDownloads(ollama.refresh);
  const [showBanner, setShowBanner] = useState(true);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const chatWith = (model: string) => {
    setPendingModel(model);
    setView('chat');
  };
  const pulling = Object.values(dl.downloads).some((d) => d.state === 'downloading');

  return (
    <ContextMenuProvider>
    <div className={`app ${isElectron && isMac ? 'mac-inset' : ''}`}>
      <nav className="rail">
        <div className="rail-logo" title="Penumbra"><Logo size={24} /></div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`rail-btn ${view === id ? 'active' : ''}`} onClick={() => setView(id)} title={label}>
            <Icon size={19} />
            {id === 'discover' && pulling && <span className="rail-dot" />}
          </button>
        ))}
        <span className="flex" />
        <div className={`rail-status ${ollama.connected ? 'on' : ollama.connected === false ? 'off' : ''}`} title={ollama.connected ? `Ollama v${ollama.version}` : 'Ollama not reachable'} />
      </nav>

      <div className="content">
        {ollama.connected === false && showBanner && (
          <div className="banner error top">
            Can't reach the Ollama server. Is it running? Check the URL in <button className="link" onClick={() => setView('developer')}>Developer</button>.
            <button className="link" onClick={() => setShowBanner(false)}>Dismiss</button>
          </div>
        )}
        <div className="content-inner">
          {view === 'chat' && <ChatView ollama={ollama} pendingModel={pendingModel} onPendingHandled={() => setPendingModel(null)} />}
          {view === 'models' && <ModelsView ollama={ollama} onChatWith={chatWith} />}
          {view === 'discover' && <DiscoverView ollama={ollama} dl={dl} />}
          {view === 'developer' && <DeveloperView ollama={ollama} />}
        </div>
      </div>
    </div>
    </ContextMenuProvider>
  );
}
