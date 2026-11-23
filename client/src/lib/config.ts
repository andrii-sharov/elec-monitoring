const defaultApiUrl = 'http://localhost:3000';

export function apiUrl(): string {
  const configured: string | undefined = import.meta.env.VITE_API_URL;
  return (configured || defaultApiUrl).replace(/\/+$/, '');
}
