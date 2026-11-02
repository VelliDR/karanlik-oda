# 🧪 Foton: Karanlık Oda

Tarayıcı üzerinde **%100 çevrimdışı (offline-first)** çalışan, analog film emülsiyonunu ve vintage lens karakteristiklerini simüle eden açık kaynaklı bir banyo istasyonudur.

Fotoğraflarınız cihazınızdan dışarı çıkmaz, uzak sunuculara yüklenmez veya analiz edilmez. Tüm işleme hattı yerel olarak **TypeScript, Canvas API, Web Worker ve PWA** mimarisi üzerinde yürütülür.

---

## 🔬 Optik ve Kimyasal Modelleme

* **🖨️ 300 DPI Arşivsel Baskı Standardı:** Dışa aktarılan PNG dosyalarına `pHYs` fiziksel piksel bloğu (11.811 px/m), JPEG dosyalarına ise 300 DPI JFIF başlığı mühürlenir. Çıktılar fine-art baskı stüdyolarında doğrudan doğru fiziksel boyutlarıyla tanınır.
* **🛡️ Kayıpsız EXIF ve ICC Profil Koruması:** Kamera modeli, lens bilgisi, diyafram, enstantane, ISO ve renk profili gibi orijinal metaveriler işlenmiş JPEG çıktısına korunarak aktarılır.
* **🌾 Luminans-Uyarlamalı Analog Gren:** Tekrarlayan dijital gürültü yerine Box-Muller Gauss dağılımı kullanılır. Gren yoğunluğu orta tonlarda (%18 gri, Zone V) doğal olarak belirginleşirken, derin gölgelerde ve patlamış beyazlarda sönümlenir.
* **🎬 CineStill 800T Çift Loblu Halasyon:** Sinema filmlerinde rem-jet katmanının eksikliğinden doğan ışık sekmesini taklit eder. Işık çekirdeğinin beyazı korunurken, sınır hatlarında sıcak turuncu-kızıl kor ve dış kırmızı saçılma oluşturulur.
* **🌀 Helios 44M Kedi Gözü (Cat-Eye) Swirl:** Biotar optik formülündeki mekanik pupil kesilmesini ve alan eğriliğini simüle eder. Merkezdeki odak alanı netliğini korurken, kenarlara doğru teğetsel eliptik astigmatizm uygulanır.
* **⚡ Radyal Kromatik Sapma:** Optik merkezde netlik korunur; mercek kenarlarına doğru kademeli olarak artan prizmatik kırmızı ve mavi ayrışması simüle edilir.
* **🌫️ Black Pro-Mist Difüzyonu:** Gölgelerdeki siyah seviyesini kilitleyerek soluklaşmayı önler; yalnızca orta ve yüksek ışık kaynaklarına yumuşak difüzyon uygular.
* **🎨 Display P3 Geniş Renk Gamutu:** Destekleyen ekran ve cihazlarda (modern iPhone, Mac ve Android amiral gemileri) tuval P3 renk uzayında işlenerek renk kırpılmaları önlenir.

---

## ⚡ Performans ve PWA Mimarisi

* **Arka Plan Banyo Motoru (Web Worker + OffscreenCanvas):** 16MP–48MP tam çözünürlüklü dışa aktarma işlemleri ana iş parçacığından koparılarak Web Worker üzerinde çalıştırılır. Arayüzde donma yaşanmaz, işlem adımları anlık olarak gösterilir.
* **Screen Wake Lock API:** Yüksek çözünürlüklü banyo esnasında mobil cihaz ekranının kararması veya uyku moduna geçmesi önlenir.
* **Masaüstü File Handling API:** PWA kurulduğunda işletim sistemiyle dosya ilişkilendirmesi sağlanır (`.jpg`, `.png`, `.webp`, `.heic` dosyaları "Birlikte Aç" veya çift tıklama ile doğrudan açılabilir).
* **Apple HEIC / HEIF Desteği:** Güncel iPhone fotoğrafları tarayıcı içinde yerel olarak çözümlenir.
* **Anlık Karşılaştırma & Geçmiş:** Düzenlemeleri orijinal ham fotoğrafla kıyaslama (`Boşluk` veya basılı tutma) ve çok adımlı geri/ileri alma (`Ctrl+Z`, `Ctrl+Y`).

---

## 🛠️ Teknoloji Yığını

* **Paketleyici:** [Vite](https://vitejs.dev/)
* **Dil:** [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
* **Arayüz & Stil:** [Tailwind CSS v4](https://tailwindcss.com/)
* **PWA:** [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox çevrimdışı önbellek)
* **İşlem Motoru:** HTML5 Canvas, OffscreenCanvas ve Web Worker

---

## 💻 Kurulum ve Geliştirme

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev

# Üretim derlemesi alın
npm run build

# Üretim çıktısını yerel olarak önizleyin
npm run preview
```

---

## 📱 Kurulum (PWA)

1. Uygulamayı modern bir mobil veya masaüstü tarayıcıda açın.
2. Sağ üstteki **"Yükle"** butonuna tıklayın (veya tarayıcı menüsünden "Ana Ekrana Ekle"yi seçin).
3. İnternet bağlantısı olmadan bağımsız bir masaüstü/mobil uygulama gibi kullanın.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) ile korunmaktadır.