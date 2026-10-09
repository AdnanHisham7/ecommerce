/**
 * IST (Indian Standard Time, UTC+5:30) Date and Time Formatting Helpers
 *
 * Ensures all dates and timestamps stored in UTC in MongoDB are rendered
 * consistently in IST across both customer and admin portals.
 */

const TIME_ZONE_IST = 'Asia/Kolkata';

/**
 * Format a date/timestamp to IST Date + Time
 * e.g., "09 Oct 2026, 03:30 pm"
 */
function formatISTDateTime(date, options = {}) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleString('en-IN', {
    timeZone: TIME_ZONE_IST,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options,
  });
}

/**
 * Format a date to IST Date only
 * e.g., "9 Oct 2026" or "9 October 2026"
 */
function formatISTDate(date, options = {}) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleDateString('en-IN', {
    timeZone: TIME_ZONE_IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

/**
 * Format a date to IST Time only
 * e.g., "03:30 pm"
 */
function formatISTTime(date, options = {}) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';

  return d.toLocaleTimeString('en-IN', {
    timeZone: TIME_ZONE_IST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options,
  });
}

module.exports = {
  TIME_ZONE_IST,
  formatISTDateTime,
  formatISTDate,
  formatISTTime,
};
