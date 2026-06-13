/**
 * routes/projects.js — 作品儲存/讀取 API
 */
const { Router } = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');

const router = Router();

/**
 * POST /api/projects — 儲存作品，回傳短 ID
 * 請求 body 需包含 name（字串）與 sprites（陣列）
 */
router.post('/', (req, res) => {
  const { name, sprites } = req.body;
  if (!name || !Array.isArray(sprites)) {
    return res.status(400).json({ error: '需要 name 和 sprites 欄位' });
  }
  const id = nanoid(7);
  const data = JSON.stringify({ name, sprites });
  db.saveProject(id, name, data);
  res.json({ id });
});

/**
 * GET /api/projects/:id — 讀取指定 ID 的作品
 * 找不到時回傳 404
 */
router.get('/:id', (req, res) => {
  const row = db.getProject(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到這個作品' });
  const project = JSON.parse(row.data);
  res.json({ id: row.id, ...project });
});

module.exports = router;
