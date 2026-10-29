const YOUTUBE_ID = /youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/;

/** Thumbnail for a YouTube embed URL, or undefined for other providers. */
export function youtubeThumbnail(embedUrl?: string): string | undefined {
  const id = embedUrl?.match(YOUTUBE_ID)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
}

export function isSoundcloud(embedUrl?: string): boolean {
  return Boolean(embedUrl && new URL(embedUrl).hostname.endsWith('soundcloud.com'));
}

/** Plain-text preview of a markdown body, trimmed to `max` characters. */
export function excerpt(markdown = '', max = 200): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\\*_>`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
