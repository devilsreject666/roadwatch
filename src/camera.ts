/**
 * Photo capture: Capacitor Camera on native, file-input fallback on web.
 * Returns a data URL (or null if the user cancelled).
 */
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export async function capturePhoto(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.getPhoto({
        quality: 80,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      });
      return photo.dataUrl ?? null;
    } catch {
      return null; // user cancelled or permission denied
    }
  }
  // Web fallback: hidden file input with camera capture hint.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(url);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result ?? '');
        // Downscale large photos so localStorage stays usable.
        downscale(url, 1024).then(finish).catch(() => finish(url));
      };
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    });
    // If the picker is dismissed without choosing, resolve null shortly after.
    window.addEventListener(
      'focus',
      () => setTimeout(() => finish(null), 800),
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

function downscale(dataUrl: string, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale >= 1) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
