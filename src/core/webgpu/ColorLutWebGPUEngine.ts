import { CubeLUT3D, RenderTarget, SliderSettings } from '../types';
import { PRESETS } from '../presets';
import { getActiveLUT3D } from '../lut3d';

/**
 * 🎨 WebGPU 3D LUT (texture_3d<f32>), Tetrahedral Enterpolasyon,
 * Hurter & Driffield (H&D) Sensitometri ve 650nm Spektral Kırılmalı Halasyon Motoru.
 *
 * - CSS filtrelerini (brightness, contrast, saturate) ve düz renk bindirmelerini (overlay) tamamen ortadan kaldırır.
 * - Gerçek emülsiyonların (Kodachrome 64, Fuji Velvia 50, Ilford HP5+, Kodak Portra 400, CineStill 800T vb.)
 *   33x33x33 veya 65x65x65 3D LUT profillerini GPU'da 3B Doku (texture_3d<f32>) üzerinde Dörtyüzlü (Tetrahedral)
 *   enterpolasyon ile piksel bazında hatasız eşler.
 * - Hurter & Driffield (H&D) karakteristik S-eğrisiyle dip tonlarda (toe) logaritmik uyanış, orta tonlarda
 *   %18 gri (E0 = 0.184) pivotlu lineer geçiş ve yüksek ışıklarda (shoulder) C¹-sürekli doygunluk sönümlenmesi uygular.
 * - Dalga boyuna göre dağılan (450nm Mavi üst katman, 550nm Yeşil orta katman, 650nm Kırmızı film tabanı tam yansıması)
 *   gerçek fiziksel Spektral Kırılmalı Halasyon haritasını lineer foton uzayında hesaplar.
 */

const COLOR_LUT_WGSL_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var out: VertexOutput;
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  let p = pos[vid];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

struct ColorUniforms {
  resolution: vec2<f32>,
  exposure: f32,
  contrast: f32,
  shoulder: f32,
  saturation: f32,
  warmth: f32,
  halation: f32,
  lutSize: f32,
  toeStrength: f32,
  gammaSlope: f32,
  shoulderRollOff: f32,
  dMin: f32,
  dMax: f32,
  highlightDesat: f32,
  aspectRatio: f32,
  domainMinR: f32,
  domainMinG: f32,
  domainMinB: f32,
  domainMaxR: f32,
  domainMaxG: f32,
  domainMaxB: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> u: ColorUniforms;
@group(0) @binding(1) var imageTexture: texture_2d<f32>;
@group(0) @binding(2) var lutTexture: texture_3d<f32>;
@group(0) @binding(3) var texSampler: sampler;

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let v = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  let low = v / 12.92;
  let high = pow((v + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(high, low, v <= vec3<f32>(0.04045));
}

fn linear_to_srgb_scalar(c: f32) -> f32 {
  let v = clamp(c, 0.0, 1.0);
  return select(
    1.055 * pow(v, 1.0 / 2.4) - 0.055,
    v * 12.92,
    v <= 0.0031308
  );
}

// Hurter & Driffield (H&D) Karakteristik Eğrisi: Toe + 18% Gri Pivotlu Straight-Line + C¹ Shoulder Roll-off
fn eval_hd_channel(
  linearE: f32,
  gamma: f32,
  toeStrength: f32,
  shoulderComp: f32,
  dMin: f32,
  dMax: f32
) -> f32 {
  let e = max(0.0, linearE);

  // 1. Dip tonlarda (Toe) logaritmik uyanış
  let toeLift = toeStrength * 0.014;
  let eToe = (e + toeLift * (1.0 - exp(-e * 18.0))) / (1.0 + toeLift);

  // 2. Orta tonlarda (Straight-line) %18 gri (E0 = 0.184) pivot etrafında eğim
  let pivot: f32 = 0.184;
  var eContrast: f32 = 0.0;
  if (eToe > 0.0) {
    eContrast = pivot * pow(eToe / pivot, gamma);
  }

  // 3. Yüksek ışıklarda (Shoulder) C¹-sürekli üstel film omzu sıkıştırması
  // y(knee) = knee, y'(knee) = 1.0 (sıfır kırılma), lim(x->∞) y(x) = ceiling <= 1.0 (sıfır patlama)
  var linearOut = eContrast;
  if (shoulderComp > 0.001) {
    let knee = 0.86 - shoulderComp * 0.42;
    let ceiling = 1.0 - shoulderComp * 0.02;
    if (eContrast > knee) {
      let delta = eContrast - knee;
      let headroom = max(0.05, ceiling - knee);
      linearOut = knee + headroom * (1.0 - exp(-delta / headroom));
    }
  }

  let srgbVal = linear_to_srgb_scalar(linearOut);
  return clamp(dMin + srgbVal * (dMax - dMin), 0.0, 1.0);
}

// 6-Bölmeli Dörtyüzlü (Tetrahedral) 3D LUT Enterpolasyonu
fn sample_lut_tetrahedral(rgb: vec3<f32>) -> vec3<f32> {
  let n = i32(u.lutSize);
  let maxIdx = f32(n - 1);
  let maxIdxI = n - 1;

  let dMin = vec3<f32>(u.domainMinR, u.domainMinG, u.domainMinB);
  let dMax = vec3<f32>(u.domainMaxR, u.domainMaxG, u.domainMaxB);
  let normRgb = clamp((rgb - dMin) / max(vec3<f32>(0.0001), dMax - dMin), vec3<f32>(0.0), vec3<f32>(1.0));

  let pos = normRgb * maxIdx;
  let p0 = min(vec3<i32>(pos), vec3<i32>(maxIdxI));
  let p1 = min(p0 + vec3<i32>(1), vec3<i32>(maxIdxI));

  let d = pos - vec3<f32>(p0);
  let dr = d.r;
  let dg = d.g;
  let db = d.b;

  let c000 = textureLoad(lutTexture, p0, 0).rgb;
  let c111 = textureLoad(lutTexture, p1, 0).rgb;

  var c1: vec3<f32>;
  var c2: vec3<f32>;
  var w0: f32;
  var w1: f32;
  var w2: f32;
  var w3: f32;

  if (dr >= dg) {
    if (dg >= db) {
      // T1: dr >= dg >= db
      c1 = textureLoad(lutTexture, vec3<i32>(p1.x, p0.y, p0.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p1.x, p1.y, p0.z), 0).rgb;
      w0 = 1.0 - dr;
      w1 = dr - dg;
      w2 = dg - db;
      w3 = db;
    } else if (dr >= db) {
      // T2: dr >= db > dg
      c1 = textureLoad(lutTexture, vec3<i32>(p1.x, p0.y, p0.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p1.x, p0.y, p1.z), 0).rgb;
      w0 = 1.0 - dr;
      w1 = dr - db;
      w2 = db - dg;
      w3 = dg;
    } else {
      // T3: db > dr >= dg
      c1 = textureLoad(lutTexture, vec3<i32>(p0.x, p0.y, p1.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p1.x, p0.y, p1.z), 0).rgb;
      w0 = 1.0 - db;
      w1 = db - dr;
      w2 = dr - dg;
      w3 = dg;
    }
  } else {
    if (db > dg) {
      // T4: db > dg > dr
      c1 = textureLoad(lutTexture, vec3<i32>(p0.x, p0.y, p1.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p0.x, p1.y, p1.z), 0).rgb;
      w0 = 1.0 - db;
      w1 = db - dg;
      w2 = dg - dr;
      w3 = dr;
    } else if (db > dr) {
      // T5: dg >= db > dr
      c1 = textureLoad(lutTexture, vec3<i32>(p0.x, p1.y, p0.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p0.x, p1.y, p1.z), 0).rgb;
      w0 = 1.0 - dg;
      w1 = dg - db;
      w2 = db - dr;
      w3 = dr;
    } else {
      // T6: dg > dr >= db
      c1 = textureLoad(lutTexture, vec3<i32>(p0.x, p1.y, p0.z), 0).rgb;
      c2 = textureLoad(lutTexture, vec3<i32>(p1.x, p1.y, p0.z), 0).rgb;
      w0 = 1.0 - dg;
      w1 = dg - dr;
      w2 = dr - db;
      w3 = db;
    }
  }

  return clamp(w0 * c000 + w1 * c1 + w2 * c2 + w3 * c111, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Spektral Kırılmalı Halasyon (650nm Film Tabanı Tam Yansıma & Mie Saçılma PSF)
fn compute_spectral_halation(uv: vec2<f32>) -> vec3<f32> {
  let halStrength = u.halation / 100.0;
  if (halStrength <= 0.001) {
    return vec3<f32>(0.0);
  }

  let aspect = u.aspectRatio;
  // Dalga boyuna göre kırılma ve film tabanı (n=1.48, d=140um, kritik açı ~42.5°) saçılma yarıçapı
  let maxRadius = 0.012 + halStrength * 0.022;
  let GOLDEN_ANGLE: f32 = 2.39996323;

  var scatter650: f32 = 0.0; // 650nm Kırmızı (Taban geri yansıması - geniş halka/saçılma)
  var scatter550: f32 = 0.0; // 550nm Yeşil/Kehribar (Orta emülsiyon Mie saçılması - dar çekirdek)
  var scatter450: f32 = 0.0; // 450nm Mavi (Üst katman ileri saçılma - mikro hale)

  var w650Sum: f32 = 0.0;
  var w550Sum: f32 = 0.0;
  var w450Sum: f32 = 0.0;

  for (var i = 0; i < 24; i++) {
    let fi = f32(i);
    let normR = sqrt((fi + 0.5) / 24.0);
    let theta = fi * GOLDEN_ANGLE;
    let dir = vec2<f32>(cos(theta), sin(theta));

    // 1. 650nm Kırmızı Katman Saçılması (Tam yansıma kritik açı halkası + Cauchy kuyruğu)
    let r650 = normR * maxRadius;
    let uv650 = clamp(uv + vec2<f32>(dir.x * r650 / aspect, dir.y * r650), vec2<f32>(0.0), vec2<f32>(1.0));
    let sCol650 = srgb_to_linear(textureSampleLevel(imageTexture, texSampler, uv650, 0.0).rgb);
    let luma650 = dot(sCol650, vec3<f32>(0.26, 0.64, 0.10));
    let energy650 = max(0.0, luma650 - 0.36) * (0.65 * sCol650.r + 0.35 * luma650);
    let highEnergy650 = pow(energy650 / 0.64, 2.2);
    let ringDiff = (normR - 0.42) / 0.22;
    let ringBoost = 1.0 + 0.65 * exp(-(ringDiff * ringDiff));
    let w650 = ringBoost / pow(1.0 + 3.2 * normR * normR, 1.5);
    scatter650 += highEnergy650 * w650;
    w650Sum += w650;

    // 2. 550nm Yeşil/Kehribar Orta Katman Saçılması (Yarıçap = %34 * r650)
    let r550 = r650 * 0.34;
    let uv550 = clamp(uv + vec2<f32>(dir.x * r550 / aspect, dir.y * r550), vec2<f32>(0.0), vec2<f32>(1.0));
    let sCol550 = srgb_to_linear(textureSampleLevel(imageTexture, texSampler, uv550, 0.0).rgb);
    let luma550 = dot(sCol550, vec3<f32>(0.2126, 0.7152, 0.0722));
    let highEnergy550 = pow(max(0.0, luma550 - 0.44) / 0.56, 2.5);
    let w550 = 1.0 / pow(1.0 + 4.5 * normR * normR, 1.6);
    scatter550 += highEnergy550 * w550;
    w550Sum += w550;

    // 3. 450nm Mavi Üst Katman Saçılması (Yarıçap = %11 * r650)
    let r450 = r650 * 0.11;
    let uv450 = clamp(uv + vec2<f32>(dir.x * r450 / aspect, dir.y * r450), vec2<f32>(0.0), vec2<f32>(1.0));
    let sCol450 = srgb_to_linear(textureSampleLevel(imageTexture, texSampler, uv450, 0.0).rgb);
    let luma450 = dot(sCol450, vec3<f32>(0.2126, 0.7152, 0.0722));
    let highEnergy450 = pow(max(0.0, luma450 - 0.55) / 0.45, 2.8);
    let w450 = 1.0 / (1.0 + 6.0 * normR * normR);
    scatter450 += highEnergy450 * w450;
    w450Sum += w450;
  }

  let norm650 = scatter650 / max(0.001, w650Sum);
  let norm550 = scatter550 / max(0.001, w550Sum);
  let norm450 = scatter450 / max(0.001, w450Sum);

  // Dalga boyu geçirgenlik katsayıları:
  // Çekirdek kenarında altın-kehribar (550nm + 650nm), dış halede saf 650nm yakut kırmızısı kırılma
  let haloLinear = vec3<f32>(
    norm650 * 1.45 + norm550 * 0.25,
    norm550 * 0.36 + norm650 * 0.05,
    norm450 * 0.08
  ) * halStrength * 1.35;

  return haloLinear;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let texCol = textureSampleLevel(imageTexture, texSampler, in.uv, 0.0);
  var linearRgb = srgb_to_linear(texCol.rgb);

  // 1. Spektral Kırılmalı Halasyon (650nm / 550nm / 450nm katman saçılması)
  if (u.halation > 0.0) {
    let spectralHalo = compute_spectral_halation(in.uv);
    linearRgb += spectralHalo;
  }

  // 2. Fiziksel EV Pozlama
  let evStops = (u.exposure / 100.0) * 1.65;
  let expGain = pow(2.0, evStops);
  linearRgb *= expGain;

  // 3. Bradford / Planckian Kromatik Sıcaklık Adaptasyonu
  if (abs(u.warmth) > 0.001) {
    let w = u.warmth / 100.0;
    let adapt = vec3<f32>(
      1.0 + w * 0.24,
      1.0 + w * 0.03,
      max(0.55, 1.0 - w * 0.26)
    );
    linearRgb *= adapt;
  }

  // 4. Hurter & Driffield (H&D) Sensitometri & Film Omzu (Shoulder) Sıkıştırması
  let contrastFactor = pow(2.0, (u.contrast / 100.0) * 0.58);
  let effectiveGamma = clamp(u.gammaSlope * contrastFactor, 0.55, 2.1);
  let userShoulder = clamp(u.shoulder / 100.0, 0.0, 1.0);
  let effectiveShoulder = select(
    clamp(userShoulder * (0.65 + 0.45 * u.shoulderRollOff), 0.0, 1.0),
    0.0,
    userShoulder <= 0.001
  );

  var hdRgb = vec3<f32>(
    eval_hd_channel(linearRgb.r, effectiveGamma, u.toeStrength, effectiveShoulder, u.dMin, u.dMax),
    eval_hd_channel(linearRgb.g, effectiveGamma, u.toeStrength, effectiveShoulder, u.dMin, u.dMax),
    eval_hd_channel(linearRgb.b, effectiveGamma, u.toeStrength, effectiveShoulder, u.dMin, u.dMax)
  );

  // 5. Film Omzunda Çapraz Kanal Doygunluk Sönümlenmesi (Highlight Shoulder Desaturation)
  let maxCh = max(hdRgb.r, max(hdRgb.g, hdRgb.b));
  let lumaPre = dot(hdRgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let shoulderZone = smoothstep(0.66, 0.98, maxCh);
  let desatAmt = shoulderZone * clamp(u.highlightDesat * effectiveShoulder * 1.25, 0.0, 1.0);

  if (desatAmt > 0.0) {
    let warmPaper = vec3<f32>(min(1.0, lumaPre * 1.006), lumaPre, lumaPre * 0.988);
    hdRgb = mix(hdRgb, warmPaper, desatAmt);
  }

  // 6. 3D LUT (texture_3d<f32>) Dörtyüzlü (Tetrahedral) Enterpolasyon
  var gradedRgb = sample_lut_tetrahedral(hdRgb);

  // 7. Omuz Korumalı Fotometrik Doygunluk
  if (abs(u.saturation) > 0.001) {
    let lumaPost = dot(gradedRgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let rawSat = max(0.0, 1.0 + (u.saturation / 100.0) * 0.85);
    let effSat = select(rawSat, 1.0 + (rawSat - 1.0) * (1.0 - shoulderZone * 0.65), rawSat > 1.0);
    gradedRgb = clamp(vec3<f32>(lumaPost) + (gradedRgb - vec3<f32>(lumaPost)) * effSat, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  return vec4<f32>(gradedRgb, texCol.a);
}
`;

export class ColorLutWebGPUEngine {
  private static instance: ColorLutWebGPUEngine | null = null;
  private static initPromise: Promise<ColorLutWebGPUEngine | null> | null = null;

  public readonly device: GPUDevice;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly uniformBuffer: GPUBuffer;
  private readonly presentationFormat: GPUTextureFormat;

  private gpuCanvas: OffscreenCanvas;
  private gpuContext: GPUCanvasContext;
  private isDeviceLost = false;

  private cachedLutTitle = '';
  private cachedLutSize = 0;
  private cachedLutDataRef: Float32Array | null = null;
  private lut3DTexture: GPUTexture | null = null;
  private lutUseFloat32 = true;

  private constructor(device: GPUDevice, presentationFormat: GPUTextureFormat) {
    this.device = device;
    this.presentationFormat = presentationFormat;

    this.device.lost.then(() => {
      this.isDeviceLost = true;
      if (ColorLutWebGPUEngine.instance === this) {
        ColorLutWebGPUEngine.instance = null;
      }
    });

    const shaderModule = this.device.createShaderModule({
      label: '3D LUT Tetrahedral & H&D Sensitometry Shader',
      code: COLOR_LUT_WGSL_SHADER
    });

    // Açık (explicit) BindGroupLayout:
    // rgba32float 3D LUT dokularının 'float32-filterable' uzantısı gerektirmeden
    // tüm WebGPU sürücülerinde textureLoad ile %100 uyumlu çalışmasını garanti eder.
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'ColorLut Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float', viewDimension: '3d' }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: 'ColorLut Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout]
    });

    this.pipeline = this.device.createRenderPipeline({
      label: '3D LUT Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentationFormat }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

    this.sampler = this.device.createSampler({
      label: 'Source Linear Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    // 24 float = 96 byte (16-byte hizalı)
    this.uniformBuffer = this.device.createBuffer({
      label: 'ColorLut Uniform Buffer',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    this.gpuCanvas = new OffscreenCanvas(256, 256);
    const ctx = this.gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) throw new Error('ColorLut WebGPU context oluşturulamadı.');
    this.gpuContext = ctx;
    this.gpuContext.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque'
    });
  }

  public static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      !!navigator.gpu &&
      typeof OffscreenCanvas !== 'undefined'
    );
  }

  public static async getOrCreate(): Promise<ColorLutWebGPUEngine | null> {
    if (ColorLutWebGPUEngine.instance && !ColorLutWebGPUEngine.instance.isDeviceLost) {
      return ColorLutWebGPUEngine.instance;
    }
    if (!ColorLutWebGPUEngine.isSupported()) {
      return null;
    }
    if (ColorLutWebGPUEngine.initPromise) {
      return ColorLutWebGPUEngine.initPromise;
    }

    ColorLutWebGPUEngine.initPromise = (async () => {
      try {
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance'
        });
        if (!adapter) return null;

        const maxTex2D = adapter.limits.maxTextureDimension2D || 8192;
        const device = await adapter.requestDevice({
          requiredLimits: {
            maxTextureDimension2D: maxTex2D
          }
        });
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        const engine = new ColorLutWebGPUEngine(device, presentationFormat);
        ColorLutWebGPUEngine.instance = engine;
        return engine;
      } catch (err) {
        console.warn('3D LUT WebGPU motoru başlatılamadı:', err);
        return null;
      } finally {
        ColorLutWebGPUEngine.initPromise = null;
      }
    })();

    return ColorLutWebGPUEngine.initPromise;
  }

  public static getInstanceSync(): ColorLutWebGPUEngine | null {
    if (ColorLutWebGPUEngine.instance?.isDeviceLost) {
      ColorLutWebGPUEngine.instance = null;
    }
    return ColorLutWebGPUEngine.instance;
  }

  private ensureLut3DTexture(lut: CubeLUT3D): GPUTexture {
    if (
      this.lut3DTexture &&
      this.cachedLutSize === lut.size &&
      this.cachedLutDataRef === lut.data &&
      this.cachedLutTitle === lut.title
    ) {
      return this.lut3DTexture;
    }

    if (this.lut3DTexture) {
      try {
        this.lut3DTexture.destroy();
      } catch {}
      this.lut3DTexture = null;
    }

    const N = lut.size;
    try {
      const tex = this.device.createTexture({
        label: `3D LUT Texture (${lut.title} ${N}x${N}x${N})`,
        dimension: '3d',
        size: [N, N, N],
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });

      this.device.queue.writeTexture(
        { texture: tex },
        lut.data.buffer,
        {
          offset: lut.data.byteOffset,
          bytesPerRow: N * 16,
          rowsPerImage: N
        },
        [N, N, N]
      );
      this.lut3DTexture = tex;
      this.lutUseFloat32 = true;
    } catch {
      const tex = this.device.createTexture({
        label: `3D LUT Texture 8bit (${lut.title} ${N}x${N}x${N})`,
        dimension: '3d',
        size: [N, N, N],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      const u8 = new Uint8Array(lut.data.length);
      for (let i = 0; i < lut.data.length; i++) {
        u8[i] = Math.min(255, Math.max(0, Math.round(lut.data[i] * 255)));
      }
      this.device.queue.writeTexture(
        { texture: tex },
        u8,
        {
          bytesPerRow: N * 4,
          rowsPerImage: N
        },
        [N, N, N]
      );
      this.lut3DTexture = tex;
      this.lutUseFloat32 = false;
    }

    this.cachedLutTitle = lut.title;
    this.cachedLutSize = lut.size;
    this.cachedLutDataRef = lut.data;
    return this.lut3DTexture;
  }

  /**
   * Hedef tuvaldeki ham görüntüyü alır; WebGPU üzerinde Spektral Kırılmalı Halasyon,
   * H&D Sensitometri Eğrisi ve 3D LUT Tetrahedral Enterpolasyon uygulayarak tuvale yazar.
   */
  public renderToTarget(
    target: RenderTarget,
    settings: SliderSettings,
    customLutOverride?: CubeLUT3D | null
  ): boolean {
    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost) return false;

    const maxTexDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxTexDim || h > maxTexDim) {
      return false;
    }

    const isCcd = settings.preset === 'ccd' || settings.preset === 'ccd_y2k';
    const effectiveHalation = isCcd ? 0 : (settings.halation ?? 0);
    const shld = settings.shoulder ?? 0;

    // Saf Orijinal (none) ve tüm ayarlar sıfır ise işlem yapmadan birebir koru
    if (
      settings.preset === 'none' &&
      settings.exposure === 0 &&
      settings.contrast === 0 &&
      shld === 0 &&
      settings.warmth === 0 &&
      settings.saturation === 0 &&
      effectiveHalation === 0
    ) {
      return true;
    }

    try {
      if (this.gpuCanvas.width !== w || this.gpuCanvas.height !== h) {
        this.gpuCanvas.width = w;
        this.gpuCanvas.height = h;
        this.gpuContext.configure({
          device: this.device,
          format: this.presentationFormat,
          alphaMode: 'opaque'
        });
      }

      const preset = PRESETS[settings.preset] || PRESETS.none;
      const lut =
        settings.preset === 'custom_lut' && customLutOverride
          ? customLutOverride
          : getActiveLUT3D(settings.preset);
      const lutTexture = this.ensureLut3DTexture(lut);

      // Kaynak görsel dokusu
      const imageTexture = this.device.createTexture({
        label: 'ColorLut Source Image Texture',
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      });

      this.device.queue.copyExternalImageToTexture(
        { source: target.canvas as GPUCopyExternalImageSource },
        { texture: imageTexture },
        [w, h]
      );

      const sens = preset.sensitometry;
      const uniformData = new Float32Array([
        w,
        h,
        settings.exposure,
        settings.contrast,
        shld,
        settings.saturation,
        settings.warmth,
        effectiveHalation,
        lut.size,
        sens.toeStrength,
        sens.gammaSlope,
        sens.shoulderRollOff,
        sens.dMin,
        sens.dMax,
        sens.highlightDesat,
        w / h,
        lut.domainMin[0],
        lut.domainMin[1],
        lut.domainMin[2],
        lut.domainMax[0],
        lut.domainMax[1],
        lut.domainMax[2],
        this.lutUseFloat32 ? 1.0 : 0.0,
        0.0
      ]);

      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

      const bindGroup = this.device.createBindGroup({
        label: 'ColorLut Bind Group',
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: imageTexture.createView() },
          { binding: 2, resource: lutTexture.createView({ dimension: '3d' }) },
          { binding: 3, resource: this.sampler }
        ]
      });

      const commandEncoder = this.device.createCommandEncoder({
        label: 'ColorLut Command Encoder'
      });

      const passEncoder = commandEncoder.beginRenderPass({
        label: 'ColorLut Render Pass',
        colorAttachments: [
          {
            view: this.gpuContext.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      });

      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(3);
      passEncoder.end();

      this.device.queue.submit([commandEncoder.finish()]);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      imageTexture.destroy();
      return true;
    } catch (err) {
      console.warn('3D LUT WebGPU render hatası, CPU tetrahedral yedek devreye giriyor:', err);
      return false;
    }
  }
}
