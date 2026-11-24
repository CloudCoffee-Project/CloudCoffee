import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../services/httpClient';
import { paymentSessionOwner } from '../services/payments';
import { getReceipt, saveReceipt } from '../services/receipts';

export function ReceiptDownload({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (busy) return; setBusy(true); setError('');
    controller.current = new AbortController();
    const signal = controller.current.signal;
    const owner = paymentSessionOwner();
    try {
      const receipt = await getReceipt(orderId, signal);
      if (!signal.aborted && owner === paymentSessionOwner()) saveReceipt(receipt);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof ApiRequestError ? cause.detail : 'No se pudo descargar el comprobante. Vuelve a intentarlo.');
    } finally { if (!signal.aborted) setBusy(false); }
  }
  return <div>
    <button type="button" className="checkout-secondary" disabled={busy} onClick={() => void download()}>
      {busy ? 'Descargando comprobante…' : 'Descargar comprobante PDF'}
    </button>
    <p>Comprobante interno, sin validez tributaria.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
