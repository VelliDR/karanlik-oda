import { RenderTarget, SliderSettings } from '../types';
import {
  computeChemistryGridSpec,
  computeNegativePxPerMm,
  EXHAUSTION_GRID_PX_PER_MM,
  EXHAUSTION_MACRO_SIGMA_MM,
  EXHAUSTION_MAX_GRID_DIM,
  EXHAUSTION_MAX_KAPPA,
  KOSTINSKY_EDGE_MAX_ALPHA,
  KOSTINSKY_EDGE_SIGMA_MM,
  KOSTINSKY_GRID_PX_PER_MM,
  KOSTINSKY_MAX_GRID_DIM,
  RETICULATION_CELL_PITCH_MM,
  RETICULATION_MAX_DENSITY_MOD,
  RETICULATION_MAX_DISPLACEMENT_MM,
  RETICULATION_RIDGE_BIAS,
  RETICULATION_RIDGE_WIDTH,
  RETICULATION_SECONDARY_FREQ,
  RETICULATION_SECONDARY_WEIGHT
} from '../chemistry/constants';
import {
  getSharedGPUDevice,
  isWebGPUSupported,
  requestOffscreenGPUDevice
} from './gpuDeviceManager';

/**
 * Faz 3: Karanlık Oda Banyo Kimyası WebGPU Motoru (`FilmChemistryWebGPUEngine`).
 *
 * 1. Adım 3.5 — Kostinsky Kenar Etkisi (Adjacency / Mackie Line) & Eberhard Developer Tükenmesi:
 *    - 36x24mm 35mm negatif üzerinde milimetre cinsinden tanımlı difüzyon yarıçaplarıyla
 *      (`rgba16float` ara ızgaralarda 4x4 kutu alt-örnekleme + yatay/dikey 1B ayrılabilir Gauss +
 *      tam çözünürlüklü sahne-lineer optik yoğunluk birleştirmesi) tek bir CommandEncoder altında çalışır.
 * 2. Adım 6.5 — Reticulation (Termal Şok Jelatin Çatlaması & Gümüş Gren Kümelenmesi):
 *    - Gren geçişinden sonra milimetre-kilitli çift oktavlı 2B Worley hücresel alanıyla hem
 *      mikro-deplasman (gren kümelenmesi) hem de sırt optik yoğunluk modülasyonu uygular.
 *
 * `src/core/chemistry/chemistry-cpu.ts` ile bit/kayan-nokta düzeyinde 1:1 eşlik sağlar
 * (`maxDiff <= 2/255`, `meanDiff < 0.5/255`).
 */

const FILM_CHEMISTRY_WGSL_SHADER = /* wgsl */ `
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

const LUMA_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);
const INV_LN_10: f32 = 0.4342944819032518;
const LN_10: f32 = 2.302585092994046;

fn srgb_to_linear_vec3(c: vec3<f32>) -> vec3<f32> {
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

fn soft_shoulder_channel(c: f32) -> f32 {
  let v = max(0.0, c);
  if (v <= 0.92) {
    return v;
  }
  return 0.92 + 0.08 * (1.0 - exp(-(v - 0.92) / 0.08));
}

// ---------------- PASS 1: 4x4 Kutu Alt-Örnekleme (Optik Yoğunluk D) ----------------
struct DownsampleUniforms {
  srcSize: vec2<f32>,
  dstSize: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uDown: DownsampleUniforms;
@group(0) @binding(1) var downSrcTex: texture_2d<f32>;

@fragment
fn fs_downsample_density(in: VertexOutput) -> @location(0) vec4<f32> {
  let gx = clamp(i32(in.position.x), 0, max(0, i32(uDown.dstSize.x) - 1));
  let gy = clamp(i32(in.position.y), 0, max(0, i32(uDown.dstSize.y) - 1));
  let maxSrcX = max(0, i32(uDown.srcSize.x) - 1);
  let maxSrcY = max(0, i32(uDown.srcSize.y) - 1);

  var sumD: f32 = 0.0;
  for (var sy: i32 = 0; sy < 4; sy = sy + 1) {
    let vSub = (f32(gy) + (f32(sy) + 0.5) * 0.25) / uDown.dstSize.y;
    let iy = clamp(i32(floor(vSub * uDown.srcSize.y)), 0, maxSrcY);
    for (var sx: i32 = 0; sx < 4; sx = sx + 1) {
      let uSub = (f32(gx) + (f32(sx) + 0.5) * 0.25) / uDown.dstSize.x;
      let ix = clamp(i32(floor(uSub * uDown.srcSize.x)), 0, maxSrcX);
      let srgb = textureLoad(downSrcTex, vec2<i32>(ix, iy), 0).rgb;
      let lin = srgb_to_linear_vec3(srgb);
      let yLin = max(1e-4, dot(lin, LUMA_WEIGHTS));
      sumD = sumD + (-log(yLin) * INV_LN_10);
    }
  }

  let meanD = sumD * 0.0625;
  return vec4<f32>(meanD, 0.0, 0.0, 1.0);
}

// ---------------- PASS 2 & 3: 1B Ayrılabilir Gauss Bulanıklığı ----------------
struct BlurUniforms {
  gridSize: vec2<f32>,
  dir: vec2<f32>,
  sigma: f32,
  radius: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> uBlur: BlurUniforms;
@group(0) @binding(1) var blurSrcTex: texture_2d<f32>;

@fragment
fn fs_blur_1d(in: VertexOutput) -> @location(0) vec4<f32> {
  let maxX = max(0, i32(uBlur.gridSize.x) - 1);
  let maxY = max(0, i32(uBlur.gridSize.y) - 1);
  let cx = clamp(i32(in.position.x), 0, maxX);
  let cy = clamp(i32(in.position.y), 0, maxY);

  let r = clamp(i32(round(uBlur.radius)), 1, 24);
  let inv2Sigma2 = 0.5 / max(1e-4, uBlur.sigma * uBlur.sigma);
  let stepX = i32(round(uBlur.dir.x));
  let stepY = i32(round(uBlur.dir.y));

  var acc: f32 = 0.0;
  var wSum: f32 = 0.0;
  for (var k: i32 = -24; k <= 24; k = k + 1) {
    if (k >= -r && k <= r) {
      let fk = f32(k);
      let w = exp(-(fk * fk) * inv2Sigma2);
      let sx = clamp(cx + k * stepX, 0, maxX);
      let sy = clamp(cy + k * stepY, 0, maxY);
      let dVal = textureLoad(blurSrcTex, vec2<i32>(sx, sy), 0).r;
      acc = acc + dVal * w;
      wSum = wSum + w;
    }
  }

  return vec4<f32>(acc / max(1e-6, wSum), 0.0, 0.0, 1.0);
}

// ---------------- PASS 4: Tam Çözünürlüklü Kostinsky + Tükenme Birleştirme ----------------
struct CompositeUniforms {
  resolution: vec2<f32>,
  edgeGridSize: vec2<f32>,
  exhGridSize: vec2<f32>,
  alphaEdge: f32,
  kappaExh: f32,
  hasEdge: f32,
  hasExh: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> uComp: CompositeUniforms;
@group(0) @binding(1) var compSrcTex: texture_2d<f32>;
@group(0) @binding(2) var compEdgeTex: texture_2d<f32>;
@group(0) @binding(3) var compExhTex: texture_2d<f32>;

fn sample_grid_bilinear(tex: texture_2d<f32>, gridSize: vec2<f32>, uv: vec2<f32>) -> f32 {
  let fx = uv.x * gridSize.x - 0.5;
  let fy = uv.y * gridSize.y - 0.5;
  let x0 = i32(floor(fx));
  let y0 = i32(floor(fy));
  let tx = fx - floor(fx);
  let ty = fy - floor(fy);

  let maxX = max(0, i32(gridSize.x) - 1);
  let maxY = max(0, i32(gridSize.y) - 1);
  let ix0 = clamp(x0, 0, maxX);
  let ix1 = clamp(x0 + 1, 0, maxX);
  let iy0 = clamp(y0, 0, maxY);
  let iy1 = clamp(y0 + 1, 0, maxY);

  let v00 = textureLoad(tex, vec2<i32>(ix0, iy0), 0).r;
  let v10 = textureLoad(tex, vec2<i32>(ix1, iy0), 0).r;
  let v01 = textureLoad(tex, vec2<i32>(ix0, iy1), 0).r;
  let v11 = textureLoad(tex, vec2<i32>(ix1, iy1), 0).r;

  let top = v00 + (v10 - v00) * tx;
  let bot = v01 + (v11 - v01) * tx;
  return top + (bot - top) * ty;
}

@fragment
fn fs_composite_chemistry(in: VertexOutput) -> @location(0) vec4<f32> {
  let maxX = max(0, i32(uComp.resolution.x) - 1);
  let maxY = max(0, i32(uComp.resolution.y) - 1);
  let px = clamp(i32(in.position.x), 0, maxX);
  let py = clamp(i32(in.position.y), 0, maxY);

  let uv = vec2<f32>(
    (f32(px) + 0.5) / uComp.resolution.x,
    (f32(py) + 0.5) / uComp.resolution.y
  );

  let srcCol = textureLoad(compSrcTex, vec2<i32>(px, py), 0);
  let lin = srgb_to_linear_vec3(srcCol.rgb);
  let yLin = max(1e-4, dot(lin, LUMA_WEIGHTS));
  let dOrig = -log(yLin) * INV_LN_10;

  var dNext = dOrig;
  if (uComp.hasEdge > 0.5) {
    let dBlurEdge = sample_grid_bilinear(compEdgeTex, uComp.edgeGridSize, uv);
    dNext = dNext + uComp.alphaEdge * (dOrig - dBlurEdge);
  }
  if (uComp.hasExh > 0.5) {
    let dBlurExh = sample_grid_bilinear(compExhTex, uComp.exhGridSize, uv);
    dNext = dNext / (1.0 + uComp.kappaExh * dBlurExh);
  }

  let dClamped = clamp(dNext, 0.0, 4.0);
  let yOut = exp(-dClamped * LN_10);
  let gain = yOut / yLin;

  let outLin = vec3<f32>(
    soft_shoulder_channel(lin.r * gain),
    soft_shoulder_channel(lin.g * gain),
    soft_shoulder_channel(lin.b * gain)
  );

  let outSrgb = vec3<f32>(
    linear_to_srgb_scalar(outLin.r),
    linear_to_srgb_scalar(outLin.g),
    linear_to_srgb_scalar(outLin.b)
  );
  return vec4<f32>(outSrgb, srcCol.a);
}

// ---------------- PASS 5: Reticulation (2B Worley Hücresel Jelatin Çatlaması) ----------------
struct ReticUniforms {
  resolution: vec2<f32>,
  invPxPerMm: f32,
  invPitch: f32,
  dispScalePx: f32,
  densityAmp: f32,
  secondaryFreq: f32,
  secondaryWeight: f32,
  ridgeWidth: f32,
  ridgeBias: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> uRetic: ReticUniforms;
@group(0) @binding(1) var reticSrcTex: texture_2d<f32>;

struct WorleySample {
  f1: f32,
  f2: f32,
  dir: vec2<f32>,
};

fn hash_cell_2d(ix: i32, iy: i32, seedSalt: u32) -> vec2<f32> {
  let ux = bitcast<u32>(ix);
  let uy = bitcast<u32>(iy);

  var h1 = ux * 374761393u + uy * 668265263u + seedSalt;
  h1 = (h1 ^ (h1 >> 13u)) * 1274126177u;
  h1 = h1 ^ (h1 >> 16u);

  var h2 = ux * 2246822519u + uy * 3266489917u + (seedSalt ^ 0x9e3779b9u);
  h2 = (h2 ^ (h2 >> 13u)) * 1274126177u;
  h2 = h2 ^ (h2 >> 16u);

  let rx = f32(h1 >> 8u) * (1.0 / 16777216.0);
  let ry = f32(h2 >> 8u) * (1.0 / 16777216.0);
  return vec2<f32>(rx, ry);
}

fn eval_worley_octave(c: vec2<f32>, seedSalt: u32) -> WorleySample {
  let baseX = i32(floor(c.x));
  let baseY = i32(floor(c.y));

  var d1Sq: f32 = 1e9;
  var d2Sq: f32 = 1e9;
  var bestD: vec2<f32> = vec2<f32>(0.0, 0.0);

  for (var oy: i32 = -1; oy <= 1; oy = oy + 1) {
    let ny = baseY + oy;
    for (var ox: i32 = -1; ox <= 1; ox = ox + 1) {
      let nx = baseX + ox;
      let jitter = hash_cell_2d(nx, ny, seedSalt);
      let feat = vec2<f32>(f32(nx), f32(ny)) + vec2<f32>(0.12) + jitter * 0.76;
      let d = feat - c;
      let distSq = dot(d, d);
      if (distSq < d1Sq) {
        d2Sq = d1Sq;
        d1Sq = distSq;
        bestD = d;
      } else if (distSq < d2Sq) {
        d2Sq = distSq;
      }
    }
  }

  let f1 = sqrt(d1Sq);
  let f2 = sqrt(d2Sq);
  let invLen = 1.0 / max(1e-4, f1);
  var res: WorleySample;
  res.f1 = f1;
  res.f2 = f2;
  res.dir = bestD * invLen;
  return res;
}

fn sample_rgba_linear_bilinear(tex: texture_2d<f32>, res: vec2<f32>, fx: f32, fy: f32) -> vec3<f32> {
  let maxXf = max(0.0, res.x - 1.0);
  let maxYf = max(0.0, res.y - 1.0);
  let cx = clamp(fx, 0.0, maxXf);
  let cy = clamp(fy, 0.0, maxYf);
  let x0f = floor(cx);
  let y0f = floor(cy);
  let tx = cx - x0f;
  let ty = cy - y0f;

  let maxXi = max(0, i32(res.x) - 1);
  let maxYi = max(0, i32(res.y) - 1);
  let x0 = clamp(i32(x0f), 0, maxXi);
  let y0 = clamp(i32(y0f), 0, maxYi);
  let x1 = min(maxXi, x0 + 1);
  let y1 = min(maxYi, y0 + 1);

  let s00 = textureLoad(tex, vec2<i32>(x0, y0), 0).rgb;
  let s10 = textureLoad(tex, vec2<i32>(x1, y0), 0).rgb;
  let s01 = textureLoad(tex, vec2<i32>(x0, y1), 0).rgb;
  let s11 = textureLoad(tex, vec2<i32>(x1, y1), 0).rgb;

  let top = s00 + (s10 - s00) * tx;
  let bot = s01 + (s11 - s01) * tx;
  let sVal = clamp(top + (bot - top) * ty, vec3<f32>(0.0), vec3<f32>(1.0));
  return srgb_to_linear_vec3(sVal);
}

@fragment
fn fs_reticulation(in: VertexOutput) -> @location(0) vec4<f32> {
  let maxX = max(0, i32(uRetic.resolution.x) - 1);
  let maxY = max(0, i32(uRetic.resolution.y) - 1);
  let px = clamp(i32(in.position.x), 0, maxX);
  let py = clamp(i32(in.position.y), 0, maxY);

  let mmPos = vec2<f32>(f32(px) + 0.5, f32(py) + 0.5) * uRetic.invPxPerMm;
  let cellPos = mmPos * uRetic.invPitch;

  let w1 = eval_worley_octave(cellPos, 0x27d4eb2du);
  let w2 = eval_worley_octave(cellPos * uRetic.secondaryFreq, 0x165667b1u);

  let ridge1 = 1.0 - smoothstep(0.0, uRetic.ridgeWidth, w1.f2 - w1.f1);
  let ridge2 = 1.0 - smoothstep(0.0, uRetic.ridgeWidth, w2.f2 - w2.f1);
  let ridge = (ridge1 + uRetic.secondaryWeight * ridge2) / (1.0 + uRetic.secondaryWeight);

  let dir = w1.dir * (1.0 - ridge1) * 0.78 + w2.dir * (1.0 - ridge2) * 0.22;
  let sampleX = f32(px) + uRetic.dispScalePx * dir.x;
  let sampleY = f32(py) + uRetic.dispScalePx * dir.y;

  let linRgb = sample_rgba_linear_bilinear(reticSrcTex, uRetic.resolution, sampleX, sampleY);
  let origAlpha = textureLoad(reticSrcTex, vec2<i32>(px, py), 0).a;

  let yLin = max(1e-4, dot(linRgb, LUMA_WEIGHTS));
  let toneWeight = max(0.0, 4.0 * yLin * (1.0 - 0.75 * yLin));
  let deltaD = uRetic.densityAmp * (ridge - uRetic.ridgeBias) * toneWeight;
  let gain = exp(-deltaD * LN_10);

  let outLin = vec3<f32>(
    soft_shoulder_channel(linRgb.r * gain),
    soft_shoulder_channel(linRgb.g * gain),
    soft_shoulder_channel(linRgb.b * gain)
  );
  let outSrgb = vec3<f32>(
    linear_to_srgb_scalar(outLin.r),
    linear_to_srgb_scalar(outLin.g),
    linear_to_srgb_scalar(outLin.b)
  );

  return vec4<f32>(outSrgb, origAlpha);
}
`;

const GRID_FORMAT: GPUTextureFormat = 'rgba16float';

export class FilmChemistryWebGPUEngine {
  private static instance: FilmChemistryWebGPUEngine | null = null;
  private static initPromise: Promise<FilmChemistryWebGPUEngine | null> | null = null;

  public readonly device: GPUDevice;
  private readonly presentationFormat: GPUTextureFormat;

  private readonly singleTexLayout: GPUBindGroupLayout;
  private readonly compositeLayout: GPUBindGroupLayout;

  private readonly downsamplePipeline: GPURenderPipeline;
  private readonly blurPipeline: GPURenderPipeline;
  private readonly compositePipeline: GPURenderPipeline;
  private readonly reticulationPipeline: GPURenderPipeline;

  private readonly edgeDownUniformBuf: GPUBuffer;
  private readonly edgeBlurHUniformBuf: GPUBuffer;
  private readonly edgeBlurVUniformBuf: GPUBuffer;
  private readonly exhDownUniformBuf: GPUBuffer;
  private readonly exhBlurHUniformBuf: GPUBuffer;
  private readonly exhBlurVUniformBuf: GPUBuffer;
  private readonly compositeUniformBuf: GPUBuffer;
  private readonly reticUniformBuf: GPUBuffer;

  private readonly dummyGridTexture: GPUTexture;

  private sourceTexture: GPUTexture | null = null;
  private cachedSrcW = 0;
  private cachedSrcH = 0;

  private edgeTexA: GPUTexture | null = null;
  private edgeTexB: GPUTexture | null = null;
  private cachedEdgeW = 0;
  private cachedEdgeH = 0;

  private exhTexA: GPUTexture | null = null;
  private exhTexB: GPUTexture | null = null;
  private cachedExhW = 0;
  private cachedExhH = 0;

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
      if (FilmChemistryWebGPUEngine.instance === this) {
        FilmChemistryWebGPUEngine.instance = null;
      }
    });

    const shaderModule = this.device.createShaderModule({
      label: 'Darkroom Film Chemistry WGSL Shader',
      code: FILM_CHEMISTRY_WGSL_SHADER
    });

    this.singleTexLayout = this.device.createBindGroupLayout({
      label: 'FilmChemistry Single Tex Layout',
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
        }
      ]
    });

    this.compositeLayout = this.device.createBindGroupLayout({
      label: 'FilmChemistry Composite Layout',
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
        }
      ]
    });

    const singlePipeLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.singleTexLayout]
    });
    const compPipeLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.compositeLayout]
    });

    this.downsamplePipeline = this.device.createRenderPipeline({
      label: 'FilmChemistry Downsample Pipeline',
      layout: singlePipeLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_downsample_density',
        targets: [{ format: GRID_FORMAT }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.blurPipeline = this.device.createRenderPipeline({
      label: 'FilmChemistry Separable Gaussian Blur Pipeline',
      layout: singlePipeLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_blur_1d',
        targets: [{ format: GRID_FORMAT }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.compositePipeline = this.device.createRenderPipeline({
      label: 'FilmChemistry Full-Res Composite Pipeline',
      layout: compPipeLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_composite_chemistry',
        targets: [{ format: this.presentationFormat }]
      },
      primitive: { topology: 'triangle-list' }
    });

    this.reticulationPipeline = this.device.createRenderPipeline({
      label: 'FilmChemistry Worley Reticulation Pipeline',
      layout: singlePipeLayout,
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_reticulation',
        targets: [{ format: this.presentationFormat }]
      },
      primitive: { topology: 'triangle-list' }
    });

    const mkBuf = (label: string, size: number) =>
      this.device.createBuffer({
        label,
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });

    this.edgeDownUniformBuf = mkBuf('Edge Downsample Uniforms', 16);
    this.edgeBlurHUniformBuf = mkBuf('Edge Blur H Uniforms', 32);
    this.edgeBlurVUniformBuf = mkBuf('Edge Blur V Uniforms', 32);
    this.exhDownUniformBuf = mkBuf('Exhaustion Downsample Uniforms', 16);
    this.exhBlurHUniformBuf = mkBuf('Exhaustion Blur H Uniforms', 32);
    this.exhBlurVUniformBuf = mkBuf('Exhaustion Blur V Uniforms', 32);
    this.compositeUniformBuf = mkBuf('Chemistry Composite Uniforms', 48);
    this.reticUniformBuf = mkBuf('Reticulation Uniforms', 48);

    this.dummyGridTexture = this.device.createTexture({
      label: 'Dummy 1x1 Chemistry Grid Texture',
      size: [1, 1, 1],
      format: GRID_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT
    });

    if (useSwapchain) {
      this.gpuCanvas = new OffscreenCanvas(256, 256);
      const ctx = this.gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!ctx) {
        throw new Error('FilmChemistry WebGPU tuval bağlamı oluşturulamadı.');
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

  public static async getOrCreate(): Promise<FilmChemistryWebGPUEngine | null> {
    if (FilmChemistryWebGPUEngine.instance && !FilmChemistryWebGPUEngine.instance.isDeviceLost) {
      return FilmChemistryWebGPUEngine.instance;
    }
    if (!FilmChemistryWebGPUEngine.isSupported()) {
      return null;
    }
    if (FilmChemistryWebGPUEngine.initPromise) {
      return FilmChemistryWebGPUEngine.initPromise;
    }

    FilmChemistryWebGPUEngine.initPromise = (async () => {
      try {
        const device = await getSharedGPUDevice();
        if (!device) return null;
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        const engine = new FilmChemistryWebGPUEngine(device, presentationFormat, true);
        FilmChemistryWebGPUEngine.instance = engine;
        return engine;
      } catch (err) {
        console.warn('FilmChemistry WebGPU motoru başlatılamadı:', err);
        return null;
      } finally {
        FilmChemistryWebGPUEngine.initPromise = null;
      }
    })();

    return FilmChemistryWebGPUEngine.initPromise;
  }

  public static getInstanceSync(): FilmChemistryWebGPUEngine | null {
    if (FilmChemistryWebGPUEngine.instance?.isDeviceLost) {
      FilmChemistryWebGPUEngine.instance = null;
    }
    return FilmChemistryWebGPUEngine.instance;
  }

  /**
   * Headless / swapchain'siz ortamlar için doğrudan `rgba8unorm` doku + `copyTextureToBuffer`
   * geri okumalı gerçek WGSL test motoru üretir.
   */
  public static async createOffscreenReadbackEngine(): Promise<FilmChemistryWebGPUEngine | null> {
    const device = await requestOffscreenGPUDevice();
    if (!device) return null;
    try {
      return new FilmChemistryWebGPUEngine(device, 'rgba8unorm', false);
    } catch {
      return null;
    }
  }

  public releaseScratchResources(): void {
    const destroyPair = (a: GPUTexture | null, b: GPUTexture | null) => {
      try { a?.destroy(); } catch {}
      try { b?.destroy(); } catch {}
    };
    if (this.sourceTexture) {
      try { this.sourceTexture.destroy(); } catch {}
      this.sourceTexture = null;
      this.cachedSrcW = 0;
      this.cachedSrcH = 0;
    }
    destroyPair(this.edgeTexA, this.edgeTexB);
    this.edgeTexA = null;
    this.edgeTexB = null;
    this.cachedEdgeW = 0;
    this.cachedEdgeH = 0;

    destroyPair(this.exhTexA, this.exhTexB);
    this.exhTexA = null;
    this.exhTexB = null;
    this.cachedExhW = 0;
    this.cachedExhH = 0;

    if (this.gpuCanvas) {
      this.gpuCanvas.width = 1;
      this.gpuCanvas.height = 1;
    }
  }

  private ensureSourceTexture(w: number, h: number): GPUTexture {
    if (this.sourceTexture && this.cachedSrcW === w && this.cachedSrcH === h) {
      return this.sourceTexture;
    }
    if (this.sourceTexture) {
      try { this.sourceTexture.destroy(); } catch {}
    }
    this.sourceTexture = this.device.createTexture({
      label: 'FilmChemistry Source Image Texture',
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.cachedSrcW = w;
    this.cachedSrcH = h;
    return this.sourceTexture;
  }

  private ensureEdgeTextures(gridW: number, gridH: number): [GPUTexture, GPUTexture] {
    if (this.edgeTexA && this.edgeTexB && this.cachedEdgeW === gridW && this.cachedEdgeH === gridH) {
      return [this.edgeTexA, this.edgeTexB];
    }
    try { this.edgeTexA?.destroy(); } catch {}
    try { this.edgeTexB?.destroy(); } catch {}
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    this.edgeTexA = this.device.createTexture({
      label: 'Chemistry Edge Grid A',
      size: [gridW, gridH, 1],
      format: GRID_FORMAT,
      usage
    });
    this.edgeTexB = this.device.createTexture({
      label: 'Chemistry Edge Grid B',
      size: [gridW, gridH, 1],
      format: GRID_FORMAT,
      usage
    });
    this.cachedEdgeW = gridW;
    this.cachedEdgeH = gridH;
    return [this.edgeTexA, this.edgeTexB];
  }

  private ensureExhTextures(gridW: number, gridH: number): [GPUTexture, GPUTexture] {
    if (this.exhTexA && this.exhTexB && this.cachedExhW === gridW && this.cachedExhH === gridH) {
      return [this.exhTexA, this.exhTexB];
    }
    try { this.exhTexA?.destroy(); } catch {}
    try { this.exhTexB?.destroy(); } catch {}
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
    this.exhTexA = this.device.createTexture({
      label: 'Chemistry Exhaustion Grid A',
      size: [gridW, gridH, 1],
      format: GRID_FORMAT,
      usage
    });
    this.exhTexB = this.device.createTexture({
      label: 'Chemistry Exhaustion Grid B',
      size: [gridW, gridH, 1],
      format: GRID_FORMAT,
      usage
    });
    this.cachedExhW = gridW;
    this.cachedExhH = gridH;
    return [this.exhTexA, this.exhTexB];
  }

  private uploadSourceFromTarget(target: RenderTarget, srcTex: GPUTexture): void {
    const { width: w, height: h, ctx } = target;
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: target.canvas as GPUCopyExternalImageSource },
        { texture: srcTex },
        [w, h]
      );
    } catch {
      const imgData = ctx.getImageData(0, 0, w, h);
      this.device.queue.writeTexture(
        { texture: srcTex },
        imgData.data,
        { bytesPerRow: w * 4, rowsPerImage: h },
        [w, h, 1]
      );
    }
  }

  private encodeChemistryPasses(
    commandEncoder: GPUCommandEncoder,
    outputView: GPUTextureView,
    target: RenderTarget,
    settings: SliderSettings
  ): void {
    const { width: w, height: h } = target;
    const exhaustion = Math.max(0.0, Math.min(1.0, settings.devExhaustion ?? 0));
    const edgeEffect = Math.max(0.0, Math.min(1.0, settings.devEdgeEffect ?? 0));
    const hasEdge = edgeEffect > 1e-5;
    const hasExh = exhaustion > 1e-5;

    const srcTex = this.ensureSourceTexture(w, h);
    this.uploadSourceFromTarget(target, srcTex);

    let edgeFinalTex: GPUTexture = this.dummyGridTexture;
    let edgeW = 1;
    let edgeH = 1;

    if (hasEdge) {
      const spec = computeChemistryGridSpec(
        w,
        h,
        KOSTINSKY_GRID_PX_PER_MM,
        KOSTINSKY_EDGE_SIGMA_MM,
        KOSTINSKY_MAX_GRID_DIM
      );
      edgeW = spec.gridW;
      edgeH = spec.gridH;
      const [texA, texB] = this.ensureEdgeTextures(edgeW, edgeH);

      this.device.queue.writeBuffer(
        this.edgeDownUniformBuf,
        0,
        new Float32Array([w, h, edgeW, edgeH])
      );
      this.device.queue.writeBuffer(
        this.edgeBlurHUniformBuf,
        0,
        new Float32Array([edgeW, edgeH, 1.0, 0.0, spec.sigmaGridPx, spec.radiusGridPx, 0, 0])
      );
      this.device.queue.writeBuffer(
        this.edgeBlurVUniformBuf,
        0,
        new Float32Array([edgeW, edgeH, 0.0, 1.0, spec.sigmaGridPx, spec.radiusGridPx, 0, 0])
      );

      this.recordSingleTexPass(
        commandEncoder,
        this.downsamplePipeline,
        this.edgeDownUniformBuf,
        srcTex,
        texA.createView()
      );
      this.recordSingleTexPass(
        commandEncoder,
        this.blurPipeline,
        this.edgeBlurHUniformBuf,
        texA,
        texB.createView()
      );
      this.recordSingleTexPass(
        commandEncoder,
        this.blurPipeline,
        this.edgeBlurVUniformBuf,
        texB,
        texA.createView()
      );
      edgeFinalTex = texA;
    }

    let exhFinalTex: GPUTexture = this.dummyGridTexture;
    let exhW = 1;
    let exhH = 1;

    if (hasExh) {
      const spec = computeChemistryGridSpec(
        w,
        h,
        EXHAUSTION_GRID_PX_PER_MM,
        EXHAUSTION_MACRO_SIGMA_MM,
        EXHAUSTION_MAX_GRID_DIM
      );
      exhW = spec.gridW;
      exhH = spec.gridH;
      const [texA, texB] = this.ensureExhTextures(exhW, exhH);

      this.device.queue.writeBuffer(
        this.exhDownUniformBuf,
        0,
        new Float32Array([w, h, exhW, exhH])
      );
      this.device.queue.writeBuffer(
        this.exhBlurHUniformBuf,
        0,
        new Float32Array([exhW, exhH, 1.0, 0.0, spec.sigmaGridPx, spec.radiusGridPx, 0, 0])
      );
      this.device.queue.writeBuffer(
        this.exhBlurVUniformBuf,
        0,
        new Float32Array([exhW, exhH, 0.0, 1.0, spec.sigmaGridPx, spec.radiusGridPx, 0, 0])
      );

      this.recordSingleTexPass(
        commandEncoder,
        this.downsamplePipeline,
        this.exhDownUniformBuf,
        srcTex,
        texA.createView()
      );
      this.recordSingleTexPass(
        commandEncoder,
        this.blurPipeline,
        this.exhBlurHUniformBuf,
        texA,
        texB.createView()
      );
      this.recordSingleTexPass(
        commandEncoder,
        this.blurPipeline,
        this.exhBlurVUniformBuf,
        texB,
        texA.createView()
      );
      exhFinalTex = texA;
    }

    const alphaEdge = edgeEffect * KOSTINSKY_EDGE_MAX_ALPHA;
    const kappaExh = exhaustion * EXHAUSTION_MAX_KAPPA;
    this.device.queue.writeBuffer(
      this.compositeUniformBuf,
      0,
      new Float32Array([
        w,
        h,
        edgeW,
        edgeH,
        exhW,
        exhH,
        alphaEdge,
        kappaExh,
        hasEdge ? 1.0 : 0.0,
        hasExh ? 1.0 : 0.0,
        0.0,
        0.0
      ])
    );

    const compBindGroup = this.device.createBindGroup({
      layout: this.compositeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.compositeUniformBuf } },
        { binding: 1, resource: srcTex.createView() },
        { binding: 2, resource: edgeFinalTex.createView() },
        { binding: 3, resource: exhFinalTex.createView() }
      ]
    });

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });
    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, compBindGroup);
    pass.draw(3);
    pass.end();
  }

  private encodeReticulationPass(
    commandEncoder: GPUCommandEncoder,
    outputView: GPUTextureView,
    target: RenderTarget,
    settings: SliderSettings
  ): void {
    const { width: w, height: h } = target;
    const retic = Math.max(0.0, Math.min(1.0, settings.devReticulation ?? 0));
    const srcTex = this.ensureSourceTexture(w, h);
    this.uploadSourceFromTarget(target, srcTex);

    const pxPerMm = computeNegativePxPerMm(w, h);
    const invPxPerMm = 1.0 / pxPerMm;
    const invPitch = 1.0 / RETICULATION_CELL_PITCH_MM;
    const dispScalePx = retic * RETICULATION_MAX_DISPLACEMENT_MM * pxPerMm;
    const densityAmp = retic * RETICULATION_MAX_DENSITY_MOD;

    this.device.queue.writeBuffer(
      this.reticUniformBuf,
      0,
      new Float32Array([
        w,
        h,
        invPxPerMm,
        invPitch,
        dispScalePx,
        densityAmp,
        RETICULATION_SECONDARY_FREQ,
        RETICULATION_SECONDARY_WEIGHT,
        RETICULATION_RIDGE_WIDTH,
        RETICULATION_RIDGE_BIAS,
        0.0,
        0.0
      ])
    );

    this.recordSingleTexPass(
      commandEncoder,
      this.reticulationPipeline,
      this.reticUniformBuf,
      srcTex,
      outputView
    );
  }

  private recordSingleTexPass(
    commandEncoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    uniformBuf: GPUBuffer,
    tex: GPUTexture,
    outputView: GPUTextureView
  ): void {
    const bg = this.device.createBindGroup({
      layout: this.singleTexLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: tex.createView() }
      ]
    });
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.draw(3);
    pass.end();
  }

  /**
   * Adım 3.5: Kostinsky Kenar Etkisi + Developer Tükenmesi (WebGPU Swapchain).
   */
  public renderChemistryToTarget(target: RenderTarget, settings: SliderSettings): boolean {
    const exhaustion = Math.max(0.0, Math.min(1.0, settings.devExhaustion ?? 0));
    const edgeEffect = Math.max(0.0, Math.min(1.0, settings.devEdgeEffect ?? 0));
    if (exhaustion <= 1e-5 && edgeEffect <= 1e-5) return true;

    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost || !this.gpuCanvas || !this.gpuContext) return false;
    const maxDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxDim || h > maxDim) return false;

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

      const commandEncoder = this.device.createCommandEncoder({
        label: 'FilmChemistry Command Encoder'
      });
      this.encodeChemistryPasses(
        commandEncoder,
        this.gpuContext.getCurrentTexture().createView(),
        target,
        settings
      );
      this.device.queue.submit([commandEncoder.finish()]);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      if (w * h > 4_194_304) {
        this.releaseScratchResources();
      }
      return true;
    } catch (err) {
      console.warn('FilmChemistry WebGPU hatası, CPU yedeğe geçiliyor:', err);
      return false;
    }
  }

  /**
   * Adım 6.5: Worley Reticulation (WebGPU Swapchain).
   */
  public renderReticulationToTarget(target: RenderTarget, settings: SliderSettings): boolean {
    const retic = Math.max(0.0, Math.min(1.0, settings.devReticulation ?? 0));
    if (retic <= 1e-5) return true;

    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost || !this.gpuCanvas || !this.gpuContext) return false;
    const maxDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxDim || h > maxDim) return false;

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

      const commandEncoder = this.device.createCommandEncoder({
        label: 'FilmReticulation Command Encoder'
      });
      this.encodeReticulationPass(
        commandEncoder,
        this.gpuContext.getCurrentTexture().createView(),
        target,
        settings
      );
      this.device.queue.submit([commandEncoder.finish()]);

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      if (w * h > 4_194_304) {
        this.releaseScratchResources();
      }
      return true;
    } catch (err) {
      console.warn('FilmReticulation WebGPU hatası, CPU yedeğe geçiliyor:', err);
      return false;
    }
  }

  private async executeReadback(
    target: RenderTarget,
    recordFn: (encoder: GPUCommandEncoder, outView: GPUTextureView) => void
  ): Promise<boolean> {
    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || this.isDeviceLost) return false;
    const maxDim = this.device.limits.maxTextureDimension2D || 8192;
    if (w > maxDim || h > maxDim) return false;

    let outTex: GPUTexture | null = null;
    let readBuf: GPUBuffer | null = null;
    try {
      outTex = this.device.createTexture({
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      });
      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      readBuf = this.device.createBuffer({
        size: bytesPerRow * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

      const encoder = this.device.createCommandEncoder();
      recordFn(encoder, outTex.createView());
      encoder.copyTextureToBuffer(
        { texture: outTex },
        { buffer: readBuf, bytesPerRow, rowsPerImage: h },
        [w, h, 1]
      );
      this.device.queue.submit([encoder.finish()]);

      await readBuf.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuf.getMappedRange());
      const outPixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const srcOff = y * bytesPerRow;
        outPixels.set(mapped.subarray(srcOff, srcOff + w * 4), y * w * 4);
      }
      readBuf.unmap();

      ctx.putImageData(new ImageData(outPixels, w, h), 0, 0);
      return true;
    } catch {
      return false;
    } finally {
      try { outTex?.destroy(); } catch {}
      try { readBuf?.destroy(); } catch {}
      if (w * h > 4_194_304) {
        this.releaseScratchResources();
      }
    }
  }

  public async renderChemistryToTargetReadback(
    target: RenderTarget,
    settings: SliderSettings
  ): Promise<boolean> {
    const exhaustion = Math.max(0.0, Math.min(1.0, settings.devExhaustion ?? 0));
    const edgeEffect = Math.max(0.0, Math.min(1.0, settings.devEdgeEffect ?? 0));
    if (exhaustion <= 1e-5 && edgeEffect <= 1e-5) return true;
    return this.executeReadback(target, (encoder, outView) =>
      this.encodeChemistryPasses(encoder, outView, target, settings)
    );
  }

  public async renderReticulationToTargetReadback(
    target: RenderTarget,
    settings: SliderSettings
  ): Promise<boolean> {
    const retic = Math.max(0.0, Math.min(1.0, settings.devReticulation ?? 0));
    if (retic <= 1e-5) return true;
    return this.executeReadback(target, (encoder, outView) =>
      this.encodeReticulationPass(encoder, outView, target, settings)
    );
  }
}
