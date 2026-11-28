import type {
  HighlighterCore,
  LanguageRegistration,
  ThemeRegistrationRaw,
} from 'shiki/core';

export type SupportedShikiTheme = 'github-dark-default' | 'vitesse-black' | 'github-light';

type ThemeLoader = () => Promise<{ default: ThemeRegistrationRaw }>;
type LangLoader = () => Promise<{ default: LanguageRegistration[] }>;

const THEME_LOADERS: Record<SupportedShikiTheme, ThemeLoader> = {
  'github-dark-default': () => import('shiki/themes/github-dark-default.mjs'),
  'vitesse-black': () => import('shiki/themes/vitesse-black.mjs'),
  'github-light': () => import('shiki/themes/github-light.mjs'),
};

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  py3: 'python',
  sh: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  console: 'shellscript',
  ps1: 'powershell',
  pwsh: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  tex: 'latex',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  htm: 'html',
  svg: 'xml',
  jsonc: 'json',
  json5: 'json',
  docker: 'dockerfile',
  sass: 'scss',
  gql: 'graphql',
  patch: 'diff',
};

const LANG_LOADERS: Record<string, LangLoader> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cmake: () => import('shiki/langs/cmake.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  http: () => import('shiki/langs/http.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  matlab: () => import('shiki/langs/matlab.mjs'),
  mermaid: () => import('shiki/langs/mermaid.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  regex: () => import('shiki/langs/regex.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const PLAIN_TEXT_LANGS = new Set(['', 'text', 'txt', 'plaintext', 'plain']);
const MAX_HIGHLIGHT_CACHE = 160;
const highlightCache = new Map<string, string>();

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedThemes = new Set<SupportedShikiTheme>();
const inFlightThemes = new Map<SupportedShikiTheme, Promise<void>>();
const loadedLangs = new Set<string>();
const inFlightLangs = new Map<string, Promise<boolean>>();

export function canonicalizeLanguage(rawLang: string | undefined): string {
  const clean = (rawLang || '').trim().toLowerCase();
  if (!clean || PLAIN_TEXT_LANGS.has(clean)) return 'text';
  return LANG_ALIASES[clean] ?? clean;
}

function makeCacheKey(code: string, canonicalLang: string, theme: SupportedShikiTheme): string {
  return `${theme}\0${canonicalLang}\0${code}`;
}

export function getCachedHighlight(
  code: string,
  rawLang: string | undefined,
  theme: SupportedShikiTheme
): string | null {
  const key = makeCacheKey(code, canonicalizeLanguage(rawLang), theme);
  if (!highlightCache.has(key)) return null;
  const cached = highlightCache.get(key) ?? null;
  if (cached !== null) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
  }
  return cached;
}

function setCachedHighlight(
  code: string,
  canonicalLang: string,
  theme: SupportedShikiTheme,
  html: string
): void {
  const key = makeCacheKey(code, canonicalLang, theme);
  if (highlightCache.has(key)) highlightCache.delete(key);
  highlightCache.set(key, html);
  if (highlightCache.size > MAX_HIGHLIGHT_CACHE) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
}

export function clearHighlightCacheForTests(): void {
  highlightCache.clear();
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
      ]);
      return createHighlighterCore({
        themes: [],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    })().catch((err) => {
      // Never leave a rejected singleton poisoned across the session
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

async function ensureTheme(
  highlighter: HighlighterCore,
  theme: SupportedShikiTheme
): Promise<void> {
  if (loadedThemes.has(theme)) return;
  const inflight = inFlightThemes.get(theme);
  if (inflight) {
    await inflight;
    return;
  }
  const loader = THEME_LOADERS[theme] ?? THEME_LOADERS['github-dark-default'];
  const task = (async () => {
    const mod = await loader();
    await highlighter.loadTheme(mod.default);
    loadedThemes.add(theme);
  })().finally(() => {
    inFlightThemes.delete(theme);
  });
  inFlightThemes.set(theme, task);
  await task;
}

async function ensureLanguage(highlighter: HighlighterCore, canonicalLang: string): Promise<boolean> {
  if (canonicalLang === 'text') return false;
  if (loadedLangs.has(canonicalLang)) return true;
  const loader = LANG_LOADERS[canonicalLang];
  if (!loader) return false;

  const inflight = inFlightLangs.get(canonicalLang);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    try {
      const mod = await loader();
      await highlighter.loadLanguage(mod.default);
      loadedLangs.add(canonicalLang);
      return true;
    } catch {
      return false;
    } finally {
      inFlightLangs.delete(canonicalLang);
    }
  })();

  inFlightLangs.set(canonicalLang, task);
  return task;
}

export async function highlightCode(
  code: string,
  rawLang: string | undefined,
  theme: SupportedShikiTheme
): Promise<string> {
  const canonicalLang = canonicalizeLanguage(rawLang);
  const cached = getCachedHighlight(code, canonicalLang, theme);
  if (cached !== null) return cached;

  const highlighter = await getHighlighter();
  await ensureTheme(highlighter, theme);
  const hasLang = await ensureLanguage(highlighter, canonicalLang);
  const effectiveLang = hasLang ? canonicalLang : 'text';

  let html: string;
  try {
    html = highlighter.codeToHtml(code, {
      lang: effectiveLang,
      theme,
    });
  } catch {
    html = highlighter.codeToHtml(code, {
      lang: 'text',
      theme,
    });
  }

  setCachedHighlight(code, canonicalLang, theme, html);
  return html;
}
