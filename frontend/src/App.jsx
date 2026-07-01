import { useEffect, useState } from "react";
import "./App.css";
import ClickSpark from "./components/ClickSpark";

const API_BASE_URL = "http://127.0.0.1:8000";

export default function App() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [shelf, setShelf] = useState({});
  const [connected, setConnected] = useState(null);
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    fetchProducts();
    fetchShelf();
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/products`);
      const data = await res.json();
      setProducts(data.products || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const fetchShelf = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/shelf-layout`);
      const data = await res.json();
      setShelf(data || {});
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/alerts`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  };

  const isGood = (status) =>
    status === "available" || status === "ok" || status === "healthy";

  const alertIcon = (type) => {
    if (type === "expired_product") return "🔴";
    if (type === "missing_item") return "🔴";
    if (type === "wrong_placement") return "🟡";
    return "🟢";
  };

  return (
    <ClickSpark>
      <div className="app">

        {/* HEADER */}
        <div className="header">
          <h1>StoreVision AI</h1>
          <span className={connected ? "status good" : "status bad"}>
            {connected === null
              ? "⏳ Connecting..."
              : connected
              ? "🟢 Backend connected"
              : "🔴 Backend offline"}
          </span>
        </div>

        {/* CARDS */}
        <div className="grid">

          <div className="glass-btn">
           📦 Total Items <span>{products.length}</span>
          </div>

          <div className="glass-btn" onClick={() => setShowAlerts(true)}>
           🚨 Active Alerts <span>{alerts.length}</span>
        </div>

</div>

        {/* PRODUCT TABLE */}
        <div className="glass-panel">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Slot</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category}</td>
                  <td>{p.slot}</td>
                  <td className={isGood(p.status) ? "good" : "bad"}>
                    {isGood(p.status) ? "🟢 " : "🔴 "}
                    {p.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* SHELF LAYOUT */}
        <div className="glass-panel">
          <h2>Shelf Layout</h2>
          <table>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Expected Product</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(shelf).map(([slot, name]) => (
                <tr key={slot}>
                  <td>{slot}</td>
                  <td>{name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* POPUP */}
        {showAlerts && (
          <div className="overlay" onClick={() => setShowAlerts(false)}>
            <div className="popup" onClick={(e) => e.stopPropagation()}>

              <h2>System Alerts</h2>

              {alerts.length === 0 ? (
                <p className="ok-text">All systems normal 🟢</p>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className="alert-row">
                    <span className="icon">{alertIcon(a.type)}</span>
                    <span>{a.message}</span>
                  </div>
                ))
              )}

              <button onClick={() => setShowAlerts(false)}>
                Close
              </button>

            </div>
          </div>
        )}

      </div>
    </ClickSpark>
  );
}
