/**
 * Foton: Karanlık Oda - Metaveri ve 300 DPI Baskı Standardı Motoru
 * 
 * Bu modül:
 * 1. Dışa aktarılan JPEG dosyalarına 300 DPI JFIF başlığı enjekte eder.
 * 2. Orijinal JPEG dosyasındaki EXIF (kamera, lens, tarih vb.) ve ICC Profil segmentlerini korur.
 * 3. Dışa aktarılan PNG dosyalarına 300 DPI fiziksel piksel (pHYs) bloğu ekler (11811 piksel/metre).
 * 4. Görsel çözünürlüğüne göre 300 DPI standartlarında fiziksel baskı boyutlarını (cm/inç) hesaplar.
 */

export interface PrintDimensions {
  widthCm: number;
  heightCm: number;
  widthInches: number;
  heightInches: number;
  dpi: number;
  megapixels: number;
}

/**
 * Verilen piksel genişlik ve yükseklik için 300 DPI baskı boyutlarını hesaplar.
 */
export function calculatePrintDimensions(
  width: number,
  height: number,
  dpi: number = 300
): PrintDimensions {
  const widthInches = Number((width / dpi).toFixed(1));
  const heightInches = Number((height / dpi).toFixed(1));
  const widthCm = Number(((width / dpi) * 2.54).toFixed(1));
  const heightCm = Number(((height / dpi) * 2.54).toFixed(1));
  const megapixels = Number(((width * height) / 1_000_000).toFixed(1));

  return {
    widthCm,
    heightCm,
    widthInches,
    heightInches,
    dpi,
    megapixels
  };
}

// -------------------------------------------------------------
// PNG 300 DPI Enjeksiyonu (pHYs Chunk)
// -------------------------------------------------------------

// Standart CRC32 tablosu
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * PNG dosyasına 300 DPI (11811 piksel/metre) pHYs bloğu enjekte eder.
 */
export async function inject300DpiToPng(blob: Blob, dpi: number = 300): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // PNG sihirli bayt doğrulaması: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length < 33 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return blob; // Geçerli PNG değilse dokunmadan dön
  }

  // 300 DPI = 300 / 0.0254 = ~11811 piksel/metre
  const ppm = Math.round(dpi / 0.0254);

  // pHYs bloğu verisi (9 bayt):
  // 4 bayt X PPM (Big-Endian)
  // 4 bayt Y PPM (Big-Endian)
  // 1 bayt Birim (1 = metre)
  const chunkData = new Uint8Array(9);
  chunkData[0] = (ppm >>> 24) & 0xff;
  chunkData[1] = (ppm >>> 16) & 0xff;
  chunkData[2] = (ppm >>> 8) & 0xff;
  chunkData[3] = ppm & 0xff;

  chunkData[4] = (ppm >>> 24) & 0xff;
  chunkData[5] = (ppm >>> 16) & 0xff;
  chunkData[6] = (ppm >>> 8) & 0xff;
  chunkData[7] = ppm & 0xff;

  chunkData[8] = 1; // 1 = metre birimi

  // CRC32 hesabı ("pHYs" tipi + veri)
  const chunkTypeAndData = new Uint8Array(4 + 9);
  chunkTypeAndData[0] = 0x70; // 'p'
  chunkTypeAndData[1] = 0x48; // 'H'
  chunkTypeAndData[2] = 0x59; // 'Y'
  chunkTypeAndData[3] = 0x73; // 's'
  chunkTypeAndData.set(chunkData, 4);

  const crc = calculateCrc32(chunkTypeAndData);

  // Tam pHYs bloğu: 4 bayt uzunluk (9) + 4 bayt tip + 9 bayt veri + 4 bayt CRC = 21 bayt
  const physChunk = new Uint8Array(4 + 4 + 9 + 4);
  physChunk[0] = 0;
  physChunk[1] = 0;
  physChunk[2] = 0;
  physChunk[3] = 9; // Uzunluk = 9
  physChunk.set(chunkTypeAndData, 4);
  physChunk[17] = (crc >>> 24) & 0xff;
  physChunk[18] = (crc >>> 16) & 0xff;
  physChunk[19] = (crc >>> 8) & 0xff;
  physChunk[20] = crc & 0xff;

  // IHDR bloğu hemen PNG imzasından sonra başlar (ofset 8) ve boyutu 25 bayttır (ofset 33).
  // pHYs bloğunu doğrudan IHDR sonrasına (ofset 33) yerleştiriyoruz.
  const ihdrEndOffset = 33;
  const newBytes = new Uint8Array(bytes.length + physChunk.length);
  newBytes.set(bytes.subarray(0, ihdrEndOffset), 0);
  newBytes.set(physChunk, ihdrEndOffset);
  newBytes.set(bytes.subarray(ihdrEndOffset), ihdrEndOffset + physChunk.length);

  return new Blob([newBytes], { type: 'image/png' });
}

// -------------------------------------------------------------
// JPEG 300 DPI ve EXIF / ICC Metaveri Enjeksiyonu
// -------------------------------------------------------------

/**
 * 300 DPI JFIF segmenti (18 bayt) oluşturur.
 */
function create300DpiJfifSegment(dpi: number = 300): Uint8Array {
  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0; // APP0 işareti
  segment[2] = 0x00;
  segment[3] = 0x10; // Uzunluk = 16 bayt
  segment[4] = 0x4a; // 'J'
  segment[5] = 0x46; // 'F'
  segment[6] = 0x49; // 'I'
  segment[7] = 0x46; // 'F'
  segment[8] = 0x00; // '\0'
  segment[9] = 0x01; // Majör versiyon (1)
  segment[10] = 0x02; // Minör versiyon (2)
  segment[11] = 0x01; // Birim = 1 (DPI - Dots Per Inch)
  segment[12] = (dpi >>> 8) & 0xff; // X yoğunluk (örn. 300 -> 0x01)
  segment[13] = dpi & 0xff; // X yoğunluk (örn. 300 -> 0x2C)
  segment[14] = (dpi >>> 8) & 0xff; // Y yoğunluk
  segment[15] = dpi & 0xff; // Y yoğunluk
  segment[16] = 0x00; // Küçük resim genişlik = 0
  segment[17] = 0x00; // Küçük resim yükseklik = 0
  return segment;
}

/**
 * Verilen bir JPEG tamponundan EXIF (APP1) ve ICC Profil (APP2) segmentlerini çıkarır.
 */
export function extractJpegMetadataSegments(buffer: ArrayBuffer): Uint8Array[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return []; // JPEG değil
  }

  const segments: Uint8Array[] = [];
  let offset = 2;

  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) break;

    const marker = bytes[offset + 1];

    // SOS (Start of Scan) veya EOI (End of Image) geldiğinde metaveri arama biter
    if (marker === 0xda || marker === 0xd9) break;

    // Uzunluk içeren markerlar
    if (offset + 4 > bytes.length) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentEnd = offset + 2 + length;

    if (segmentEnd > bytes.length) break;

    // APP1 (EXIF: 0xE1) veya APP2 (ICC Profile: 0xE2)
    if (marker === 0xe1 || marker === 0xe2) {
      segments.push(bytes.slice(offset, segmentEnd));
    }

    offset = segmentEnd;
  }

  return segments;
}

/**
 * EXIF APP1 segmentinde XResolution, YResolution ve ResolutionUnit etiketlerini 300 DPI'a günceller.
 */
function patchExifResolution(segment: Uint8Array, dpi: number = 300): Uint8Array {
  // APP1 işareti: FF E1
  // Header kontrolü: 'Exif\0\0'
  if (
    segment.length < 18 ||
    segment[4] !== 0x45 ||
    segment[5] !== 0x78 ||
    segment[6] !== 0x69 ||
    segment[7] !== 0x66 ||
    segment[8] !== 0x00 ||
    segment[9] !== 0x00
  ) {
    return segment;
  }

  // Kopya üzerinde çalış
  const copy = new Uint8Array(segment);
  const tiffOffset = 10; // Exif\0\0 sonrasındaki TIFF başlığı

  if (tiffOffset + 8 > copy.length) return copy;

  const isLittleEndian = copy[tiffOffset] === 0x49 && copy[tiffOffset + 1] === 0x49; // "II"
  const isBigEndian = copy[tiffOffset] === 0x4d && copy[tiffOffset + 1] === 0x4d; // "MM"

  if (!isLittleEndian && !isBigEndian) return copy;

  const readU16 = (o: number) =>
    isLittleEndian ? copy[o] | (copy[o + 1] << 8) : (copy[o] << 8) | copy[o + 1];
  const readU32 = (o: number) =>
    isLittleEndian
      ? copy[o] | (copy[o + 1] << 8) | (copy[o + 2] << 16) | (copy[o + 3] << 24)
      : (copy[o] << 24) | (copy[o + 1] << 16) | (copy[o + 2] << 8) | copy[o + 3];

  const writeU32 = (o: number, val: number) => {
    if (isLittleEndian) {
      copy[o] = val & 0xff;
      copy[o + 1] = (val >>> 8) & 0xff;
      copy[o + 2] = (val >>> 16) & 0xff;
      copy[o + 3] = (val >>> 24) & 0xff;
    } else {
      copy[o] = (val >>> 24) & 0xff;
      copy[o + 1] = (val >>> 16) & 0xff;
      copy[o + 2] = (val >>> 8) & 0xff;
      copy[o + 3] = val & 0xff;
    }
  };

  const writeU16 = (o: number, val: number) => {
    if (isLittleEndian) {
      copy[o] = val & 0xff;
      copy[o + 1] = (val >>> 8) & 0xff;
    } else {
      copy[o] = (val >>> 8) & 0xff;
      copy[o + 1] = val & 0xff;
    }
  };

  const ifd0Offset = tiffOffset + readU32(tiffOffset + 4);
  if (ifd0Offset + 2 > copy.length) return copy;

  const entryCount = readU16(ifd0Offset);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12;
    if (entryOffset + 12 > copy.length) break;

    const tag = readU16(entryOffset);

    // Tag 0x011A: XResolution (RATIONAL: Pay / Payda)
    // Tag 0x011B: YResolution (RATIONAL: Pay / Payda)
    if (tag === 0x011a || tag === 0x011b) {
      const valOffset = tiffOffset + readU32(entryOffset + 8);
      if (valOffset + 8 <= copy.length) {
        writeU32(valOffset, dpi); // Pay = 300
        writeU32(valOffset + 4, 1); // Payda = 1
      }
    }

    // Tag 0x0128: ResolutionUnit (SHORT: 2 = Inches)
    if (tag === 0x0128) {
      writeU16(entryOffset + 8, 2);
    }
  }

  return copy;
}

/**
 * Dışa aktarılan JPEG bloğuna 300 DPI JFIF ve varsa orijinal dosyanın EXIF/ICC metaverilerini enjekte eder.
 */
export async function inject300DpiAndExifToJpeg(
  exportBlob: Blob,
  originalMetadataSegments?: Uint8Array[],
  dpi: number = 300
): Promise<Blob> {
  const arrayBuffer = await exportBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // JPEG SOI doğrulaması: FF D8
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return exportBlob;
  }

  // 1. Yeni 300 DPI JFIF segmenti
  const jfifSegment = create300DpiJfifSegment(dpi);

  // 2. Orijinal dosyanın EXIF ve ICC segmentlerini hazırla
  const processedExtraSegments: Uint8Array[] = [];
  if (originalMetadataSegments && originalMetadataSegments.length > 0) {
    for (const seg of originalMetadataSegments) {
      if (seg[1] === 0xe1) {
        // EXIF APP1: 300 DPI etiketleriyle yamala
        processedExtraSegments.push(patchExifResolution(seg, dpi));
      } else {
        // ICC APP2 veya diğer
        processedExtraSegments.push(seg);
      }
    }
  }

  // 3. Canvas tarafından üretilen JPEG'deki varsayılan APP0 segmentini atla (varsa)
  let scanOffset = 2;
  while (scanOffset < bytes.length - 1) {
    if (bytes[scanOffset] !== 0xff) break;
    const marker = bytes[scanOffset + 1];

    // Sadece APP0 (varsayılan 72/96 DPI JFIF) veya boş APP1 varsa atla
    if (marker === 0xe0) {
      const segLen = (bytes[scanOffset + 2] << 8) | bytes[scanOffset + 3];
      scanOffset += 2 + segLen;
    } else {
      break;
    }
  }

  // 4. Parçaları birleştir:
  // SOI (2 bayt) + 300 DPI JFIF + EXIF/ICC segmentleri + Kalan JPEG verisi
  const remainingJpegBytes = bytes.subarray(scanOffset);
  let totalLength = 2 + jfifSegment.length + remainingJpegBytes.length;

  for (const seg of processedExtraSegments) {
    totalLength += seg.length;
  }

  const finalBytes = new Uint8Array(totalLength);
  let writeOffset = 0;

  // SOI: FF D8
  finalBytes[writeOffset++] = 0xff;
  finalBytes[writeOffset++] = 0xd8;

  // 300 DPI JFIF
  finalBytes.set(jfifSegment, writeOffset);
  writeOffset += jfifSegment.length;

  // EXIF & ICC
  for (const seg of processedExtraSegments) {
    finalBytes.set(seg, writeOffset);
    writeOffset += seg.length;
  }

  // Kalan görüntü verisi
  finalBytes.set(remainingJpegBytes, writeOffset);

  return new Blob([finalBytes], { type: 'image/jpeg' });
}
