import { DodgeBurnMap, PaperType, RenderTarget, SliderSettings } from '../types';
import {
  computeHardLayerWeight,
  ENLARGER_CONSTANTS,
  LINEAR_LUMA_WEIGHTS,
  LN_10,
  LOG10_2,
  MM_PER_PIXEL_AT_300DPI,
  MULTIGRADE_EMULSION_CONSTANTS,
  NEGATIVE_FILM_CONSTANTS,
  PAPER_PROFILES
} from '../paper/constants';
import { hasActiveDodgeBurnData, packDodgeBurnMapToR16Float } from '../paper/dodge-burn';
import { computePaperBaseLinearRgb, PaperPrintRenderContext } from '../paper/paper-cpu';
import { getOrBuildToningLUT1D } from '../paper/toning-lut';
import {
  getSharedGPUDevice,
  isWebGPUSupported,
  requestOffscreenGPUDevice
} from './gpuDeviceManager';

const INV_LN_10 = 1.0 / LN_10;
const NEG_INV_LOG_DENOM =
  1.0 / (Math.log(1.0 + NEGATIVE_FILM_CONSTANTS.logCompressionK) * INV_LN_10);

function f32Literal(n: number): string {
  const s = Number(n).toString();
  return s.includes('.') || s.includes('e') || s.includes('E') ? s : `${s}.0`;
}

/**
 * 🖨️ Foton: Karanlık Oda — Faz 1 Kağıda Baskı (Darkroom Paper Print) WebGPU Motoru.
 *
 * Fiziksel Işık ve Kimya Yolu (WGSL Tek Geçişli Sahne-Lineer Akış):
 * 0. Giriş sRGB dokusunu sahne/film-lineer foton uzayına açar ve pankromatik lüminansı hesaplar.
 * 1. S/B gümüş negatif optik yoğunluğunu (D_neg ∈ [dBaseFog, dMax]) ve geçirgenliğini (T_neg = 10^(-D_neg))
 *    hesaplar; Agrandizör pozu (stop) ve yarım-teksel doğrusal örneklenmiş 1/4 çözünürlüklü Dodge/Burn haritasını ekler.
 * 2. Ilford Multigrade V çift emülsiyon katmanı (Derece 00 yumuşak yeşil duyarlı + Derece 5 sert mavi duyarlı)
 *    veya Split-Grade (iki ayrı pozun net yoğunluk toplamı) üzerinden kağıt yansıma yoğunluğunu D(logE) üretir.
 * 3. Optik yoğunluktan lineer yansımaya (R = 10^(-D)) geçer.
 * 4. 256x1 `rgba16float` 1D Kimyasal Toning LUT dokusundan Selenyum (Ag2Se) ve Sepya (Ag2S) tepkisini örnekler.
 * 5. Kağıt tabanı tonunu (nötr beyaz -> sıcak baryta krem) ve 300 DPI fiziksel milimetre ölçeğine kilitli
 *    iki katmanlı prosedürel kağıt dokusunu (genlik <= %2) uygular.
 * 6. En sonda tek noktada sRGB ekran dönüşümü yapar.
 */
const PAPER_PRINT_WGSL_SHADER = /* wgsl */ `
const LN_10: f32 = ${f32Literal(LN_10)};
const INV_LN_10: f32 = ${f32Literal(INV_LN_10)};
const LOG10_2: f32 = ${f32Literal(LOG10_2)};

const NEG_D_BASE_FOG: f32 = ${f32Literal(NEGATIVE_FILM_CONSTANTS.dBaseFog)};
const NEG_D_MAX: f32 = ${f32Literal(NEGATIVE_FILM_CONSTANTS.dMax)};
const NEG_LOG_K: f32 = ${f32Literal(NEGATIVE_FILM_CONSTANTS.logCompressionK)};
const NEG_INV_LOG_DENOM: f32 = ${f32Literal(NEG_INV_LOG_DENOM)};

const G_SOFT: f32 = ${f32Literal(MULTIGRADE_EMULSION_CONSTANTS.gSoft)};
const LOG_E0_SOFT: f32 = ${f32Literal(MULTIGRADE_EMULSION_CONSTANTS.logE0Soft)};
const G_HARD: f32 = ${f32Literal(MULTIGRADE_EMULSION_CONSTANTS.gHard)};
const LOG_E0_HARD: f32 = ${f32Literal(MULTIGRADE_EMULSION_CONSTANTS.logE0Hard)};

const MAX_DB_STOPS: f32 = ${f32Literal(ENLARGER_CONSTANTS.maxDodgeBurnStops)};
const LUMA_WEIGHTS: vec3<f32> = vec3<f32>(
  ${f32Literal(LINEAR_LUMA_WEIGHTS[0])},
  ${f32Literal(LINEAR_LUMA_WEIGHTS[1])},
  ${f32Literal(LINEAR_LUMA_WEIGHTS[2])}
);

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

struct PaperPrintUniforms {
  resolution: vec2<f32>,
  fullSizeMm: vec2<f32>,
  exposureStops: f32,
  hardWeight: f32,
  splitGradeActive: f32,
  splitHardRatio: f32,
  dMin: f32,
  dMax: f32,
  paperBaseR: f32,
  paperBaseG: f32,
  paperBaseB: f32,
  texAmplitude: f32,
  texLowWaveMm: f32,
  texHighWaveMm: f32,
  texLowWeight: f32,
  hasDodgeBurn: f32,
  isNeutralToning: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> u: PaperPrintUniforms;
@group(0) @binding(1) var imageTexture: texture_2d<f32>;
@group(0) @binding(2) var dodgeBurnTexture: texture_2d<f32>;
@group(0) @binding(3) var toningTexture: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;

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

fn hash_u32_2d(x: u32, y: u32) -> f32 {
  var h: u32 = x * 374761393u + y * 668265263u + 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  let unit = f32(h >> 8u) * (1.0 / 16777215.0);
  return unit * 2.0 - 1.0;
}

fn value_noise_2d(gx: f32, gy: f32) -> f32 {
  let safeGx = max(0.0, gx);
  let safeGy = max(0.0, gy);
  let flX = floor(safeGx);
  let flY = floor(safeGy);

  let ix0 = u32(flX);
  let iy0 = u32(flY);
  let ix1 = ix0 + 1u;
  let iy1 = iy0 + 1u;

  let fx = safeGx - flX;
  let fy = safeGy - flY;

  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uy = fy * fy * (3.0 - 2.0 * fy);

  let n00 = hash_u32_2d(ix0, iy0);
  let n10 = hash_u32_2d(ix1, iy0);
  let n01 = hash_u32_2d(ix0, iy1);
  let n11 = hash_u32_2d(ix1, iy1);

  let nx0 = n00 + (n10 - n00) * ux;
  let nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

fn eval_paper_texture_multiplier(
  xMm: f32,
  yMm: f32,
  amplitude: f32,
  lowWaveMm: f32,
  highWaveMm: f32,
  lowWeight: f32
) -> f32 {
  let clampedAmp = clamp(amplitude, 0.0, 0.02);
  if (clampedAmp <= 1e-6) {
    return 1.0;
  }

  let nLow = value_noise_2d(xMm / max(0.05, lowWaveMm), yMm / max(0.05, lowWaveMm));
  let nHigh = value_noise_2d(
    xMm / max(0.02, highWaveMm) + 31.7,
    yMm / max(0.02, highWaveMm) + 19.3
  );

  let wLow = clamp(lowWeight, 0.0, 1.0);
  let combined = clamp(wLow * nLow + (1.0 - wLow) * nHigh, -1.0, 1.0);
  return 1.0 + clampedAmp * combined;
}

fn eval_emulsion_logistic(logE: f32, g: f32, logE0: f32) -> f32 {
  let exponent = clamp(-LN_10 * g * (logE - logE0), -40.0, 40.0);
  return 1.0 / (1.0 + exp(exponent));
}

fn eval_negative_log_transmittance(linearFilmLuma: f32) -> f32 {
  let y = clamp(linearFilmLuma, 0.0, 1.0);
  let normNeg = log(1.0 + NEG_LOG_K * y) * INV_LN_10 * NEG_INV_LOG_DENOM;
  let dNeg = NEG_D_BASE_FOG + (NEG_D_MAX - NEG_D_BASE_FOG) * normNeg;
  return -dNeg;
}

fn eval_multigrade_paper_density(
  logEBase: f32,
  dMin: f32,
  dMax: f32,
  hardWeight: f32,
  splitGrade: bool,
  splitHardRatio: f32
) -> f32 {
  let densitySpan = max(0.0, dMax - dMin);

  if (!splitGrade) {
    let wHard = clamp(hardWeight, 0.0, 1.0);
    let wSoft = 1.0 - wHard;
    let sSoft = eval_emulsion_logistic(logEBase, G_SOFT, LOG_E0_SOFT);
    let sHard = eval_emulsion_logistic(logEBase, G_HARD, LOG_E0_HARD);
    return dMin + densitySpan * (wSoft * sSoft + wHard * sHard);
  }

  let r = clamp(splitHardRatio, 0.0, 1.0);
  let softShare = 1.0 - r;

  var netDensitySoft: f32 = 0.0;
  if (softShare > 1e-5) {
    let logESoft = logEBase + log(softShare) * INV_LN_10;
    netDensitySoft = densitySpan * eval_emulsion_logistic(logESoft, G_SOFT, LOG_E0_SOFT);
  }

  var netDensityHard: f32 = 0.0;
  if (r > 1e-5) {
    let logEHard = logEBase + log(r) * INV_LN_10;
    netDensityHard = densitySpan * eval_emulsion_logistic(logEHard, G_HARD, LOG_E0_HARD);
  }

  return dMin + min(densitySpan, netDensitySoft + netDensityHard);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let maxX = max(0, i32(u.resolution.x) - 1);
  let maxY = max(0, i32(u.resolution.y) - 1);
  let px = clamp(i32(in.position.x), 0, maxX);
  let py = clamp(i32(in.position.y), 0, maxY);

  // CPU (px + 0.5) / w ile IEEE-754 bit düzeyinde birebir aynı UV koordinatı
  let uv = vec2<f32>(
    (f32(px) + 0.5) / u.resolution.x,
    (f32(py) + 0.5) / u.resolution.y
  );

  // 0. Sahne/film-lineer uzaya açılım
  let srcCol = textureLoad(imageTexture, vec2<i32>(px, py), 0);
  let linearFilmRgb = srgb_to_linear(srcCol.rgb);
  let yFilm = dot(linearFilmRgb, LUMA_WEIGHTS);

  // 1. Negatif geçirgenliği ve Agrandizör + Dodge/Burn yerel pozu (textureSampleLevel dallanma dışında)
  let logTNeg = eval_negative_log_transmittance(yFilm);
  let sampledDb = textureSampleLevel(dodgeBurnTexture, linearSampler, uv, 0.0).r;
  let dbStops = select(0.0, clamp(sampledDb, -MAX_DB_STOPS, MAX_DB_STOPS), u.hasDodgeBurn > 0.5);
  let logE = logTNeg + (u.exposureStops + dbStops) * LOG10_2;

  // 2. Multigrade / Split-Grade kağıt yansıma yoğunluğu D(logE)
  let dPaper = eval_multigrade_paper_density(
    logE,
    u.dMin,
    u.dMax,
    u.hardWeight,
    u.splitGradeActive > 0.5,
    u.splitHardRatio
  );

  // 3. Yoğunluktan lineer yansımaya dönüşüm: R = 10^(-D)
  let reflectance = exp(-dPaper * LN_10);

  // 4. 256x1 1D Toning LUT örneklemesi (yarım-teksel merkezli: [0.5/256 .. 255.5/256])
  let densitySpan = max(1e-5, u.dMax - u.dMin);
  let normDensity = clamp((dPaper - u.dMin) / densitySpan, 0.0, 1.0);
  let lutU = (normDensity * 255.0 + 0.5) / 256.0;
  let sampledTone = textureSampleLevel(toningTexture, linearSampler, vec2<f32>(lutU, 0.5), 0.0).rgb;
  let toneMul = select(sampledTone, vec3<f32>(1.0, 1.0, 1.0), u.isNeutralToning > 0.5);

  // 5. Kağıt tabanı tonu ve 300 DPI prosedürel kağıt dokusu çarpanı
  let xMm = uv.x * u.fullSizeMm.x;
  let yMm = uv.y * u.fullSizeMm.y;
  let texMul = eval_paper_texture_multiplier(
    xMm,
    yMm,
    u.texAmplitude,
    u.texLowWaveMm,
    u.texHighWaveMm,
    u.texLowWeight
  );

  let paperBase = vec3<f32>(u.paperBaseR, u.paperBaseG, u.paperBaseB);
  let linOut = clamp(vec3<f32>(reflectance) * toneMul * paperBase * texMul, vec3<f32>(0.0), vec3<f32>(1.0));

  // 6. En sonda tek noktada ekran dönüşümü
  let srgbOut = vec3<f32>(
    linear_to_srgb_scalar(linOut.r),
    linear_to_srgb_scalar(linOut.g),
    linear_to_srgb_scalar(linOut.b)
  );

  return vec4<f32>(srgbOut, srcCol.a);
}
`;

export class PaperPrintWebGPUEngine {
  private static instance: PaperPrintWebGPUEngine | null = null;
  private static initPromise: Promise<PaperPrintWebGPUEngine | null> | null = null;

  public readonly device: GPUDevice;
  private readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly pipeline: GPURenderPipeline;
  private readonly linearSampler: GPUSampler;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformArray = new Float32Array(20);
  private readonly presentationFormat: GPUTextureFormat;

  private readonly dummyDodgeBurnTexture: GPUTexture;
  private readonly toningTexture: GPUTexture;
  private cachedToningKey = '';

  private sourceImageTexture: GPUTexture | null = null;
  private cachedSourceWidth = 0;
  private cachedSourceHeight = 0;

  private dodgeBurnTexture: GPUTexture | null = null;
  private cachedDbWidth = 0;
  private cachedDbHeight = 0;
  private cachedDbVersion = -1;
  private dodgeBurnHalfScratch: Uint16Array | null = null;

  private cachedBindGroup: GPUBindGroup | null = null;
  private cachedBgImageTex: GPUTexture | null = null;
  private cachedBgDbTex: GPUTexture | null = null;

  private gpuCanvas: OffscreenCanvas | null = null;
  private gpuContext: GPUCanvasContext | null = null;
  private isDeviceLost = false;

  private constructor(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    useSwapchain = true
  ) {
    this.device = device;
    this.presentationFormat = presentationFormat;

    this.device.lost.then(() => {
      this.isDeviceLost = true;
      if (PaperPrintWebGPUEngine.instance === this) {
        PaperPrintWebGPUEngine.instance = null;
      }
    });

    const shaderModule = this.device.createShaderModule({
      label: 'PaperPrint Multigrade & Toning Shader',
      code: PAPER_PRINT_WGSL_SHADER
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'PaperPrint Bind Group Layout',
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
          texture: { sampleType: 'float', viewDimension: '2d' }
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' }
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: 'PaperPrint Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout]
    });

    this.pipeline = this.device.createRenderPipeline({
      label: 'PaperPrint Render Pipeline',
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

    this.linearSampler = this.device.createSampler({
      label: 'PaperPrint Linear Clamp Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    // 20 float = 80 byte (16-byte hizalı)
    this.uniformBuffer = this.device.createBuffer({
      label: 'PaperPrint Uniform Buffer',
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Dodge/Burn aktif değilken bağlanan 1x1 sıfır değerli r16float doku
    this.dummyDodgeBurnTexture = this.device.createTexture({
      label: 'PaperPrint Dummy DodgeBurn 1x1 r16float',
      size: [1, 1, 1],
      format: 'r16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const zeroHalf = new Uint16Array([0]);
    this.device.queue.writeTexture(
      { texture: this.dummyDodgeBurnTexture },
      zeroHalf.buffer,
      { offset: 0, bytesPerRow: 2, rowsPerImage: 1 },
      [1, 1, 1]
    );

    // 256x1 1D Kimyasal Toning LUT dokusu (rgba16float donanım doğrusal filtreli)
    this.toningTexture = this.device.createTexture({
      label: 'PaperPrint 1D Toning LUT 256x1 rgba16float',
      size: [256, 1, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    if (useSwapchain) {
      this.gpuCanvas = new OffscreenCanvas(256, 256);
      const ctx = this.gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) {
        throw new Error('PaperPrint WebGPU context oluşturulamadı.');
      }
      this.gpuContext = ctx;
      this.gpuContext.configure({
        device: this.device,
        format: this.presentationFormat,
        alphaMode: 'opaque'
      });
    }
  }

  public static isSupported(): boolean {
    return isWebGPUSupported();
  }

  public static async getOrCreate(): Promise<PaperPrintWebGPUEngine | null> {
    if (PaperPrintWebGPUEngine.instance && !PaperPrintWebGPUEngine.instance.isDeviceLost) {
      return PaperPrintWebGPUEngine.instance;
    }
    if (!PaperPrintWebGPUEngine.isSupported()) {
      return null;
    }
    if (PaperPrintWebGPUEngine.initPromise) {
      return PaperPrintWebGPUEngine.initPromise;
    }

    PaperPrintWebGPUEngine.initPromise = (async () => {
      try {
        const device = await getSharedGPUDevice();
        if (!device) return null;

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        const engine = new PaperPrintWebGPUEngine(device, presentationFormat, true);
        PaperPrintWebGPUEngine.instance = engine;
        return engine;
      } catch (err) {
        console.warn('Kağıda Baskı WebGPU motoru başlatılamadı:', err);
        return null;
      } finally {
        PaperPrintWebGPUEngine.initPromise = null;
      }
    })();

    return PaperPrintWebGPUEngine.initPromise;
  }

  /**
   * Swapchain olmayan ortamlarda (ör. headless doğrulama ve arka plan testleri) aynı WGSL shader,
   * uniform ve yarım-float dokuları doğrudan `rgba8unorm` GPUTexture üzerinde çalıştıran örnek üretir.
   */
  public static async createOffscreenReadbackEngine(): Promise<PaperPrintWebGPUEngine | null> {
    if (!PaperPrintWebGPUEngine.isSupported()) {
      return null;
    }
    try {
      const device = await requestOffscreenGPUDevice();
      if (!device) return null;
      return new PaperPrintWebGPUEngine(device, 'rgba8unorm', false);
    } catch {
      return null;
    }
  }

  public static getInstanceSync(): PaperPrintWebGPUEngine | null {
    if (PaperPrintWebGPUEngine.instance?.isDeviceLost) {
      PaperPrintWebGPUEngine.instance = null;
    }
    return PaperPrintWebGPUEngine.instance;
  }

  private ensureToningTexture(
    selenium: number,
    sepia: number,
    paperType: PaperType
  ): { texture: GPUTexture; isNeutral: boolean } {
    const lut = getOrBuildToningLUT1D(selenium, sepia, paperType);
    if (this.cachedToningKey !== lut.key) {
      this.device.queue.writeTexture(
        { texture: this.toningTexture },
        lut.halfData.buffer,
        {
          offset: lut.halfData.byteOffset,
          bytesPerRow: lut.size * 8,
          rowsPerImage: 1
        },
        [lut.size, 1, 1]
      );
      this.cachedToningKey = lut.key;
    }
    return { texture: this.toningTexture, isNeutral: lut.isNeutral };
  }

  private ensureDodgeBurnTexture(
    map: DodgeBurnMap | null | undefined,
    active: boolean
  ): GPUTexture {
    if (!active || !map || map.width <= 0 || map.height <= 0) {
      return this.dummyDodgeBurnTexture;
    }

    if (
      !this.dodgeBurnTexture ||
      this.cachedDbWidth !== map.width ||
      this.cachedDbHeight !== map.height
    ) {
      if (this.dodgeBurnTexture) {
        try {
          this.dodgeBurnTexture.destroy();
        } catch {}
      }
      this.dodgeBurnTexture = this.device.createTexture({
        label: `PaperPrint DodgeBurn ${map.width}x${map.height} r16float`,
        size: [map.width, map.height, 1],
        format: 'r16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      this.cachedDbWidth = map.width;
      this.cachedDbHeight = map.height;
      this.cachedDbVersion = -1;
    }

    if (this.cachedDbVersion !== map.version) {
      this.dodgeBurnHalfScratch = packDodgeBurnMapToR16Float(
        map,
        this.dodgeBurnHalfScratch ?? undefined
      );
      this.device.queue.writeTexture(
        { texture: this.dodgeBurnTexture },
        this.dodgeBurnHalfScratch.buffer,
        {
          offset: this.dodgeBurnHalfScratch.byteOffset,
          bytesPerRow: map.width * 2,
          rowsPerImage: map.height
        },
        [map.width, map.height, 1]
      );
      this.cachedDbVersion = map.version;
    }

    return this.dodgeBurnTexture;
  }

  private ensureSourceImageTexture(w: number, h: number): GPUTexture {
    if (
      !this.sourceImageTexture ||
      this.cachedSourceWidth !== w ||
      this.cachedSourceHeight !== h
    ) {
      if (this.sourceImageTexture) {
        try {
          this.sourceImageTexture.destroy();
        } catch {}
      }
      this.sourceImageTexture = this.device.createTexture({
        label: `PaperPrint Source Image ${w}x${h}`,
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT
      });
      this.cachedSourceWidth = w;
      this.cachedSourceHeight = h;
      this.cachedBindGroup = null;
    }
    return this.sourceImageTexture;
  }

  private prepareUniformsAndBindGroup(
    w: number,
    h: number,
    sourceTex: GPUTexture,
    settings: SliderSettings,
    context?: PaperPrintRenderContext
  ): GPUBindGroup {
    const paperType: PaperType =
      settings.printPaperType && PAPER_PROFILES[settings.printPaperType]
        ? settings.printPaperType
        : 'rc-glossy';
    const profile = PAPER_PROFILES[paperType];

    const exposureStops = Math.max(
      ENLARGER_CONSTANTS.minExposureStops,
      Math.min(
        ENLARGER_CONSTANTS.maxExposureStops,
        settings.printExposure ?? ENLARGER_CONSTANTS.defaultExposureStops
      )
    );
    const grade = Math.max(
      MULTIGRADE_EMULSION_CONSTANTS.minGrade,
      Math.min(
        MULTIGRADE_EMULSION_CONSTANTS.maxGrade,
        settings.printGrade ?? MULTIGRADE_EMULSION_CONSTANTS.defaultGrade
      )
    );
    const hardWeight = computeHardLayerWeight(grade);
    const splitGrade = Boolean(settings.printSplitGrade);
    const splitRatio = Math.max(0.0, Math.min(1.0, settings.printSplitRatio ?? 0.5));
    const paperTone = Math.max(0.0, Math.min(1.0, settings.printPaperTone ?? 0.0));
    const selenium = Math.max(0.0, Math.min(1.0, settings.printSelenium ?? 0.0));
    const sepia = Math.max(0.0, Math.min(1.0, settings.printSepia ?? 0.0));

    const [baseR, baseG, baseB] = computePaperBaseLinearRgb(paperType, paperTone);
    const { texture: toningTex, isNeutral: isNeutralToning } = this.ensureToningTexture(
      selenium,
      sepia,
      paperType
    );

    const dodgeBurnMap = context?.dodgeBurnMap ?? null;
    const useDodgeBurn = hasActiveDodgeBurnData(dodgeBurnMap);
    const dbTexture = this.ensureDodgeBurnTexture(dodgeBurnMap, useDodgeBurn);

    const fullW =
      context?.fullDimensions?.width && context.fullDimensions.width > 0
        ? context.fullDimensions.width
        : w;
    const fullH =
      context?.fullDimensions?.height && context.fullDimensions.height > 0
        ? context.fullDimensions.height
        : h;
    const fullWidthMm = fullW * MM_PER_PIXEL_AT_300DPI;
    const fullHeightMm = fullH * MM_PER_PIXEL_AT_300DPI;

    const u = this.uniformArray;
    u[0] = w;
    u[1] = h;
    u[2] = fullWidthMm;
    u[3] = fullHeightMm;
    u[4] = exposureStops;
    u[5] = hardWeight;
    u[6] = splitGrade ? 1.0 : 0.0;
    u[7] = splitRatio;
    u[8] = profile.dMin;
    u[9] = profile.dMax;
    u[10] = baseR;
    u[11] = baseG;
    u[12] = baseB;
    u[13] = profile.texture.amplitude;
    u[14] = profile.texture.lowFreqWavelengthMm;
    u[15] = profile.texture.highFreqWavelengthMm;
    u[16] = profile.texture.lowFreqWeight;
    u[17] = useDodgeBurn ? 1.0 : 0.0;
    u[18] = isNeutralToning ? 1.0 : 0.0;
    u[19] = 0.0;

    // Tek bir toplu uniform yazımı (slider sürüklemede sıfır ek tampon/doku tahsisi)
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    if (
      !this.cachedBindGroup ||
      this.cachedBgImageTex !== sourceTex ||
      this.cachedBgDbTex !== dbTexture
    ) {
      this.cachedBindGroup = this.device.createBindGroup({
        label: 'PaperPrint Bind Group',
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: sourceTex.createView() },
          { binding: 2, resource: dbTexture.createView() },
          { binding: 3, resource: toningTex.createView() },
          { binding: 4, resource: this.linearSampler }
        ]
      });
      this.cachedBgImageTex = sourceTex;
      this.cachedBgDbTex = dbTexture;
    }

    return this.cachedBindGroup;
  }

  public renderToTarget(
    target: RenderTarget,
    settings: SliderSettings,
    context?: PaperPrintRenderContext
  ): boolean {
    if (!settings.printEnabled) return true;

    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost || !this.gpuCanvas || !this.gpuContext) {
      return false;
    }

    const maxTexDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxTexDim || h > maxTexDim) {
      return false;
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

      const sourceTex = this.ensureSourceImageTexture(w, h);
      this.device.queue.copyExternalImageToTexture(
        { source: target.canvas as GPUCopyExternalImageSource },
        { texture: sourceTex },
        [w, h]
      );

      const bindGroup = this.prepareUniformsAndBindGroup(w, h, sourceTex, settings, context);

      const commandEncoder = this.device.createCommandEncoder({
        label: 'PaperPrint Command Encoder'
      });

      const passEncoder = commandEncoder.beginRenderPass({
        label: 'PaperPrint Render Pass',
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

      if (this.isDeviceLost) {
        return false;
      }

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      // 24MP gibi yüksek çözünürlüklü export geçişlerinden sonra geçici VRAM tamponlarını anında boşalt
      if (w * h > 4_194_304) {
        this.releaseScratchResources();
      }

      return true;
    } catch (err) {
      console.warn('Kağıda Baskı WebGPU render hatası, CPU yedeği devreye giriyor:', err);
      return false;
    }
  }

  /**
   * Swapchain olmayan ortamlarda aynı WGSL hattını GPUTexture + GPUBuffer üzerinden çalıştırıp
   * pikselleri 2D tuvale yazar.
   */
  public async renderToTargetReadback(
    target: RenderTarget,
    settings: SliderSettings,
    context?: PaperPrintRenderContext
  ): Promise<boolean> {
    if (!settings.printEnabled) return true;

    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost) return false;

    const maxTexDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxTexDim || h > maxTexDim) {
      return false;
    }

    let outTexture: GPUTexture | null = null;
    let readBuffer: GPUBuffer | null = null;

    try {
      const srcImg = ctx.getImageData(0, 0, w, h);
      const sourceTex = this.ensureSourceImageTexture(w, h);
      this.device.queue.writeTexture(
        { texture: sourceTex },
        srcImg.data.buffer,
        {
          offset: srcImg.data.byteOffset,
          bytesPerRow: w * 4,
          rowsPerImage: h
        },
        [w, h, 1]
      );

      const bindGroup = this.prepareUniformsAndBindGroup(w, h, sourceTex, settings, context);

      outTexture = this.device.createTexture({
        label: `PaperPrint Readback Out ${w}x${h}`,
        size: [w, h, 1],
        format: this.presentationFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      });

      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      readBuffer = this.device.createBuffer({
        label: 'PaperPrint Readback Buffer',
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

      const commandEncoder = this.device.createCommandEncoder({
        label: 'PaperPrint Readback Encoder'
      });

      const passEncoder = commandEncoder.beginRenderPass({
        label: 'PaperPrint Readback Pass',
        colorAttachments: [
          {
            view: outTexture.createView(),
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

      commandEncoder.copyTextureToBuffer(
        { texture: outTexture },
        { buffer: readBuffer, bytesPerRow, rowsPerImage: h },
        [w, h, 1]
      );

      this.device.queue.submit([commandEncoder.finish()]);
      await readBuffer.mapAsync(GPUMapMode.READ);

      const mapped = new Uint8Array(readBuffer.getMappedRange());
      const outData = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const srcRow = y * bytesPerRow;
        const dstRow = y * w * 4;
        outData.set(mapped.subarray(srcRow, srcRow + w * 4), dstRow);
      }
      readBuffer.unmap();

      ctx.putImageData(new ImageData(outData, w, h), 0, 0);

      if (w * h > 4_194_304) {
        this.releaseScratchResources();
      }
      return true;
    } catch (err) {
      console.warn('Kağıda Baskı WebGPU readback render hatası:', err);
      return false;
    } finally {
      if (outTexture) {
        try {
          outTexture.destroy();
        } catch {}
      }
      if (readBuffer) {
        try {
          readBuffer.destroy();
        } catch {}
      }
    }
  }

  public releaseScratchResources(): void {
    if (this.sourceImageTexture) {
      try {
        this.sourceImageTexture.destroy();
      } catch {}
      this.sourceImageTexture = null;
    }
    this.cachedSourceWidth = 0;
    this.cachedSourceHeight = 0;

    if (this.dodgeBurnTexture) {
      try {
        this.dodgeBurnTexture.destroy();
      } catch {}
      this.dodgeBurnTexture = null;
    }
    this.cachedDbWidth = 0;
    this.cachedDbHeight = 0;
    this.cachedDbVersion = -1;
    this.dodgeBurnHalfScratch = null;

    this.cachedBindGroup = null;
    this.cachedBgImageTex = null;
    this.cachedBgDbTex = null;

    if (this.gpuCanvas && (this.gpuCanvas.width > 1 || this.gpuCanvas.height > 1)) {
      this.gpuCanvas.width = 1;
      this.gpuCanvas.height = 1;
    }
  }
}
