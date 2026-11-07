import { DodgeBurnMap, DodgeBurnToolMode } from '../types';
import { ENLARGER_CONSTANTS } from './constants';
import { packFloat32ArrayToFloat16 } from './toning-lut';

let globalMapVersionCounter = 1;

export function nextDodgeBurnVersion(): number {
  return ++globalMapVersionCounter;
}

/**
 * Verilen hedef önizleme/görüntü boyutuna karşılık gelen ~1/4 çözünürlüklü Dodge/Burn haritası oluşturur.
 */
export function createDodgeBurnMap(imageWidth: number, imageHeight: number): DodgeBurnMap {
  const factor = ENLARGER_CONSTANTS.dodgeBurnDownsampleFactor;
  const minDim = ENLARGER_CONSTANTS.minDodgeBurnDim;

  const aspect = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1.0;
  let w = Math.max(minDim, Math.round(imageWidth / factor));
  let h = Math.max(minDim, Math.round(imageHeight / factor));

  if (aspect >= 1.0 && w < Math.round(h * aspect)) {
    w = Math.max(minDim, Math.round(h * aspect));
  } else if (aspect < 1.0 && h < Math.round(w / aspect)) {
    h = Math.max(minDim, Math.round(w / aspect));
  }

  return {
    width: w,
    height: h,
    data: new Float32Array(w * h),
    version: nextDodgeBurnVersion()
  };
}

/**
 * Geçmiş (Undo/Redo) veya Worker aktarımı için DodgeBurnMap kopyası üretir.
 */
export function cloneDodgeBurnMap(map: DodgeBurnMap | null | undefined): DodgeBurnMap | null {
  if (!map) return null;
  return {
    width: map.width,
    height: map.height,
    data: new Float32Array(map.data),
    version: map.version
  };
}

/**
 * İki DodgeBurnMap nesnesinin içerik/sürüm eşitliğini kontrol eder.
 */
export function areDodgeBurnMapsEqual(
  a: DodgeBurnMap | null | undefined,
  b: DodgeBurnMap | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.version === b.version && a.width === b.width && a.height === b.height) return true;
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/**
 * Haritada sıfırdan farklı herhangi bir poz müdahalesi olup olmadığını bildirir.
 */
export function hasActiveDodgeBurnData(map: DodgeBurnMap | null | undefined): boolean {
  if (!map || map.width <= 0 || map.height <= 0) return false;
  const d = map.data;
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i]) > 1e-4) return true;
  }
  return false;
}

/**
 * Görsel 90° saat yönünde döndürüldüğünde Dodge/Burn haritasını da kayıpsız döndürür.
 */
export function rotateDodgeBurnMapClockwise(map: DodgeBurnMap): DodgeBurnMap {
  const oldW = map.width;
  const oldH = map.height;
  const newW = oldH;
  const newH = oldW;
  const rotated = new Float32Array(newW * newH);

  for (let y = 0; y < oldH; y++) {
    for (let x = 0; x < oldW; x++) {
      const dstX = oldH - 1 - y;
      const dstY = x;
      rotated[dstY * newW + dstX] = map.data[y * oldW + x];
    }
  }

  return {
    width: newW,
    height: newH,
    data: rotated,
    version: nextDodgeBurnVersion()
  };
}

/**
 * PointerEvent üzerinden normalize edilmiş basınç çarpanı (0.05 .. 1.0) çıkarır.
 * Kalem/tablet (pen) girişlerinde gerçek basıncı okur; standart farede 1.0 tam güç döner.
 */
export function resolvePointerPressure(e: { pointerType?: string; pressure?: number }): number {
  const p = typeof e.pressure === 'number' ? e.pressure : 1.0;
  if (e.pointerType === 'pen') {
    return Math.max(0.05, Math.min(1.0, p > 0 ? p : 0.5));
  }
  if (e.pointerType === 'touch' && p > 0 && Math.abs(p - 0.5) > 0.02 && p < 1.0) {
    return Math.max(0.15, Math.min(1.0, p));
  }
  return 1.0;
}

export interface BrushDabOptions {
  /** Görüntü üzerinde normalize X koordinatı [0..1] */
  normX: number;
  /** Görüntü üzerinde normalize Y koordinatı [0..1] */
  normY: number;
  /** Kısa kenara göre normalize fırça yarıçapı (örn. 0.02 .. 0.35) */
  radiusNorm: number;
  /** Fırça modu: dodge (-stop), burn (+stop) veya erase (sıfıra yumuşatma) */
  mode: Exclude<DodgeBurnToolMode, 'off'>;
  /** Darbe başına hedef güç (stop cinsinden baz adım, örn. 0.04 .. 0.35) */
  strengthStops: number;
  /** Kalem / dokunma basınç çarpanı [0.05 .. 1.0] */
  pressure?: number;
}

/**
 * Sert kenarsız C²-sürekli (quartic smooth bell: (1 - r²)²) yumuşak karanlık oda fırça darbesi uygular.
 */
export function applyDodgeBurnBrushDab(map: DodgeBurnMap, opts: BrushDabOptions): void {
  const { width: w, height: h, data } = map;
  if (w <= 0 || h <= 0) return;

  const pressure = Math.max(0.05, Math.min(1.0, opts.pressure ?? 1.0));
  const minSide = Math.min(w, h);
  const radiusPx = Math.max(1.5, opts.radiusNorm * minSide);
  const invRadius2 = 1.0 / (radiusPx * radiusPx);

  const cx = opts.normX * w;
  const cy = opts.normY * h;

  const minX = Math.max(0, Math.floor(cx - radiusPx));
  const maxX = Math.min(w - 1, Math.ceil(cx + radiusPx));
  const minY = Math.max(0, Math.floor(cy - radiusPx));
  const maxY = Math.min(h - 1, Math.ceil(cy + radiusPx));

  const maxStop = ENLARGER_CONSTANTS.maxDodgeBurnStops;
  const effectiveDelta = opts.strengthStops * pressure;

  for (let y = minY; y <= maxY; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy;
    const rowOffset = y * w;

    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx;
      const r2 = (dx * dx + dy2) * invRadius2;
      if (r2 >= 1.0) continue;

      // C¹/C² türevi sınırda sıfır olan pürüzsüz radyal tüy (feather) profili
      const oneMinusR2 = 1.0 - r2;
      const falloff = oneMinusR2 * oneMinusR2;

      const idx = rowOffset + x;
      const cur = data[idx];

      if (opts.mode === 'erase') {
        const keep = Math.max(0, 1.0 - Math.min(0.85, effectiveDelta * 2.2) * falloff);
        const nextVal = cur * keep;
        data[idx] = Math.abs(nextVal) < 1e-4 ? 0 : nextVal;
      } else {
        const sign = opts.mode === 'burn' ? 1.0 : -1.0;
        const nextVal = cur + sign * effectiveDelta * falloff;
        data[idx] = Math.max(-maxStop, Math.min(maxStop, nextVal));
      }
    }
  }

  map.version = nextDodgeBurnVersion();
}

/**
 * İki ardışık işaretçi (pointer) konumu arasında kesintisiz fırça izi oluşturmak için
 * doğrusal olarak enterpole edilmiş darbeler uygular.
 */
export function applyDodgeBurnStrokeSegment(
  map: DodgeBurnMap,
  fromNormX: number,
  fromNormY: number,
  toNormX: number,
  toNormY: number,
  opts: Omit<BrushDabOptions, 'normX' | 'normY'>
): void {
  const aspect = map.height > 0 ? map.width / map.height : 1.0;
  const dx = (toNormX - fromNormX) * (aspect >= 1 ? aspect : 1);
  const dy = (toNormY - fromNormY) * (aspect < 1 ? 1 / aspect : 1);
  const dist = Math.hypot(dx, dy);

  const stepDist = Math.max(0.004, opts.radiusNorm * 0.28);
  const steps = Math.max(1, Math.ceil(dist / stepDist));
  // Adım sıklığına göre darbe gücünü normalize et ki hızlı/yavaş sürüklemede birikim dengeli kalsın
  const perStepStrength = opts.strengthStops * Math.min(1.0, 0.42);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    applyDodgeBurnBrushDab(map, {
      ...opts,
      normX: fromNormX + (toNormX - fromNormX) * t,
      normY: fromNormY + (toNormY - fromNormY) * t,
      strengthStops: perStepStrength
    });
  }
}

/**
 * WebGPU'nun `linear` + `clamp-to-edge` donanım örnekleyicisiyle 1:1 aynı yarım-teksel merkezli
 * çift doğrusal (bilinear) enterpolasyonu CPU üzerinde çalıştırır.
 */
export function sampleDodgeBurnBilinear(
  map: DodgeBurnMap | null | undefined,
  u: number,
  v: number
): number {
  if (!map || map.width <= 0 || map.height <= 0) return 0.0;

  const w = map.width;
  const h = map.height;
  const data = map.data;

  const xc = u * w - 0.5;
  const yc = v * h - 0.5;

  const xFloor = Math.floor(xc);
  const yFloor = Math.floor(yc);

  const fx = xc - xFloor;
  const fy = yc - yFloor;

  const x0 = xFloor < 0 ? 0 : xFloor >= w ? w - 1 : xFloor;
  const x1 = xFloor + 1 < 0 ? 0 : xFloor + 1 >= w ? w - 1 : xFloor + 1;
  const y0 = yFloor < 0 ? 0 : yFloor >= h ? h - 1 : yFloor;
  const y1 = yFloor + 1 < 0 ? 0 : yFloor + 1 >= h ? h - 1 : yFloor + 1;

  const row0 = y0 * w;
  const row1 = y1 * w;

  const v00 = data[row0 + x0];
  const v10 = data[row0 + x1];
  const v01 = data[row1 + x0];
  const v11 = data[row1 + x1];

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * DodgeBurnMap Float32 tamponunu WebGPU `r16float` doku yüklemesi için IEEE-754 Uint16 dizisine paketler.
 */
export function packDodgeBurnMapToR16Float(map: DodgeBurnMap, scratch?: Uint16Array): Uint16Array {
  return packFloat32ArrayToFloat16(map.data, scratch);
}
