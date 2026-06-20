import sanitizeHtml from 'sanitize-html';

/**
 * Strip all HTML from user-generated text. Use on all UGC fields before persist.
 */
export function sanitizeInput(text: string): string {
  if (typeof text !== 'string') return '';
  const stripped = sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return stripped.trim();
}
