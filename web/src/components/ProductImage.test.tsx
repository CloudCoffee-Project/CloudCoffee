// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductImage } from './ProductImage';
import { getProductById } from '../services/catalog';
vi.mock('../config/env', () => ({ env:{ apiBaseUrl:'http://localhost:18080' } }));
vi.mock('../services/catalog', () => ({ getProductById:vi.fn() }));
afterEach(cleanup);
it('usa la fotografía guardada y maneja enlaces rotos', () => {
  render(<ProductImage src="/cafe.png" name="Café" />);
  const image = screen.getByRole('img', { name:'Café' }); expect(image.getAttribute('src')).toBe('/cafe.png');
  fireEvent.error(image); expect(screen.getByRole('img', { name:'Sin foto de Café' })).toBeTruthy();
});
it('recupera fotografías de carritos antiguos sin cambiar cantidades o precios', async () => {
  vi.mocked(getProductById).mockResolvedValue({ id:'cafe', nombre:'Café', imagenUrl:'/foto.png', descripcion:null, categoria:{id:'bebidas',nombre:'Bebidas'} });
  render(<ProductImage productId="cafe" name="Café" />);
  expect((await screen.findByRole('img', { name:'Café' })).getAttribute('src')).toBe('/foto.png');
});

it('resuelve las fotos públicas en el Gateway aunque la web use otro puerto', () => {
  render(<ProductImage src="/v1/catalog/imagenes/cafe.png" name="Café" />);
  expect(screen.getByRole('img', { name:'Café' }).getAttribute('src')).toBe('http://localhost:18080/v1/catalog/imagenes/cafe.png');
});
