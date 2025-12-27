import React, { useState, useEffect, useRef } from "react";
import { executeCommand, onClaudeEvents, ClaudeEvent } from "../services/tauriService";
import styles from "./ControlPanel.module.css";

/**
 * ControlPanel Component
 * UI panel with tmux control buttons
 */
export function ControlPanel() {
  const [mensaje, setMensaje] = useState("");
  const [sessionName, setSessionName] = useState("one-term");
  const [status, setStatus] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("sonnet");
  const [showMcpConfig, setShowMcpConfig] = useState(false);
  const [mcpList, setMcpList] = useState<string[]>([]);
  const [mcpConfigs, setMcpConfigs] = useState<Record<string, unknown>>({});
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpJson, setNewMcpJson] = useState("");
  const [mcpToDelete, setMcpToDelete] = useState<string | null>(null);
  const [showClaudeLauncher, setShowClaudeLauncher] = useState(false);
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set());
  const [codeMcpList, setCodeMcpList] = useState<string[]>([]);
  const [desktopMcpList, setDesktopMcpList] = useState<string[]>([]);
  const [desktopMcpConfigs, setDesktopMcpConfigs] = useState<Record<string, unknown>>({});
  const [workingDir, setWorkingDir] = useState("~");
  const [pathInput, setPathInput] = useState("");
  const [pathOutput, setPathOutput] = useState("");
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [claudeEvents, setClaudeEvents] = useState<ClaudeEvent[]>([]);
  const [showClaudeMonitor, setShowClaudeMonitor] = useState(false);
  // Chat history state - usando number para timestamp (mejor serialización)
  const [chatHistory, setChatHistory] = useState<Array<{role: "user" | "claude", content: string, timestamp: number}>>([]);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // Cargar chat history del localStorage al montar
  useEffect(() => {
    const saved = localStorage.getItem("chatHistory");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        console.log("📚 Chat cargado:", parsed.length, "mensajes");
        setChatHistory(parsed);
      } catch (e) {
        console.error("Error loading chat:", e);
      }
    }
  }, []);

  // Guardar chat history en localStorage cuando cambie
  useEffect(() => {
    if (chatHistory.length > 0) {
      console.log("💾 Guardando chat:", chatHistory.length, "mensajes");
      localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
    }
  }, [chatHistory]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Listen for Claude events (solo para el monitor, NO para chat)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    onClaudeEvents((events) => {
      setClaudeEvents((prev) => {
        const updated = [...prev, ...events];
        return updated.slice(-100);
      });
    }).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const MCP_DESKTOP_PATH = "~/Library/Application\\ Support/Claude/claude_desktop_config.json";
  const MCP_CODE_PATH = "~/.claude.json";
  const [activeConfigPath, setActiveConfigPath] = useState(MCP_DESKTOP_PATH);
  const [activeConfigName, setActiveConfigName] = useState("Desktop");

  // Execute tmux command and show status
  const runTmuxCommand = async (cmd: string) => {
    try {
      setStatus("Ejecutando...");
      await executeCommand(cmd);
      setStatus("OK");
      setTimeout(() => setStatus(null), 2000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${msg}`);
    }
  };

  // Open Claude launcher with MCP selector
  const openClaudeLauncher = async () => {
    try {
      // Initialize working directory
      await initWorkingDir();

      // Load Code MCPs (default, always included)
      const codeOutput = await executeCommand(`cat ${MCP_CODE_PATH}`);
      const codeConfig = JSON.parse(codeOutput);
      const codeServers = Object.keys(codeConfig.mcpServers || {});
      setCodeMcpList(codeServers);

      // Load Desktop MCPs (optional, to add)
      const desktopOutput = await executeCommand(`cat ${MCP_DESKTOP_PATH}`);
      const desktopConfig = JSON.parse(desktopOutput);
      const desktopServers = desktopConfig.mcpServers || {};
      setDesktopMcpList(Object.keys(desktopServers));
      setDesktopMcpConfigs(desktopServers);

      setSelectedMcps(new Set()); // Start with none selected
      setPathOutput(""); // Clear previous output
      setPathInput("");
      setShowClaudeLauncher(true);
      setStatus(`Code: ${codeServers.length} MCPs | Desktop: ${Object.keys(desktopServers).length} disponibles`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error cargando configs: ${msg}`);
    }
  };

  // Just launch claude without additional MCPs
  const launchClaudeSimple = async () => {
    setShowClaudeLauncher(false);

    // CD to working directory first
    if (workingDir && workingDir !== "~") {
      await executeCommand(`tmux send-keys -t ${sessionName}:0 "cd '${workingDir}'" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
      await new Promise(r => setTimeout(r, 300));
    }

    runTmuxCommand(`tmux send-keys -t ${sessionName}:0 "claude" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
    setStatus(`Claude en ${workingDir} (solo MCPs de Code)`);
  };

  // Path navigation functions
  const executePathCommand = async (cmd: string) => {
    const trimmedCmd = cmd.trim();
    if (!trimmedCmd) return;

    try {
      if (trimmedCmd === "pwd") {
        const result = await executeCommand(`cd ${workingDir} && pwd`);
        setPathOutput(result.trim());
      } else if (trimmedCmd.startsWith("cd ")) {
        const newPath = trimmedCmd.slice(3).trim();
        const fullPath = newPath.startsWith("/") || newPath.startsWith("~")
          ? newPath
          : `${workingDir}/${newPath}`;
        // Verify path exists
        const resolved = await executeCommand(`cd ${fullPath} 2>/dev/null && pwd`);
        if (resolved.trim()) {
          setWorkingDir(resolved.trim());
          setPathOutput(`→ ${resolved.trim()}`);
        } else {
          setPathOutput(`❌ No existe: ${fullPath}`);
        }
      } else if (trimmedCmd === "ls") {
        const result = await executeCommand(`cd ${workingDir} && ls -1`);
        setPathOutput(result.trim() || "(vacío)");
      } else if (trimmedCmd.startsWith("ls ")) {
        const path = trimmedCmd.slice(3).trim();
        const result = await executeCommand(`cd ${workingDir} && ls -1 ${path} 2>/dev/null || echo "No existe"`);
        setPathOutput(result.trim());
      } else {
        setPathOutput(`Comandos: cd, ls, pwd`);
      }
    } catch (error) {
      setPathOutput(`Error: ${error}`);
    }
    setPathInput("");
  };

  // Tab autocomplete
  const handlePathKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const input = pathInput.trim();

      // Get the path part to complete
      let pathToComplete = input;
      let prefix = "";

      if (input.startsWith("cd ")) {
        prefix = "cd ";
        pathToComplete = input.slice(3);
      } else if (input.startsWith("ls ")) {
        prefix = "ls ";
        pathToComplete = input.slice(3);
      }

      try {
        const basePath = pathToComplete.includes("/")
          ? pathToComplete.substring(0, pathToComplete.lastIndexOf("/") + 1)
          : "";
        const partial = pathToComplete.includes("/")
          ? pathToComplete.substring(pathToComplete.lastIndexOf("/") + 1)
          : pathToComplete;

        const searchDir = basePath
          ? (basePath.startsWith("/") || basePath.startsWith("~") ? basePath : `${workingDir}/${basePath}`)
          : workingDir;

        const result = await executeCommand(`cd ${searchDir} 2>/dev/null && ls -1 | grep "^${partial}" | head -10`);
        const matches = result.trim().split("\n").filter(Boolean);

        if (matches.length === 1) {
          // Single match - complete it
          const isDir = await executeCommand(`cd ${searchDir} && test -d "${matches[0]}" && echo "dir"`);
          const suffix = isDir.trim() === "dir" ? "/" : "";
          setPathInput(`${prefix}${basePath}${matches[0]}${suffix}`);
          setPathSuggestions([]);
        } else if (matches.length > 1) {
          // Multiple matches - show suggestions
          setPathSuggestions(matches);
        }
      } catch {
        // Ignore autocomplete errors
      }
    } else if (e.key === "Enter") {
      executePathCommand(pathInput);
      setPathSuggestions([]);
    } else {
      setPathSuggestions([]);
    }
  };

  // Open Finder at current path
  const openFinder = async () => {
    try {
      await executeCommand(`open "${workingDir}"`);
      setStatus(`Finder abierto en ${workingDir}`);
    } catch {
      setStatus("Error abriendo Finder");
    }
  };

  // Initialize working directory
  const initWorkingDir = async () => {
    try {
      const pwd = await executeCommand("pwd");
      setWorkingDir(pwd.trim());
    } catch {
      setWorkingDir("~");
    }
  };

  // Toggle MCP selection
  const toggleMcpSelection = (mcp: string) => {
    setSelectedMcps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mcp)) {
        newSet.delete(mcp);
      } else {
        newSet.add(mcp);
      }
      return newSet;
    });
  };

  // Select/deselect all Desktop MCPs
  const selectAllMcps = () => {
    if (selectedMcps.size === desktopMcpList.length) {
      setSelectedMcps(new Set());
    } else {
      setSelectedMcps(new Set(desktopMcpList));
    }
  };

  // Launch claude with selected Desktop MCPs
  const launchClaudeWithMcps = async () => {
    setShowClaudeLauncher(false);

    if (selectedMcps.size === 0) {
      launchClaudeSimple();
      return;
    }

    setStatus(`Agregando ${selectedMcps.size} MCPs de Desktop...`);

    // Add each selected Desktop MCP using claude mcp add-json
    try {
      for (const mcpName of selectedMcps) {
        const config = desktopMcpConfigs[mcpName];
        if (config) {
          const jsonStr = JSON.stringify(config);
          // Escape single quotes for shell
          const escapedJson = jsonStr.replace(/'/g, "'\\''");
          await executeCommand(`tmux send-keys -t ${sessionName}:0 "claude mcp add-json ${mcpName} '${escapedJson}'" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // CD to working directory first
      if (workingDir && workingDir !== "~") {
        await executeCommand(`tmux send-keys -t ${sessionName}:0 "cd '${workingDir}'" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
        await new Promise(r => setTimeout(r, 300));
      }

      // Finally launch claude
      await new Promise(r => setTimeout(r, 500));
      runTmuxCommand(`tmux send-keys -t ${sessionName}:0 "claude" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
      setStatus(`Claude en ${workingDir} con ${codeMcpList.length} Code + ${selectedMcps.size} Desktop MCPs`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${msg}`);
    }
  };

  // Detectar si una línea es basura de UI
  const isJunkLine = (text: string): boolean => {
    return text.includes('──') ||
           text.includes('━━') ||
           text.includes('? for shortcuts') ||
           text.includes('esc to interrupt') ||
           text.includes('ctrl+g') ||
           text.includes('↵ send') ||
           text.includes('[one-term]') ||
           text.includes('/model') ||
           text.length < 3;
  };

  // Capturar respuesta de Claude desde snapshot de tmux
  const captureClaudeResponse = async (): Promise<string | null> => {
    try {
      const output = await executeCommand(`tmux capture-pane -t ${sessionName}:0 -p -S -50`);

      // Buscar líneas con marcador ⏺ (respuesta Claude)
      const lines = output.split('\n');
      const responseLines: string[] = [];
      let capturing = false;

      // Recorrer desde abajo hacia arriba para encontrar la última respuesta
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const trimmed = line.trim();

        // Parar si llegamos al prompt del usuario (>)
        if (trimmed.startsWith('>') && capturing) break;

        // Empezar a capturar si encontramos marcador ⏺
        if (trimmed.includes('⏺')) {
          capturing = true;
          const clean = trimmed.replace(/⏺/g, '').trim();
          if (clean && !isJunkLine(clean)) {
            responseLines.unshift(clean);
          }
        } else if (capturing && trimmed && !isJunkLine(trimmed)) {
          // Continuar capturando líneas de respuesta
          responseLines.unshift(trimmed);
        }
      }

      const result = responseLines.join('\n').trim();
      console.log("📥 Respuesta capturada:", result);
      return result.length > 0 ? result : null;
    } catch (error) {
      console.error("Error capturando respuesta:", error);
      return null;
    }
  };

  // Button: Send custom message + Enter + Enter
  const sendMensaje = async () => {
    if (!mensaje.trim()) {
      setStatus("Escribe un mensaje primero");
      return;
    }
    const userMessage = mensaje.trim();
    console.log("📤 Enviando mensaje:", userMessage);

    // 1. Agregar mensaje del usuario al chat inmediatamente
    setChatHistory((prev) => [...prev, { role: "user", content: userMessage, timestamp: Date.now() }]);

    // 2. Enviar a tmux
    const escapedMsg = mensaje.replace(/"/g, '\\"');
    await executeCommand(`tmux send-keys -t ${sessionName}:0 "${escapedMsg}" C-m && sleep 0.2 && tmux send-keys -t ${sessionName}:0 C-m`);

    // Clear input y mostrar feedback
    setMensaje("");
    setStatus("⏳ Esperando respuesta...");

    // 3. Esperar 3 segundos y capturar respuesta
    setTimeout(async () => {
      const response = await captureClaudeResponse();
      if (response) {
        setChatHistory((prev) => [...prev, { role: "claude", content: response, timestamp: Date.now() }]);
        setStatus("✓ Respuesta recibida");
      } else {
        setStatus("✓ Mensaje enviado (sin respuesta detectada)");
      }
    }, 3000);
  };

  // Button: Send Escape + Shift+Tab
  const sendEscapeTab = () => {
    runTmuxCommand(`tmux send-keys -t ${sessionName} C-[ "[Z"`);
  };

  // Button: Send Ctrl+C
  const sendCtrlC = () => {
    runTmuxCommand(`tmux send-keys -t ${sessionName}:0 C-c`);
  };

  // Button: Send Escape
  const sendEscape = () => {
    runTmuxCommand(`tmux send-keys -t ${sessionName}:0 Escape`);
  };

  // Button: Send /model command
  const sendModel = () => {
    runTmuxCommand(`tmux send-keys -t ${sessionName}:0 "/model ${selectedModel}" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);
  };

  // Button: Send claude mcp list and capture output
  const sendMcpList = async () => {
    try {
      setStatus("Enviando claude mcp list...");
      // Send the command
      await executeCommand(`tmux send-keys -t ${sessionName}:0 "claude mcp list" && sleep 0.1 && tmux send-keys -t ${sessionName}:0 C-m`);

      // Poll for completion by checking pane content
      const checkOutput = async (): Promise<string | null> => {
        const output = await executeCommand(`tmux capture-pane -t ${sessionName}:0 -p -S -50`);
        // Check if command completed (prompt appeared after mcp list output)
        if (output.includes("Connected") && (output.includes("❯") || output.includes("$") || output.includes("desktop"))) {
          return output;
        }
        return null;
      };

      // Poll every second for up to 15 seconds
      let attempts = 0;
      const maxAttempts = 15;

      const poll = async () => {
        attempts++;
        setStatus(`Esperando resultado... (${attempts}s)`);

        const result = await checkOutput();
        if (result) {
          // Clean ANSI codes and extract only MCP server lines
          const cleanLine = (line: string) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]|\^?\[\[?[A-Z]/g, "").trim();

          const lines = result.split("\n").map(cleanLine);

          // Only keep lines that match MCP pattern: "name: url/command - ✓/✗ Status"
          const mcpLines = lines.filter(line =>
            (line.includes("✓ Connected") || line.includes("✗ Failed") || line.includes("- Connected") || line.includes("- Failed")) &&
            line.includes(":")
          );

          // Remove duplicates
          const uniqueMcps = [...new Set(mcpLines)];

          if (uniqueMcps.length > 0) {
            setStatus(uniqueMcps.join("\n"));
          } else {
            setStatus("MCP list completado (ver terminal)");
          }
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
        } else {
          setStatus("Timeout - revisa la terminal");
        }
      };

      // Start polling after 2 seconds initial delay
      setTimeout(poll, 2000);

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${msg}`);
    }
  };

  // Button: List tmux sessions
  const listSessions = async () => {
    try {
      setStatus("Listando sesiones...");
      const output = await executeCommand("tmux list-sessions 2>/dev/null || echo 'No hay sesiones tmux'");
      setStatus(output.trim());
    } catch {
      setStatus("No hay sesiones tmux activas");
    }
  };

  // Load MCP config and list servers
  const loadMcpConfig = async (configPath: string, configName: string, showPanel = true) => {
    try {
      setStatus(`Cargando ${configName}...`);
      setActiveConfigPath(configPath);
      setActiveConfigName(configName);
      const output = await executeCommand(`cat ${configPath}`);
      const config = JSON.parse(output);
      const servers = config.mcpServers || {};
      setMcpList(Object.keys(servers));
      setMcpConfigs(servers);
      if (showPanel) {
        setShowMcpConfig(true);
      }
      setStatus(`${Object.keys(servers).length} MCPs en ${configName}`);
      return servers;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error al cargar config: ${msg}`);
      return {};
    }
  };

  // Wrappers for each config type
  const loadDesktopConfig = () => loadMcpConfig(MCP_DESKTOP_PATH, "Desktop", true);
  const loadCodeConfig = () => loadMcpConfig(MCP_CODE_PATH, "Code", true);

  // Validate MCP JSON structure
  const validateMcpJson = (jsonStr: string): { valid: boolean; error?: string; config?: Record<string, unknown> } => {
    const trimmed = jsonStr.trim();

    // Check starts with {
    if (!trimmed.startsWith("{")) {
      return { valid: false, error: "JSON debe empezar con {" };
    }

    // Check ends with }
    if (!trimmed.endsWith("}")) {
      return { valid: false, error: "JSON debe terminar con }" };
    }

    // Check balanced braces
    let braceCount = 0;
    let inString = false;
    let escaped = false;

    for (const char of trimmed) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") braceCount++;
        if (char === "}") braceCount--;
      }
    }

    if (braceCount !== 0) {
      return { valid: false, error: `Llaves desbalanceadas (${braceCount > 0 ? "falta }" : "sobra }"})` };
    }

    // Try parsing JSON
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(trimmed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "JSON inválido";
      return { valid: false, error: `JSON inválido: ${msg}` };
    }

    // Check required field: command
    if (!config.command || typeof config.command !== "string") {
      return { valid: false, error: "Falta campo 'command' (string requerido)" };
    }

    // Check args if present
    if (config.args !== undefined && !Array.isArray(config.args)) {
      return { valid: false, error: "Campo 'args' debe ser un array" };
    }

    return { valid: true, config };
  };

  // Add new MCP server
  const addMcp = async () => {
    const mcpName = newMcpName.trim();

    if (!mcpName) {
      setStatus("❌ Ingresa un nombre para el MCP");
      return;
    }

    // Validate name (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(mcpName)) {
      setStatus("❌ Nombre solo puede tener letras, números, - y _");
      return;
    }

    if (!newMcpJson.trim()) {
      setStatus("❌ Ingresa la configuración JSON");
      return;
    }

    // Validate MCP JSON
    const validation = validateMcpJson(newMcpJson);
    if (!validation.valid) {
      setStatus(`❌ ${validation.error}`);
      return;
    }

    try {
      const mcpConfig = validation.config;

      // Read current config
      const output = await executeCommand(`cat ${activeConfigPath}`);
      const config = JSON.parse(output);

      // Add new MCP
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers[mcpName] = mcpConfig;

      // Write back
      const newConfigJson = JSON.stringify(config, null, 2);
      const escapedJson = newConfigJson.replace(/'/g, "'\\''");
      await executeCommand(`echo '${escapedJson}' > ${activeConfigPath}`);

      setStatus(`✅ MCP "${mcpName}" agregado a ${activeConfigName}`);
      setNewMcpName("");
      setNewMcpJson("");
      // Reload list
      await loadMcpConfig(activeConfigPath, activeConfigName, true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${msg}`);
    }
  };

  // Delete MCP server (called after modal confirmation)
  const confirmDeleteMcp = async () => {
    if (!mcpToDelete) return;

    try {
      const output = await executeCommand(`cat ${activeConfigPath}`);
      const config = JSON.parse(output);
      delete config.mcpServers[mcpToDelete];

      const newConfigJson = JSON.stringify(config, null, 2);
      const escapedJson = newConfigJson.replace(/'/g, "'\\''");
      await executeCommand(`echo '${escapedJson}' > ${activeConfigPath}`);

      setStatus(`MCP "${mcpToDelete}" eliminado de ${activeConfigName}`);
      setMcpToDelete(null);
      await loadMcpConfig(activeConfigPath, activeConfigName, true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${msg}`);
      setMcpToDelete(null);
    }
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Control Panel</h2>

      {/* Session Name */}
      <div className={styles.section}>
        <label className={styles.label}>Sesion tmux:</label>
        <input
          type="text"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          className={styles.input}
          placeholder="nombre de sesion"
        />
      </div>

      {/* Buttons */}
      <div className={styles.section}>
        <label className={styles.label}>Acciones:</label>

        <button onClick={openClaudeLauncher} className={styles.buttonPrimary}>
          Claude MCP
        </button>

        <button onClick={sendEscapeTab} className={styles.button}>
          Enviar Escape + Shift+Tab
        </button>

        <button onClick={sendCtrlC} className={styles.button}>
          Enviar Ctrl+C
        </button>

        <button onClick={sendEscape} className={styles.button}>
          Enviar Escape
        </button>

        <button onClick={listSessions} className={styles.buttonSecondary}>
          Listar Sesiones
        </button>

        <button onClick={sendMcpList} className={styles.button}>
          Claude MCP List
        </button>

        <button onClick={loadDesktopConfig} className={styles.buttonPrimary}>
          Global Desktop MCP
        </button>

        <button onClick={loadCodeConfig} className={styles.buttonPrimary}>
          Global Code MCP
        </button>
      </div>

      {/* MCP Configuration Panel */}
      {showMcpConfig && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <label className={styles.label}>{activeConfigName} MCPs ({mcpList.length}):</label>
            <button onClick={() => setShowMcpConfig(false)} className={styles.closeButton}>✕</button>
          </div>

          {/* MCP List with trash icons */}
          <div className={styles.mcpList}>
            {mcpList.map((mcp) => (
              <div key={mcp} className={styles.mcpItem}>
                <span>{mcp}</span>
                <button onClick={() => setMcpToDelete(mcp)} className={styles.trashButton}>🗑</button>
              </div>
            ))}
          </div>

          {/* Add MCP */}
          <div className={styles.addMcp}>
            <input
              type="text"
              value={newMcpName}
              onChange={(e) => setNewMcpName(e.target.value)}
              className={styles.input}
              placeholder="Nombre del MCP"
            />
            <textarea
              value={newMcpJson}
              onChange={(e) => setNewMcpJson(e.target.value)}
              className={styles.textarea}
              placeholder='{"command": "npx", "args": ["-y", "pkg"]}'
              rows={3}
            />
            <button onClick={addMcp} className={styles.buttonPrimary}>+ Agregar</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {mcpToDelete && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <p>¿Eliminar <strong>{mcpToDelete}</strong>?</p>
            <div className={styles.modalButtons}>
              <button onClick={() => setMcpToDelete(null)} className={styles.button}>Cancelar</button>
              <button onClick={confirmDeleteMcp} className={styles.buttonDanger}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Claude Launcher Modal */}
      {showClaudeLauncher && (
        <div className={styles.modalOverlay}>
          <div className={styles.launcherModal}>
            <div className={styles.sectionHeader}>
              <label className={styles.label}>Iniciar Claude</label>
              <button onClick={() => setShowClaudeLauncher(false)} className={styles.closeButton}>✕</button>
            </div>

            {/* Code MCPs - Always included */}
            <div className={styles.mcpSection}>
              <label className={styles.mcpSectionLabel}>✓ Code MCPs (siempre incluidos):</label>
              <div className={styles.mcpTagList}>
                {codeMcpList.length > 0 ? (
                  codeMcpList.map((mcp) => (
                    <span key={mcp} className={styles.mcpTag}>{mcp}</span>
                  ))
                ) : (
                  <span className={styles.mcpEmpty}>Sin MCPs en Code</span>
                )}
              </div>
            </div>

            {/* Path Selector */}
            <div className={styles.mcpSection}>
              <label className={styles.mcpSectionLabel}>📁 Directorio de trabajo:</label>
              <div className={styles.pathDisplay}>
                <span className={styles.pathText}>{workingDir}</span>
                <button onClick={openFinder} className={styles.finderButton} title="Abrir en Finder">📂</button>
              </div>
              <div className={styles.pathTerminal}>
                <input
                  type="text"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={handlePathKeyDown}
                  className={styles.pathInput}
                  placeholder="cd, ls, pwd... (Tab para autocompletar)"
                />
                {pathSuggestions.length > 0 && (
                  <div className={styles.pathSuggestions}>
                    {pathSuggestions.map((s, i) => (
                      <span key={i} className={styles.pathSuggestion} onClick={() => {
                        const prefix = pathInput.startsWith("cd ") ? "cd " : pathInput.startsWith("ls ") ? "ls " : "";
                        const basePath = pathInput.replace(prefix, "").includes("/")
                          ? pathInput.replace(prefix, "").substring(0, pathInput.replace(prefix, "").lastIndexOf("/") + 1)
                          : "";
                        setPathInput(`${prefix}${basePath}${s}`);
                        setPathSuggestions([]);
                      }}>{s}</span>
                    ))}
                  </div>
                )}
                {pathOutput && (
                  <pre className={styles.pathOutput}>{pathOutput}</pre>
                )}
              </div>
            </div>

            {/* Desktop MCPs - Optional to add */}
            <div className={styles.mcpSection}>
              <label className={styles.mcpSectionLabel}>+ Desktop MCPs (agregar):</label>
              {desktopMcpList.length > 0 ? (
                <>
                  <button onClick={selectAllMcps} className={styles.selectAllButton}>
                    {selectedMcps.size === desktopMcpList.length ? "Deseleccionar todo" : "Seleccionar todo"}
                  </button>
                  <div className={styles.mcpCheckList}>
                    {desktopMcpList.map((mcp) => (
                      <label key={mcp} className={styles.mcpCheckItem}>
                        <input
                          type="checkbox"
                          checked={selectedMcps.has(mcp)}
                          onChange={() => toggleMcpSelection(mcp)}
                        />
                        <span>{mcp}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <span className={styles.mcpEmpty}>Sin MCPs en Desktop</span>
              )}
            </div>

            <div className={styles.modalButtons}>
              <button onClick={() => setShowClaudeLauncher(false)} className={styles.button}>Cancelar</button>
              <button onClick={launchClaudeWithMcps} className={styles.buttonPrimary}>
                Iniciar Claude {selectedMcps.size > 0 ? `+ ${selectedMcps.size} Desktop` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model Selector */}
      <div className={styles.section}>
        <label className={styles.label}>Modelo:</label>
        <div className={styles.modelRow}>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className={styles.select}
          >
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
          <button onClick={sendModel} className={styles.buttonPrimary}>
            Enviar /model
          </button>
        </div>
      </div>

      {/* Custom Message */}
      <div className={styles.section}>
        <label className={styles.label}>Mensaje personalizado:</label>
        <textarea
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          className={styles.textarea}
          placeholder="Escribe tu mensaje aqui..."
          rows={4}
        />
        <button onClick={sendMensaje} className={styles.buttonPrimary}>
          Enviar Mensaje + Enter + Enter
        </button>
      </div>

      {/* Chat History Toggle */}
      <div className={styles.section}>
        <button
          onClick={() => setShowClaudeMonitor(!showClaudeMonitor)}
          className={showClaudeMonitor ? styles.buttonPrimary : styles.button}
        >
          {showClaudeMonitor ? "💬 Chat Activo" : "💬 Ver Chat"}
        </button>
        {showClaudeMonitor && (
          <button
            onClick={() => { setChatHistory([]); setClaudeEvents([]); localStorage.removeItem("chatHistory"); }}
            className={styles.buttonSecondary}
            style={{ marginTop: 8 }}
          >
            Limpiar Chat
          </button>
        )}
      </div>

      {/* Chat History View - Siempre visible con estilos inline */}
      <div style={{
        backgroundColor: '#1a1a1a',
        border: '2px solid #007acc',
        borderRadius: '8px',
        marginTop: '16px',
        padding: '0',
        minHeight: '150px'
      }}>
        <div style={{
          backgroundColor: '#252526',
          padding: '10px 14px',
          fontSize: '12px',
          color: '#9d9d9d',
          borderBottom: '1px solid #3e3e42'
        }}>
          💬 Conversación ({chatHistory.length} mensajes)
        </div>
        <div ref={chatMessagesRef} style={{
          maxHeight: '300px',
          overflowY: 'auto',
          padding: '12px'
        }}>
          {chatHistory.length === 0 ? (
            <div style={{ color: '#6d6d6d', textAlign: 'center', padding: '20px' }}>
              Envía un mensaje para comenzar...
            </div>
          ) : (
            chatHistory.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: '10px'
                }}
              >
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  backgroundColor: msg.role === 'user' ? '#0e639c' : '#3c3c3c',
                  color: '#fff'
                }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, marginBottom: '4px', opacity: 0.7 }}>
                    {msg.role === 'user' ? 'TÚ' : 'CLAUDE'}
                  </div>
                  <div style={{ fontSize: '13px', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  <div style={{ fontSize: '9px', opacity: 0.5, marginTop: '6px', textAlign: 'right' }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Status */}
      {status && (
        <div className={styles.status}>
          <pre>{status}</pre>
        </div>
      )}
    </div>
  );
}

export default ControlPanel;
