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

      device.lost.then((info) => {
        console.warn('WebGPU Paylaşımlı Cihaz kaybedildi:', info.message);
        sharedDevice = null;
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

export function getSharedGPUDeviceSync(): GPUDevice | null {
  return sharedDevice;
}
