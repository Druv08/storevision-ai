import { useEffect, useState } from "react";
import "./App.css";
import LiveCameraMonitor from "./components/LiveCameraMonitor";
import DetectionUpload from "./components/DetectionUpload";

const API_BASE_URL = "http://127.0.0.1:8000";

export default function App() {
  const [connected, setConnected] = useState(null);

  const checkBackend = async () => {
    try {
      await fetch(`${API_BASE_URL}/health`);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  useEffect(() => {
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
          Point a camera at a store shelf and let the AI find empty spaces in
          the current frame.
        </p>
      </div>

      {/* LIVE SHELF MONITOR */}
      <LiveCameraMonitor />

      {/* HOW IT WORKS */}
      <div className="glass-panel">
        <h2>How it works</h2>

        <ol className="how-list">
          <li>Start the camera and point it at a store shelf.</li>
          <li>Click "Analyze Current Frame" to capture the live view.</li>
          <li>The trained YOLO model scans the frame for empty shelf spaces.</li>
          <li>Empty spots are highlighted with boxes and listed in the report.</li>
        </ol>
      </div>

      {/* DEV FALLBACK: analyze a saved image instead of the camera */}
      <details className="glass-panel fallback-panel">
        <summary>Upload Image Test (fallback)</summary>
        <DetectionUpload />
      </details>
    </div>
  );
}
