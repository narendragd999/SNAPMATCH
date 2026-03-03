/**
 * SNAPMATCH Watermark Utilities
 * Custom watermark generation and application for photos
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatermarkConfig {
  enabled: boolean;
  type: 'logo' | 'text';
  
  // Logo watermark settings
  logoUrl?: string;
  logoOpacity: number; // 0-100
  logoSize: number; // percentage of image width
  logoPosition: WatermarkPosition;
  
  // Text watermark settings
  text?: string;
  textSize: number; // percentage of image width
  textOpacity: number; // 0-100
  textPosition: WatermarkPosition;
  textColor: string;
  textFont: string;
  
  // Advanced settings
  padding: number; // pixels from edge
  rotation: number; // degrees
  tile: boolean; // repeat watermark across image
}

export type WatermarkPosition = 
  | 'top-left' 
  | 'top-center' 
  | 'top-right'
  | 'center-left' 
  | 'center' 
  | 'center-right'
  | 'bottom-left' 
  | 'bottom-center' 
  | 'bottom-right';

// ─── Default Configurations ───────────────────────────────────────────────────

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: false,
  type: 'text',
  logoOpacity: 70,
  logoSize: 15,
  logoPosition: 'bottom-right',
  text: '© Event Photos',
  textSize: 3,
  textOpacity: 60,
  textPosition: 'bottom-center',
  textColor: '#ffffff',
  textFont: 'Arial, sans-serif',
  padding: 20,
  rotation: 0,
  tile: false,
};

// ─── Position Calculator ──────────────────────────────────────────────────────

interface PositionResult {
  x: number;
  y: number;
  anchorX: 'left' | 'center' | 'right';
  anchorY: 'top' | 'center' | 'bottom';
}

export const calculateWatermarkPosition = (
  position: WatermarkPosition,
  imageWidth: number,
  imageHeight: number,
  watermarkWidth: number,
  watermarkHeight: number,
  padding: number
): PositionResult => {
  const positions: Record<WatermarkPosition, PositionResult> = {
    'top-left': {
      x: padding,
      y: padding,
      anchorX: 'left',
      anchorY: 'top',
    },
    'top-center': {
      x: imageWidth / 2,
      y: padding,
      anchorX: 'center',
      anchorY: 'top',
    },
    'top-right': {
      x: imageWidth - padding,
      y: padding,
      anchorX: 'right',
      anchorY: 'top',
    },
    'center-left': {
      x: padding,
      y: imageHeight / 2,
      anchorX: 'left',
      anchorY: 'center',
    },
    'center': {
      x: imageWidth / 2,
      y: imageHeight / 2,
      anchorX: 'center',
      anchorY: 'center',
    },
    'center-right': {
      x: imageWidth - padding,
      y: imageHeight / 2,
      anchorX: 'right',
      anchorY: 'center',
    },
    'bottom-left': {
      x: padding,
      y: imageHeight - padding,
      anchorX: 'left',
      anchorY: 'bottom',
    },
    'bottom-center': {
      x: imageWidth / 2,
      y: imageHeight - padding,
      anchorX: 'center',
      anchorY: 'bottom',
    },
    'bottom-right': {
      x: imageWidth - padding,
      y: imageHeight - padding,
      anchorX: 'right',
      anchorY: 'bottom',
    },
  };

  return positions[position];
};

// ─── Apply Watermark to Canvas ────────────────────────────────────────────────

export const applyWatermarkToCanvas = async (
  canvas: HTMLCanvasElement,
  config: WatermarkConfig
): Promise<HTMLCanvasElement> => {
  if (!config.enabled) return canvas;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const { width, height } = canvas;

  // Apply based on type
  if (config.type === 'logo' && config.logoUrl) {
    await applyLogoWatermark(ctx, canvas, config);
  } else if (config.type === 'text' && config.text) {
    applyTextWatermark(ctx, canvas, config);
  }

  return canvas;
};

// ─── Logo Watermark ───────────────────────────────────────────────────────────

const applyLogoWatermark = async (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  config: WatermarkConfig
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const logo = new Image();
    logo.crossOrigin = 'anonymous';
    
    logo.onload = () => {
      const { width: imgWidth, height: imgHeight } = canvas;
      
      // Calculate logo size based on percentage of image width
      const logoWidth = (config.logoSize / 100) * imgWidth;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      
      // Calculate position
      const pos = calculateWatermarkPosition(
        config.logoPosition,
        imgWidth,
        imgHeight,
        logoWidth,
        logoHeight,
        config.padding
      );
      
      // Calculate actual x, y based on anchor
      let x = pos.x;
      let y = pos.y;
      
      if (pos.anchorX === 'center') x -= logoWidth / 2;
      else if (pos.anchorX === 'right') x -= logoWidth;
      
      if (pos.anchorY === 'center') y -= logoHeight / 2;
      else if (pos.anchorY === 'bottom') y -= logoHeight;
      
      // Apply tiling if enabled
      if (config.tile) {
        applyTiledLogo(ctx, canvas, logo, logoWidth, logoHeight, config);
        resolve();
        return;
      }
      
      // Apply rotation if needed
      ctx.save();
      
      if (config.rotation !== 0) {
        const centerX = x + logoWidth / 2;
        const centerY = y + logoHeight / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((config.rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }
      
      // Set opacity
      ctx.globalAlpha = config.logoOpacity / 100;
      
      // Draw logo
      ctx.drawImage(logo, x, y, logoWidth, logoHeight);
      
      ctx.restore();
      resolve();
    };
    
    logo.onerror = () => reject(new Error('Failed to load logo'));
    logo.src = config.logoUrl!;
  });
};

// ─── Tiled Logo ───────────────────────────────────────────────────────────────

const applyTiledLogo = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  logo: HTMLImageElement,
  logoWidth: number,
  logoHeight: number,
  config: WatermarkConfig
): void => {
  const { width: imgWidth, height: imgHeight } = canvas;
  const spacing = Math.max(logoWidth, logoHeight) * 2;
  
  ctx.save();
  ctx.globalAlpha = config.logoOpacity / 100;
  
  for (let y = -spacing; y < imgHeight + spacing; y += spacing) {
    for (let x = -spacing; x < imgWidth + spacing; x += spacing) {
      ctx.drawImage(logo, x, y, logoWidth, logoHeight);
    }
  }
  
  ctx.restore();
};

// ─── Text Watermark ───────────────────────────────────────────────────────────

const applyTextWatermark = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  config: WatermarkConfig
): void => {
  const { width: imgWidth, height: imgHeight } = canvas;
  
  // Calculate text size based on percentage of image width
  const fontSize = Math.round((config.textSize / 100) * imgWidth);
  
  // Set font
  ctx.font = `bold ${fontSize}px ${config.textFont}`;
  ctx.textBaseline = 'middle';
  
  // Measure text
  const metrics = ctx.measureText(config.text!);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  
  // Calculate position
  const pos = calculateWatermarkPosition(
    config.textPosition,
    imgWidth,
    imgHeight,
    textWidth,
    textHeight,
    config.padding
  );
  
  // Calculate actual x, y based on anchor
  let x = pos.x;
  let y = pos.y;
  
  if (pos.anchorX === 'center') ctx.textAlign = 'center';
  else if (pos.anchorX === 'right') {
    ctx.textAlign = 'right';
    x = pos.x;
  } else {
    ctx.textAlign = 'left';
  }
  
  // Apply tiling if enabled
  if (config.tile) {
    applyTiledText(ctx, canvas, config, fontSize);
    return;
  }
  
  ctx.save();
  
  // Apply rotation if needed
  if (config.rotation !== 0) {
    ctx.translate(x, y);
    ctx.rotate((config.rotation * Math.PI) / 180);
    ctx.translate(-x, -y);
  }
  
  // Set opacity
  ctx.globalAlpha = config.textOpacity / 100;
  
  // Draw text shadow for better visibility
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = fontSize / 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  
  // Draw text
  ctx.fillStyle = config.textColor;
  ctx.fillText(config.text!, x, y);
  
  ctx.restore();
};

// ─── Tiled Text ───────────────────────────────────────────────────────────────

const applyTiledText = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  config: WatermarkConfig,
  fontSize: number
): void => {
  const { width: imgWidth, height: imgHeight } = canvas;
  const spacing = fontSize * 10;
  
  ctx.save();
  ctx.globalAlpha = config.textOpacity / 100;
  ctx.font = `bold ${fontSize}px ${config.textFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = config.textColor;
  
  // Rotate around center
  const centerX = imgWidth / 2;
  const centerY = imgHeight / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate((config.rotation * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);
  
  for (let y = -spacing; y < imgHeight + spacing; y += spacing) {
    for (let x = -spacing; x < imgWidth + spacing; x += spacing) {
      ctx.fillText(config.text!, x, y);
    }
  }
  
  ctx.restore();
};

// ─── Watermark Preview Generator ──────────────────────────────────────────────

export const generateWatermarkPreview = async (
  imageUrl: string,
  config: WatermarkConfig
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = async () => {
      // Create canvas at preview size (max 400px)
      const maxSize = 400;
      let width = img.width;
      let height = img.height;
      
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width *= ratio;
        height *= ratio;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Draw original image
      ctx.drawImage(img, 0, 0, width, height);
      
      // Scale config values for preview
      const scaledConfig: WatermarkConfig = {
        ...config,
        padding: Math.round((config.padding / img.width) * width),
      };
      
      // Apply watermark
      await applyWatermarkToCanvas(canvas, scaledConfig);
      
      // Return data URL
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
};

// ─── Apply Watermark to Image File ────────────────────────────────────────────

export const applyWatermarkToImageFile = async (
  file: File,
  config: WatermarkConfig
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Apply watermark
      await applyWatermarkToCanvas(canvas, config);
      
      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          
          const watermarkedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          });
          
          resolve(watermarkedFile);
        },
        file.type,
        0.95
      );
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

// ─── Apply Watermark to Image URL ──────────────────────────────────────────────

export const applyWatermarkToImageUrl = async (
  imageUrl: string,
  config: WatermarkConfig,
  filename: string = 'watermarked-photo.jpg'
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Apply watermark
      await applyWatermarkToCanvas(canvas, config);
      
      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }
          
          const watermarkedFile = new File([blob], filename, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          
          resolve(watermarkedFile);
        },
        'image/jpeg',
        0.95
      );
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
};

// ─── Local Storage for Watermark Config ────────────────────────────────────────

export const WATERMARK_STORAGE_KEY = 'snapmatch_watermark_config';

export const saveWatermarkConfig = (config: WatermarkConfig): void => {
  try {
    localStorage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(config));
  } catch {
    console.warn('Failed to save watermark config');
  }
};

export const loadWatermarkConfig = (): WatermarkConfig => {
  try {
    const saved = localStorage.getItem(WATERMARK_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_WATERMARK_CONFIG, ...JSON.parse(saved) };
    }
  } catch {
    console.warn('Failed to load watermark config');
  }
  return { ...DEFAULT_WATERMARK_CONFIG };
};

// ─── Position Labels ──────────────────────────────────────────────────────────

export const WATERMARK_POSITIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'center-left', label: 'Center Left' },
  { value: 'center', label: 'Center' },
  { value: 'center-right', label: 'Center Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
];