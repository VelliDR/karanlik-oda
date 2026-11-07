/**
 * ⚡ WebGPU Paylaşımlı Cihaz (Shared GPUDevice) Yöneticisi.
 *
 * Tek bir donanım bağdaştırıcısı (adapter) ve paylaşımlı cihaz (GPUDevice) üzerinden
 * hem Helios 44M Swirl motorunun hem de 3D LUT Sensitometri motorunun aynı komut kuyruğunda
 * (command queue) yarışmasız, desenskronizasyonsuz ve VRAM aşımı olmaksızın çalışmasını sağlar.
 */

let sharedDevice: GPUDevice | null = null;
let sharedDevicePromise: Promise<GPUDevice | null> | null = null;

export function isWebGPUSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    !!navigator.gpu &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

async function tryInitDevice(
  options?: GPURequestAdapterOptions,
  requireSwapchain = true
): Promise<GPUDevice | null> {
  try {
    const adapter = await navigator.gpu.requestAdapter(options);
    if (!adapter) return null;

    const maxTex2D = adapter.limits.maxTextureDimension2D || 8192;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: maxTex2D
      }
    });

    let lostDuringProbe = false;
    device.lost.then(() => {
      lostDuringProbe = true;
    });

    const probeEncoder = device.createCommandEncoder({ label: 'WebGPU Liveness Probe' });

    if (requireSwapchain) {
      const probeCanvas = new OffscreenCanvas(1, 1);
      const probeCtx = probeCanvas.getContext('webgpu') as GPUCanvasContext | null;
      if (!probeCtx) {
        return null;
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      probeCtx.configure({
        device,
        format,
        alphaMode: 'opaque'
      });
      const pass = probeEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: probeCtx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      });
      pass.end();
      probeCtx.unconfigure();
    }

    device.queue.submit([probeEncoder.finish()]);

    const alive = await Promise.race([
      device.queue
        .onSubmittedWorkDone()
        .then(() => true)
        .catch(() => false),
      device.lost.then(() => false)
    ]);

    if (!alive || lostDuringProbe) {
      return null;
    }

    return device;
  } catch {
    return null;
  }
}

export async function getSharedGPUDevice(): Promise<GPUDevice | null> {
  if (sharedDevice) {
    return sharedDevice;
  }
  if (!isWebGPUSupported()) {
    return null;
  }
  if (sharedDevicePromise) {
    return sharedDevicePromise;
  }

  sharedDevicePromise = (async () => {
    try {
      let device = await tryInitDevice({ powerPreference: 'high-performance' }, true);
      if (!device) {
        device = await tryInitDevice(undefined, true);
      }
      if (!device) {
        device = await tryInitDevice(
          { fallbackAdapter: true } as GPURequestAdapterOptions,
          true
        );
      }
      if (!device) {
        return null;
      }

      device.lost.then((info) => {
        console.warn('WebGPU Paylaşımlı Cihaz kaybedildi:', info.message);
        if (sharedDevice === device) {
          sharedDevice = null;
        }
      });

      sharedDevice = device;
      return device;
    } catch (err) {
      console.warn('WebGPU cihazı başlatılamadı:', err);
      return null;
    } finally {
      sharedDevicePromise = null;
    }
  })();

  return sharedDevicePromise;
}

/**
 * Pencere yüzeyi (swapchain) olmayan headless ortamlarda doğrudan GPUTexture + GPUBuffer
 * geri okuma (readback) ile WGSL shader çalıştırmak için swapchain bağımsız GPUDevice üretir.
 */
export async function requestOffscreenGPUDevice(): Promise<GPUDevice | null> {
  if (!isWebGPUSupported()) {
    return null;
  }
  let device = await tryInitDevice({ powerPreference: 'high-performance' }, false);
  if (!device) {
    device = await tryInitDevice(undefined, false);
  }
  if (!device) {
    device = await tryInitDevice({ fallbackAdapter: true } as GPURequestAdapterOptions, false);
  }
  return device;
}

export function getSharedGPUDeviceSync(): GPUDevice | null {
  return sharedDevice;
}
