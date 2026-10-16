import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './contexts/AuthContext';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('No se encontró el elemento raíz de la aplicación');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider> {/* Envolver la app */}
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
