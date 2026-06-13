import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    injectManifest: {
      // Avoid precaching the HTML shell so clients always revalidate index.html
      // and pick up the latest hashed asset references after deploys.
      globPatterns: ['**/*.{js,css,svg,png,webmanifest}'],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
    },
    manifest: {
      name: 'Wandreel',
      short_name: 'Wandreel',
      description: 'From scroll to stroll.',
      theme_color: '#0f766e',
      background_color: '#f8fafc',
      display: 'standalone',
      start_url: '/',
      share_target: {
        action: '/share-target',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          title: 'title',
          text: 'text',
          url: 'url',
        },
      },
      icons: [
        {
          src: '/favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    },
  }), cloudflare()],
})
