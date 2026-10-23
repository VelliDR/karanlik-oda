let heicScriptLoadingPromise: Promise<void> | null = null;

export function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    type === 'image/heic' ||
    type === 'image/heif'
  );
}

export async function loadHeicConverter(): Promise<void> {
  if (window.heic2any) return;

  if (heicScriptLoadingPromise) {
    return heicScriptLoadingPromise;
  }

  heicScriptLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './js/heic2any.min.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      heicScriptLoadingPromise = null;
      reject(new Error('Çevrimdışı HEIF çözücü kütüphanesi yüklenemedi.'));
    };
    document.head.appendChild(script);
  });

  return heicScriptLoadingPromise;
}

/**
 * Apple HEIC/HEIF görselini %100 kayıpsız PNG formatına dönüştürür.
 */
export async function convertHeicToLossless(file: File): Promise<Blob> {
  await loadHeicConverter();

  if (!window.heic2any) {
    throw new Error('HEIC dönüştürücü başlatılamadı.');
  }

  const result = await window.heic2any({
    blob: file,
    toType: 'image/png' // %100 kayıpsız format
  });

  return Array.isArray(result) ? result[0] : result;
}
