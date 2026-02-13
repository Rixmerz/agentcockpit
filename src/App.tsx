import { AppProvider } from './contexts/AppContext';
import { PluginProvider } from './plugins/context/PluginContext';
import { MediaProvider } from './contexts/MediaContext';
import { claudePlugin } from './agents/claude';
import { cursorAgentPlugin } from './agents/cursor-agent';
import { geminiPlugin } from './agents/gemini-cli';
import { AppShell } from './layouts/AppShell';
import './App.css';

function App() {
  return (
    <AppProvider>
      <MediaProvider>
        <PluginProvider initialPlugins={[claudePlugin, cursorAgentPlugin, geminiPlugin]}>
          <AppShell />
        </PluginProvider>
      </MediaProvider>
    </AppProvider>
  );
}

export default App;
