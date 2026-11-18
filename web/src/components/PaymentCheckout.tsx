import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../services/httpClient';
import { clearPaymentScenario, getPayment, paymentSessionOwner, pendingPaymentScenario,
  startPayment, type Payment, type PaymentScenario } from '../services/payments';

export function PaymentCheckout({ compraId }: { compraId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState<PaymentScenario>(() => pendingPaymentScenario(compraId) ?? 'aprobar');
  const [locked, setLocked] = useState(() => pendingPaymentScenario(compraId) !== null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function pay() {
    if (busy) return;
    setBusy(true); setError('');
    const owner = paymentSessionOwner();
    try {
      let payment: Payment;
      try { payment = await getPayment(compraId); }
      catch (cause) {
        if (!(cause instanceof ApiRequestError && cause.status === 404)) throw cause;
        payment = await startPayment(compraId, scenario);
      }
      if (!active.current || owner !== paymentSessionOwner()) return;
      if (!payment.simulado || payment.proveedor !== 'simulado') throw new Error('El servidor no está configurado para pago simulado.');
      clearPaymentScenario(compraId);
      navigate(`/pago/resultado?compraId=${encodeURIComponent(compraId)}`);
    } catch (cause) {
      if (!active.current || owner !== paymentSessionOwner()) return;
      setLocked(pendingPaymentScenario(compraId) !== null);
      setError(cause instanceof ApiRequestError ? cause.detail : cause instanceof Error ? cause.message : 'No se pudo simular el pago. Vuelve a intentarlo.');
    } finally { if (active.current) setBusy(false); }
  }

  return <div className="payment-checkout">
    <p>Pago simulado. No se realizan cobros reales.</p>
    <label>Resultado de la simulación{' '}
      <select aria-label="Resultado de la simulación" value={scenario} disabled={busy || locked}
        onChange={event => setScenario(event.target.value as PaymentScenario)}>
        <option value="aprobar">Aprobar</option>
        <option value="rechazar">Rechazar</option>
        <option value="pendiente">Dejar pendiente</option>
      </select>
    </label>
    {locked && <p>El reintento conserva el escenario original hasta conocer la respuesta del servidor.</p>}
    <button type="button" className="checkout-primary" disabled={busy} onClick={() => void pay()}>
      {busy ? 'Procesando simulación…' : 'Simular pago'}
    </button>
    <Link className="checkout-secondary" to={`/pago/resultado?compraId=${encodeURIComponent(compraId)}`}>Consultar resultado del pago</Link>
    {error && <p role="alert">{error}</p>}
  </div>;
}
