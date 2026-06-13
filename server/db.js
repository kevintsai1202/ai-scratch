/**
 * db.js — SQLite 資料庫初始化與作品 CRUD
 */
const Database = require('better-sqlite3');
const path = require('path');

/** 資料庫檔案路徑（可透過環境變數指定） */
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'scratchy.db');
const db = new Database(DB_PATH);

/** 初始化資料表 */
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  )
`);

/** 儲存作品（id 重複時更新） */
const upsertStmt = db.prepare(`
  INSERT INTO projects (id, name, data, created_at, updated_at)
  VALUES (?, ?, ?, unixepoch(), unixepoch())
  ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data, updated_at=unixepoch()
`);

/**
 * 儲存或更新作品至資料庫
 * @param {string} id - 作品唯一識別碼
 * @param {string} name - 作品名稱
 * @param {string} data - 作品資料（JSON 字串）
 */
function saveProject(id, name, data) {
  upsertStmt.run(id, name, data);
}

/** 依 ID 讀取作品；不存在回 null */
const getStmt = db.prepare('SELECT id, name, data, created_at, updated_at FROM projects WHERE id = ?');

/**
 * 依 ID 從資料庫讀取作品
 * @param {string} id - 作品唯一識別碼
 * @returns {object|null} 作品資料物件，若不存在則回傳 null
 */
function getProject(id) {
  return getStmt.get(id) || null;
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

module.exports = { saveProject, getProject, saveImage, getImage, listImages };
