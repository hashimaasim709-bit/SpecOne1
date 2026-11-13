// Business intelligence: dashboard KPIs, revenue & profit series, customer lifetime
// value, per-job profit and the tax-year ledger.
import { addDays, todayIn } from '../../shared/format';
import { estimateTax, taxYearFor } from '../../shared/pricing';
import { all, first } from '../lib/db';
import type { Settings } from '../lib/settings';

const num = (v: unknown): number => Number(v ?? 0) || 0;

export interface SeriesPoint {
  key: string;
  label: string;
  revenue: number;
  costs: number;
  profit: number;
  jobs: number;
}

/** Revenue is recognised on completed jobs by job date; costs by the date they were incurred. */
async function series(db: D1Database, grain: 'week' | 'month', from: string, to: string): Promise<SeriesPoint[]> {
  const fmt = grain === 'week' ? "strftime('%Y-%W', {col})" : "strftime('%Y-%m', {col})";
  const [rev, exp, com] = await Promise.all([
    all<{ k: string; revenue: number; jobs: number }>(db, `SELECT ${fmt.replace('{col}', 'date')} AS k, SUM(total) AS revenue, COUNT(*) AS jobs FROM bookings WHERE status = 'completed' AND date BETWEEN ? AND ? GROUP BY k`, from, to),
    all<{ k: string; costs: number }>(db, `SELECT ${fmt.replace('{col}', 'spent_on')} AS k, SUM(amount) AS costs FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY k`, from, to),
    all<{ k: string; costs: number }>(db, `SELECT ${fmt.replace('{col}', 'b.date')} AS k, SUM(c.amount) AS costs FROM commissions c JOIN bookings b ON b.id = c.booking_id WHERE c.status <> 'void' AND b.date BETWEEN ? AND ? GROUP BY k`, from, to),
  ]);
  const map = new Map<string, SeriesPoint>();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Pre-fill every bucket so quiet periods still appear as zero.
  if (grain === 'month') {
    const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
    const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
    while (d <= end) {
      const key = d.toISOString().slice(0, 7);
      map.set(key, { key, label: `${monthNames[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, revenue: 0, costs: 0, profit: 0, jobs: 0 });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  } else {
    for (let day = from; day <= to; day = addDays(day, 7)) {
      const dt = new Date(`${day}T00:00:00Z`);
      const key = weekKey(dt);
      if (!map.has(key)) map.set(key, { key, label: `${dt.getUTCDate()} ${monthNames[dt.getUTCMonth()]}`, revenue: 0, costs: 0, profit: 0, jobs: 0 });
    }
  }
  const bucket = (k: string): SeriesPoint => {
    let p = map.get(k);
    if (!p) {
      p = { key: k, label: k, revenue: 0, costs: 0, profit: 0, jobs: 0 };
      map.set(k, p);
    }
    return p;
  };
  for (const r of rev) Object.assign(bucket(r.k), { revenue: num(r.revenue), jobs: num(r.jobs) });
  for (const r of exp) bucket(r.k).costs += num(r.costs);
  for (const r of com) bucket(r.k).costs += num(r.costs);
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map((p) => ({ ...p, profit: p.revenue - p.costs }));
}

/** Matches SQLite's strftime('%Y-%W'): week of year with Monday as the first day. */
function weekKey(d: Date): string {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - start) / 86400000);
  const weekday = (d.getUTCDay() + 6) % 7;
  return `${d.getUTCFullYear()}-${String(Math.floor((dayOfYear + 7 - weekday) / 7)).padStart(2, '0')}`;
}

export async function dashboard(db: D1Database, settings: Settings, withFinance: boolean): Promise<Record<string, unknown>> {
  const today = todayIn(settings.business.timezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [todayJobs, upcoming, pending, unread, lowStock, licences] = await Promise.all([
    all(db, `SELECT b.id, b.ref, b.status, b.slot, b.emergency, b.address, b.postcode, b.total, c.name AS customer_name, c.phone AS customer_phone,
             (SELECT GROUP_CONCAT(v.reg || ' ' || v.make || ' ' || v.model, ' · ') FROM booking_vehicles bv JOIN vehicles v ON v.id = bv.vehicle_id WHERE bv.booking_id = b.id) AS vehicles
             FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.date = ? AND b.status NOT IN ('cancelled','no_show')
             ORDER BY CASE b.slot WHEN 'asap' THEN 0 WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3 END, b.id`, today),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bookings WHERE date > ? AND date <= ? AND status IN ('pending','confirmed')", today, addDays(today, 7)),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'"),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM chat_threads WHERE unread > 0 AND status = 'open'"),
    all(db, 'SELECT id, name, stock, min_stock, unit FROM inventory WHERE stock <= min_stock ORDER BY (stock - min_stock) LIMIT 12'),
    all(db, 'SELECT id, name, expires_on, tokens_left FROM licences WHERE (expires_on IS NOT NULL AND expires_on <= ?) OR (tokens_left IS NOT NULL AND tokens_left <= 5) ORDER BY expires_on LIMIT 12', addDays(today, 45)),
  ]);
  const base = { today, todayJobs, upcomingWeek: num(upcoming?.n), pending: num(pending?.n), unreadChats: num(unread?.n), lowStock, licences };
  if (!withFinance) return base;

  const [mtd, mtdCosts, outstanding, newCustomers, weekly, monthly, topServices, byCategory, sources] = await Promise.all([
    first<{ revenue: number; jobs: number }>(db, "SELECT SUM(total) AS revenue, COUNT(*) AS jobs FROM bookings WHERE status = 'completed' AND date BETWEEN ? AND ?", monthStart, today),
    first<{ costs: number }>(db, 'SELECT SUM(amount) AS costs FROM expenses WHERE spent_on BETWEEN ? AND ?', monthStart, today),
    first<{ owed: number; n: number }>(db, "SELECT SUM(total - paid_amount) AS owed, COUNT(*) AS n FROM bookings WHERE status = 'completed' AND paid_amount < total"),
    first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?', `${monthStart}T00:00:00Z`),
    series(db, 'week', addDays(today, -7 * 11), today),
    series(db, 'month', addDays(`${today.slice(0, 7)}-01`, -335), today),
    all(db, `SELECT bi.name, COUNT(*) AS jobs, SUM(ROUND(bi.qty * bi.unit_price)) AS revenue FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
             WHERE b.status = 'completed' AND b.date >= ? GROUP BY bi.name ORDER BY revenue DESC LIMIT 6`, addDays(today, -90)),
    all(db, `SELECT COALESCE(p.category, bi.kind) AS category, SUM(ROUND(bi.qty * bi.unit_price)) AS revenue FROM booking_items bi JOIN bookings b ON b.id = bi.booking_id
             LEFT JOIN packages p ON p.id = bi.package_id WHERE b.status = 'completed' AND b.date >= ? GROUP BY category ORDER BY revenue DESC`, addDays(today, -90)),
    all(db, "SELECT source, COUNT(*) AS jobs FROM bookings WHERE date >= ? AND status <> 'cancelled' GROUP BY source ORDER BY jobs DESC", addDays(today, -90)),
  ]);
  const revenue = num(mtd?.revenue);
  const costs = num(mtdCosts?.costs);
  return {
    ...base,
    kpis: { revenueMtd: revenue, costsMtd: costs, profitMtd: revenue - costs, jobsMtd: num(mtd?.jobs), avgJob: num(mtd?.jobs) ? Math.round(revenue / num(mtd?.jobs)) : 0, outstanding: num(outstanding?.owed), outstandingJobs: num(outstanding?.n), newCustomers: num(newCustomers?.n) },
    weekly, monthly, topServices, byCategory, sources,
  };
}

/** Customer lifetime value: total spend, visit count and vehicles for every customer. */
export async function lifetimeValue(db: D1Database, limit = 100): Promise<Record<string, unknown>> {
  const customers = await all(
    db,
    `SELECT c.id, c.name, c.phone, c.email, c.loyalty_points,
            COUNT(b.id) AS jobs, COALESCE(SUM(b.total), 0) AS spend, MIN(b.date) AS first_job, MAX(b.date) AS last_job,
            (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id) AS vehicles
     FROM customers c LEFT JOIN bookings b ON b.customer_id = c.id AND b.status = 'completed'
     GROUP BY c.id ORDER BY spend DESC, c.id DESC LIMIT ?`, limit,
  );
  const totals = await first<{ customers: number; repeaters: number; revenue: number }>(
    db,
    `SELECT COUNT(*) AS customers, SUM(CASE WHEN jobs > 1 THEN 1 ELSE 0 END) AS repeaters, SUM(spend) AS revenue
     FROM (SELECT customer_id, COUNT(*) AS jobs, SUM(total) AS spend FROM bookings WHERE status = 'completed' GROUP BY customer_id)`,
  );
  const paying = num(totals?.customers);
  return { customers, summary: { payingCustomers: paying, repeatRate: paying ? num(totals?.repeaters) / paying : 0, averageLtv: paying ? Math.round(num(totals?.revenue) / paying) : 0 } };
}

/** True net profit for one job: what was charged, less linked costs and partner commission. */
export async function jobProfit(db: D1Database, bookingId: number): Promise<{ revenue: number; costs: number; commission: number; profit: number; margin: number }> {
  const [b, costs, commission] = await Promise.all([
    first<{ total: number }>(db, 'SELECT total FROM bookings WHERE id = ?', bookingId),
    first<{ s: number }>(db, 'SELECT SUM(amount) AS s FROM expenses WHERE booking_id = ?', bookingId),
    first<{ s: number }>(db, "SELECT SUM(amount) AS s FROM commissions WHERE booking_id = ? AND status <> 'void'", bookingId),
  ]);
  const revenue = num(b?.total);
  const profit = revenue - num(costs?.s) - num(commission?.s);
  return { revenue, costs: num(costs?.s), commission: num(commission?.s), profit, margin: revenue ? profit / revenue : 0 };
}

/** Ledger and tax estimate for the tax year containing `date`. */
export async function taxLedger(db: D1Database, settings: Settings, date: string): Promise<Record<string, unknown>> {
  const t = settings.tax;
  const year = taxYearFor(date, t.taxYearStartMonth, t.taxYearStartDay);
  const [income, expenseRows, commission, months] = await Promise.all([
    first<{ s: number; n: number }>(db, "SELECT SUM(total) AS s, COUNT(*) AS n FROM bookings WHERE status = 'completed' AND date BETWEEN ? AND ?", year.start, year.end),
    all<{ category: string; total: number; vat: number; n: number }>(db, 'SELECT category, SUM(amount) AS total, SUM(vat_amount) AS vat, COUNT(*) AS n FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', year.start, year.end),
    first<{ s: number }>(db, "SELECT SUM(c.amount) AS s FROM commissions c JOIN bookings b ON b.id = c.booking_id WHERE c.status <> 'void' AND b.date BETWEEN ? AND ?", year.start, year.end),
    series(db, 'month', year.start, year.end < date ? year.end : date),
  ]);
  const turnover = num(income?.s);
  const expenses = expenseRows.reduce((s, r) => s + num(r.total), 0) + num(commission?.s);
  const profit = turnover - expenses;
  const today = todayIn(settings.business.timezone);
  // Project the year-end position from the run-rate so far.
  const elapsed = Math.max(1, Math.min(365, Math.round((Date.parse(`${today < year.end ? today : year.end}T00:00:00Z`) - Date.parse(`${year.start}T00:00:00Z`)) / 86400000) + 1));
  const projectedProfit = Math.round((profit / elapsed) * 365);
  return {
    year, turnover, jobs: num(income?.n), expenses, commission: num(commission?.s), profit,
    expenseCategories: expenseRows, months,
    estimate: estimateTax(profit, t), projectedProfit, projectedEstimate: estimateTax(projectedProfit, t),
    vatThresholdNote: turnover > 80_000_00 ? 'Turnover is approaching or above the VAT registration threshold — speak to your accountant.' : '',
    note: t.setAsideNote,
  };
}
