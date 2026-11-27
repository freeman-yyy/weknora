/**
 * Runtime branding.
 *
 * Reads `window.__BRANDING__` (defined in `public/branding.js`; in Docker the
 * compose file mounts `deploy/branding.js` over the baked-in copy) and
 * rewrites the WeKnora brand word inside i18n message bundles on the fly, so
 * deployments can rename the product by editing one file — no rebuild, no
 * container restart, a browser refresh is enough.
 *
 * Protected tokens (WeKnora Cloud / WeKnora CLI / WeKnora Skill /
 * X-WeKnora-Signature, …) point at real external products or protocol
 * headers and are never rewritten. Object keys are never rewritten either.
 */

export interface BrandingConfig {
  /** Unified brand name, wins over the per-locale variants. */
  APP_NAME?: string
  /** Brand name shown when the UI locale is Chinese. */
  APP_NAME_ZH?: string
  /** Brand name shown for every other UI locale. */
  APP_NAME_EN?: string
  /** Browser tab title; falls back to APP_NAME when empty. */
  APP_TITLE?: string
  /** Overrides the official website links. Reserved: the login page no
   *  longer shows a website button, so nothing consumes this today. */
  WEBSITE_URL?: string
  /** Overrides the login page logo image URL. */
  LOGO_URL?: string
  /** Overrides the platform sidebar logo image URL (independent of LOGO_URL). */
  SIDEBAR_LOGO_URL?: string
}

declare global {
  interface Window {
    __BRANDING__?: BrandingConfig
  }
}

const FALLBACK_BRAND = 'WeKnora'

const BUILT_IN_WEBSITE_URL = 'https://weknora.weixin.qq.com'

/**
 * Brand words that reference real external products / protocol headers.
 * Order matters only for readability — the list is sorted longest-first
 * before matching so overlapping prefixes cannot leak through.
 */
const PROTECTED_TOKENS = [
  'X-WeKnora-Signature',
  'WeKnora Cloud',
  'WeKnora Skill',
  'WeKnoraCloud',
  'WeKnora CLI',
].sort((a, b) => b.length - a.length)

// Private-use-area sentinels temporarily replace protected tokens during a
// rewrite; they cannot collide with natural message text.
const SENTINEL_START = '\uE000'
const SENTINEL_END = '\uE001'

const CJK_CHAR_CLASS =
  '[\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]'

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasCJK(text: string): boolean {
  return new RegExp(CJK_CHAR_CLASS).test(text)
}

/** Current branding config; `{}` outside the browser (tests / SSR). */
export function getBranding(): BrandingConfig {
  if (typeof window === 'undefined') return {}
  return window.__BRANDING__ ?? {}
}

/**
 * Brand name for a UI locale. `APP_NAME` wins over the per-locale variants;
 * an empty result means "leave bundle strings untouched".
 */
export function resolveBrandName(locale: string): string {
  const b = getBranding()
  const unified = clean(b.APP_NAME)
  if (unified) return unified
  if (locale.toLowerCase().startsWith('zh')) {
    return clean(b.APP_NAME_ZH) || clean(b.APP_NAME_EN)
  }
  return clean(b.APP_NAME_EN) || clean(b.APP_NAME_ZH)
}

/** Resolved brand name for display attributes (alt/title); falls back to WeKnora. */
export function brandDisplayName(locale: string): string {
  return resolveBrandName(locale) || FALLBACK_BRAND
}

/** Browser tab title: APP_TITLE, else APP_NAME, else '' (keep the built-in one). */
export function resolveAppTitle(): string {
  const b = getBranding()
  return clean(b.APP_TITLE) || clean(b.APP_NAME)
}

export interface BrandingLinks {
  website: string
  logo: string
  sidebarLogo: string
}

/** Link/logo overrides; each empty string means "use the built-in default". */
export function getBrandingLinks(): BrandingLinks {
  const b = getBranding()
  return {
    website: clean(b.WEBSITE_URL),
    logo: clean(b.LOGO_URL),
    sidebarLogo: clean(b.SIDEBAR_LOGO_URL),
  }
}

export function getWebsiteUrl(): string {
  return getBrandingLinks().website || BUILT_IN_WEBSITE_URL
}

/**
 * Drop the spaces a latin brand word needs around it once the replacement
 * name itself is CJK, e.g. "使用 WeKnora 助手" → "使用知识库助手".
 * Latin-only brand names keep CJK-latin spacing untouched.
 */
function tightenCJKSpacing(text: string, brand: string): string {
  if (!hasCJK(brand)) return text
  const esc = escapeRegExp(brand)
  const before = new RegExp(`(${CJK_CHAR_CLASS}) ${esc}`, 'g')
  const after = new RegExp(`${esc} (${CJK_CHAR_CLASS})`, 'g')
  let out = text
  for (;;) {
    let next = out.replace(before, (_match, c: string) => c + brand)
    next = next.replace(after, (_match, c: string) => brand + c)
    if (next === out) return next
    out = next
  }
}

/**
 * Rewrite the brand word in a single message string. Idempotent: running it
 * on already-rewritten text is a no-op (as long as the configured brand name
 * itself does not contain "WeKnora").
 */
export function transformBrandString(input: string, locale: string): string {
  const brand = resolveBrandName(locale)
  if (!brand || !input.includes(FALLBACK_BRAND)) return input

  // Stash protected tokens so the generic rewrite cannot touch them.
  const stash: string[] = []
  let text = input.replace(
    new RegExp(PROTECTED_TOKENS.map(escapeRegExp).join('|'), 'g'),
    (matched: string) => {
      stash.push(matched)
      return `${SENTINEL_START}${stash.length - 1}${SENTINEL_END}`
    },
  )

  text = text.replaceAll(FALLBACK_BRAND, brand)
  text = tightenCJKSpacing(text, brand)

  text = text.replace(
    new RegExp(`${SENTINEL_START}(\\d+)${SENTINEL_END}`, 'g'),
    (_match, index: string) => stash[Number(index)] ?? '',
  )
  return text
}

function transformValue(value: unknown, locale: string): unknown {
  if (typeof value === 'string') return transformBrandString(value, locale)
  if (Array.isArray(value)) return value.map((item) => transformValue(item, locale))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Keys (e.g. `weknoraTemplateTitle`) are internal identifiers — untouched.
      out[key] = transformValue(child, locale)
    }
    return out
  }
  return value
}

/**
 * Deep-clone an i18n message bundle with brand strings rewritten for the
 * given UI locale. The input bundle is never mutated, so callers can keep a
 * pristine snapshot and re-apply after the branding config changes.
 */
export function applyBrandingToMessages<T>(bundle: T, locale: string): T {
  const brand = resolveBrandName(locale)
  if (!brand) return bundle
  const transformed = transformValue(bundle, locale) as T
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[branding] applied "${brand}" to locale ${locale}`)
  }
  return transformed
}

/** Override document.title when APP_TITLE/APP_NAME is configured. */
export function applyDocumentTitle(): void {
  if (typeof document === 'undefined') return
  const title = resolveAppTitle()
  if (title) document.title = title
}
