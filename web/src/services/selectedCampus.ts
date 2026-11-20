import { useSyncExternalStore } from 'react';
import type { Campus } from './catalog';
const key = 'cloudcoffee:campus';
const event = 'campus:change';
export function selectedCampusId(): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
export function selectCampus(campus: Campus): void {
  try { localStorage.setItem(key, campus.id); } catch { /* URL preserves the choice when storage is unavailable. */ }
  window.dispatchEvent(new Event(event));
}
function subscribe(callback: () => void) {
  window.addEventListener(event, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener('storage', callback); };
}
export function useSelectedCampusId() { return useSyncExternalStore(subscribe, selectedCampusId, () => ''); }
