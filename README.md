# 🧪 Foton: Karanlık Oda (v3.0 - TypeScript & Vite)

Abonelik ücretlerinden, hantal arayüzlerden ve fotoğrafları uzak sunuculara yükleme zorunluluğundan sıkılanlar için geliştirilmiş, **%100 çevrimdışı (offline-first)** çalışan, tarayıcı tabanlı bir analog banyo istasyonu ve optik simülatörü.

Fotoğraflarınız cihazınızdan asla çıkmaz, analiz edilmez veya bir buluta yüklenmez. Tüm işleme mantığı tamamen tarayıcınızın içinde, **TypeScript, Vite, HTML5 Canvas ve Web Worker/PWA** gücüyle yerel olarak çalışır.

---

## 🌀 Neden Karanlık Oda?

Modern dijital kameralar jilet gibi keskin, kusursuz ama bir o kadar da ruhsuz fotoğraflar üretiyor. Karanlık Oda, optik fiziğin ve kimyanın o "kusurlu ama sıcak" estetiğini (**Wabi-Sabi**) dijital görsellere geri kazandırmayı amaçlar.

### 🔬 Karakteristik Özellikler

* **🌀 Helios Swirl (Dönen Bokeh):** Efsanevi Rus merceği Helios 44M-4'ün kenar bölgelerindeki mekanik vinyet ve astigmatizm hatasını (dairesel bükülme) matematiksel olarak simüle eder.
* **🎬 CineStill 800T Halation (Kırmızı Parlama):** Sinema filmlerinin arkasındaki ışık emici katmanın (rem-jet) temizlenmesiyle oluşan o ikonik kimyasal reaksiyonu taklit eder. Parlak ışıkları izole eder, CineStill kırmızısına boyar ve yumuşatarak görselin üzerine mühürler.
* **⚡ Chromatic Aberration (Renk Sapması):** Eski manuel lenslerin odak kaçırma hatasını, kırmızı ve cyan kanallarını milimetrik olarak GPU üzerinde kaydırıp ölçeklendirerek canlandırır.
* **🌾 Leica Nordic Cool:** Gölgeleri dondurucu bir İskandinav lacivertine bükerken, cilt tonlarını bozmadan sıcak tutan özel bir split-toning reçetesi.
* **👁️ Anlık Karşılaştır (Before / After):** Ekrana veya butona basılı tutarak (veya klavyede Boşluk tuşuna basarak) yapılan düzenlemeleri orijinal ham fotoğrafla anında kıyaslama imkanı.
* **↩️ Geri Al / İleri Al (Undo / Redo):** Yapılan her ayar ve reçete seçimi için tam geçmiş adımları (`Ctrl+Z`, `Ctrl+Y`).
* **🔄 Kayıpsız Döndürme (Lossless Rotation):** Görseli JPEG sıkıştırmasına sokmadan, doğrudan tuval koordinat matrisiyle kayıpsız 90° döndürme.
* **🍏 Çevrimdışı Apple HEIC / HEIF Desteği:** iPhone ve güncel mobil cihazların fotoğraflarını cihaz içinde otomatik olarak JPEG standardına dönüştürür.
* **🛡️ Sıfır Bellek Kopyası (Zero-Copy):** `readAsDataURL` yerine `URL.createObjectURL` ve `createImageBitmap` kullanılarak 16MP+ görsellerde tarayıcının çökmesi engellenir.

---

## 🛠️ Teknoloji Yığını (v3.0 Mimarisi)

* **Build Tool:** [Vite 6+](https://vitejs.dev/) — Anında HMR, yüksek hızlı modül paketleme
* **Dil:** [TypeScript (Strict Mode)](https://www.typescriptlang.org/) — Güçlü tip güvenliği ve sıfır çalışma zamanı hatası
* **Stil:** [Tailwind CSS v4](https://tailwindcss.com/) — Sıfır çalışma zamanı CDN gecikmesi, derlenmiş yerel CSS
* **PWA:** [vite-plugin-pwa (Workbox)](https://vite-pwa-org.netlify.app/) — Tam çevrimdışı önbellekleme ve uygulama kurulumu
* **Optik Motoru:** Özel HTML5 2D Canvas & Matrix Compositing Pipeline

---

## 💻 Geliştirme ve Kurulum

### Gereksinimler
* Node.js 18+ (Node 20+ önerilir)
* npm veya pnpm

### Projeyi Başlatma

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev

# Üretim (Production) derlemesi alın
npm run build

# Üretim çıktısını yerel olarak önizleyin
npm run preview
```

---

## 📱 Kurulum (PWA)

Karanlık Oda, tamamen çevrimdışı çalışabilen modern bir Progressive Web App (PWA) uygulamasıdır:

1. Uygulamayı mobil veya masaüstü tarayıcınızda açın.
2. Sağ üstte beliren **"Yükle"** butonuna dokunun (veya tarayıcı menüsünden "Ana Ekrana Ekle"yi seçin).
3. İnternet bağlantınız olmasa bile cihazınızda yerel bir uygulama gibi bağımsız pencerede kullanın.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) ile korunmaktadır.