import Terminal from "./components/Terminal";
import ControlPanel from "./components/ControlPanel";
import "./App.css";

/**
 * Root App Component
 * Split layout: Terminal (left) + Control Panel (right)
 */
function App() {
  return (
    <div className="app">
      <div className="split-container">
        <div className="panel-left">
          <Terminal />
        </div>
        <div className="panel-right">
          <ControlPanel />
        </div>
      </div>
    </div>
  );
}

export default App;
