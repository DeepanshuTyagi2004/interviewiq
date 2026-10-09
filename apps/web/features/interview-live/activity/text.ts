/**
 * Length caps for text that goes to the worker. The worker counts characters (code points) and rejects a whole batch
 * over its limits or holding a lone surrogate, so a cap that cut an emoji in half would silently lose every event
 * in that batch. Cut by code point, and drop a half emoji that was already there.
 */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

export const wellFormed = (text: string): string => text.replace(LONE_SURROGATE, '')

export function capCodePoints(text: string, max: number): string {
  const clean = wellFormed(text)
  if (clean.length <= max) return clean // UTF-16 units are never fewer than characters
  return Array.from(clean).slice(0, max).join('')
}
