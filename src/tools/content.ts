/** Pull text or JSON out of a Strands tool-result content list. */
export function contentPayload(content: ReadonlyArray<unknown>): string {
  return content
    .map((c) => {
      if (!c || typeof c !== 'object') return ''
      const o = c as { text?: unknown; json?: unknown }
      if (typeof o.text === 'string' && o.text.length) return o.text
      if (o.json !== undefined) return JSON.stringify(o.json)
      return ''
    })
    .join('')
}
