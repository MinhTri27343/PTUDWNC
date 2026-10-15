import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_URL = 'http://localhost:3000';

function App() {
  const [sku, setSku] = useState('A001');
  const [quantity, setQuantity] = useState(2);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submitOrder(nextSku = sku, nextQuantity = quantity) {
    setLoading(true);
    const startedAt = new Date().toISOString();
    try {
      const response = await fetch(API_URL + '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: nextSku, quantity: Number(nextQuantity) })
      });
      const body = await response.json();
      setResult({ startedAt, status: response.status, body });
    } catch (error) {
      setResult({ startedAt, status: 'NETWORK_ERROR', body: { message: error.message } });
    } finally {
      setLoading(false);
    }
  }

  return <main className="page">
    <section className="card">
      <p className="eyebrow">Web nâng cao · Block 3</p>
      <h1>Order API · REST baseline</h1>
      <p className="intro">Browser gọi Order API bằng REST. Order API tiếp tục gọi Inventory Service bằng REST.</p>
      <div className="form-grid">
        <label>SKU<input value={sku} onChange={(event) => setSku(event.target.value)} /></label>
        <label>Số lượng<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
      </div>
      <div className="actions">
        <button onClick={() => submitOrder('A001', 2)} disabled={loading}>Test đủ hàng</button>
        <button className="secondary" onClick={() => submitOrder('A002', 2)} disabled={loading}>Test thiếu hàng</button>
        <button className="ghost" onClick={() => submitOrder()} disabled={loading}>Gửi dữ liệu hiện tại</button>
      </div>
      <div className="result">
        <h2>Browser response</h2>
        {result ? <><p><strong>Thời điểm:</strong> {result.startedAt}</p><p><strong>HTTP status:</strong> <span className={result.status >= 400 ? 'bad' : 'good'}>{result.status}</span></p><pre>{JSON.stringify(result.body, null, 2)}</pre></> : <p className="muted">Chưa có request. Hãy chọn một case để chạy.</p>}
      </div>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
