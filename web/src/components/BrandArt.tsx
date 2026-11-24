export function BrandArt({ className = '' }: { className?: string }) {
  return <div className={`brand-art ${className}`} aria-hidden="true"><span className="brand-art-circle" /><img src="/brand/mascota-cafe.png" alt="" /></div>;
}
