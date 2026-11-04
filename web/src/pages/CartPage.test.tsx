// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import { CartPage } from './CartPage';
import {
  CART_STORAGE_KEY,
  readCartItems,
  type CartItem,
} from '../services/catalog';

const itemA: CartItem = {
  offerId: 'offer-central-latte',
  productId: 'product-latte',
  productName: 'Latte',
  cafeteriaId: 'cafeteria-central',
  cafeteriaName: 'Cafetería Central',
  price: 2200,
  quantity: 2,
  stock: 5,
};

const itemB: CartItem = {
  ...itemA,
  offerId: 'offer-central-tea',
  productId: 'product-tea',
  productName: 'Té',
  price: 1500,
  quantity: 1,
};

const itemC: CartItem = {
  ...itemA,
  offerId: 'offer-norte-latte',
  cafeteriaId: 'cafeteria-norte',
  cafeteriaName: 'Kiosco Norte',
  quantity: 1,
};

function renderCart() {
  return render(
    <MemoryRouter>
      <CartPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('carrito web (INT2-60)', () => {
  it('muestra el estado vacío y un acceso al catálogo', () => {
    renderCart();

    expect(screen.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir al catálogo' }).getAttribute('href')).toBe('/catalogo');
  });

  it('agrupa por cafetería, calcula subtotales y limita la cantidad al stock', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([itemA, itemB, itemC]));
    renderCart();

    expect(screen.getAllByRole('heading', { name: 'Cafetería Central' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Kiosco Norte' })).toBeTruthy();
    expect(screen.getByText('Subtotal Cafetería Central:')).toBeTruthy();

    const quantity = screen.getByLabelText(
      'Cantidad de Latte en Cafetería Central',
    ) as HTMLInputElement;
    fireEvent.change(quantity, { target: { value: '10' } });

    expect(readCartItems().find((item) => item.offerId === itemA.offerId)?.quantity).toBe(5);
  });

  it('permite quitar productos y muestra el estado vacío al quitar el último', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([itemA]));
    renderCart();

    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(readCartItems()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeTruthy();
  });

  it('permite incrementar y decrementar unidades respetando los límites', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([itemA]));
    renderCart();

    fireEvent.click(screen.getByRole('button', {
      name: 'Agregar una unidad de Latte de Cafetería Central',
    }));
    expect(readCartItems()[0].quantity).toBe(3);

    fireEvent.click(screen.getByRole('button', {
      name: 'Quitar una unidad de Latte de Cafetería Central',
    }));
    expect(readCartItems()[0].quantity).toBe(2);
  });
});
