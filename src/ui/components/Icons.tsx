export interface IconProps {
  class?: string;
  size?: number;
}

/** ️ Işık / Pozlama Simgesi */
export function SunIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

/** Renk / Palet Simgesi */
export function PaletteIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4 10 9.5 10c1.5 0 2.5-1 2.5-2.5 0-.7-.3-1.3-.7-1.7-.4-.5-.6-1-.6-1.6 0-1.2 1-2.2 2.2-2.2H17c3.9 0 5-2.6 5-6 0-4.4-4.5-8-10-8z" />
    </svg>
  );
}

/** ️ Film / Emülsiyon Makara Simgesi */
export function FilmIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2 8h5M2 16h5M17 8h5M17 16h5M2 12h20" />
    </svg>
  );
}

/** Mercek / Diyafram Simgesi */
export function ApertureIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m14.31 8 5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94" />
    </svg>
  );
}

/** Histogram / Dalga Grafiği Simgesi */
export function HistogramIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M3 20h18" />
      <path d="M6 20v-6M10 20v-10M14 20v-14M18 20v-8" />
    </svg>
  );
}

/** ️ / ️ Baskı / Mühür Simgesi */
export function StampIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M5 22h14M5 2h14v10H5zM12 18v4M7 14h10" />
    </svg>
  );
}

/** ️ Karşılaştır / Göz Simgesi */
export function EyeIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Büyüteç Simgesi */
export function ZoomIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Klasör / Dosya Aç Simgesi */
export function FolderIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

/** Kaydet Simgesi */
export function SaveIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

/** ↩️ Geri Al Simgesi */
export function UndoIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

/** ↪️ İleri Al Simgesi */
export function RedoIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
  );
}

/** 90° Döndür Simgesi */
export function RotateIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** Rastgele / Kör Makara Simgesi */
export function ShuffleIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** ️ Sıfırla / Çöp Kutusu Simgesi */
export function ResetIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Odak Hedefi / Crosshairs Simgesi */
export function TargetIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

/** Parıltı / Akıllı AI Simgesi */
export function SparklesIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

/** Kamera Simgesi */
export function CameraIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

/** 3D Küp / LUT Simgesi */
export function CubeIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="m21 16-9 5-9-5V8l9-5 9 5v8Z" />
      <path d="m3.27 6.96 8.73 4.88 8.73-4.88M12 22.08V12" />
    </svg>
  );
}

/** Takvim Simgesi */
export function CalendarIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/** ️ Yazıcı Simgesi */
export function PrinterIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

/** Onay Simgesi */
export function CheckIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Karanlık Oda Agrandizör (Optik Büyütücü) Simgesi */
export function EnlargerIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M4 21h16" />
      <path d="M6 21V3" />
      <path d="M6 7h5" />
      <rect x="11" y="3" width="7" height="5" rx="1" />
      <path d="M12.5 8l-1 3h6l-1-3" />
      <path d="M12.5 11l-3.5 10" strokeDasharray="2 2" />
      <path d="M16.5 11l3.5 10" strokeDasharray="2 2" />
    </svg>
  );
}

/** Fotoğraf Kağıdı ve Banyo Küveti Simgesi */
export function PaperSheetIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="7" y="6" width="10" height="10" rx="0.5" />
      <path d="M7 18.5h10" />
    </svg>
  );
}

/** Kimyasal Toning / Banyo Beheri Simgesi */
export function FlaskIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M9 3h6" />
      <path d="M10 3v5.4a2 2 0 0 1-.4 1.2L5 16.2A3 3 0 0 0 7.4 21h9.2a3 3 0 0 0 2.4-4.8l-4.6-6.6a2 2 0 0 1-.4-1.2V3" />
      <path d="M7 15h10" />
    </svg>
  );
}

/** Dodge (Işık Kesici Çubuk / Açma) Simgesi */
export function DodgeIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <circle cx="9.5" cy="9.5" r="5.5" fill="currentColor" fillOpacity="0.25" />
      <path d="M13.5 13.5L21 21" />
    </svg>
  );
}

/** Burn (Delikli Kart / Ek Pozlama Karartma) Simgesi */
export function BurnIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/** Fırça Haritası Silgisi Simgesi */
export function EraserIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

/** 35mm Çoklu Kare Film Şeridi Simgesi */
export function FilmStripIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M9 8v8M15 8v8" />
      <path d="M5 5v2M9 5v2M15 5v2M19 5v2" />
      <path d="M5 17v2M9 17v2M15 17v2M19 17v2" />
    </svg>
  );
}

/** Karanlık Oda Kontakt Baskı Sayfası Simgesi */
export function ContactSheetIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="6" y="6.5" width="5" height="4" rx="0.5" />
      <rect x="13" y="6.5" width="5" height="4" rx="0.5" />
      <rect x="6" y="13.5" width="5" height="4" rx="0.5" />
      <rect x="13" y="13.5" width="5" height="4" rx="0.5" />
    </svg>
  );
}

/** Artı / Kare Ekle Simgesi */
export function PlusIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Kapat / Kare Çıkar Simgesi */
export function CloseIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Sürükle-Bırak Tutamaç Simgesi */
export function GripIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      class={className}
    >
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

/** Karanlık Oda Mumlu Seçim Kalemi (Chinagraph) Simgesi */
export function PencilMarkIcon({ class: className = 'w-3.5 h-3.5', size = 14 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      class={className}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}
