/**
 * routes/projects.js — 作品儲存/讀取/刪除 API
 *
 * type='save'  → 使用者儲存的作品（可修改、可列表）
 * type='share' → 分享快照（不可變、僅透過 /play/:id 存取）
 */
const { Router } = require('express');
const { nanoid } = require('nanoid');
const db = require('../db');

const router = Router();

/**
 * GET /api/projects — 列出所有儲存的作品（不含分享快照）
 */
router.get('/', (req, res) => {
  const list = db.listSaved();
  res.json(list);
});

/**
 * POST /api/projects — 建立新作品或分享快照
 * body: { name, sprites, type?, saveId? }
 * type='save' 且帶 saveId → 更新既有作品
 * type='save' 不帶 saveId → 建立新儲存
 * type='share'（預設） → 建立不可變的分享快照
 */
router.post('/', (req, res) => {
  const { name, sprites, type, saveId } = req.body;
  if (!name || !Array.isArray(sprites)) {
    return res.status(400).json({ error: '需要 name 和 sprites 欄位' });
  }
  const projType = type === 'save' ? 'save' : 'share';
  const id = (projType === 'save' && saveId) ? saveId : nanoid(7);
  const data = JSON.stringify({ name, sprites });
  db.saveProject(id, name, data, projType);
  res.json({ id });
});

/**
 * GET /api/projects/:id — 讀取指定 ID 的作品（儲存或分享皆可）
 */
router.get('/:id', (req, res) => {
  const row = db.getProject(req.params.id);
  if (!row) return res.status(404).json({ error: '找不到這個作品' });
  const project = JSON.parse(row.data);
  res.json({ id: row.id, ...project });
});

/**
 * DELETE /api/projects/:id — 刪除儲存的作品（僅限 type='save'）
 */
router.delete('/:id', (req, res) => {
  const result = db.deleteProject(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: '找不到這個作品' });
  res.json({ ok: true });
});

module.exports = router;
