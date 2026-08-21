## v25.1.6

延續 v25.1.5，本次新增「監視公告」動態排程調整功能：更新終了後自動偵測動畫瘋首頁公告，<br>
在不更動 sn_list.txt 的情況下處理今晚／本週時間異動、暫停、合併集數等狀況；<br>
同時修正資料庫整頓與 sn_list 清理誤用「作品名稱」比對造成的誤刪問題，改用 sn 交集判斷，並把資料庫整頓從自動刪除改為列出候選清單勾選確認；<br>
另外新增手動任務重新命名功能。<br>
共 10 項變更。

<details>
<summary><strong><u>🆕 新功能（4 項）</u></strong></summary>

<details>
<summary><strong>監視公告：自動偵測動畫瘋首頁公告並動態調整排程檢查時間</strong></summary>

- 更新終了後自動偵測動畫瘋首頁 `class="gossip"` 公告，解析今晚／本週時間異動、暫停、暫停＋復播、合併集數／加更兩集等狀況，<br>
在不更動 sn_list.txt 的前提下動態調整這週(或未來某天)的檢查時間；<br>
比對作品一律用 sn 是否有交集判斷，不比對名稱字面(公告、搜尋結果、sn_list.txt 三邊的名稱經常不一致，<br>
例如加了 `[年齡限制版]` 或用 `2nd Season` 代替 `第二季`)

</details>

<details>
<summary><strong>監視公告紀錄檔與逾時複查機制</strong></summary>

- 新增三份紀錄檔：`gossip_log.jsonl`／`gossip_disposition_log.jsonl` 只 append 不刪除、永久留存公告原文與處置紀錄，<br>
`gossip_pending.json` 是實際生效中的暫存工作檔，負責追蹤是否已補齊所有預期集數與逾時複查(合併集數／加更兩集時，<br>
30 分鐘後自動複查是否已補齊剩餘集數，沿用既有 2 小時重試上限)

</details>

<details>
<summary><strong>Dashboard 新增「監視公告」相關設定</strong></summary>

- Dashboard「其他」新增「監視公告」／「公告保存天數」／「機動調整時間」三個設定，可個別關閉監視或只記錄不動態調整排程，公告紀錄依保存天數自動清理

</details>

<details>
<summary><strong>手動任務重新命名</strong></summary>

- 手動新增任務的「影片鏈接」下方新增「更改名稱(可空)」輸入框，原理與 sn_list.txt 的 `<重新命名>` 標籤相同：留空則使用線上解析到的預設番劇名稱，<br>
填寫後不論下載模式（單集／最新一集／最後一集／全部）或「掃描集數」勾選後的指定集數下載都會套用這個名稱；<br>
「本篇」／「中文配音」／「特別篇」的分類規則不受影響，是獨立判斷邏輯

</details>

</details>

<details>
<summary><strong><u>🐛 BUG 修正（3 項）</u></strong></summary>

<details>
<summary><strong>「資料庫整頓」與 sn_list 清理誤用作品名稱字面比對導致誤刪</strong></summary>

- 修正「資料庫整頓」與 sn_list.txt 項目被移除時的自動清理，用「作品名稱」字面比對是否還在追蹤導致的誤刪問題：使用者事後在 sn_list.txt 加上 `<重新命名>` 標籤、或站方調整 `[年齡限制版]` 這類分類標籤，<br>
都會讓新舊名稱字面對不上，明明還在追蹤卻被誤刪(實測案例:《從後面來的神威先生》)；<br>
兩處都改成用 sn 是否有交集判斷，不受名稱字面影響

</details>

<details>
<summary><strong>sn_list 清理未處理「線上查詢失敗」情境</strong></summary>

- `_cleanup_removed_sn_list_entries` 額外處理「線上查詢失敗」情境：查不到就先當作仍在追蹤跳過不清理，避免因單次網路異常誤刪

</details>

<details>
<summary><strong>新增設定欄位忘記調高版本號，升級後讀取設定 KeyError 崩潰</strong></summary>

- 修正新增「監視公告」設定欄位時忘了同步調高 `latest_config_version` 的問題：設定檔版本號已經停在跟目前版本相同（未落後）的使用者升級後永遠不會觸發欄位補完，讀取設定時直接 `KeyError: 'gossip_retention_days'` 崩潰；<br>
已調高版本號讓這類設定檔正確觸發升級補齊欄位

</details>

</details>

<details>
<summary><strong><u>🔧 其他改善（2 項）</u></strong></summary>

<details>
<summary><strong>監視公告設定相依檢查，避免設定檔矛盾狀態</strong></summary>

- 「監視公告」／「機動調整時間」預設皆為關閉，需自行到 Dashboard 開啟；<br>
「機動調整時間」必須先開啟「監視公告」才能開啟，「公告保存天數」也只有「監視公告」開啟時才可編輯，<br>
Dashboard 前端與後端 `read_settings()` 都有這層相依檢查，避免設定檔被手動改壞後出現矛盾狀態

</details>

<details>
<summary><strong>「資料庫整頓」改為列出候選清單勾選確認</strong></summary>

- 「資料庫整頓」不再掃描完就自動刪除，改成列出候選清單讓使用者勾選要清除的項目：頂部有「全選」勾選框，清單本身是可捲動的勾選框(項目多時不會撐爆視窗)，確認後才真正執行刪除；<br>
確認當下會再檢查一次是否已被重新加回 sn_list.txt，避免極端情況下誤刪

</details>

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

<details>
<summary><strong>版本號由 v25.1.5 調整為 v25.1.6</strong></summary>

- 版本號由 v25.1.5 調整為 v25.1.6

</details>

</details>

---

> 完整變更歷史（v24.6 → v25.1.5）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
