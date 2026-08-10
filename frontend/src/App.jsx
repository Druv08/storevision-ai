import { useEffect, useState } from "react";
import "./App.css";
import LiveCameraMonitor from "./components/LiveCameraMonitor";
import DetectionUpload from "./components/DetectionUpload";
import { API_BASE_URL } from "./services/detectionApi";

export default function App() {
  const [connected, setConnected] = useState(null);

  const checkBackend = async () => {
    try {
      await fetch(`${API_BASE_URL}/health`, {
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
    // checkBackend only calls setState after an awaited fetch (async), so it
    // is not a synchronous setState-in-effect; this primes status before poll.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkBackend();

    const interval = setInterval(() => {
      checkBackend();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app">
      {/* HEADER */}
      <div className="header">
        <h1>StoreVision AI</h1>

        <span className="status">
          {connected === null
            ? "⏳ Connecting..."
            : connected
              ? "🟢 Backend connected"
              : "🔴 Backend offline"}
        </span>
      </div>

      {/* WELCOME MESSAGE */}
      <div className="welcome-box">
        <h2>AI-powered live shelf monitoring</h2>
        <p>
          Save a reference photo of any shelf, desk, or product layout — the
          app compares every scan against it and flags missing, moved, or
          changed objects.
        </p>
      </div>

      {/* LIVE SHELF MONITOR */}
      <LiveCameraMonitor />

      {/* HOW IT WORKS */}
      <div className="glass-panel">
        <h2>How it works</h2>

        <ol className="how-list">
          <li>Point the camera at any shelf, desk, or product layout.</li>
          <li>Click "Set Reference Layout" while everything is placed correctly.</li>
          <li>Scan or start monitoring — each frame is compared with the reference photo.</li>
          <li>Changed areas are highlighted: possible missing, moved, or swapped objects.</li>
        </ol>

        <p className="zone-note">
          Phone camera testing works best through an HTTPS tunnel — set
          VITE_API_BASE_URL in frontend/.env.local to the backend tunnel URL.
        </p>
      </div>

      {/* DEV FALLBACK: analyze a saved image instead of the camera */}
      <details className="glass-panel fallback-panel">
        <summary>Upload Image Test (fallback)</summary>
        <DetectionUpload />
      </details>
    </div>
  );
}
