//! Debug HTTP Server (DEV only)
//!
//! Exposes `localhost:19876` so external tools (Claude Code MCP, curl)
//! can interact with the running app via `window.__debug._invoke()`.
//!
//! Flow:
//!   1. curl POST /invoke {action, params}
//!   2. Server evals JS: window.__debug._invoke(action, params)
//!   3. JS result -> fetch POST /callback {callback_id, result}
//!   4. Server resolves the waiting /invoke and responds
//!
//! Uses 4 worker threads so /callback can arrive while /invoke waits.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use tauri::{AppHandle, WebviewWindow};
use tiny_http::{Header, Method, Response, Server};
use uuid::Uuid;

type PendingCallbacks = Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<String>>>>;
type SharedWindow = Arc<Mutex<WebviewWindow>>;

static PENDING: OnceLock<PendingCallbacks> = OnceLock::new();

pub fn start(window: WebviewWindow, _app_handle: AppHandle) {
    let pending: PendingCallbacks = Arc::new(Mutex::new(HashMap::new()));
    let _ = PENDING.set(pending.clone());

    let window: SharedWindow = Arc::new(Mutex::new(window));

    thread::spawn(move || {
        let server = match Server::http("127.0.0.1:19876") {
            Ok(s) => Arc::new(s),
            Err(e) => {
                log::error!("[DebugServer] Failed to bind :19876: {}", e);
                return;
            }
        };
        log::info!("[DebugServer] Listening on http://127.0.0.1:19876");

        // Spawn 4 worker threads to handle concurrent requests
        let mut guards = Vec::with_capacity(4);
        for _ in 0..4 {
            let server = server.clone();
            let pending = pending.clone();
            let window = window.clone();

            let guard = thread::spawn(move || {
                loop {
                    let request = match server.recv() {
                        Ok(rq) => rq,
                        Err(_) => break,
                    };

                    handle_request(request, &pending, &window);
                }
            });
            guards.push(guard);
        }

        for g in guards {
            let _ = g.join();
        }
    });
}

fn handle_request(mut request: tiny_http::Request, pending: &PendingCallbacks, window: &SharedWindow) {
    let url = request.url().to_string();

    // CORS preflight
    if *request.method() == Method::Options {
        let resp = Response::empty(204)
            .with_header(cors("Access-Control-Allow-Origin", "*"))
            .with_header(cors("Access-Control-Allow-Methods", "POST, OPTIONS"))
            .with_header(cors("Access-Control-Allow-Headers", "Content-Type"));
        let _ = request.respond(resp);
        return;
    }

    // ---- POST /callback (from webview JS) ----
    if *request.method() == Method::Post && url == "/callback" {
        let mut body = String::new();
        let _ = request.as_reader().read_to_string(&mut body);

        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
        let cb_id = parsed.get("callback_id").and_then(|v| v.as_str()).unwrap_or("");
        let result = parsed.get("result").and_then(|v| v.as_str()).unwrap_or("{}");

        if !cb_id.is_empty() {
            let tx = {
                let map = pending.lock();
                map.get(cb_id).cloned()
            };
            if let Some(tx) = tx {
                let _ = tx.send(result.to_string());
            }
        }

        let resp = Response::from_string(r#"{"ok":true}"#)
            .with_header(cors("Access-Control-Allow-Origin", "*"))
            .with_header(json_ct());
        let _ = request.respond(resp);
        return;
    }

    // ---- POST /invoke (from curl / MCP) ----
    if *request.method() == Method::Post && url == "/invoke" {
        let mut body = String::new();
        if request.as_reader().read_to_string(&mut body).is_err() {
            let resp = Response::from_string(r#"{"error":"Failed to read body"}"#)
                .with_status_code(400)
                .with_header(cors("Access-Control-Allow-Origin", "*"))
                .with_header(json_ct());
            let _ = request.respond(resp);
            return;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(e) => {
                let resp = Response::from_string(format!(r#"{{"error":"Invalid JSON: {}"}}"#, e))
                    .with_status_code(400)
                    .with_header(cors("Access-Control-Allow-Origin", "*"))
                    .with_header(json_ct());
                let _ = request.respond(resp);
                return;
            }
        };

        let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("");
        let params = parsed.get("params").cloned().unwrap_or(serde_json::json!({}));

        if action.is_empty() {
            let resp = Response::from_string(r#"{"error":"Missing 'action' field"}"#)
                .with_status_code(400)
                .with_header(cors("Access-Control-Allow-Origin", "*"))
                .with_header(json_ct());
            let _ = request.respond(resp);
            return;
        }

        // Register callback channel
        let callback_id = Uuid::new_v4().to_string();
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        {
            let mut map = pending.lock();
            // Guard against unbounded growth if callbacks are never resolved
            // (e.g. webview closed mid-request). 100 concurrent requests is
            // far beyond normal usage; clearing resets any leaked entries.
            if map.len() > 100 {
                log::warn!("[DebugServer] pending callbacks exceeded 100, clearing stale entries");
                map.clear();
            }
            map.insert(callback_id.clone(), tx);
        }

        // Eval JS — result arrives via fetch to /callback
        let js = format!(
            r#"(async () => {{
                try {{
                    const result = await window.__debug._invoke({action}, {params});
                    await fetch('http://127.0.0.1:19876/callback', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{
                            callback_id: '{cb_id}',
                            result: JSON.stringify(result)
                        }})
                    }});
                }} catch (err) {{
                    await fetch('http://127.0.0.1:19876/callback', {{
                        method: 'POST',
                        headers: {{ 'Content-Type': 'application/json' }},
                        body: JSON.stringify({{
                            callback_id: '{cb_id}',
                            result: JSON.stringify({{ error: String(err) }})
                        }})
                    }});
                }}
            }})()"#,
            action = serde_json::to_string(action).unwrap_or_default(),
            params = params.to_string(),
            cb_id = callback_id,
        );

        {
            let w = window.lock();
            if let Err(e) = w.eval(&js) {
                log::error!("[DebugServer] eval failed: {}", e);
                let mut map = pending.lock();
                map.remove(&callback_id);

                let resp = Response::from_string(format!(r#"{{"error":"eval failed: {}"}}"#, e))
                    .with_status_code(500)
                    .with_header(cors("Access-Control-Allow-Origin", "*"))
                    .with_header(json_ct());
                let _ = request.respond(resp);
                return;
            }
        }

        // Wait for JS callback (timeout 30s)
        let result = rx.recv_timeout(Duration::from_secs(30));

        {
            let mut map = pending.lock();
            map.remove(&callback_id);
        }

        let response_body = match result {
            Ok(data) => data,
            Err(_) => r#"{"error":"Timeout waiting for webview response"}"#.to_string(),
        };

        let resp = Response::from_string(response_body)
            .with_header(cors("Access-Control-Allow-Origin", "*"))
            .with_header(json_ct());
        let _ = request.respond(resp);
        return;
    }

    // 404
    let resp = Response::from_string(r#"{"error":"Use POST /invoke"}"#)
        .with_status_code(404)
        .with_header(cors("Access-Control-Allow-Origin", "*"))
        .with_header(json_ct());
    let _ = request.respond(resp);
}

/// Tauri command fallback
#[tauri::command]
pub fn debug_callback(callback_id: String, result: String) {
    if let Some(pending) = PENDING.get() {
        let tx = {
            let map = pending.lock();
            map.get(&callback_id).cloned()
        };
        if let Some(tx) = tx {
            let _ = tx.send(result);
        }
    }
}

fn cors(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn json_ct() -> Header {
    Header::from_bytes(b"Content-Type", b"application/json").unwrap()
}
