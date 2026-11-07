import { AnyCanvas, HeliosParams, RenderTarget } from '../types';
import { getSharedGPUDevice, isWebGPUSupported } from './gpuDeviceManager';

/**
 * 🌀 Helios 44M-4 Dönen Bokeh (Swirl & Cat-Eye) WebGPU Motoru.
 * 
 * - Sıfır vertex buffer gerektiren tam ekran üçgen (fullscreen triangle).
 * - En-boy oranı düzeltmeli Vogel Disk spiral örnekleme çekirdeği (28 örnek).
 * - Merkeze dik teğetsel vektör (tanVec = vec2(-radVec.y, radVec.x)) boyunca non-lineer esneme.
 * - Kedi gözü diyafram vinyeti: Kenarlara doğru radyal eksende basıklık (catEyeCompress).
 * - Fotometrik vurgu patlamaları (Specular Highlights): Örnekleme ortalamasında lüminansa üssel ağırlık (1.0 + pow(luma, 4.0) * 14.0).
 * - Odak kalkanı: Derinlik haritası varsa focalDepth ve aperture üzerinden CoC hesabı; yoksa alan eğriliği (field curvature).
 * - NaN / Siyah Ekran Koruması: textureSampleLevel (LOD 0) ile non-uniform akış türev hatası engellenmiş,
 *   merkezde sıfıra bölme (0/0) korumalı güvenli vektör matematiği.
 */

const HELIOS_WGSL_SHADER = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var out: VertexOutput;
  // Fullscreen triangle: 3 köşe noktası ile tüm ekranı vertex buffersız kaplar
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

struct HeliosUniforms {
  resolution: vec2<f32>,
  intensity: f32,
  focalDepth: f32,
  aperture: f32,
  hasDepthMap: f32,
  aspectRatio: f32,
  catEye: f32,
  soapBubble: f32,
  loca: f32,
  apertureBlades: f32,
  bladeCurvature: f32,
  hasSkinMap: f32,
  pad0: f32,
  pad1: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: HeliosUniforms;
@group(0) @binding(1) var imageTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var skinTexture: texture_2d<f32>;

// Jorge Jimenez Interleaved Gradient Noise (IGN)
// Yüksek frekanslı (mavi gürültü profilli) ekran uzayı gürültüsü
fn interleaved_gradient_noise(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Explicit LOD 0.0 kullanımı (textureSampleLevel):
  // Non-uniform akışlarda veya erken çıkışlarda ekran türevlerinin NaN dönmesini ve
  // görselin tamamen siyaha bürünmesini kesin olarak engeller.
  let baseColor = textureSampleLevel(imageTexture, texSampler, in.uv, 0.0).rgb;
  let intensity = uniforms.intensity;
  if (intensity <= 0.0) {
    return vec4<f32>(baseColor, 1.0);
  }

  let aspect = max(uniforms.aspectRatio, 0.001);
  // Merkeze göre normalize edilmiş koordinat (en-boy oranı düzeltmeli)
  let centeredUV = (in.uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);
  let dist = length(centeredUV);

  // Sıfıra bölme (0/0 = NaN) koruması: Merkeze yakın piksellerde normalize(0) NaN üretmez
  let safeDist = max(dist, 0.0001);
  let radVec = select(vec2<f32>(1.0, 0.0), centeredUV / safeDist, dist > 0.0001);
  // Merkeze dik teğetsel vektör
  let tanVec = vec2<f32>(-radVec.y, radVec.x);

  // Kedi gözü diyafram vinyeti: Kenarlara doğru radyal basıklık ve teğetsel esneme
  let normDist = clamp(dist * 1.8, 0.0, 1.6);
  // Merkez optik eksende diyafram %100 daireseldir (swirl olmaz); girdap sadece dış çeperde başlar:
  let catEyeFactor = smoothstep(0.35, 1.05, normDist);
  let catEyeStrength = uniforms.catEye / 100.0;
  let radialCompress = mix(1.0, 0.32, catEyeFactor * (intensity / 100.0) * catEyeStrength);
  let tangentialStretch = mix(1.0, 1.0 + (intensity / 100.0) * 2.8, catEyeFactor);

  // Odak Kalkanı (CoC: Circle of Confusion) ve Odak Yönü
  var coc: f32 = 0.0;
  var focusSign: f32 = 1.0; // +1.0 = Arka plan (yeşil LoCA saçak), -1.0 = Ön plan (mor/macenta LoCA saçak)
  var centerZ: f32 = 0.0;
  var depthThreshold: f32 = 0.0;

  if (uniforms.hasDepthMap > 0.5) {
    let z = textureSampleLevel(depthTexture, texSampler, in.uv, 0.0).r;
    centerZ = z;
    let apertureFactor = uniforms.aperture / 100.0;
    // Portre öznelerinin fiziksel derinlik hacmini (saç, kulak, omuz, giysi) koruyan DoF eşiği:
    let threshold = mix(0.24, 0.12, apertureFactor);
    depthThreshold = threshold;
    let diff = z - uniforms.focalDepth;
    let absDiff = abs(diff);
    if (absDiff > threshold) {
      coc = smoothstep(0.0, 0.22, absDiff - threshold);
    }
    focusSign = sign(diff);
  } else {
    // Alan Eğriliği (Field Curvature):
    // 3D derinlik henüz yoksa, portre kompozisyonundaki özne kadrajın dikey elipsinde yer alır.
    // Dikey portre elipsi ile özne net korunur; girdap sadece kenarlarda ve arka planda oluşur.
    let portraitDist = length(vec2<f32>(centeredUV.x * 1.35, centeredUV.y * 0.90));
    coc = smoothstep(0.42, 1.15, portraitDist);
    focusSign = 1.0;
  }

  // 🛡️ Akıllı Ten ve Özne Kalkanı:
  // İnsan teni/yüzü tespit edildiyse dönme ve bulanıklık kalkan tarafından tamamen sıfırlanır
  if (uniforms.hasSkinMap > 0.5) {
    let skinSample = textureSampleLevel(skinTexture, texSampler, in.uv, 0.0);
    let skinVal = max(skinSample.a, skinSample.r);
    coc = coc * (1.0 - clamp(skinVal * 1.8, 0.0, 1.0));
  }

  if (coc <= 0.001) {
    return vec4<f32>(baseColor, 1.0);
  }

  // Maksimum bulanıklık yarıçapı (UV alanında)
  let maxBlur = (intensity / 100.0) * 0.040 * coc;

  // Vogel Disk Spiral Örnekleme (28 örnek)
  // Golden Angle ~ 2.39996323 rad (137.50776°)
  let PI: f32 = 3.1415926535;
  let GOLDEN_ANGLE: f32 = 2.39996323;
  let SAMPLE_COUNT: f32 = 28.0;

  var accumColor = vec3<f32>(0.0);
  var accumWeight: f32 = 0.0;

  let bubbleFactor = uniforms.soapBubble / 100.0;
  let locaStrength = (uniforms.loca / 100.0) * 0.048 * coc * focusSign;

  // 🐱 Fiziksel Vesica Piscis (İki Çember Arakesiti Kedi Gözü Tüp Kayması)
  let barrelShift = catEyeFactor * (intensity / 100.0) * catEyeStrength * 0.85;

  // ⬡ Prosedürel Diyafram Bıçakları (N-gen parametreleri)
  let hasBlades = uniforms.apertureBlades > 2.0;
  let bladeN = uniforms.apertureBlades;
  let bladeAlpha = (2.0 * PI) / max(bladeN, 3.0);
  let bladeCurvature = clamp(uniforms.bladeCurvature / 100.0, 0.0, 1.0);

  // 🎲 Blue Noise / IGN Açısal Rotasyon Jitter:
  // Her pikselin örnekleme spiralini yüksek frekanslı mavi gürültü açısıyla döndürerek
  // konsantrik basamak/halkalanmayı (banding) analog film dokusuna dönüştürür.
  let pixelPos = in.position.xy;
  let ignAngle = interleaved_gradient_noise(pixelPos) * (2.0 * PI);

  for (var i = 0; i < 28; i++) {
    let fi = f32(i);
    // Yarıçap ditheringi (örnekler arası radyal adımları yumuşatır)
    let radJitter = (interleaved_gradient_noise(pixelPos + vec2<f32>(fi * 3.17, fi * 7.13)) - 0.5) * 0.28;
    let r = sqrt(clamp((fi + 0.5 + radJitter) / SAMPLE_COUNT, 0.02, 1.0));
    let theta = fi * GOLDEN_ANGLE + ignAngle;
    let diskSample = vec2<f32>(r * cos(theta), r * sin(theta));

    // 1. 🐱 Analitik Vesica Piscis Kedi Gözü Sınır Kırpması:
    // Lensin ön ve arka tüp çerçevelerinin eğik ışık demetini çift taraflı kesmesi
    var pupilWeight: f32 = 1.0;
    if (barrelShift > 0.001) {
      let dFront = length(vec2<f32>(diskSample.x - barrelShift * 0.65, diskSample.y));
      let dRear  = length(vec2<f32>(diskSample.x + barrelShift * 0.65, diskSample.y));
      let maxBarrelD = max(dFront, dRear);
      pupilWeight = smoothstep(1.08, 0.85, maxBarrelD);
    }

    // 2. ⬡ Prosedürel Diyafram Bıçakları Poligon Testi:
    var bladeClip: f32 = 1.0;
    if (hasBlades) {
      let phi = atan2(diskSample.y, diskSample.x);
      let thetaC = phi - bladeAlpha * floor(phi / bladeAlpha + 0.5);
      let polyRadius = cos(PI / bladeN) / max(cos(thetaC), 0.0001);
      let bladeMaxR = mix(1.0, polyRadius, bladeCurvature);
      bladeClip = smoothstep(bladeMaxR + 0.06, bladeMaxR - 0.06, r);
    }

    // Teğetsel ve radyal deformasyon dönüşümü (Swirl & Cat-Eye)
    let sampleOffset = (diskSample.x * radVec * radialCompress + diskSample.y * tanVec * tangentialStretch) * maxBlur;

    // 3. 🛡️ Jorge Jimenez / Earl Hammon Ön Plan Sızıntı Kalkanı (Foreground Bleed Shield):
    // Arka plan pikselleri bulanıklaşırken keskin ön plan nesnelerinden örnek topladığında
    // oluşan çirkin renk sızıntısı (bleed/halo) kusurunu tamamen engeller.
    var bleedShield: f32 = 1.0;
    if (uniforms.hasDepthMap > 0.5 && maxBlur > 0.0001) {
      let sampleRawUV = in.uv + vec2<f32>(sampleOffset.x / aspect, sampleOffset.y);
      let sUV = clamp(sampleRawUV, vec2<f32>(0.0), vec2<f32>(1.0));
      let sampleZ = textureSampleLevel(depthTexture, texSampler, sUV, 0.0).r;
      let depthDiff = sampleZ - centerZ;
      if (depthDiff < -0.035) {
        // Örnek noktası merkez pikselin belirgin şekilde önünde (ön plan nesnesi)
        let sampleDistToFocal = abs(sampleZ - uniforms.focalDepth);
        let sampleCoC = clamp((sampleDistToFocal - depthThreshold) / 0.16, 0.0, 1.0);
        bleedShield = smoothstep(0.0, 0.40, sampleCoC);
      }
    }

    var col: vec3<f32>;
    if (uniforms.loca > 0.0) {
      // 🌈 Boyuna Kromatik Sapma (LoCA / Spectral Bokeh Fringing):
      // Dalga boyuna göre z-ekseni dispersiyonu:
      // Arka planda Yeşil dış çepere taşar, Kırmızı/Mavi içte kalır.
      // Ön planda Mor/Macenta dış çepere taşar.
      let offsetR = sampleOffset * (1.0 - locaStrength);
      let offsetG = sampleOffset * (1.0 + locaStrength * 0.70);
      let offsetB = sampleOffset * (1.0 - locaStrength * 0.85);

      let uvR = clamp(in.uv + vec2<f32>(offsetR.x / aspect, offsetR.y), vec2<f32>(0.0), vec2<f32>(1.0));
      let uvG = clamp(in.uv + vec2<f32>(offsetG.x / aspect, offsetG.y), vec2<f32>(0.0), vec2<f32>(1.0));
      let uvB = clamp(in.uv + vec2<f32>(offsetB.x / aspect, offsetB.y), vec2<f32>(0.0), vec2<f32>(1.0));

      let colR = textureSampleLevel(imageTexture, texSampler, uvR, 0.0).r;
      let colG = textureSampleLevel(imageTexture, texSampler, uvG, 0.0).g;
      let colB = textureSampleLevel(imageTexture, texSampler, uvB, 0.0).b;
      col = vec3<f32>(colR, colG, colB);
    } else {
      let sampleUV = in.uv + vec2<f32>(sampleOffset.x / aspect, sampleOffset.y);
      let clampedUV = clamp(sampleUV, vec2<f32>(0.0), vec2<f32>(1.0));
      col = textureSampleLevel(imageTexture, texSampler, clampedUV, 0.0).rgb;
    }

    // 🫧 Sabun Köpüğü Halka Bokeh (Soap Bubble / Annular Rim Profile):
    // Küresel sapma sebebiyle bokeh diskinin dış çeperi (r > 0.65) parıldayan parlak bir halkaya bürünür
    let rimBoost = mix(1.0, mix(0.72, 1.0 + 3.2 * smoothstep(0.65, 0.98, r), smoothstep(0.35, 0.70, r)), bubbleFactor);

    // Fotometrik Vurgu Patlamaları (Specular Highlights):
    // Parlak noktalara üssel ağırlık vererek kremamsı ışık pullarını öne çıkar
    let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));
    let specularWeight = 1.0 + pow(clamp(luma, 0.0, 1.0), 4.0) * 14.0;
    let weight = specularWeight * rimBoost * pupilWeight * bladeClip * bleedShield;

    accumColor += col * weight;
    accumWeight += weight;
  }

  let blurredRgb = select(baseColor, accumColor / max(accumWeight, 0.0001), accumWeight > 0.0001);
  let finalRgb = mix(baseColor, blurredRgb, clamp(coc * 1.2, 0.0, 1.0));
  return vec4<f32>(finalRgb, 1.0);
}
`;

export class HeliosWebGPUEngine {
  private static instance: HeliosWebGPUEngine | null = null;
  private static initPromise: Promise<HeliosWebGPUEngine | null> | null = null;

  public readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private readonly uniformBuffer: GPUBuffer;
  private readonly presentationFormat: GPUTextureFormat;
  private readonly dummyDepthTexture: GPUTexture;
  private readonly dummySkinTexture: GPUTexture;

  private gpuCanvas: OffscreenCanvas;
  private gpuContext: GPUCanvasContext;

  private constructor(device: GPUDevice, presentationFormat: GPUTextureFormat) {
    this.device = device;
    this.presentationFormat = presentationFormat;

    const shaderModule = this.device.createShaderModule({
      label: 'Helios44M Swirl Shader',
      code: HELIOS_WGSL_SHADER
    });

    this.pipeline = this.device.createRenderPipeline({
      label: 'Helios44M Render Pipeline',
      layout: 'auto',
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
      label: 'Helios Texture Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    // 16 float = 64 byte (16-byte hizalı)
    this.uniformBuffer = this.device.createBuffer({
      label: 'Helios Uniform Buffer',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // 1x1 beyaz dummy derinlik dokusu
    this.dummyDepthTexture = this.device.createTexture({
      label: 'Helios Dummy Depth Texture',
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    this.device.queue.writeTexture(
      { texture: this.dummyDepthTexture },
      whitePixel,
      { bytesPerRow: 4, rowsPerImage: 1 },
      [1, 1, 1]
    );

    // 1x1 şeffaf dummy ten/özne maske dokusu
    this.dummySkinTexture = this.device.createTexture({
      label: 'Helios Dummy Skin Texture',
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    const blackZero = new Uint8Array([0, 0, 0, 0]);
    this.device.queue.writeTexture(
      { texture: this.dummySkinTexture },
      blackZero,
      { bytesPerRow: 4, rowsPerImage: 1 },
      [1, 1, 1]
    );

    this.gpuCanvas = new OffscreenCanvas(256, 256);
    const ctx = this.gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) throw new Error('WebGPU context oluşturulamadı.');
    this.gpuContext = ctx;
    this.gpuContext.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'opaque'
    });
  }

  public static isSupported(): boolean {
    return isWebGPUSupported();
  }

  public static async getOrCreate(): Promise<HeliosWebGPUEngine | null> {
    if (HeliosWebGPUEngine.instance) {
      return HeliosWebGPUEngine.instance;
    }
    if (!HeliosWebGPUEngine.isSupported()) {
      return null;
    }
    if (HeliosWebGPUEngine.initPromise) {
      return HeliosWebGPUEngine.initPromise;
    }

    HeliosWebGPUEngine.initPromise = (async () => {
      try {
        const device = await getSharedGPUDevice();
        if (!device) return null;

        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        const engine = new HeliosWebGPUEngine(device, presentationFormat);
        HeliosWebGPUEngine.instance = engine;
        return engine;
      } catch (err) {
        console.warn('Helios WebGPU motoru başlatılamadı:', err);
        return null;
      } finally {
        HeliosWebGPUEngine.initPromise = null;
      }
    })();

    return HeliosWebGPUEngine.initPromise;
  }

  /**
   * Senkronize şekilde mevcut singleton örneğini döner (eğer önceden ilklendirildiyse).
   */
  public static getInstanceSync(): HeliosWebGPUEngine | null {
    return HeliosWebGPUEngine.instance;
  }

  /**
   * Kaynak görseli ve derinlik maskesini WebGPU dokularına alarak
   * tam ekran üçgeni üzerinden dönen bokeh efektini işler ve hedefe çizer.
   */
  public renderToTarget(
    target: RenderTarget,
    params: HeliosParams,
    depthCanvas?: AnyCanvas | null,
    skinCanvas?: AnyCanvas | null
  ): boolean {
    const { width: w, height: h, ctx } = target;
    if (w <= 0 || h <= 0 || params.intensity <= 0) return false;

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

      // 1. Kaynak görsel dokusu
      const imageTexture = this.device.createTexture({
        label: 'Helios Source Texture',
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

      // 2. Derinlik haritası dokusu
      let depthTexture = this.dummyDepthTexture;
      let hasDepth = 0.0;

      let tempDepthTexture: GPUTexture | null = null;
      if (depthCanvas && depthCanvas.width > 0 && depthCanvas.height > 0) {
        try {
          const dw = depthCanvas.width;
          const dh = depthCanvas.height;
          tempDepthTexture = this.device.createTexture({
            label: 'Helios Depth Texture',
            size: [dw, dh, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          });
          this.device.queue.copyExternalImageToTexture(
            { source: depthCanvas as GPUCopyExternalImageSource },
            { texture: tempDepthTexture },
            [dw, dh]
          );

          depthTexture = tempDepthTexture;
          hasDepth = 1.0;
        } catch {
          depthTexture = this.dummyDepthTexture;
          hasDepth = 0.0;
        }
      }

      // 2.1 Ten ve Özne Koruma Kalkanı dokusu
      let skinTexture = this.dummySkinTexture;
      let hasSkin = 0.0;
      let tempSkinTexture: GPUTexture | null = null;

      if (skinCanvas && skinCanvas.width > 0 && skinCanvas.height > 0) {
        try {
          const sw = skinCanvas.width;
          const sh = skinCanvas.height;
          tempSkinTexture = this.device.createTexture({
            label: 'Helios Skin Texture',
            size: [sw, sh, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          });
          this.device.queue.copyExternalImageToTexture(
            { source: skinCanvas as GPUCopyExternalImageSource },
            { texture: tempSkinTexture },
            [sw, sh]
          );

          skinTexture = tempSkinTexture;
          hasSkin = 1.0;
        } catch {
          skinTexture = this.dummySkinTexture;
          hasSkin = 0.0;
        }
      }

      // 3. Uniform verisi (16 float = 64 byte, 16-byte hizalamalı)
      const aspect = w / h;
      const uniformData = new Float32Array(16);
      uniformData[0] = w;
      uniformData[1] = h;
      uniformData[2] = params.intensity;
      uniformData[3] = params.focalDepth ?? 0.5;
      uniformData[4] = params.aperture ?? 50;
      uniformData[5] = hasDepth;
      uniformData[6] = aspect;
      uniformData[7] = params.catEye ?? 100.0;
      uniformData[8] = params.soapBubble ?? 0.0;
      uniformData[9] = params.loca ?? 0.0;
      uniformData[10] = params.apertureBlades ?? 0.0;
      uniformData[11] = params.bladeCurvature ?? 85.0;
      uniformData[12] = hasSkin;
      // [13..15] pad alanları sıfır kalır

      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

      // 4. Bind Group
      const bindGroup = this.device.createBindGroup({
        label: 'Helios Bind Group',
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: imageTexture.createView() },
          { binding: 2, resource: depthTexture.createView() },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: skinTexture.createView() }
        ]
      });

      // 5. Render Pass
      const commandEncoder = this.device.createCommandEncoder({
        label: 'Helios Command Encoder'
      });
      const currentTextureView = this.gpuContext.getCurrentTexture().createView();

      const passEncoder = commandEncoder.beginRenderPass({
        label: 'Helios Render Pass',
        colorAttachments: [
          {
            view: currentTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      });

      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, bindGroup);
      passEncoder.draw(3); // Sıfır vertex buffer ile tam ekran üçgeni çiz
      passEncoder.end();

      this.device.queue.submit([commandEncoder.finish()]);

      // 6. Sonucu 2D tuvale blit et
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      // VRAM Temizliği
      imageTexture.destroy();
      if (tempDepthTexture) {
        tempDepthTexture.destroy();
      }
      if (tempSkinTexture) {
        tempSkinTexture.destroy();
      }

      return true;
    } catch (err) {
      console.warn('WebGPU render hatası, 2D fallback çalıştırılacak:', err);
      return false;
    }
  }

  public destroy(): void {
    try {
      this.dummyDepthTexture.destroy();
      this.dummySkinTexture.destroy();
      this.uniformBuffer.destroy();
    } catch {}
    HeliosWebGPUEngine.instance = null;
  }
}
