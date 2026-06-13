/**
 * routes/images.js — 圖片上傳、去背、縮圖、儲存
 *
 * POST /api/images  — 上傳圖片 → sharp 去背+縮圖 → 存檔 → 回傳 { id, url }
 * GET  /api/images/:id.png — 讀取已處理的圖片
 * GET  /api/images — 列出所有已上傳圖片
 */
const { Router } = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { nanoid } = require('nanoid');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = Router();

/** 上傳目錄 */
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** multer 設定：暫存到記憶體，限制 5MB */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

/**
 * 簡易去背：將接近白色的像素設為透明
 * @param {Buffer} inputBuffer 原始圖片 buffer
 * @returns {Buffer} 去背後的 PNG buffer
 */
async function removeWhiteBackground(inputBuffer) {
  const image = sharp(inputBuffer).resize(128, 128, { fit: 'inside' }).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  const threshold = 240;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > threshold && data[i + 1] > threshold && data[i + 2] > threshold) {
      data[i + 3] = 0;
    }
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

/** POST /api/images — 上傳並處理圖片 */
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳圖片檔案（jpg/png/webp）' });

  try {
    const id = nanoid(8);
    const processed = await removeWhiteBackground(req.file.buffer);
    const filePath = path.join(UPLOAD_DIR, `${id}.png`);
    fs.writeFileSync(filePath, processed);
    db.saveImage(id, req.file.originalname);
    res.json({ id, url: `/api/images/${id}.png` });
  } catch (err) {
    console.error('圖片處理錯誤：', err);
    res.status(500).json({ error: '圖片處理失敗' });
  }
});

/** GET /api/images/:id.png — 讀取圖片 */
router.get('/:id.png', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, `${req.params.id}.png`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '圖片不存在' });
  res.type('image/png').sendFile(filePath);
});

/** GET /api/images — 列出所有已上傳圖片 */
router.get('/', (req, res) => {
  const images = db.listImages();
  res.json(images.map(img => ({ id: img.id, name: img.original_name, url: `/api/images/${img.id}.png` })));
});

module.exports = router;
