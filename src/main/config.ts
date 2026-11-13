import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import defaults from '../../config/ais.default.json'
import { resourcePath } from './paths'

const AiSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'id: lettres minuscules, chiffres et tirets'),
  name: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  icon: z.string().optional(),
  /** Accent colour (CSS hex) used for the glow behind the chrome when this AI is active. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Domains (and their subdomains) the view may navigate to. The url's own host is always added. */
  allowedDomains: z.array(z.string()).default([]),
  /** Name of a DOM adapter in src/adapters (claude, chatgpt, muse). Omit for the generic one. */
  adapter: z.string().optional(),
  userAgent: z.string().optional(),
  enabled: z.boolean().default(true),
})

const ConfigSchema = z.object({ ais: z.array(AiSchema).min(1) })

/** A raw ais.json entry (schema-validated, defaults applied), before icon/accent resolution. */
export type RawAi = z.infer<typeof AiSchema>

export type AiConfig = RawAi & {
  iconDataUrl: string
  /** Raster icon for native notifications (they cannot render SVG); null = app icon. */
  iconPng: string | null
  accent: string
}

const BUILTIN = ConfigSchema.parse(defaults).ais
const BUILTIN_IDS = new Set(BUILTIN.map((a) => a.id))
const BUILTIN_BY_ID = new Map(BUILTIN.map((a) => [a.id, a]))

/** True for the three bundled AIs: they can be hidden but never deleted. */
export function isBuiltInId(id: string): boolean {
  return BUILTIN_IDS.has(id)
}

/** The bundled icon reference for a built-in AI (used when resetting a custom logo). */
export function builtInIconName(id: string): string | undefined {
  return BUILTIN_BY_ID.get(id)?.icon
}

/** Folder holding user-supplied logos, next to ais.json. */
export function customIconDir(): string {
  return join(dirname(configFilePath()), 'custom-icons')
}

export function configFilePath(): string {
  return join(app.getPath('userData'), 'ais.json')
}

/** Reads ais.json as a raw array — all entries, disabled ones included (created on first run). */
export function loadRawConfig(): RawAi[] {
  const file = configFilePath()
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(defaults, null, 2) + '\n')
  }
  try {
    const parsed = ConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
    const ids = parsed.ais.map((a) => a.id)
    const dup = ids.find((id, i) => ids.indexOf(id) !== i)
    if (dup) throw new Error(`id en double : ${dup}`)
    return parsed.ais
  } catch (error) {
    console.error(`[config] ${file} invalide, utilisation des valeurs par défaut :`, error)
    return ConfigSchema.parse(defaults).ais
  }
}

/** Validates and writes the raw config array back to ais.json. */
export function saveRawConfig(ais: RawAi[]): void {
  const file = configFilePath()
  const data = ConfigSchema.parse({ ais })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

/** Resolves one raw entry into a runtime AiConfig (icon data URLs, accent fallback). */
export function materializeAi(ai: RawAi): AiConfig {
  const configDir = dirname(configFilePath())
  const host = new URL(ai.url).hostname.replace(/^www\./, '')
  const allowedDomains = [...new Set([host, ...ai.allowedDomains.map((d) => d.toLowerCase())])]
  return {
    ...ai,
    allowedDomains,
    // Configs written before a field existed fall back to the bundled default for that id.
    accent: ai.accent ?? BUILTIN_BY_ID.get(ai.id)?.accent ?? hashColor(ai.name),
    iconDataUrl: resolveIcon(ai.icon, ai.name, configDir),
    iconPng: resolvePng(ai.icon, configDir),
  }
}

/** Loads the user's ais.json (created from the bundled defaults on first run). */
export function loadAiConfig(): AiConfig[] {
  return loadRawConfig()
    .filter((ai) => ai.enabled)
    .map(materializeAi)
}

function resolveIcon(icon: string | undefined, name: string, configDir: string): string {
  if (icon?.startsWith('data:')) return icon
  if (icon) {
    const candidates = isAbsolute(icon) ? [icon] : [join(configDir, icon), resourcePath('icons', icon)]
    for (const path of candidates) {
      if (!existsSync(path)) continue
      const ext = extname(path).toLowerCase()
      const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : null
      if (mime) return `data:${mime};base64,${readFileSync(path).toString('base64')}`
    }
    console.warn(`[config] icône introuvable pour ${name} : ${icon}`)
  }
  return monogram(name)
}

/** PNG for notifications: the icon itself if raster, else a same-named .png next to the SVG. */
function resolvePng(icon: string | undefined, configDir: string): string | null {
  if (!icon || icon.startsWith('data:')) return null
  const png = icon.replace(/\.svg$/i, '.png')
  const candidates = isAbsolute(png) ? [png] : [join(configDir, png), resourcePath('icons', png)]
  return candidates.find((p) => /\.(png|jpe?g)$/i.test(p) && existsSync(p)) ?? null
}

function nameHue(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return hash % 360
}

function hashColor(name: string): string {
  // hsl(h 55% 48%) → hex
  const h = nameHue(name) / 360, s = 0.55, l = 0.48
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Fallback icon: first letter on a colour derived from the name. */
function monogram(name: string): string {
  const hue = nameHue(name)
  const letter = name.trim().charAt(0).toUpperCase().replace(/[<>&"]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="hsl(${hue} 55% 48%)"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" font-weight="600" text-anchor="middle" fill="#fff">${letter}</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
