/**
 * routes/ai.js — AI 自然語言生積木代理
 *
 * 接收前端的中文指令，呼叫 Zeabur AI Hub（OpenAI 相容格式），
 * 回傳中間 DSL 格式供前端轉換為 Blockly 積木。
 */
const { Router } = require('express');
const router = Router();

/** 可用積木的 DSL 對照表（嵌入 system prompt 供 AI 參考） */
const BLOCK_REFERENCE = `
可用積木（DSL type → 參數 → 說明）：
- event_whenflag：當綠旗被點擊時開始
- event_whenkey(key)：當指定按鍵被按下時執行。key 值：" "(空白鍵), "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"
- event_whenclicked：當角色被點擊時執行
- event_whencloned(body[])：當分身被產生時執行
- motion_move(steps)：沿目前方向移動
- motion_turn_right(degrees)：順時針旋轉
- motion_turn_left(degrees)：逆時針旋轉
- motion_goto_xy(x, y)：移到指定座標
- motion_point_dir(direction)：面朝方向（0上 90右 180下 270左）
- motion_change_x(dx)：水平位置改變（正右負左）
- motion_change_y(dy)：垂直位置改變（正上負下）
- motion_bounce：碰到邊緣就反彈
- looks_say(text)：顯示對話泡泡
- looks_say_for(text, seconds)：說指定秒數後消失
- looks_show：顯示角色
- looks_hide：隱藏角色
- looks_set_size(size)：設定大小百分比
- looks_costume(costume)：換成指定 emoji 造型
- sound_play(sound)：播放音效。sound 值：pop, jump, coin, laser, ding, boom
- sound_tts(text)：唸出文字（不等待）
- sound_tts_wait(text)：唸出文字（等待唸完）
- control_wait(seconds)：等待指定秒數
- control_repeat(times, body[])：重複 N 次
- control_forever(body[])：重複無限次直到停止
- control_stop：停止所有角色
- control_clone：產生自己的分身
- control_delete_clone：刪除這個分身
- sensing_touching(sprite)：是否碰到指定角色
- sensing_touching_edge：是否碰到邊緣
- sensing_keydown(key)：指定按鍵是否按住
`.trim();

const SYSTEM_PROMPT = `你是「積木遊戲工坊」的 AI 助手。用戶會用中文描述想讓角色做什麼，你要回傳對應的積木指令 JSON。

${BLOCK_REFERENCE}

回傳格式：純 JSON 陣列（不要 markdown 圍欄），每個元素是一個積木指令物件。
事件積木和控制積木用 body 陣列包含子指令。

範例 1 —「讓貓咪走正方形」：
[{"type":"event_whenflag","body":[{"type":"control_repeat","times":4,"body":[{"type":"motion_move","steps":100},{"type":"motion_turn_right","degrees":90}]}]}]

範例 2 —「按空白鍵時跳起來再落下」：
[{"type":"event_whenkey","key":" ","body":[{"type":"motion_change_y","dy":50},{"type":"control_wait","seconds":0.3},{"type":"motion_change_y","dy":-50}]}]

範例 3 —「不斷移動並碰到邊緣就反彈」：
[{"type":"event_whenflag","body":[{"type":"control_forever","body":[{"type":"motion_move","steps":5},{"type":"motion_bounce"}]}]}]

範例 4 —「移到隨機位置」：
[{"type":"event_whenflag","body":[{"type":"motion_goto_xy","x":{"randomFrom":-200,"randomTo":200},"y":{"randomFrom":-150,"randomTo":150}}]}]

隨機數語法：任何數值參數都可以用 {"randomFrom": 最小值, "randomTo": 最大值} 代替固定數字。
例如移動隨機點數：{"type":"motion_move","steps":{"randomFrom":5,"randomTo":50}}
例如等待隨機秒數：{"type":"control_wait","seconds":{"randomFrom":1,"randomTo":3}}
例如隨機方向：{"type":"motion_point_dir","direction":{"randomFrom":0,"randomTo":360}}

如果用戶的請求需要多個角色（例如「做一個射擊遊戲」），用多角色格式回傳：
{"sprites":[{"name":"角色名","costume":"emoji","x":0,"y":0,"blocks":[...]},...]}

規則：
- 只回傳 JSON，不要任何解釋文字
- 簡單請求回傳純陣列（單角色），複雜遊戲回傳 sprites 物件（多角色）
- body 內的指令按執行順序排列
- 事件積木只能在最外層（不能嵌套在其他積木 body 裡）
- 如果用戶提供了現有程式碼，回傳修改後的完整 DSL（包含所有積木，不只修改的部分），用來完整替換原有程式`;

/** POST /api/ai/blocks */
router.post('/', async (req, res) => {
  const { prompt, currentCode } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: '請輸入指令' });

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || 'https://ai.zeabur.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  if (!apiKey) return res.status(500).json({ error: 'AI 尚未設定（缺少 AI_API_KEY）' });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...(currentCode ? [{ role: 'user', content: `這是目前角色的積木程式碼：\n\`\`\`\n${currentCode}\n\`\`\`\n請根據以下要求修改，回傳完整的替換版 DSL（不是只有修改的部分，而是完整的程式）：\n${prompt}` }]
            : [{ role: 'user', content: prompt }]),
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('AI API 錯誤：', response.status, err);
      return res.status(500).json({ error: 'AI 暫時忙不過來，請稍後再試' });
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'AI 沒有回應' });

    // 去掉 markdown 圍欄
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      res.json({ dsl: parsed });
    } else if (parsed.sprites) {
      res.json({ sprites: parsed.sprites });
    } else {
      res.json({ dsl: [parsed] });
    }
  } catch (err) {
    console.error('AI 處理錯誤：', err);
    res.status(500).json({ error: 'AI 回傳格式無法解析，請換個說法再試' });
  }
});

module.exports = router;
