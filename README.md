# 🧪 Foton: Karanlık Oda

Modern web teknolojileri üzerinde çalışan; analog film emülsiyonlarını, vintage optik karakteristikleri ve fiziksel banyo kusurlarını yerel olarak simüle eden minimalist bir karanlık oda istasyonudur.

Uzak sunuculara bağımlılığı yoktur. Görseller cihazdan dışarı aktarılmaz; tüm hesaplamalar **HTML5 Canvas, Web Worker, WebGPU / WASM SIMD ve PWA** mimarisi üzerinde, tamamen istemci tarafında (client-side) gerçekleştirilir.

---

## 🎯 Temel Özellikler

### 🎞️ Analog Emülsiyon ve Kimyasal Kusurlar
* **Luminans-Uyarlamalı Gren:** Standart dijital parazit yerine Box-Muller Gaussian dağılımı kullanılır. Gren dokusu orta tonlarda (%18 gri, Zone V) belirginleşirken patlamış açık tonlarda ve derin gölgelerde doğal olarak sönümlenir.
* **CineStill 800T Halasyon:** Sinema filmlerindeki rem-jet katmanı eksikliğinden doğan ışık sekmesini taklit eder. Yüksek parlaklıktaki ışık kaynaklarının etrafında kırmızı-turuncu kor ve sıcak saçılma oluşturur.
* **Bleach Bypass (Gümüş Koruma):** Renkli banyo sürecinde ağartma adımının atlanmasıyla gümüşün emülsiyonda kalmasını sağlar; kontrastı artırır, renk doygunluğunu düşürür.
* **Işık Sızıntısı & Quartz Date:** Fotoğraf makinesinin arka kapağından sızan ışık yanmaları ve 90'lar analog kompakt kameraların turuncu LED tarih damgası mühürlenebilir.

### 🔍 Vintage Optik Modelleme
* **Helios 44M-4 Kedi Gözü (Cat-Eye) Swirl:** Klasik Biotar formülündeki mekanik diyafram kesilmesini simüle eder. Merkez netliği korunurken kenarlara doğru teğetsel eliptik astigmatizm ve dönen bokeh üretilir.
* **Radyal Kromatik Sapma:** Optik merkez ekseninde keskinlik korunur; kenarlara doğru prizmatik kırmızı ve mavi dalga boyu ayrışması kademeli olarak artar.
* **Black Pro-Mist Difüzyonu:** Derin siyah seviyelerini koruyarak orta ve yüksek parlaklıktaki ışık alanlarına yumuşak haleli yayılım sağlar.
* **Mekanik Vinyet:** $cos^4(\theta)$ optik aydınlatma düşüşü kuralına uygun yumuşak kenar kararması.

### 🤖 Cihaz İçi (On-Device) AI
* **3D Fiziksel Alan Derinliği (Depth Anything V2):** ONNX Runtime Web (WebGPU & WASM SIMD) aracılığıyla istemci tarafında çalışır. Ekrana dokunarak odak düzlemi seçilebilir (Tap-to-Focus). Helios bokeh etkisi yalnızca odak dışı derinlik katmanlarına uygulanır; netlikteki özne merkezde olmasa dahi keskinliğini korur. Model yalnızca istendiğinde (~26 MB) indirilip `CacheStorage` içinde çevrimdışı önbelleğe alınır.
* **En-Boy Oranı Koruma Kalkanı (Aspect Shield):** Görseli nöral ağ boyutuna çekerken en-boy oranını letterbox/unpad mimarisiyle sub-piksel seviyesinde korur. Önizleme ile 48 MP tam çözünürlüklü dışa aktarma arasında piksel kayması yaşanmaz.
* **Ten Koruma Kalkanı:** İnsan ten pigmentlerini $YC_bC_r$ kromatik düzleminde filtreler. Soğuk filtre veya sert tonlamalarda insan ten tonlarının doğallığını korur.
* **Akıllı Reçete Asistanı:** Fotoğrafın Zone System ışık dağılımını, dinamik kontrastını, renk sıcaklığını (Kelvin) ve derinlik ayrımını analiz ederek en uygun analog film reçetesini ve optik ayarları önerir.

### 🖨️ 300 DPI Arşivsel Baskı Standartları
* **Kayıpsız 300 DPI Mühürleme:** PNG çıktılara `pHYs` fiziksel piksel bloğu (11.811 px/m), JPEG çıktılara ise JFIF 300 DPI başlığı enjekte edilir. Fine-art baskı merkezlerinde doğrudan fiziksel ölçüleriyle (cm/inç) algılanır.
* **EXIF ve Renk Profili Korunumu:** Orijinal kameraya ait diyafram, enstantane, ISO, lens ve ICC profili segmentleri ayıklanarak dışa aktarılan dosyaya korunarak aktarılır.
* **Display P3 Desteği:** Geniş renk gamutu destekleyen ekranlarda (Apple Display P3) renk kırpılmaları önlenerek geniş dinamik aralık korunur.

---

## ⚡ Mimari ve Performans

* **Web Worker Banyo Hattı:** Yüksek çözünürlüklü (16–48 MP) dışa aktarma işlemleri arka plan iş parçacığı ve `OffscreenCanvas` üzerinde yürütülür; ana arayüz hiçbir zaman donmaz.
* **Screen Wake Lock API:** Mobil cihazlarda uzun banyo süreçlerinde ekranın kapanması engellenir.
* **Masaüstü File Handling API:** Kurulum yapıldığında işletim sisteminde `.jpg`, `.png`, `.webp`, `.heic` dosyaları "Birlikte Aç" ile doğrudan uygulamaya yönlendirilebilir.
* **Apple HEIC / HEIF Dönüştürücü:** Güncel iPhone formatları tarayıcı içinde kayıpsız olarak işlenir.

---

## 🛠️ Teknoloji Yığını

| Bileşen | Teknoloji | Açıklama |
| :--- | :--- | :--- |
| **Paketleyici** | [Vite 8](https://vitejs.dev/) | Hızlı HMR ve optimize üretim derlemesi |
| **Dil** | [TypeScript](https://www.typescriptlang.org/) | Tip güvenli çekirdek mimari (Strict Mode) |
| **Arayüz** | [Tailwind CSS v4](https://tailwindcss.com/) | Modern, koyu kırmızı karanlık oda teması |
| **PWA** | [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) | Service Worker ve Workbox çevrimdışı önbellek |
| **AI Çalıştırıcı** | [ONNX Runtime Web](https://onnxruntime.ai/) | WebGPU donanım hızlandırma ve WASM SIMD yedek |
| **Görsel Çekirdek** | Canvas API & OffscreenCanvas | Sıfır kopyalı bellek transferi ve sub-piksel projeksiyon |

---

## 💻 Kurulum ve Çalıştırma

Projeyi yerel makinenizde derlemek ve çalıştırmak için:

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme sunucusunu başlatın
npm run dev

# Üretim sürümünü derleyin
npm run build

# Üretim çıktısını yerel olarak önizleyin
npm run preview
```

---

## 📱 PWA Kurulumu

1. Desteklenen bir mobil veya masaüstü tarayıcıda (Chrome, Edge, Safari vb.) açın.
2. Adres çubuğundaki veya araç çubuğundaki **Yükle / Uygulamayı Yükle** butonuna tıklayın (veya tarayıcı menüsünden *Ana Ekrana Ekle* seçeneğini kullanın).
3. İnternet bağlantısı olmaksızın bağımsız bir yerel masaüstü veya mobil uygulama gibi kullanın.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak yayımlanmıştır.