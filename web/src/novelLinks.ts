export function novelPageUrl(id: number, from?: number): string {
  const params = new URLSearchParams({ view: 'novel', id: String(id) });
  if (from && from !== id) params.set('from', String(from));
  return `${import.meta.env.BASE_URL}?${params.toString()}`;
}
