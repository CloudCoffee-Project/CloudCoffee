import { ApiRequestError, request } from './httpClient';
import { paymentState, type Purchase, type PurchaseOrder } from './purchases';

export function canDownloadReceipt(purchase: Purchase, order: PurchaseOrder): boolean {
  return purchase.estado === 'pagado' && paymentState(purchase) === 'aprobado' &&
    ['pagado', 'listo_para_retiro', 'entregado', 'no_retirado_pendiente_revision', 'no_retirado_final'].includes(order.estado);
}

function receiptFilename(header: string | null, orderId: string): string {
  const fallback = `comprobante-CC-${orderId}.pdf`;
  let name = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (name) { try { name = decodeURIComponent(name); } catch { name = undefined; } }
  name ??= header?.match(/filename="([^"]+)"/i)?.[1] ?? header?.match(/filename=([^;]+)/i)?.[1];
  const safe = (name ?? fallback).trim().replace(/[\\/\x00-\x1f\x7f]/g, '_');
  return safe.toLowerCase().endsWith('.pdf') && safe.length < 200 ? safe : fallback;
}

export async function getReceipt(orderId: string, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const response = await request<Response>(`/v1/orders/${encodeURIComponent(orderId)}/boleta`, {
    headers: { Accept: 'application/pdf' }, responseType: 'response', signal,
  });
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    throw new ApiRequestError(response.status, 'Documento inválido', 'El servidor no devolvió un comprobante PDF.');
  }
  return { blob: await response.blob(), filename: receiptFilename(response.headers.get('Content-Disposition'), orderId) };
}

export function saveReceipt({ blob, filename }: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  // La descarga necesita resolver el blob antes de liberar la URL local.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
