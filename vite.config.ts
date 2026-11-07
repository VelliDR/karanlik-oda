import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon-192.png',
        'icon-512.png',
        'js/heic2any.min.js',
        'wasm/libraw.wasm',
        'wasm/libraw.js'
      ],
      manifest: {
        id: 'karanlik-oda-pwa',
        name: 'Foton: Karanlık Oda',
        short_name: 'Karanlık Oda',
        description: '%100 Çevrimdışı, Wabi-Sabi Analog Banyo İstasyonu ve Helios Optik Laboratuvarı',
        theme_color: '#F2A93B',
        background_color: '#0B0C10',
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
            name: 'Analog ve RAW Fotoğraflar',
            accept: {
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/png': ['.png'],
              'image/webp': ['.webp'],
              'image/heic': ['.heic'],
              'image/heif': ['.heif'],
              'image/x-adobe-dng': ['.dng'],
              'image/x-canon-cr2': ['.cr2'],
              'image/x-canon-cr3': ['.cr3'],
              'image/x-nikon-nef': ['.nef'],
              'image/x-sony-arw': ['.arw'],
              'image/x-fuji-raf': ['.raf']
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 35 * 1024 * 1024
      }
    })
  ]
});
