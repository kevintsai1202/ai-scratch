/**
 * server/index.js — Express 入口
 *
 * 掛載 API 路由 + 靜態檔案服務。
 * /play/:id 回傳前端 index.html，前端 JS 讀取路徑決定播放模式。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const projectsRouter = require('./routes/projects');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

/** API 路由 */
app.use('/api/projects', projectsRouter);

/** 靜態檔案：serve 專案根目錄 */
app.use(express.static(path.join(__dirname, '..')));

/**
 * /play/:id — 回傳 index.html，前端讀 URL path 決定播放模式
 */
app.get('/play/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`積木遊戲工坊 server 啟動：http://localhost:${PORT}`);
});
