import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_NAVY = '#0b1222';

/** GitHub Pages project sites live under /<repo>/, so the base path comes from the build environment. */
function normalizeBase(raw: string | undefined): string {
  if (!raw || raw === '/') return '/';
  let base = raw.trim();
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

/**
 * Adds a strict Content-Security-Policy to the production index.html. Only this origin and the
 * configured Supabase project may be contacted, which limits the damage any injected script could do.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  return {
    name: 'folio-csp',
    apply: 'build',
    transformIndexHtml(html) {
      let connect = "'self'";
      if (supabaseUrl) {
        try {
          const url = new URL(supabaseUrl);
          connect += ` ${url.origin} wss://${url.host}`;
        } catch {
          // An invalid URL is reported at runtime by the app itself.
        }
      }
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src ${connect}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join('; ');
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = normalizeBase(env.VITE_BASE_PATH);

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      contentSecurityPolicy(env.VITE_SUPABASE_URL),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'script',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme-init.js', 'icons/*.png'],
        manifest: {
          id: base,
          name: 'Folio — Private Notes',
          short_name: 'Folio',
          description: 'Private, end-to-end encrypted notes.',
          start_url: base,
          scope: base,
          display: 'standalone',
          orientation: 'any',
          background_color: THEME_NAVY,
          theme_color: THEME_NAVY,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Precache the whole app shell so it opens offline. Supabase requests are never cached.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
        },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    },
    build: {
      rolldownOptions: {
        output: {
          // Vendor code changes rarely; separate chunks keep updates small.
          codeSplitting: {
            groups: [
              { name: 'editor', test: /node_modules[\\/](@tiptap|prosemirror-|linkifyjs|orderedmap|rope-sequence|w3c-keyname)/ },
              { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|iceberg-js)/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
