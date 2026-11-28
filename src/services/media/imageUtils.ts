export const MAX_ATTACHED_IMAGES = 6;
const MAX_DIMENSION = 1600;
const MAX_INLINE_BYTES = 1_500_000;
const MAX_GIF_BYTES = 4_000_000;
const API_SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export interface AttachedImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('无法读取图片内容'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  return Math.floor(((dataUrl.length - commaIdx - 1) * 3) / 4);
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export async function prepareImageAttachment(file: File): Promise<AttachedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`文件 "${file.name}" 不是受支持的图片格式`);
  }

  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const isApiSupported = API_SUPPORTED_IMAGE_MIMES.has(file.type);

  // Keep reasonably sized animated GIFs and non-DOM environments intact
  if (
    (file.type === 'image/gif' && file.size > 0 && file.size <= MAX_GIF_BYTES) ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    const rawDataUrl = await readBlobAsDataUrl(file);
    return {
      id,
      name: file.name || 'image',
      mimeType: file.type,
      dataUrl: rawDataUrl,
      size: file.size || estimateDataUrlBytes(rawDataUrl),
    };
  }

  const canObjectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  let objectUrl: string | null = null;
  let lazyRawDataUrl: string | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const ensureRawDataUrl = async () => {
    if (lazyRawDataUrl === null) {
      lazyRawDataUrl = await readBlobAsDataUrl(file);
    }
    return lazyRawDataUrl;
  };

  try {
    const imgSrc = canObjectUrl ? (objectUrl = URL.createObjectURL(file)) : await ensureRawDataUrl();
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = imgSrc;
    });

    const natW = img.naturalWidth || img.width || 800;
    const natH = img.naturalHeight || img.height || 600;
    const needsResize = natW > MAX_DIMENSION || natH > MAX_DIMENSION;
    const needsCompress = file.size > MAX_INLINE_BYTES || !isApiSupported || file.type === 'image/gif';
    if (!needsResize && !needsCompress) {
      const rawDataUrl = await ensureRawDataUrl();
      return {
        id,
        name: file.name || 'image',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        size: file.size || estimateDataUrlBytes(rawDataUrl),
      };
    }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(natW, natH, 1));
    const width = Math.max(1, Math.round(natW * scale));
    const height = Math.max(1, Math.round(natH * scale));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (!isApiSupported) {
        throw new Error(`当前浏览器不支持转换图片格式 ${file.type}`);
      }
      const rawDataUrl = await ensureRawDataUrl();
      return {
        id,
        name: file.name || 'image',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        size: file.size || estimateDataUrlBytes(rawDataUrl),
      };
    }

    if (file.type === 'image/png') {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const pngBlob = await canvasToBlobAsync(canvas, 'image/png');
      if (pngBlob) {
        if (pngBlob.size <= MAX_INLINE_BYTES) {
          return {
            id,
            name: file.name || 'image.png',
            mimeType: 'image/png',
            dataUrl: await readBlobAsDataUrl(pngBlob),
            size: pngBlob.size,
          };
        }
      } else {
        const pngUrl = canvas.toDataURL('image/png');
        const pngBytes = estimateDataUrlBytes(pngUrl);
        if (pngBytes <= MAX_INLINE_BYTES) {
          return {
            id,
            name: file.name || 'image.png',
            mimeType: 'image/png',
            dataUrl: pngUrl,
            size: pngBytes,
          };
        }
      }
    }

    // Composite onto solid white background before JPEG encoding so transparent regions stay readable
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const qualities = [0.86, 0.72, 0.58];
    let winningBlob: Blob | null = null;
    for (const q of qualities) {
      const candidate = await canvasToBlobAsync(canvas, 'image/jpeg', q);
      if (!candidate) break;
      winningBlob = candidate;
      if (candidate.size <= MAX_INLINE_BYTES) break;
    }

    if (winningBlob) {
      return {
        id,
        name: (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg',
        mimeType: 'image/jpeg',
        dataUrl: await readBlobAsDataUrl(winningBlob),
        size: winningBlob.size,
      };
    }

    let jpegUrl = canvas.toDataURL('image/jpeg', 0.86);
    for (const q of [0.72, 0.58]) {
      if (estimateDataUrlBytes(jpegUrl) <= MAX_INLINE_BYTES) break;
      jpegUrl = canvas.toDataURL('image/jpeg', q);
    }

    return {
      id,
      name: (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg',
      mimeType: 'image/jpeg',
      dataUrl: jpegUrl,
      size: estimateDataUrlBytes(jpegUrl),
    };
  } catch {
    if (!isApiSupported) {
      throw new Error(
        `图片 "${file.name}" 格式 (${file.type}) 暂不被模型接口支持，请转换为 PNG / JPG / WebP`
      );
    }
    const rawDataUrl = await ensureRawDataUrl();
    return {
      id,
      name: file.name || 'image',
      mimeType: file.type,
      dataUrl: rawDataUrl,
      size: file.size || estimateDataUrlBytes(rawDataUrl),
    };
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
