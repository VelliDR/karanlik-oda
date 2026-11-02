import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'js/heic2any.min.js'],
      manifest: {
        id: 'karanlik-oda-pwa',
        name: 'Foton: Karanlık Oda',
        short_name: 'Karanlık Oda',
        description: '%100 Çevrimdışı, Wabi-Sabi Analog Banyo İstasyonu ve Helios Optik Laboratuvarı',
        theme_color: '#FF8A80',
        background_color: '#121318',
        display: 'standalone',
        orientation: 'any',
        start_url: './index.html',
        scope: './',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        file_handlers: [
          {
            action: './index.html',
            name: 'Analog Fotoğraflar',
            accept: {
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/png': ['.png'],
              'image/webp': ['.webp'],
              'image/heic': ['.heic'],
              'image/heif': ['.heif']
            }
          }
        ],
        shortcuts: [
          {
            name: 'Yeni Fotoğraf Banyo Et',
            short_name: 'Yeni Banyo',
            description: 'Karanlık Oda ile yeni bir fotoğraf düzenle',
            url: './index.html',
            icons: [{ src: 'icon-192.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}']
      }
    })
  ]
});
