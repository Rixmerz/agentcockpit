import { AppProvider } from './contexts/AppContext';
import { PluginProvider } from './plugins/context/PluginContext';

import { claudePlugin } from './agents/claude';
import { agentfulPlugin } from './agents/agentful';
import { cursorAgentPlugin } from './agents/cursor-agent';
import { geminiPlugin } from './agents/gemini-cli';
import { AppShell } from './layouts/AppShell';
import './App.css';

function App() {
  return (
    <AppProvider>
      <PluginProvider initialPlugins={[claudePlugin, agentfulPlugin, cursorAgentPlugin, geminiPlugin]}>
        <AppShell />
      </PluginProvider>
    </AppProvider>
  );
}

export default App;
