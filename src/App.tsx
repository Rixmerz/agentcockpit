import { AppProvider } from './contexts/AppContext';
import { PluginProvider } from './plugins/context/PluginContext';

import { claudePlugin } from './agents/claude';
import { cursorAgentPlugin } from './agents/cursor-agent';
import { geminiPlugin } from './agents/gemini-cli';
import { AppShell } from './layouts/AppShell';
import './App.css';

function App() {
  return (
    <AppProvider>
      <PluginProvider initialPlugins={[claudePlugin, cursorAgentPlugin, geminiPlugin]}>
        <AppShell />
      </PluginProvider>
    </AppProvider>
  );
}

export default App;
