/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  interface Window {
    heic2any?: (options: {
      blob: Blob;
      toType?: string;
      quality?: number;
      multiple?: boolean;
    }) => Promise<Blob | Blob[]>;
  }
}

export {};
