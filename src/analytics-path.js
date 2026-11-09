// Only these public page labels may enter the statistics request.
export function analyticsPath(value) {
  if (typeof value !== 'string' || value.length > 180) return null;
  if (['/', '/projetos/', '/sobre/', '/contato/', '/privacidade/'].includes(value)) return value;
  return /^\/projetos\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(value) ? value : null;
}

export function analyticsURL(path, base) {
  if (!analyticsPath(path)) return base;
  return path !== '/projetos/' && path.startsWith('/projetos/')
    ? `${base}projeto/?trabalho=${encodeURIComponent(path.slice('/projetos/'.length, -1))}`
    : base + path.slice(1);
}

export function brazilDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function offsetDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function summarizeViews(rows, period = 30, today = brazilDay()) {
  const start = offsetDay(today, 1 - period), week = offsetDay(today, -6), month = offsetDay(today, -29);
  const result = { today: 0, week: 0, month: 0, total: 0, pages: [], days: [] };
  const pages = new Map(), days = new Map();
  for (const row of rows) {
    const views = Number(row.views), path = analyticsPath(row.page_path), day = row.view_day;
    if (!path || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !Number.isSafeInteger(views) || views < 0 || day > today) continue;
    if (day === today) result.today += views;
    if (day >= week) result.week += views;
    if (day >= month) result.month += views;
    if (day >= start) {
      result.total += views;
      pages.set(path, (pages.get(path) || 0) + views);
      days.set(day, (days.get(day) || 0) + views);
    }
  }
  result.pages = [...pages].map(([path, views]) => ({ path, views })).sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));
  for (let i = 0; i < period; i++) { const day = offsetDay(start, i); result.days.push({ day, views: days.get(day) || 0 }); }
  return result;
}
