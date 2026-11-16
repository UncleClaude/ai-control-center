import type { WebContents } from 'electron'
import type { AiUsage, UsageSnapshot, UsageWindow } from '../shared/protocol'

/** One AI view the reader can query (its signed-in session lives in its web contents). */
export interface UsageTarget {
  id: string
  /** Adapter name (claude, chatgpt…); undefined for the generic one. */
  adapter: string | undefined
  wc: WebContents | undefined
}

/** Raw shape a page-side reader script returns. */
type RawResult = { loggedOut?: boolean; error?: string; usage?: unknown }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface Reader {
  /** JS evaluated IN the page (main world); returns a RawResult. Only reads usage numbers. */
  script: string
  parse(usage: Record<string, unknown>): { plan: string | null; windows: UsageWindow[] }
}

function pct(n: unknown): number | null {
  return typeof n === 'number' && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
}

/** Human label for a rolling window given its length in seconds. */
function windowLabel(seconds: number): string {
  const h = Math.round(seconds / 3600)
  if (seconds <= 3600) return '1 h'
  if (h < 24) return `${h} h`
  const d = Math.round(seconds / 86_400)
  if (d === 1) return '24 h'
  if (d === 7) return 'Semaine'
  if (d >= 28 && d <= 31) return '30 jours'
  return `${d} jours`
}

function prettyPlan(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('free')) return 'Free'
  if (s.includes('pro')) return 'Pro'
  if (s.includes('plus')) return 'Plus'
  if (s.includes('max')) return 'Max'
  if (s.includes('team')) return 'Team'
  if (s.includes('enterprise')) return 'Enterprise'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const readers: Record<string, Reader> = {
  // claude.ai — cookie-authenticated same-origin endpoints.
  claude: {
    script: `(async () => {
      try {
        if (!location.hostname.endsWith('claude.ai')) return { loggedOut: true };
        const orgRes = await fetch('/api/organizations', { headers: { accept: 'application/json' } });
        if (orgRes.status === 401 || orgRes.status === 403) return { loggedOut: true };
        if (!orgRes.ok) return { error: 'orgs ' + orgRes.status };
        const list = await orgRes.json();
        const org = Array.isArray(list) ? (list.find(o => o && o.uuid) || list[0]) : null;
        if (!org || !org.uuid) return { error: 'no-org' };
        const r = await fetch('/api/organizations/' + org.uuid + '/usage', { headers: { accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) return { loggedOut: true };
        if (!r.ok) return { error: 'usage ' + r.status };
        return { usage: await r.json() };
      } catch (e) { return { error: String((e && e.message) || e) }; }
    })()`,
    parse(u) {
      const windows: UsageWindow[] = []
      const add = (key: string, label: string) => {
        const w = u[key] as { utilization?: number; resets_at?: string } | null | undefined
        const p = pct(w?.utilization)
        if (w && p !== null) windows.push({ label, usedPercent: p, resetsAt: w.resets_at ? Date.parse(w.resets_at) : null })
      }
      add('five_hour', '5 heures')
      add('seven_day', 'Semaine')
      add('seven_day_opus', 'Opus · semaine')
      add('seven_day_sonnet', 'Sonnet · semaine')
      return { plan: null, windows }
    },
  },
  // chatgpt.com — needs the session bearer token, then the wham usage endpoint.
  chatgpt: {
    script: `(async () => {
      try {
        if (!location.hostname.endsWith('chatgpt.com')) return { loggedOut: true };
        const s = await fetch('/api/auth/session', { headers: { accept: 'application/json' } });
        if (!s.ok) return { loggedOut: true };
        const sess = await s.json();
        const tok = sess && sess.accessToken;
        if (!tok) return { loggedOut: true };
        const r = await fetch('/backend-api/wham/usage', { headers: { authorization: 'Bearer ' + tok, accept: 'application/json' } });
        if (r.status === 401 || r.status === 403) return { loggedOut: true };
        if (!r.ok) return { error: 'usage ' + r.status };
        return { usage: await r.json() };
      } catch (e) { return { error: String((e && e.message) || e) }; }
    })()`,
    parse(u) {
      const windows: UsageWindow[] = []
      const rl = u.rate_limit as
        | { primary_window?: Record<string, unknown>; secondary_window?: Record<string, unknown> }
        | undefined
      const toWindow = (w: Record<string, unknown> | undefined): UsageWindow | null => {
        if (!w) return null
        const p = pct(w.used_percent)
        if (p === null) return null
        const secs = typeof w.limit_window_seconds === 'number' ? w.limit_window_seconds : 0
        let resetsAt: number | null = null
        if (typeof w.reset_at === 'number') resetsAt = w.reset_at * 1000
        else if (typeof w.reset_after_seconds === 'number') resetsAt = Date.now() + w.reset_after_seconds * 1000
        return { label: secs ? windowLabel(secs) : 'Limite', usedPercent: p, resetsAt }
      }
      const a = toWindow(rl?.primary_window)
      const b = toWindow(rl?.secondary_window)
      if (a) windows.push(a)
      if (b) windows.push(b)
      const planType = typeof u.plan_type === 'string' ? u.plan_type : null
      return { plan: planType ? prettyPlan(planType) : null, windows }
    },
  },
}

function runInView(wc: WebContents, script: string, timeoutMs: number): Promise<RawResult> {
  return Promise.race([
    wc.executeJavaScript(script, true) as Promise<RawResult>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ])
}

function evalInView<T>(wc: WebContents, script: string, timeoutMs: number): Promise<T> {
  return Promise.race([
    wc.executeJavaScript(script, true) as Promise<T>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ])
}

// ---------- Muse (Meta) ----------
// Muse has no stable usage API: the numbers come from a Next.js server action that only fires when
// the Settings dialog opens. So the reader opens Settings in the (hidden) view, reads the value, and
// closes it again. These scripts run in the page; the open/close keystrokes are trusted input events.

/** Locates the dock "Settings" reveal button; returns its viewport centre, {lo:true}, or {x:null}. */
const MUSE_DOCK_RECT = `(() => {
  if (!location.hostname.endsWith('muse.ai')) return { lo: true };
  var vis = function (e) { var r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  var d = [].slice.call(document.querySelectorAll('button,[role=button]')).find(function (e) {
    return /settings/i.test((e.getAttribute('aria-label') || '').trim()) && /dock|reveal/i.test(e.className) && vis(e);
  });
  if (!d) return { x: null };
  var r = d.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`

/** Locates the "Settings" item in the opened dock menu; returns its viewport centre or {x:null}. */
const MUSE_MENU_RECT = `(() => {
  var vis = function (e) { var r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  var cands = [].slice.call(document.querySelectorAll('*')).filter(function (e) {
    var t = (e.textContent || '').trim();
    return /^Settings/i.test(t) && t.length < 30 && vis(e) && e.querySelectorAll('*').length < 6;
  });
  var el = cands[cands.length - 1];
  if (!el) return { x: null };
  var r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`

/** Installs a one-shot fetch hook that captures the subscription server-action response. */
const MUSE_HOOK = `(() => {
  if (!location.hostname.endsWith('muse.ai')) return 'logged-out';
  window.__aiccMuseSub = null;
  if (!window.__aiccMuseHook) {
    window.__aiccMuseHook = true;
    var of = window.fetch;
    window.fetch = function () {
      var p = of.apply(this, arguments);
      try { p.then(function (r) { try { r.clone().text().then(function (t) {
        if (t && t.indexOf('"subscription"') >= 0 && t.indexOf('percentUsed') >= 0) window.__aiccMuseSub = t;
      }).catch(function(){}); } catch (e) {} }).catch(function(){}); } catch (e) {}
      return p;
    };
  }
  return 'ok';
})()`

/** Returns {ok, plan, windows} once the usage is available (structured response or rendered DOM). */
const MUSE_EXTRACT = `(() => {
  var pct = function (n) { return (typeof n === 'number' && isFinite(n)) ? Math.max(0, Math.min(100, Math.round(n))) : null; };
  // 1) Prefer the structured server-action payload captured by the hook.
  try {
    var raw = window.__aiccMuseSub;
    if (raw) {
      var sub = null, lines = String(raw).split('\\n');
      for (var i = 0; i < lines.length; i++) {
        var c = lines[i].indexOf(':');
        if (c > 0) { try { var o = JSON.parse(lines[i].slice(c + 1)); if (o && o.subscription) { sub = o.subscription; break; } } catch (e) {} }
      }
      if (sub) {
        var windows = [];
        if (sub.usage && pct(sub.usage.percentUsed) !== null) {
          windows.push({ label: 'Hebdomadaire', usedPercent: pct(sub.usage.percentUsed), resetsAt: sub.usage.resetsAt ? sub.usage.resetsAt * 1000 : null });
        }
        if (typeof sub.topupTotal === 'number' && sub.topupTotal > 0 && typeof sub.topupBalance === 'number') {
          var used = pct((1 - sub.topupBalance / sub.topupTotal) * 100);
          var left = sub.topupRowValueLabel || null;
          windows.push({ label: 'Tokens bonus', usedPercent: used, resetsAt: null, note: left });
        }
        return { ok: true, plan: (sub.tier && sub.tier.name) || null, windows: windows };
      }
    }
  } catch (e) {}
  // 2) Fallback: read the rendered Usage rows from the open Settings dialog.
  try {
    var txt = document.body ? document.body.innerText : '';
    if (!/Weekly limit|% used|Usage/i.test(txt)) return { ok: false };
    var ls = txt.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var wins = [], plan = null;
    for (var j = 0; j < ls.length; j++) {
      var mm = ls[j].match(/(\\d{1,3})%\\s*used/i);
      if (mm) {
        var label = (ls[j - 1] && !/%/.test(ls[j - 1])) ? ls[j - 1] : 'Usage';
        if (/free|plan|pro|max/i.test(label) && !plan) plan = label;
        wins.push({ label: /token|additional/i.test(label) ? 'Tokens bonus' : 'Hebdomadaire', usedPercent: parseInt(mm[1], 10), resetsAt: null });
      }
    }
    if (wins.length) return { ok: true, plan: plan, windows: wins };
  } catch (e) {}
  return { ok: false };
})()`

const unsupported = (id: string): AiUsage => ({
  id,
  status: 'unsupported',
  plan: null,
  windows: [],
  detail: 'Ce service ne publie pas de quota.',
  fetchedAt: null,
})

/**
 * Reads each AI's official quota live from its signed-in session, with a short cache so reopening
 * the dashboard is instant. Nothing is persisted; only usage percentages and the plan name are read.
 */
class UsageReader {
  private cache: UsageSnapshot | null = null

  async snapshot(targets: UsageTarget[], force = false): Promise<UsageSnapshot> {
    const now = Date.now()
    if (!force && this.cache && now - this.cache.generatedAt < 15_000) {
      // Keep only the AIs still present, in the requested order.
      const ais: Record<string, AiUsage> = {}
      for (const t of targets) ais[t.id] = this.cache.ais[t.id] ?? unsupported(t.id)
      return { generatedAt: this.cache.generatedAt, ais }
    }
    const entries = await Promise.all(targets.map(async (t) => [t.id, await this.read(t)] as const))
    this.cache = { generatedAt: now, ais: Object.fromEntries(entries) }
    return this.cache
  }

  private async read(t: UsageTarget): Promise<AiUsage> {
    if (t.adapter === 'muse') return this.readMuse(t)
    const reader = t.adapter ? readers[t.adapter] : undefined
    if (!reader) return unsupported(t.id)
    if (!t.wc || t.wc.isDestroyed()) {
      return { id: t.id, status: 'error', plan: null, windows: [], detail: 'Vue non chargée.', fetchedAt: null }
    }
    try {
      const raw = await runInView(t.wc, reader.script, 8_000)
      if (!raw || raw.loggedOut) {
        return { id: t.id, status: 'logged-out', plan: null, windows: [], detail: 'Non connecté à ce service.', fetchedAt: null }
      }
      if (raw.error || !raw.usage) {
        return { id: t.id, status: 'error', plan: null, windows: [], detail: 'Quota indisponible pour le moment.', fetchedAt: null }
      }
      const { plan, windows } = reader.parse(raw.usage as Record<string, unknown>)
      if (!windows.length) {
        return { id: t.id, status: 'error', plan, windows: [], detail: 'Aucune donnée d’usage renvoyée.', fetchedAt: null }
      }
      return { id: t.id, status: 'ok', plan, windows, detail: null, fetchedAt: Date.now() }
    } catch {
      return { id: t.id, status: 'error', plan: null, windows: [], detail: 'Lecture du quota impossible.', fetchedAt: null }
    }
  }

  /**
   * Muse: open its Settings (trusted Ctrl+,) in the hidden view, read the usage, close it (Escape).
   * The dashboard overlay already hides the view, so the user never sees the dialog.
   */
  private async readMuse(t: UsageTarget): Promise<AiUsage> {
    const wc = t.wc
    const fail = (detail: string, status: AiUsage['status'] = 'error'): AiUsage => ({ id: t.id, status, plan: null, windows: [], detail, fetchedAt: null })
    if (!wc || wc.isDestroyed()) return fail('Vue non chargée.')
    const clickAt = (x: number, y: number) => {
      try {
        wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      } catch {
        /* view gone */
      }
    }
    const escape = () => {
      try {
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      } catch {
        /* view gone */
      }
    }
    try {
      const hook = await evalInView<string>(wc, MUSE_HOOK, 4_000)
      if (hook !== 'ok') return fail('Non connecté à ce service.', 'logged-out')
      // Open the dock menu, then the Settings item (locations read live from the DOM).
      // Mouse / key events are injected by coordinate, so the view is never focused — focusing the
      // hidden view would steal input focus from the shell (settings become unclickable on Wayland).
      const dock = await evalInView<{ lo?: boolean; x?: number | null; y?: number }>(wc, MUSE_DOCK_RECT, 3_000).catch(() => null)
      if (dock?.lo) return fail('Non connecté à ce service.', 'logged-out')
      if (!dock || dock.x == null) return fail('Ouvre une fois les Réglages de Muse, puis réessaie.')
      clickAt(dock.x, dock.y!)
      await sleep(800)
      const item = await evalInView<{ x?: number | null; y?: number }>(wc, MUSE_MENU_RECT, 3_000).catch(() => null)
      if (item && item.x != null) clickAt(item.x, item.y!)
      type MuseExtract = { ok?: boolean; plan?: string | null; windows?: { label: string; usedPercent: number; resetsAt: number | null }[] }
      let data: MuseExtract | null = null
      for (let i = 0; i < 18; i++) {
        await sleep(300)
        data = await evalInView<MuseExtract>(wc, MUSE_EXTRACT, 2_000).catch(() => null)
        if (data && data.ok) break
      }
      escape() // close Settings (and the dock menu if still open)
      if (!data || !data.ok || !data.windows || !data.windows.length) {
        return fail('Ouvre une fois les Réglages de Muse, puis réessaie.')
      }
      const windows: UsageWindow[] = data.windows.map((w) => ({
        label: String(w.label),
        usedPercent: Math.max(0, Math.min(100, Math.round(Number(w.usedPercent) || 0))),
        resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt : null,
      }))
      return { id: t.id, status: 'ok', plan: data.plan ?? null, windows, detail: null, fetchedAt: Date.now() }
    } catch {
      return fail('Lecture du quota impossible.')
    }
  }
}

export const usage = new UsageReader()
