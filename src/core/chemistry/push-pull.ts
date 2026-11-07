import { PresetDefinition, PresetKey, SensitometryParams, SliderSettings } from '../types';
import { PRESETS } from '../presets';
import {
  PUSH_PULL_CALIBRATION_TABLE,
  PUSH_PULL_MAX_STOPS,
  PUSH_PULL_MIN_STOPS,
  PushPullCalibrationNode
} from './constants';

/**
 * Push / Pull banyosu yalnızca siyah-beyaz gümüş-jelatin negatif profillerinde ('hp5', 'sb') aktiftir.
 */
export function isPushPullSupportedPreset(preset: PresetKey): boolean {
  return preset === 'hp5' || preset === 'sb';
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Kalibrasyon tablosundan parça-parça doğrusal (piecewise-linear) enterpolasyonla
 * verilen deltaStops (-3..+3 aralığına genişletilmiş) için fiziksel çarpanları hesaplar.
 */
export function interpolatePushPullNode(deltaStops: number): PushPullCalibrationNode {
  if (Math.abs(deltaStops) < 1e-6) {
    return PUSH_PULL_CALIBRATION_TABLE[2]; // Tam 0.0 birim düğümü
  }

  const table = PUSH_PULL_CALIBRATION_TABLE;
  const first = table[0];
  const last = table[table.length - 1];

  // Moriyama S/B (+2 nominal) üzerinde kullanıcı -2.0 stop seçerse deltaStops = -4.0 olabilir;
  // alt/üst uçlarda son segmentin eğimiyle yumuşak ve sınırlı ekstrapolasyon yapılır.
  const clampedDelta = clamp(deltaStops, -4.0, 3.5);

  if (clampedDelta <= first.deltaStops) {
    const next = table[1];
    const t = (clampedDelta - first.deltaStops) / (next.deltaStops - first.deltaStops);
    return lerpNode(first, next, t);
  }

  if (clampedDelta >= last.deltaStops) {
    const prev = table[table.length - 2];
    const t = (clampedDelta - prev.deltaStops) / (last.deltaStops - prev.deltaStops);
    return lerpNode(prev, last, t);
  }

  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (clampedDelta >= a.deltaStops && clampedDelta <= b.deltaStops) {
      const t = (clampedDelta - a.deltaStops) / (b.deltaStops - a.deltaStops);
      return lerpNode(a, b, t);
    }
  }

  return table[2];
}

function lerpNode(
  a: PushPullCalibrationNode,
  b: PushPullCalibrationNode,
  t: number
): PushPullCalibrationNode {
  return {
    deltaStops: a.deltaStops + (b.deltaStops - a.deltaStops) * t,
    gammaMultiplier: Math.max(0.58, a.gammaMultiplier + (b.gammaMultiplier - a.gammaMultiplier) * t),
    toeDelta: a.toeDelta + (b.toeDelta - a.toeDelta) * t,
    shoulderDelta: a.shoulderDelta + (b.shoulderDelta - a.shoulderDelta) * t,
    exposureEvDelta: a.exposureEvDelta + (b.exposureEvDelta - a.exposureEvDelta) * t,
    dMinDelta: a.dMinDelta + (b.dMinDelta - a.dMinDelta) * t,
    dMaxDelta: a.dMaxDelta + (b.dMaxDelta - a.dMaxDelta) * t,
    grainMultiplier: Math.max(0.65, a.grainMultiplier + (b.grainMultiplier - a.grainMultiplier) * t)
  };
}

export interface ResolvedPushPullState {
  active: boolean;
  userStops: number;
  nominalStops: number;
  deltaStops: number;
  effectiveExposureSlider: number;
  sensitometry: SensitometryParams;
  grainMultiplier: number;
}

/**
 * Seçili profil ve sürgü ayarları için efektif Push/Pull H&D sensitometri ve gren çarpanlarını çözer.
 *
 * Kritik Garanti:
 * - S/B olmayan tüm profillerde active = false döner ve hiçbir parametreye dokunulmaz.
 * - `hp5` (varsayılan 0.0 stop) ve `sb` (Moriyama S/B, varsayılan +2.0 stop) profillerinde
 *   varsayılan değerdeyken deltaStops === 0 olur ve orijinal referans nesnesi 0 farkla korunur.
 */
export function resolveEffectivePushPull(
  settings: SliderSettings,
  presetOverride?: PresetDefinition
): ResolvedPushPullState {
  const preset = presetOverride || PRESETS[settings.preset] || PRESETS.none;
  const supported = isPushPullSupportedPreset(settings.preset);
  const defaultStops = preset.defaultPushPull ?? 0.0;
  const nominalStops = preset.nominalPushStops ?? 0.0;

  if (!supported) {
    return {
      active: false,
      userStops: 0.0,
      nominalStops: 0.0,
      deltaStops: 0.0,
      effectiveExposureSlider: settings.exposure,
      sensitometry: preset.sensitometry,
      grainMultiplier: 1.0
    };
  }

  const rawUserStops = settings.devPushPull !== undefined ? settings.devPushPull : defaultStops;
  const userStops = clamp(rawUserStops, PUSH_PULL_MIN_STOPS, PUSH_PULL_MAX_STOPS);
  const deltaStops = userStops - nominalStops;

  if (Math.abs(deltaStops) < 1e-6) {
    return {
      active: true,
      userStops,
      nominalStops,
      deltaStops: 0.0,
      effectiveExposureSlider: settings.exposure,
      sensitometry: preset.sensitometry,
      grainMultiplier: 1.0
    };
  }

  const node = interpolatePushPullNode(deltaStops);
  const base = preset.sensitometry;

  // lut3d ve ColorLutWebGPUEngine içinde evStops = (exposure / 100) * 1.65 olduğundan,
  // exposureEvDelta stop kaymasını aynı ölçekte pozlama parametresine ekleriz.
  const exposureSliderDelta = (node.exposureEvDelta / 1.65) * 100.0;

  const sensitometry: SensitometryParams = {
    toeStrength: clamp(base.toeStrength + node.toeDelta, 0.02, 0.95),
    gammaSlope: clamp(base.gammaSlope * node.gammaMultiplier, 0.58, 2.05),
    shoulderRollOff: clamp(base.shoulderRollOff + node.shoulderDelta, 0.25, 0.98),
    dMin: clamp(base.dMin + node.dMinDelta, 0.0, 0.12),
    dMax: clamp(base.dMax + node.dMaxDelta, 0.85, 1.0),
    highlightDesat: base.highlightDesat
  };

  return {
    active: true,
    userStops,
    nominalStops,
    deltaStops,
    effectiveExposureSlider: settings.exposure + exposureSliderDelta,
    sensitometry,
    grainMultiplier: node.grainMultiplier
  };
}
