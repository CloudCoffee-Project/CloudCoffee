import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PaymentCheckout } from '../components/PaymentCheckout';
import { AUTH_SESSION_EVENT, ApiRequestError } from '../services/httpClient';
import {
  assertSandboxPayment, getPayment, isPaymentNotStarted, isPaymentReconciling, paymentSessionOwner, type Payment,
} from '../services/payments';
import { connectPurchaseRealtimeStream, getPurchase, type Purchase } from '../services/purchases';
import './CheckoutPage.css';

const labels: Record<string, string> = {
  aprobado: 'Pago aprobado', pendiente: 'Pago pendiente de confirmación', rechazado: 'Pago rechazado',
  cancelado: 'Pago cancelado', vencido: 'Pago vencido', requiere_conciliacion: 'Pago en conciliación',
};

export function PaymentResultPage() {
  const [params] = useSearchParams();
  // Ningún status/resultado del retorno sirve como confirmación del pago.
  const compraId = params.get('compraId') ?? '';
  const [data, setData] = useState<{ payment: Payment | null; purchase: Purchase; reconciling: boolean } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setData(null);
    setError('');
    if (!compraId) { setError('Falta el identificador de la compra.'); return; }
    const controller = new AbortController();
    const owner = paymentSessionOwner();
    const onSession = () => {
      if (owner !== paymentSessionOwner()) {
        controller.abort(); setData(null); setError('La sesión cambió. Vuelve a consultar desde tus compras.');
      }
    };
    window.addEventListener(AUTH_SESSION_EVENT, onSession);
    window.addEventListener('storage', onSession);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    async function load() {
      if (loading || controller.signal.aborted) return;
      loading = true;
      clearTimeout(timer);
      try {
        const purchase = await getPurchase(compraId, controller.signal);
        let payment: Payment | null = null;
        let reconciling = false;
        try {
          payment = await getPayment(compraId, controller.signal);
          assertSandboxPayment(payment, compraId);
        } catch (cause) {
          if (isPaymentReconciling(cause)) reconciling = true;
          else if (!isPaymentNotStarted(cause)) throw cause;
        }
        if (controller.signal.aborted) return;
        setData({ payment, purchase, reconciling });
        setError('');
        if (reconciling || payment?.estado === 'pendiente' || payment?.estado === 'requiere_conciliacion') {
          timer = setTimeout(() => void load(), 5000);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          // Un error de autorización nunca conserva datos de la compra anterior.
          setData(null);
          setError(cause instanceof ApiRequestError ? cause.detail : cause instanceof Error ? cause.message : 'No se pudo consultar el pago.');
        }
      } finally { loading = false; }
    }
    void load();
    const disconnect = connectPurchaseRealtimeStream({ compraId, onEvent: () => void load(), onReconnect: () => void load() });
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort(); clearTimeout(timer); disconnect(); window.removeEventListener('focus', onFocus);
      window.removeEventListener(AUTH_SESSION_EVENT, onSession); window.removeEventListener('storage', onSession);
    };
  }, [compraId, attempt]);

  return <section className="checkout-page checkout-result">
    <h1>Resultado del pago</h1>
    <p>Mercado Pago Sandbox · entorno de pruebas</p>
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Reintentar consulta</button></>
      : !data ? <p role="status">Consultando estado en el servidor…</p> : <>
        <h2>{data.payment ? labels[data.payment.estado] ?? 'Estado de pago desconocido' : data.reconciling ? 'Pago en conciliación' : 'Pago aún no iniciado'}</h2>
        <p>Compra {data.purchase.compraId}: {data.purchase.estado.replaceAll('_', ' ')}</p>
        {data.payment?.estado === 'pendiente' && <p>Estamos esperando la confirmación del pago. Puedes volver a consultarlo desde Mis compras.</p>}
        {data.purchase.estado === 'pendiente_pago' && !data.reconciling && (!data.payment || (data.payment.estado === 'pendiente' && Boolean(data.payment.initPoint))) && <PaymentCheckout key={compraId} compraId={compraId} />}
      </>}
    <p><Link to="/compras">Mis compras</Link> · <Link to="/checkout">Volver al checkout</Link></p>
  </section>;
}
