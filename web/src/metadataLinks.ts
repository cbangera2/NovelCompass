export function browseFacetUrl(kind: 'genre' | 'tag', value: string): string {
  const params = new URLSearchParams({ view: 'browse', [kind]: value });
  return `${import.meta.env.BASE_URL}?${params.toString()}`;
}
