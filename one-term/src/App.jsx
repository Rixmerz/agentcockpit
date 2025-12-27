import Terminal from "./components/Terminal";
import "./App.css";

/**
 * Root App Component
 * Renders the Terminal application with integrated xterm
 */
function App() {
  return (
    <div className="app">
      <Terminal />
    </div>
  );
}

export default App;
