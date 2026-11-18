// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProductImageManager } from './ProductImageManager';
import { listImageProducts, uploadProductImage } from '../services/productImages';
vi.mock('../services/productImages', () => ({ listImageProducts: vi.fn(), uploadProductImage: vi.fn(), productImageUrl: (value: string) => value }));
const product = { id: 'cafe', nombre: 'Café americano', imagenUrl: null, estado: 'ACTIVE' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listImageProducts).mockResolvedValue({ content: [product], number: 0, totalPages: 1 }); });
afterEach(cleanup);
it('carga una foto para el producto elegido y actualiza la imagen actual', async () => {
  vi.mocked(uploadProductImage).mockResolvedValue({ ...product, imagenUrl: '/v1/catalog/imagenes/imagen.png' });
  render(<ProductImageManager />); await screen.findByLabelText('Fotografía');
  const file = new File(['png'], 'cafe.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Fotografía'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imagen' }));
  await screen.findByText('Imagen guardada correctamente.');
  expect(uploadProductImage).toHaveBeenCalledWith('cafe', file, expect.any(AbortSignal));
  expect(screen.getByAltText('Imagen actual de Café americano').getAttribute('src')).toContain('imagen.png');
});
it('rechaza formatos no admitidos antes de enviar', async () => {
  render(<ProductImageManager />); await screen.findByLabelText('Fotografía');
  fireEvent.change(screen.getByLabelText('Fotografía'), { target: { files: [new File(['svg'], 'test.svg', { type: 'image/svg+xml' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imagen' }));
  await screen.findByRole('alert'); expect(uploadProductImage).not.toHaveBeenCalled();
});
it('permite reintentar la carga fallida sin borrar el archivo elegido', async () => {
  vi.mocked(uploadProductImage).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ...product, imagenUrl: '/image.png' });
  render(<ProductImageManager />); await screen.findByLabelText('Fotografía');
  fireEvent.change(screen.getByLabelText('Fotografía'), { target: { files: [new File(['png'], 'cafe.png', { type: 'image/png' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imagen' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imagen' })); await screen.findByText('Imagen guardada correctamente.');
  await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(2));
});
