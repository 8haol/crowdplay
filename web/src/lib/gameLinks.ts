export function joinUrl(token: string): string {
  return `${window.location.origin}/play/${token}`;
}

/** Projector link. Its own token, so the URL on the venue laptop opens nothing else. */
export function screenUrl(token: string): string {
  return `${window.location.origin}/screen/${token}`;
}

