/**
 * db.js — SQLite 資料庫初始化與作品 CRUD
 */
const Database = require('better-sqlite3');
const path = require('path');

/** 資料目錄（Zeabur 持久化磁碟掛載點；本地預設 ./data） */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!require('fs').existsSync(DATA_DIR)) require('fs').mkdirSync(DATA_DIR, { recursive: true });

/** 資料庫檔案路徑 */
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'scratchy.db');
const db = new Database(DB_PATH);

/** 初始化資料表（type 區分儲存作品與分享快照） */
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'share',
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`);

/** 補欄位（既有資料庫升級用） */
try { db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'share'"); } catch {}

/** 儲存作品（id 重複時更新） */
const upsertStmt = db.prepare(`
  INSERT INTO projects (id, name, data, type, created_at, updated_at)
  VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated_at=unixepoch()
`);

/**
 * 儲存或更新作品至資料庫
 * @param {string} id - 作品唯一識別碼
 * @param {string} name - 作品名稱
 * @param {string} data - 作品資料（JSON 字串）
 * @param {string} type - 'save'（使用者儲存）或 'share'（分享快照）
 */
function saveProject(id, name, data, type) {
  upsertStmt.run(id, name, data, type || 'share');
}

/** 依 ID 讀取作品；不存在回 null */
const getStmt = db.prepare('SELECT id, name, data, type, created_at, updated_at FROM projects WHERE id = ?');

/**
 * 依 ID 從資料庫讀取作品
 * @param {string} id - 作品唯一識別碼
 * @returns {object|null} 作品資料物件，若不存在則回傳 null
 */
function getProject(id) {
  return getStmt.get(id) || null;
}

/** 列出所有儲存的作品（不含分享快照） */
const listSavedStmt = db.prepare(
  "SELECT id, name, updated_at FROM projects WHERE type = 'save' ORDER BY updated_at DESC"
);
function listSaved() {
  return listSavedStmt.all();
}

/** 刪除儲存的作品 */
const deleteStmt = db.prepare("DELETE FROM projects WHERE id = ? AND type = 'save'");
function deleteProject(id) {
  return deleteStmt.run(id);
}

/** 初始化圖片資料表 */
db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    original_name TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  )
`);

/** 儲存圖片紀錄 */
const insertImageStmt = db.prepare('INSERT INTO images (id, original_name) VALUES (?, ?)');
function saveImage(id, originalName) {
  insertImageStmt.run(id, originalName);
}

/** 查詢圖片是否存在 */
const getImageStmt = db.prepare('SELECT id, original_name, created_at FROM images WHERE id = ?');
function getImage(id) {
  return getImageStmt.get(id) || null;
}

/** 列出所有已上傳圖片 */
const listImagesStmt = db.prepare('SELECT id, original_name, created_at FROM images ORDER BY created_at DESC');
function listImages() {
  return listImagesStmt.all();
}

module.exports = { saveProject, getProject, listSaved, deleteProject, saveImage, getImage, listImages, DATA_DIR };
