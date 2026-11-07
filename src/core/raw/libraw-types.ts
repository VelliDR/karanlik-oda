export interface RawMetadata {
  width: number;
  height: number;
  rawWidth: number;
  rawHeight: number;
  flip: number; // 0=none, 3=180, 5=90 CCW, 6=90 CW
  colors: number;
  iso: number;
  shutter: number;
  aperture: number;
  focalLength: number;
  camMul: [number, number, number, number];
  rgbCam: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number]
  ];
  make: string;
  model: string;
}

export interface RawThumbnail {
  format: 'jpeg' | 'bitmap';
  data: Uint8Array;
}

export interface RawDecodedImage {
  width: number;
  height: number;
  colors: number;
  bits: number; // 16 (16-bit linear) or 8
  data: Uint16Array | Uint8Array;
}

const RAW_EXTENSIONS = new Set([
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'raf',
  'orf',
  'rw2',
  'raw',
  'pef',
  'srw',
  '3fr',
  'iiq',
  'x3f'
]);

/**
 * Dosya adı ve uzantısına göre RAW görsel formatı olup olmadığını tespit eder.
 */
export function isRawFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext ? RAW_EXTENSIONS.has(ext) : false;
}
