import { AnyCanvas, HeliosParams, RenderTarget } from '../types';

/**
 * 🌀 Helios 44M-4 Dönen Bokeh (Swirl & Cat-Eye) WebGPU Motoru.
 * 
 * - Sıfır vertex buffer gerektiren tam ekran üçgen (fullscreen triangle).
 * - En-boy oranı düzeltmeli Vogel Disk spiral örnekleme çekirdeği (28 örnek).
 * - Merkeze dik teğetsel vektör (tanVec = vec2(-radVec.y, radVec.x)) boyunca non-lineer esneme.
 * - Kedi gözü diyafram vinyeti: Kenarlara doğru radyal eksende basıklık (catEyeCompress).
 * - Fotometrik vurgu patlamaları (Specular Highlights): Örnekleme ortalamasında lüminansa üssel ağırlık (1.0 + pow(luma, 4.0) * 14.0).
 * - Odak kalkanı: Derinlik haritası varsa focalDepth ve aperture üzerinden CoC hesabı; yoksa alan eğriliği (field curvature).
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
};

@group(0) @binding(0) var<uniform> uniforms: HeliosUniforms;
@group(0) @binding(1) var imageTexture: texture_2d<f32>;
@group(0) @binding(2) var depthTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let intensity = uniforms.intensity;
  if (intensity <= 0.0) {
    return textureSample(imageTexture, texSampler, in.uv);
  }

  let aspect = uniforms.aspectRatio;
  // Merkeze göre normalize edilmiş koordinat (en-boy oranı düzeltmeli)
  let centeredUV = (in.uv - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, 1.0);
  let dist = length(centeredUV);

  let radVec = select(vec2<f32>(1.0, 0.0), normalize(centeredUV), dist > 0.0001);
  // Merkeze dik teğetsel vektör
  let tanVec = vec2<f32>(-radVec.y, radVec.x);

  // Kedi gözü diyafram vinyeti: Kenarlara doğru radyal basıklık ve teğetsel esneme
  let normDist = clamp(dist * 1.8, 0.0, 1.6);
  let catEyeFactor = smoothstep(0.18, 0.95, normDist);
  let catEyeStrength = uniforms.catEye / 100.0;
  let radialCompress = mix(1.0, 0.32, catEyeFactor * (intensity / 100.0) * catEyeStrength);
  let tangentialStretch = mix(1.0, 1.0 + (intensity / 100.0) * 2.8, catEyeFactor);

  // Odak Kalkanı (CoC: Circle of Confusion)
  var coc: f32 = 0.0;
  if (uniforms.hasDepthMap > 0.5) {
    let z = textureSample(depthTexture, texSampler, in.uv).r;
    let apertureFactor = uniforms.aperture / 100.0;
    let threshold = 0.35 - apertureFactor * 0.31;
    let diff = abs(z - uniforms.focalDepth);
    if (diff > threshold) {
      coc = clamp((diff - threshold) / 0.16, 0.0, 1.0);
    }
  } else {
    // Alan Eğriliği (Field Curvature): Merkez keskin, kenarlara doğru dönen bokeh
    let centerSharpRadius = 0.22;
    coc = smoothstep(centerSharpRadius, 0.85, normDist);
  }

  if (coc <= 0.001) {
    return textureSample(imageTexture, texSampler, in.uv);
  }

  // Maksimum bulanıklık yarıçapı (UV alanında)
  let maxBlur = (intensity / 100.0) * 0.040 * coc;

  // Vogel Disk Spiral Örnekleme (28 örnek)
  // Golden Angle ~ 2.39996323 rad (137.50776°)
  let GOLDEN_ANGLE: f32 = 2.39996323;
  let SAMPLE_COUNT: f32 = 28.0;

  var accumColor = vec3<f32>(0.0);
  var accumWeight: f32 = 0.0;

  for (var i = 0; i < 28; i++) {
    let fi = f32(i);
    let r = sqrt((fi + 0.5) / SAMPLE_COUNT);
    let theta = fi * GOLDEN_ANGLE;
    let diskSample = vec2<f32>(r * cos(theta), r * sin(theta));

    // Teğetsel ve radyal deformasyon dönüşümü
    let sampleOffset = (diskSample.x * radVec * radialCompress + diskSample.y * tanVec * tangentialStretch) * maxBlur;
    let sampleUV = in.uv + vec2<f32>(sampleOffset.x / aspect, sampleOffset.y);
    let clampedUV = clamp(sampleUV, vec2<f32>(0.0), vec2<f32>(1.0));

    let col = textureSample(imageTexture, texSampler, clampedUV);

    // Fotometrik Vurgu Patlamaları (Specular Highlights):
    // Parlak noktalara üssel ağırlık vererek kremamsı ışık pullarını öne çıkar
    let luma = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let weight = 1.0 + pow(clamp(luma, 0.0, 1.0), 4.0) * 14.0;

    accumColor += col.rgb * weight;
    accumWeight += weight;
  }

  let finalRgb = accumColor / accumWeight;
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

    // 8 float = 32 byte
    this.uniformBuffer = this.device.createBuffer({
      label: 'Helios Uniform Buffer',
      size: 32,
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

    this.gpuCanvas = new OffscreenCanvas(256, 256);
    const ctx = this.gpuCanvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!ctx) throw new Error('WebGPU context oluşturulamadı.');
    this.gpuContext = ctx;
    this.gpuContext.configure({
      device: this.device,
      format: this.presentationFormat,
      alphaMode: 'premultiplied'
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
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: 'high-performance'
        });
        if (!adapter) return null;

        const device = await adapter.requestDevice();
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
    depthCanvas?: AnyCanvas | null
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
          alphaMode: 'premultiplied'
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

      // 3. Uniform verisi
      const aspect = w / h;
      const uniformData = new Float32Array([
        w,
        h,
        params.intensity,
        params.focalDepth ?? 0.5,
        params.aperture ?? 50,
        hasDepth,
        aspect,
        params.catEye ?? 100.0
      ]);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

      // 4. Bind Group
      const bindGroup = this.device.createBindGroup({
        label: 'Helios Bind Group',
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: imageTexture.createView() },
          { binding: 2, resource: depthTexture.createView() },
          { binding: 3, resource: this.sampler }
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
      ctx.drawImage(this.gpuCanvas as CanvasImageSource, 0, 0);
      ctx.restore();

      // VRAM Temizliği
      imageTexture.destroy();
      if (tempDepthTexture) {
        tempDepthTexture.destroy();
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
      this.uniformBuffer.destroy();
      this.device.destroy();
    } catch {}
    HeliosWebGPUEngine.instance = null;
  }
}
