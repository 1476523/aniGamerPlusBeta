## v25.1.1

以官方 [v24.6](https://github.com/miyouzi/aniGamerPlus/releases/tag/v24.6) 為基準的客製修改版本。<br>
共 28 項變更，涵蓋反爬蟲穩定性、多項崩潰修正、檔名清理與 sn_list.txt 功能強化。

<details>
<summary><strong><u>🆕 新功能（9 項）</u></strong></summary>

<details>
<summary><strong>以 curl_cffi 取代 pyhttpx，繞過動畫瘋／Cloudflare 反爬蟲偵測</strong></summary>

- 以 `curl_cffi` 取代已停止維護的 `pyhttpx`，模擬瀏覽器 TLS/JA3 指紋繞過動畫瘋／Cloudflare 反爬蟲偵測

</details>

<details>
<summary><strong>新增 Cookie 刷新頻率限制，避免短時間內重複刷新</strong></summary>

- 新增 cookie 刷新頻率限制（90 秒冷卻，全域＋執行緒安全）

</details>

<details>
<summary><strong>裝置 ID 改為持久化保存，不再每次下載都取得新身分</strong></summary>

- 裝置 ID（`device_id`）改為持久化保存於 `device_id.txt`，不再每次下載/重試都取得新裝置身分

</details>

<details>
<summary><strong>新增全域執行緒例外攔截，未預期錯誤改為中文提示</strong></summary>

- 新增全域執行緒例外攔截，未預期錯誤改為中文提示，不再直接印出原始 Traceback

</details>

<details>
<summary><strong>新增自訂星期／時間排程檢查語法</strong></summary>

- 新增自定義星期／時間排程檢查語法：`*星期* $HH:MM$`（需同時填寫），該項目改為只在指定時段起算 10 分鐘內主動檢查，不再排入一般全數檢查隊伍

</details>

<details>
<summary><strong>新增 sn_list.txt 同行重複標籤偵測與警示</strong></summary>

- 新增同行重複標籤（`<>`、`**`、`$$`）偵測與警示

</details>

<details>
<summary><strong>sn 從清單移除且無人追蹤同作品時，自動清除資料庫集數紀錄</strong></summary>

- sn 從 sn_list.txt 移除且無其他項目仍追蹤同一作品時，自動清除該作品在 `aniGamer.db` 中的所有集數紀錄（僅清資料庫，不刪除已下載檔案）

</details>

<details>
<summary><strong>面板開放外部訪問但未設密碼保護時，啟動顯示警告</strong></summary>

- 面板開放外部訪問但未啟用密碼保護時，啟動時顯示警告

</details>

<details>
<summary><strong>手動任務新增「下載雙語版本」開關</strong></summary>

- 手動任務新增「下載雙語版本」開關（預設關閉），可排除中文配音／中文電影等額外語言版本

</details>

</details>

<details>
<summary><strong><u>🐛 BUG 修正（14 項）</u></strong></summary>

<details>
<summary><strong>curl_cffi Session Cookie 寫回遺失</strong></summary>

- 修正 `curl_cffi` session cookie 寫回遺失的問題

</details>

<details>
<summary><strong>Cookie 刷新觸發條件過鬆，CDN 回應誤觸發刷新風暴</strong></summary>

- 收緊 cookie 刷新觸發條件（僅 gamer.com.tw 網域 + 內容包含 `BAHARUNE`），避免 CDN 回應誤觸發刷新風暴

</details>

<details>
<summary><strong>不可重試的錯誤被誤判為暫時性錯誤，浪費重試次數</strong></summary>

- 新增 `ForceStopError`：VIP 限制、地區限制、sn 不存在等不可重試的錯誤不再被誤判為暫時性錯誤而浪費重試

</details>

<details>
<summary><strong>anime.renew() 在重試流程中未受例外保護</strong></summary>

- 修正 `anime.renew()` 在重試流程中未受 try/except 保護的問題

</details>

<details>
<summary><strong>通知發送失敗時裸 except 缺少變數，導致二次錯誤</strong></summary>

- 修正 Discord／Plex／Telegram 通知失敗時裸 `except:` 缺少 `as e` 導致的二次 `NameError`

</details>

<details>
<summary><strong>無網路連線時 get_local_ip() 發生 UnboundLocalError</strong></summary>

- 修正 `get_local_ip()` 在無網路連線時的 `UnboundLocalError`

</details>

<details>
<summary><strong>主控台無法顯示特定 Unicode 字元，導致程式崩潰</strong></summary>

- 修正主控台無法顯示特定 Unicode 字元時導致整支程式崩潰的問題（例如含特殊字元的 GitHub release notes）

</details>

<details>
<summary><strong>版本號含多個小數點時，更新檢查邏輯崩潰</strong></summary>

- 修正版本比較邏輯：版本號出現多個小數點（如 `v24.9.10`）時不再讓更新檢查崩潰

</details>

<details>
<summary><strong>標題尾端殘留多餘標籤未清除</strong></summary>

- 標題尾端殘留的多餘 `[...]` 標籤（例如 `[年齡限制版]`）自動清除，支援多層疊加標籤

</details>

<details>
<summary><strong>劇場版檔名殘留 [電影] 標記</strong></summary>

- 劇場版檔名不再附加 `[電影]` 標記

</details>

<details>
<summary><strong>特別篇檔名殘留 [特別篇] 標記</strong></summary>

- 特別篇檔名不再附加 `[特別篇]` 標記

</details>

<details>
<summary><strong>排程時間已過期就整個跳過，完全不檢查</strong></summary>

- 修正排程「已過期即跳過、完全不檢查」的問題，改為無論如何至少檢查一次（仍遵守 SN 解析冷卻時間）

</details>

<details>
<summary><strong>Web 控制面板缺少 CSRF 防護</strong></summary>

- 新增 CSRF 防護（`X-Requested-With` 標頭驗證），涵蓋 `/uploadConfig`、`/manualTask`、`/sn_list`

</details>

<details>
<summary><strong>相依套件版本釘選過嚴，Python 3.13 環境無法安裝</strong></summary>

- `greenlet`／`gevent`／`lxml` 版本由精確釘選改為下限版本，修正 Python 3.13 環境下無法安裝的問題

</details>

</details>

<details>
<summary><strong><u>🔧 其他改善（4 項）</u></strong></summary>

<details>
<summary><strong>curl_cffi 套用到所有 Web API 請求，統一連線指紋</strong></summary>

- `curl_cffi` 套用到所有 Web API 請求（裝置驗證、token、解鎖等），避免同一連線指紋前後不一致

</details>

<details>
<summary><strong>任務進度條 WebSocket 推送頻率優化</strong></summary>

- 任務進度條 WebSocket 推送頻率由 1 秒優化為 0.3 秒，消除卡頓感

</details>

<details>
<summary><strong>sn_list 格式說明補充新規則</strong></summary>

- sn_list 格式說明補上新規則文字說明

</details>

<details>
<summary><strong>建立本機 PyInstaller 獨立 exe 打包流程</strong></summary>

- 建立本機 PyInstaller 獨立 exe 打包流程

</details>

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

<details>
<summary><strong>版本號由 v24.6 調整為 v25.1.1</strong></summary>

- 版本號由 v24.6 調整為 v25.1.1

</details>

</details>

---

> 以上為此次針對官方 v24.6 原始碼所做的客製修改，未包含官方後續（v24.7 ~ v25.0）自行發布的其他更新內容。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
