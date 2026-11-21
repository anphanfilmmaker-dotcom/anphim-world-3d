import * as T from 'three';

/**
 * PROCEDURAL HIGH-FIDELITY PAVER & TILE TEXTURE GENERATOR
 * Tạo texture lát gạch gốm nung (Terracotta Brick Pavers) & đá lát quảng trường (Granite Plaza Tiles)
 * Chuẩn mỹ thuật game & đô thị:
 * - Có mạch vữa chìm (Grout lines)
 * - Từng viên gạch có biến thiên màu sắc tự nhiên (subtle color jitter)
 * - Đi kèm Bump Map để tạo hiệu ứng gồ ghề 3D chân thực dưới ánh sáng mặt trời
 */

// 1. Texture Gạch Lát Đường Đi Bộ (Terracotta Paver Bricks - Running Bond)
export function createWalkwayPaverTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  // Nền mạch vữa (Mortar grout)
  ctx.fillStyle = '#82786b';
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#1a1a1a'; // Rãnh vữa chìm sâu
  bCtx.fillRect(0, 0, size, size);

  const rows = 16;
  const rowH = size / rows;
  const cols = 8;
  const brickW = size / cols;
  const gap = 2.5; // Khe vữa 2.5px

  // Bảng màu gạch đất nung cao cấp (Terracotta warm palette)
  const brickColors = [
    '#cf8438', '#d68e42', '#c67830', '#dc974d', '#c27329', '#e09f56', '#b96c24'
  ];

  for (let r = 0; r < rows; r++) {
    const isOdd = r % 2 === 1;
    const xOffset = isOdd ? brickW / 2 : 0;
    const y = r * rowH;

    for (let c = -1; c <= cols; c++) {
      const x = c * brickW + xOffset;
      const bx = x + gap;
      const by = y + gap;
      const bw = brickW - gap * 2;
      const bh = rowH - gap * 2;

      // Chọn ngẫu nhiên màu gạch
      const colorIndex = Math.abs(Math.sin((r * 31 + c * 17) * 43758.5453)) * brickColors.length | 0;
      ctx.fillStyle = brickColors[colorIndex];

      // Bo góc nhẹ cho viên gạch
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 2.5);
      ctx.fill();

      // Bump map cho viên gạch: nổi lên sáng
      bCtx.fillStyle = '#dcdcdc';
      bCtx.beginPath();
      bCtx.roundRect(bx, by, bw, bh, 2.5);
      bCtx.fill();

      // Vát mép nhẹ (bevel highlight) trên viên gạch
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(bx, by, bw, 2);
      ctx.fillRect(bx, by, 2, bh);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(bx, by + bh - 2, bw, 2);
      ctx.fillRect(bx + bw - 2, by, 2, bh);
    }
  }

  // Thêm chút noise hạt cát bề mặt cho độ nhám tự nhiên
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 14;
    data[i] = Math.min(255, Math.max(0, data[i] + noise));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(1, 1);

  const bumpTexture = new T.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = T.RepeatWrapping;
  bumpTexture.wrapT = T.RepeatWrapping;
  bumpTexture.repeat.set(1, 1);

  return { texture, bumpTexture };
}

// 2. Texture Đá Lát Quảng Trường / Sân Trước HQ (Granite Plaza Tiles)
export function createPlazaTileTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  // Mạch vữa
  ctx.fillStyle = '#6e6357';
  ctx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#202020';
  bCtx.fillRect(0, 0, size, size);

  const gridSize = 8;
  const tileSize = size / gridSize;
  const gap = 3.0;

  const plazaColors = [
    '#c87a32', '#d4883d', '#bf702a', '#dc9349', '#b66822'
  ];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const x = c * tileSize + gap;
      const y = r * tileSize + gap;
      const w = tileSize - gap * 2;
      const h = tileSize - gap * 2;

      const idx = (r * 7 + c * 13) % plazaColors.length;
      ctx.fillStyle = plazaColors[idx];
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3.0);
      ctx.fill();

      bCtx.fillStyle = '#e5e5e5';
      bCtx.beginPath();
      bCtx.roundRect(x, y, w, h, 3.0);
      bCtx.fill();

      // Viền vát đá granite
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(x, y, w, 2.5);
      ctx.fillRect(x, y, 2.5, h);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      ctx.fillRect(x, y + h - 2.5, w, 2.5);
      ctx.fillRect(x + w - 2.5, y, 2.5, h);
    }
  }

  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(1, 1);

  const bumpTexture = new T.CanvasTexture(bumpCanvas);
  bumpTexture.wrapS = T.RepeatWrapping;
  bumpTexture.wrapT = T.RepeatWrapping;
  bumpTexture.repeat.set(1, 1);

  return { texture, bumpTexture };
}
