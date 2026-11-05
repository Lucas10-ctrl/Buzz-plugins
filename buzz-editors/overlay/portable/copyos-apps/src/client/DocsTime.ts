/** Compact "5m" / "3h" / "2d" times for comment bylines, the document list and the header. */
import { useEffect, useState } from 'react'

/** Format how long ago an ISO time was, in the compact form used across Docs chrome.
 * @param iso - Time to describe.
 * @param now - Current time in milliseconds.
 * @returns An empty string under a minute, `5m`, `3h`, `2d`, or a short date after a week.
 */
export function docsShortAgo(iso: string, now: number): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric',
    ...(new Date(time).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) })
}

/** Re-render once a minute so relative times stay current.
 * @returns The current time in milliseconds.
 */
export function useDocsNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  return now
}
