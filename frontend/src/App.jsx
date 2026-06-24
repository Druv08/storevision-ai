import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://127.0.0.1:8000";

function App() {
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [backendStatus, setBackendStatus] = useState("Checking...");

  // ----------------------------
  // LOAD ON START
  // ----------------------------
  useEffect(() => {
    checkBackend();
    fetchProducts();
    fetchAlerts();
  }, []);

  // ----------------------------
  // BACKEND HEALTH CHECK
  // ----------------------------
  const checkBackend = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      const data = await res.json();
      setBackendStatus(data.status === "ok" ? "Connected" : "Issue");
    } catch {
      setBackendStatus("Not connected");
    }
  };

  // ----------------------------
  // PRODUCTS
  // ----------------------------
  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/products`);
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err) {
      console.log("Products error:", err);
    }
  };

  // ----------------------------
  // ALERTS
  // ----------------------------
  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/alerts`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (err) {
      console.log("Alerts error:", err);
    }
  };

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <h1>StoreVision AI</h1>
        <div className="status">
          Backend: <b>{backendStatus}</b>
        </div>
      </header>

      {/* DASHBOARD SUMMARY */}
    <div className="summary-grid">

       <div className="summary-card">
         <h3>Total Items in Store</h3>
         <strong>{products.length}</strong>
       </div>

       <div className="summary-card">
         <h3>Active Alerts</h3>
         <strong>{alerts.length}</strong>

        <details className="alerts-dropdown">
          <summary>View Alert Details</summary>

          {alerts.length === 0 ? (
            <p>No active alerts</p>
          ) : (
            alerts.map((alert, index) => (
              <div key={index} className="alert-item">
                 {alert.message}
              </div>
            ))
       )}
    </details>
  </div>

</div>

      {/* PRODUCTS TABLE */}
      <div className="panel">
        <h2>Store Inventory</h2>

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
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;