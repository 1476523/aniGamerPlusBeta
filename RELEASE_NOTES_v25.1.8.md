## v25.1.8

延續 v25.1.7，本次將 `config.json`、`sn_list.txt`、`cookie.txt`、`device_id.txt`、`dashboard_secret.key`、手動任務暫存檔全部整併進 `aniGamer.db`，<br>
根除斷電/當機導致設定檔寫到一半損毀成亂碼的問題；<br>
新增「快速取得 Cookie / UA・JA3・Akamai」一鍵擷取工具與啟動緊急修復機制；<br>
並新增 Telegram／Discord 共用的「通知類別」開關系統，同時修正 Telegram 通知一個會誤判成「Token 無效」的崩潰問題。<br>
共 14 項變更。

<details>
<summary><strong><u>🆕 新功能（5 項）</u></strong></summary>

<details>
<summary><strong>設定/排程/密鑰檔案整併進 aniGamer.db</strong></summary>

- `config.json`／`sn_list.txt`／`cookie.txt`／`device_id.txt`／`dashboard_secret.key`／`manual_single_tasks.json`／`manual_batch_tasks.json` 改存進 `aniGamer.db`（各自一張表），<br>
不再是獨立的純文字/JSON 檔案，執行期間所有讀寫都透過 SQLite 交易完成，不會再發生「寫到一半當機/斷電導致檔案整個損毀成亂碼」的情況
- 首次以 v25.1.8 啟動時，若偵測到硬碟上仍有舊版的上述檔案，會自動驗證內容格式沒有問題後匯入資料庫；<br>
驗證失敗（例如檔案本身已經是亂碼）則不會匯入，改建立空白/預設值，避免把已損毀的內容原封不動帶進資料庫。<br>
匯入後原始檔案不會被刪除或改名，會繼續保留在硬碟上，供你自行確認新版本運作沒問題後再手動刪除
- 「Web 控制臺」→「設定」→「其他」區塊，「資料庫整頓」按鈕右側新增「匯出設定與排程檔」按鈕：可將目前資料庫裡的內容匯出重建成 `sn_list.txt` 與 `config.json` 兩個檔案並由瀏覽器下載，<br>
供之後不想繼續使用本客製版（資料庫儲存方式）的使用者取得一般純文字檔格式的設定；<br>
按下後會先跳出提醒，匯出的檔案是由資料庫重建而成，請自行檢查內容後再使用

</details>

<details>
<summary><strong>快速取得 Cookie / UA・JA3・Akamai</strong></summary>

「設定」頁「Cookie／JA3／Akamai」旁新增「快速取得」按鈕，取代原本只能自己開瀏覽器手動複製貼上、或跳轉到 [ja3.zone/check](https://ja3.zone/check) 再抄一次的流程。

| 功能 | 用法 | 好處 |
|---|---|---|
| 快速取得 Cookie | 按下「快速取得」→「Cookie」，程式會另外開一個乾淨（全新暫存設定檔）的獨立 Chrome/Edge 視窗導向動畫瘋首頁，登入後按視窗上的獨立控制面板「取得Cookie」按鈕，Cookie 會自動填入設定頁欄位並自動關閉瀏覽器 | 不用再自己開發者工具找 Cookie 欄位手動複製，登入哪個帳號一目了然，全新暫存設定檔不受你平常瀏覽器的登入狀態/擴充功能干擾 |
| 快速取得 UA／JA3／Akamai | 按下「快速取得」→「UA／JA3／Akamai」，程式開啟獨立瀏覽器視窗導向 [ja3.zone/check](https://ja3.zone/check)，等頁面載入完成後按控制面板按鈕，三個欄位會自動擷取並一次填入 | 不用再自己前往 ja3.zone/check 逐一複製三個欄位，且與取得 Cookie 用的是同一個瀏覽器核心，確保三者指紋一致 |
| 獨立控制面板視窗 | 取得按鈕不是注入在網頁畫面裡，而是額外彈出一個小型獨立視窗 | 避免動畫瘋/ja3.zone 頁面本身的重新渲染或瀏覽器原生對話框把注入的按鈕清掉導致點不到 |
| 打包後 exe 亦可使用 | 無需操作，`aniGamerPlus.exe` 內建隱藏的 `--quick-fetch` 重啟旗標帶起這個功能 | 打包後沒有隨附 `python.exe` 可執行輔助腳本的限制已處理好，不影響封裝版使用 |

> 此功能需要系統已安裝 Chrome 或 Edge 瀏覽器（透過登錄檔自動偵測安裝位置），兩者皆未安裝時會提示改用手動貼上的方式填寫。

</details>

<details>
<summary><strong>啟動緊急修復機制</strong></summary>

- 自 v25.1.8 起設定改存進 `aniGamer.db`，一般使用者沒有工具能直接打開 SQLite 資料庫手動修改。<br>
若啟動時偵測到 Web 控制面板的 port 被佔用（過去這種情況只能提示「請到配置文件更換」但沒有可編輯的配置文件），現在會在程式資料夾自動產生 `emergency_fix.txt`，<br>
用記事本打開即可依照裡面的說明修改 `dashboard_port`，<br>
存檔後重新啟動 `aniGamerPlus.exe` 就會自動驗證並套用進資料庫，套用成功後這個暫存檔案會被自動刪除；<br>
內容格式不合法時會保留檔案並提示錯誤原因，讓你修正後再重啟一次

</details>

<details>
<summary><strong>Telegram／Discord 共用「通知類別」開關</strong></summary>

「設定」→「通知設定」新增「通知類別」子區塊，讓 Telegram 與 Discord 共用同一組「哪些事件要推播」開關，兩個管道各自的啟用開關與 Token/Webhook 設定則維持獨立。

| 分類 | 涵蓋事件 |
|---|---|
| 下載通知 | 手動任務-下載完成／下載失敗、排程任務-下載完成／下載失敗（透過新增的 `manual` 旗標分辨手動任務與排程自動觸發） |
| 公告通知 | 停止更新、延後更新、臨時加更、其他公告（對應「監視公告」功能偵測到的各類事件） |
| 系統通知 | Cookie 失效、裝置驗證異常（code=1007）、新版本可用 |

- 所有開關預設全開，維持舊版「只要開啟 Telegram/Discord 通知就一定收到下載完成通知」的既有行為，升級後不需要重新設定
- 通知內容統一改成顯示番劇名稱＋集數＋副檔名（而非完整的自訂檔名前綴/後綴），標題也統一帶上「客製強化版」與目前版本號，訊息更精簡好讀
- Cookie 失效、裝置驗證異常這類系統通知加上 10 分鐘冷卻，避免併發下載短時間內同時觸發同一個問題時被同樣的通知洗版

</details>

<details>
<summary><strong>新增「發送測試訊息」／「取得Chat ID」按鈕</strong></summary>

- 新增「發送測試訊息」按鈕（Telegram／Discord 設定區塊皆有）與「取得Chat ID」按鈕（Telegram 專用），<br>
可在還沒儲存設定前就先用目前輸入框裡的 Token/Webhook 測試是否正確，不用先存檔、觸發下載完成才知道有沒有設定對；<br>
自動偵測到的 Chat ID 現在會直接記住並自動切換為「手動指定Chat ID」模式，之後每次通知都不需要再重新查詢一次

</details>

</details>

<details>
<summary><strong><u>🐛 BUG 修正（3 項）</u></strong></summary>

<details>
<summary><strong>資料庫升級版本號未即時寫回，升級訊息重複顯示</strong></summary>

- 修正資料庫從 v2.0 升級到 v3.0（或任何版本升級）後，`database_version` 沒有立即寫回資料庫，<br>
導致同一次執行期間每次呼叫 `read_settings()` 都會誤判成「尚待升級」而重複印出「資料庫從 vX.X 升級到 vX.X」訊息；<br>
改為升級完成後立即寫回新版本號

</details>

<details>
<summary><strong>Telegram 自動偵測 Chat ID 在無對話紀錄時誤判成「Token 無效」</strong></summary>

- 修正 Telegram 通知在自動偵測 Chat ID（呼叫 `getUpdates`）尚未取得任何與 Bot 的對話紀錄時，因為沒有檢查回傳陣列是否為空就直接取第一筆，<br>
導致 `IndexError` 並顯示「Invalid access token」這種容易誤導使用者去懷疑 Token 本身有問題的錯誤訊息；<br>
改為明確判斷並提示「請先在 Telegram 傳送任意訊息給這個 Bot」

</details>

<details>
<summary><strong>Telegram 通知中文/換行內容未做 URL 編碼導致發送失敗</strong></summary>

- 修正 Telegram 通知內容直接原封不動接在 URL 查詢字串後面送出、從未做過 URL 編碼，導致訊息內含中文或換行字元時請求本身就是錯的（改為透過 POST + JSON 傳遞訊息內容）

</details>

</details>

<details>
<summary><strong><u>🔧 其他改善（5 項）</u></strong></summary>

<details>
<summary><strong>舊版設定檔匯入訊息合併顯示</strong></summary>

- 首次啟動同時偵測到舊版 `config.json` 與 `sn_list.txt` 兩份待匯入的舊檔時，原本會各自獨立印出一行匯入訊息，現在合併成一行顯示，訊息更精簡

</details>

<details>
<summary><strong>更新檢查改查詢客製版自己的 GitHub repo</strong></summary>

- 「檢查最新版本」改為查詢客製強化版自己的 GitHub repo（`1476523/aniGamerPlusBeta`），<br>
不再比對官方 `miyouzi/aniGamerPlus` 的版本號（兩者版號體系不同，比對沒有意義）

</details>

<details>
<summary><strong>修正版本比較邏輯避免誤判成倒退</strong></summary>

- 同時修正版本比較邏輯，避免未來版號規則調整時被誤判成「倒退」

</details>

<details>
<summary><strong>環境偽裝設定欄位標籤精簡置中，移除舊版取得UA／ja3.zone按鈕</strong></summary>

- 「設定」頁「環境偽裝設定」區塊的 Cookie／UA／JA3／Akamai 欄位標籤精簡並置中排版，移除舊版「取得當前UA」（其實只是回填瀏覽器自己的 UA，<br>
容易讓人誤會跟下方 Cookie/JA3/Akamai 是同一個瀏覽器）與「前往 ja3.zone/check 採集指紋」外部連結按鈕，改由上方「快速取得」按鈕統一處理

</details>

<details>
<summary><strong>IMPORT_CONFIG_LABEL_MAP 補上先前遺漏的中文標籤欄位</strong></summary>

- 讀取其他版本設定檔比對工具（`IMPORT_CONFIG_LABEL_MAP`）補上先前遺漏中文標籤的欄位（鎖定會員帳號下載、劇集名補零、解析最大重試次數／延遲秒數、阻止訪客下載）

</details>

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

<details>
<summary><strong>版本號由 v25.1.7 調整為 v25.1.8</strong></summary>

- 版本號由 v25.1.7 調整為 v25.1.8

</details>

</details>

---

> 完整變更歷史（v24.6 → v25.1.7）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
