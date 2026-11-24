// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReceiptDownload } from './ReceiptDownload';
import { getReceipt, saveReceipt } from '../services/receipts';
vi.mock('../services/receipts', () => ({ getReceipt: vi.fn(), saveReceipt: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(cleanup);
it('muestra error y permite reintentar la misma orden', async () => {
  const file = { blob: new Blob(['%PDF']), filename: 'comprobante-CC-o.pdf' };
  vi.mocked(getReceipt).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(file);
  render(<ReceiptDownload orderId="o" />);
  fireEvent.click(screen.getByRole('button')); await screen.findByRole('alert');
  expect(saveReceipt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(saveReceipt).toHaveBeenCalledWith(file));
  expect(vi.mocked(getReceipt).mock.calls.every(call => call[0] === 'o')).toBe(true);
});
it('deshabilita envíos duplicados y cancela al desmontar', async () => {
  let complete!: (value: { blob: Blob; filename: string }) => void;
  vi.mocked(getReceipt).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const result = render(<ReceiptDownload orderId="o" />);
  fireEvent.click(screen.getByRole('button')); fireEvent.click(screen.getByRole('button'));
  expect(getReceipt).toHaveBeenCalledTimes(1); expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  result.unmount(); complete({ blob: new Blob(), filename: 'o.pdf' });
  await Promise.resolve(); expect(saveReceipt).not.toHaveBeenCalled();
});
