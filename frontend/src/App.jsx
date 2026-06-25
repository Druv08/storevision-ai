import { useEffect, useState } from "react";
import "./App.css";
import ClickSpark from "./components/ClickSpark";

const API_BASE_URL = "http://127.0.0.1:8000";

export default function App() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);

  useEffect(() => {
    fetchProducts();
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchProducts = async () => {
    const res = await fetch(`${API_BASE_URL}/products`);
    const data = await res.json();
    setProducts(data.products || []);
  };

  const fetchAlerts = async () => {
    const res = await fetch(`${API_BASE_URL}/alerts`);
    const data = await res.json();
    setAlerts(data.alerts || []);
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

        {/* TABLE */}
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

        <div className="table-wrapper">
          <table>...</table>
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