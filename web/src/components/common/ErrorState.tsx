export function ErrorState({ message = "Ha ocurrido un error inesperado" }: { message?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-text-main)' }}>
      <svg
        style={{ color: '#ef4444', marginBottom: '1rem' }}
        width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <h3 style={{ marginBottom: '0.5rem' }}>Oops! Algo salio mal</h3>
      <p style={{ color: 'var(--color-text-muted)' }}>{message}</p>
    </div>
  );
}
