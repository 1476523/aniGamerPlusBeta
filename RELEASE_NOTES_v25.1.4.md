## v25.1.4

延續 v25.1.3，本次修繕了早期就存在、但從未真正接上功能的自訂登入網頁，並完善了早期寫好卻始終沒有網頁設定介面的 Discord／Telegram 通知；<br>
另外新增「取得當前新番更新時間」與「資料庫整頓」兩個排程輔助功能，並移除已停止維護的 Plex 自動更新／命名功能。<br>
同時修正重新採集 cookie/ja3/akamai 後可能出現的裝置驗證異常（code=1007），並新增手動任務的暫存紀錄機制與「掃描集數」勾選下載功能。<br>
共 22 項變更。

<details>
<summary><strong><u>🔐 Web 控制面板：新功能（6 項）</u></strong></summary>

- 修繕早期就存在、但從未接上路由的自訂登入頁（`login.html`）：密碼保護過去實際上一直靠瀏覽器原生 HTTP Basic Auth 彈窗，現在改為伺服器端 session 保存的真正自訂登入頁；<br>
重複的 `register.html` 已移除
- 完善早期就寫好、但網頁上一直沒有設定欄位的 Discord／Telegram 通知：新增「通知設定」區塊可直接開關並填寫 Bot Token／Chat ID／Webhook URL，敏感欄位遮罩顯示
- Dashboard 新增 Cookie 編輯欄位，取代過去只能手動編輯 `cookie.txt`；<br>
保存後自動觸發裝置ID過期偵測重新申請
- 新增「讀取其他版本設定檔」：比對舊 `config.json` 與目前設定的差異逐項列出，預設不勾選，需自行勾選才會匯入；<br>
高風險欄位（會影響面板連線/登入）會加上 ⚠ 二次確認
- 新增「取得當前新番更新時間」：查詢 sn_list.txt 各作品最新 3 集上架時間換算成候選星期＋時間，供逐項選擇套用／自訂／跳過
- 新增「資料庫整頓」：重新解析各作品名稱後清除 `aniGamer.db` 中不再追蹤的舊紀錄；<br>
任一項目查詢失敗則整個中止不刪除

</details>

<details>
<summary><strong><u>🛟 手動任務強化：暫存紀錄與掃描集數（2 項）</u></strong></summary>

- 新增手動任務暫存紀錄檔，程式意外中斷後啟動時會自動重新提交上次未完成的任務（批次類任務是整批重新送出）
- 新增「掃描集數」：可對填寫的連結線上查詢完整集數清單，列成勾選框逐集挑選下載（取代原本下拉選單模式），依「本篇」／「中文配音」／「特別篇」分區並自動補零排序

</details>

<details>
<summary><strong><u>🧭 Web 控制面板：體驗與效能優化（5 項）</u></strong></summary>

- 任務監控頁補齊導覽列項目，修正一個死連結與跟其他頁字體比例不一致的問題
- 新增手動任務／排程自動檢查提交後，先以「已提交, 排隊中」暫定狀態立即出現在監控列表，避免使用者因延遲顯示而重複提交
- 修正登出在反向代理／Cloudflare Tunnel 環境下可能「按了沒反應」的問題；<br>
靜態資源加上版本號與 `no-cache`，版本更新後不會沿用過期快取
- 修正大量下載時 Dashboard 網頁可能卡死變白畫面的問題：靜態資源與登入頁請求不再一律讀取解析 `config.json`
- 修正下載期間 Dashboard 反應變慢、切頁白畫面轉圈的問題：`curl_cffi` 請求改丟進 gevent 專屬執行緒池，不再排擠網頁請求的事件迴圈

</details>

<details>
<summary><strong><u>🛡️ 反爬蟲與裝置驗證穩定性（3 項）</u></strong></summary>

- 新增 ja3/akamai 自動相容性檢測：偵測並自動移除會讓 `curl_cffi` 崩潰的 TLS 擴展編號，請求層另有退回內建指紋重試的防護
- 新增裝置ID過期自動偵測：`cookie.txt` 修改時間比 `device_id.txt` 新即視為裝置ID也已過期，自動重新申請一組，修正重新採集指紋後的裝置驗證異常
- 修正裝置ID一旦觸發過一次裝置驗證異常（`code=1007`）就會持續失敗的根因：偵測到異常時立即清除裝置ID並拋出可重試例外，讓既有重試機制自動換一組全新裝置ID；<br>
一併修正了會擋住這個重試路徑的集數列表累加 bug

</details>

<details>
<summary><strong><u>🐛 BUG 修正（4 項）</u></strong></summary>

- 修正 `config_version` 長期未更新導致舊設定檔不會補完新欄位、Dashboard 讀取設定頁直接崩潰的問題
- 修正偵測不到 `Dashboard` 資料夾時，設定物件互相污染導致整支程式 `KeyError` 崩潰的問題
- 修正 `range` 下載模式輸出字串混用簡體字，在特定主控台編碼下會整段崩潰的問題
- 修正中文配音／特別篇集數會被誤歸類到與正篇相同資料夾的問題

</details>

<details>
<summary><strong><u>🗑️ 移除功能（1 項）</u></strong></summary>

- 移除已停止維護的 Plex 自動更新媒體庫、Plex 命名規則功能；<br>
升級時會自動清除 `config.json` 中殘留的 Plex 欄位

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

- 版本號由 v25.1.3 調整為 v25.1.4

</details>

---

> 完整變更歷史（v24.6 → v25.1.3）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
