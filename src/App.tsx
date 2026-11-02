import { useEffect, useState } from 'react';
import { useOllama, usePersistent } from './store';
import { ChatView } from './views/ChatView';
import { ModelsView } from './views/ModelsView';
import { DiscoverView } from './views/DiscoverView';
import { useDownloads } from './downloads';
import { DeveloperView, developerFocus } from './views/DeveloperView';
import { AgentsView } from './views/AgentsView';
import { Bot, CalendarClock, FolderOpen, ImageIcon, MessageSquare, Settings, Telescope, Workflow } from './components/icons';
import { WorkspaceView } from './views/WorkspaceView';
import { SchedulerView } from './views/SchedulerView';
import { ImagesView } from './views/ImagesView';
import { UpdatesView } from './views/UpdatesView';
import { startScheduler, useScheduler } from './scheduler';
import { start as startImages } from './images';
import { chatController, openChatRequest, streaming } from './session';
import { ContextMenuProvider } from './components/ContextMenu';
import { Logo } from './components/Logo';
import { isElectron, isMac } from './platform';
import { UpdateButton } from './components/UpdateButton';
import { ProfileButton } from './components/ProfileButton';
import { LightboxHost } from './components/Lightbox';
import { LockScreen } from './components/LockScreen';
import { Tutorial } from './components/Tutorial';
import { host, type ProfileInfo } from './host';
import { syncProfile } from './profile';
import { startUpdateChecks } from './updates';

type View = 'chat' | 'orchestrator' | 'scheduler' | 'agents' | 'images' | 'models' | 'discover' | 'developer' | 'updates';

const NAV: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'orchestrator', label: 'Orchestrator', icon: Workflow },
  { id: 'scheduler', label: 'Scheduler', icon: CalendarClock },
  { id: 'agents', label: 'Agents & Skills', icon: Bot },
  { id: 'images', label: 'Images', icon: ImageIcon },
  { id: 'developer', label: 'Options', icon: Settings },
  { id: 'models', label: 'My Models', icon: FolderOpen },
  { id: 'discover', label: 'Discover', icon: Telescope },
];


/** Opens the app, or the lock screen first when this window's profile has a password. */
export default function App() {
  const [gate, setGate] = useState<{ profile: ProfileInfo; locked: boolean } | null>(null);
  const [ready, setReady] = useState(!host());
  useEffect(() => {
    host()?.profiles.current().then((p) => {
      setGate({ profile: p, locked: p.locked });
      setReady(true);
    }).catch(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (gate?.locked) return <LockScreen profile={gate.profile} onUnlocked={() => setGate({ ...gate, locked: false })} />;
  return <Main />;
}

function Main() {
  const [view, setView] = usePersistent<View>('ollama-gui.view', 'chat');
  const ollama = useOllama();
  const dl = useDownloads(ollama.refresh);
  const [showBanner, setShowBanner] = useState(true);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const chatWith = (model: string) => {
    setPendingModel(model);
    setView('chat');
  };
  const chatWithAgent = (agentId: string) => {
    setPendingAgent(agentId);
    setView('chat');
  };
  const pulling = Object.values(dl.downloads).some((d) => d.state === 'downloading');
  const running = !!streaming.use();
  useEffect(startUpdateChecks, []);
  useEffect(startScheduler, []);
  useEffect(startImages, []);
  useEffect(() => {
    syncProfile();
  }, []);
  const scheduler = useScheduler();
  const openChat = (convId: string) => {
    chatController.current?.openChat(convId);
    setView('chat');
  };
  // A notification (or the scheduler) asked to show a chat.
  const chatRequest = openChatRequest.use();
  useEffect(() => {
    if (!chatRequest) return;
    openChat(chatRequest);
    openChatRequest.set(null);
  }, [chatRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ContextMenuProvider>
    <div className={`app ${isElectron && isMac ? 'mac-inset' : ''}`}>
      <nav className="rail">
        <div className="rail-logo" title="Penumbra"><Logo size={24} /></div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`rail-btn ${view === id ? 'active' : ''}`} onClick={() => setView(id)} title={label}>
            <Icon size={19} />
            {id === 'discover' && pulling && <span className="rail-dot" />}
            {id === 'chat' && running && view !== 'chat' && <span className="rail-dot" />}
            {id === 'scheduler' && scheduler.running && view !== 'scheduler' && <span className="rail-dot" />}
          </button>
        ))}
        <span className="flex" />
        <UpdateButton active={view === 'updates'} onOpen={() => setView('updates')} />
        <ProfileButton />
        <div className={`rail-status ${ollama.connected ? 'on' : ollama.connected === false ? 'off' : ''}`} title={ollama.connected ? `Ollama v${ollama.version}` : 'Ollama not reachable'} />
      </nav>

      <div className="content">
        {ollama.connected === false && showBanner && (
          <div className="banner error top">
            Can't reach the Ollama server. Is it running? Check the URL in <button className="link" onClick={() => setView('developer')}>Options</button>.
            <button className="link" onClick={() => setShowBanner(false)}>Dismiss</button>
          </div>
        )}
        <div className="content-inner">
          {/* The chat stays mounted on other tabs, so replies and orchestrator runs keep streaming. */}
          <div className="view-host" style={{ display: view === 'chat' ? 'contents' : 'none' }}>
            <ChatView
              ollama={ollama}
              pendingModel={pendingModel}
              pendingAgent={pendingAgent}
              onPendingHandled={() => { setPendingModel(null); setPendingAgent(null); }}
              onManageAgents={() => setView('agents')}
              onInternetSettings={() => { developerFocus.section = 'internet-access'; setView('developer'); }}
            />
          </div>
          {view === 'orchestrator' && (
            <WorkspaceView
              ollama={ollama}
              onOpenChat={(id) => {
                chatController.current?.openChat(id);
                setView('chat');
              }}
            />
          )}
          {view === 'scheduler' && <SchedulerView ollama={ollama} onOpenChat={openChat} />}
          {view === 'images' && <ImagesView />}
          {view === 'agents' && <AgentsView ollama={ollama} onChatWithAgent={chatWithAgent} />}
          {view === 'models' && <ModelsView ollama={ollama} onChatWith={chatWith} />}
          {view === 'discover' && <DiscoverView ollama={ollama} dl={dl} />}
          {view === 'developer' && <DeveloperView ollama={ollama} onOpenUpdates={() => setView('updates')} />}
          {view === 'updates' && <UpdatesView />}
        </div>
      </div>
    <LightboxHost />
    <Tutorial setView={(v) => setView(v as View)} />
    </div>
    </ContextMenuProvider>
  );
}
