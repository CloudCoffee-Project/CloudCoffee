import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiRequestError } from '../services/httpClient';
import {
  assertSandboxPayment, getPayment, isPaymentNotStarted, isPaymentReconciling,
  openMercadoPagoCheckout, paymentSessionOwner, sandboxCheckoutUrl, startPayment, type Payment,
} from '../services/payments';

export function PaymentCheckout({ compraId }: { compraId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const resultPath = `/pago/resultado?compraId=${encodeURIComponent(compraId)}`;

  useEffect(() => () => pending.current?.abort(), [compraId]);

  async function pay() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const owner = paymentSessionOwner();
    const isCurrent = () => !controller.signal.aborted && owner === paymentSessionOwner();

    setBusy(true);
    setError('');
    try {
      let payment: Payment;
      try {
        payment = await getPayment(compraId, controller.signal);
      } catch (cause) {
        if (!isPaymentNotStarted(cause)) throw cause;
        if (!isCurrent()) return;
        payment = await startPayment(compraId, controller.signal);
      }

      if (!isCurrent()) return;
      assertSandboxPayment(payment, compraId);
      const url = sandboxCheckoutUrl(payment);
      if (url) openMercadoPagoCheckout(url);
      else navigate(resultPath);
    } catch (cause) {
      if (!isCurrent()) return;
      if (isPaymentReconciling(cause) ||
          (cause instanceof ApiRequestError && cause.code === 'PAGO_YA_INICIADO')) {
        navigate(resultPath);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir Mercado Pago. Inténtalo nuevamente.');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  return (
    <div className="payment-checkout">
      <p>Mercado Pago Sandbox. Usa una cuenta y una tarjeta de prueba.</p>
      <button type="button" className="checkout-primary" disabled={busy} onClick={() => void pay()}>
        {busy ? 'Preparando el pago…' : 'Pagar con Mercado Pago'}
      </button>
      <Link className="checkout-secondary" to={resultPath}>Consultar resultado del pago</Link>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
