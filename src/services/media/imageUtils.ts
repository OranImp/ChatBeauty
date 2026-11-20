export const MAX_ATTACHED_IMAGES = 6;
const MAX_DIMENSION = 1600;
const MAX_INLINE_BYTES = 1_500_000;

export interface AttachedImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
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
    reader.readAsDataURL(file);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  return Math.floor(((dataUrl.length - commaIdx - 1) * 3) / 4);
}

export async function prepareImageAttachment(file: File): Promise<AttachedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`文件 "${file.name}" 不是受支持的图片格式`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Keep animated GIFs and non-browser/DOM environments intact
  if (
    file.type === 'image/gif' ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    return {
      id,
      name: file.name || 'image',
      mimeType: file.type,
      dataUrl: rawDataUrl,
      size: file.size || estimateDataUrlBytes(rawDataUrl),
    };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = rawDataUrl;
    });

    const needsResize = img.width > MAX_DIMENSION || img.height > MAX_DIMENSION;
    const needsCompress = file.size > MAX_INLINE_BYTES;
    if (!needsResize && !needsCompress) {
      return {
        id,
        name: file.name || 'image',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        size: file.size || estimateDataUrlBytes(rawDataUrl),
      };
    }

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height, 1));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        id,
        name: file.name || 'image',
        mimeType: file.type,
        dataUrl: rawDataUrl,
        size: file.size,
      };
    }

    ctx.drawImage(img, 0, 0, width, height);
    const jpegUrl = canvas.toDataURL('image/jpeg', 0.86);
    if (file.type === 'image/png') {
      const pngUrl = canvas.toDataURL('image/png');
      if (pngUrl.length <= jpegUrl.length * 1.25 && estimateDataUrlBytes(pngUrl) <= MAX_INLINE_BYTES) {
        return {
          id,
          name: file.name || 'image.png',
          mimeType: 'image/png',
          dataUrl: pngUrl,
          size: estimateDataUrlBytes(pngUrl),
        };
      }
    }

    return {
      id,
      name: file.name || 'image.jpg',
      mimeType: 'image/jpeg',
      dataUrl: jpegUrl,
      size: estimateDataUrlBytes(jpegUrl),
    };
  } catch {
    return {
      id,
      name: file.name || 'image',
      mimeType: file.type,
      dataUrl: rawDataUrl,
      size: file.size || estimateDataUrlBytes(rawDataUrl),
    };
  }
}
