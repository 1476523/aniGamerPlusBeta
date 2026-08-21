## v25.1.9

延續 v25.1.8，本次新增客製強化版獨有的「通知模板」自訂系統：11 種通知類別（下載完成/失敗、公告事件、系統事件）都能自訂實際發送的文字內容，<br>
Telegram 版可用 HTML 格式標籤（粗體/斜體/底線/刪除線/程式碼/引用/超連結/防劇透等），<br>
儲存時自動轉換成對應的 Discord Markdown 語法，不需要自己維護兩份文字；<br>
同時新增「發送歷史」查詢功能，可回顧每一則通知實際送出的內容與成功/失敗結果。<br>
另外修正 Telegram 通知格式標籤先前只會顯示成純文字、不會真的套用格式的問題，並統一了設定頁控制項的寬度排版、導覽列置中，通知測試結果改用彈窗顯示。<br>
共 10 項變更。

<details>
<summary><strong><u>🆕 新功能（2 項）</u></strong></summary>

<details>
<summary><strong>通知模板自訂，Telegram HTML 標籤／自動轉換 Discord Markdown</strong></summary>

「設定」→「通知設定」新增「通知模板」摺疊區塊，可自訂 11 種通知類別（下載通知 4 項、公告通知 4 項、系統通知 3 項）實際發送的文字內容，<br>
取代過去寫死在程式碼裡、無法客製化的固定訊息格式。<br>
此功能為客製強化版獨有，模板內容存在 `aniGamer.db`，**不包含**在「匯出設定與排程檔」的匯出範圍內。

| 功能 | 用法 | 好處 |
|---|---|---|
| 選擇類別編輯 | 下拉選單「選擇通知類別」切換要編輯的類別，切換後自動載入該類別目前的模板文字 | 11 種類別集中在同一個編輯器管理，不用到程式碼裡逐一翻找對應的通知文字 |
| Telegram 格式工具列 | 選取文字後按「B／I／U／S／程式碼／程式碼區塊／引用／可摺疊引用／超連結／防劇透」按鈕，自動包上對應標籤 | 不需要背 Telegram Bot 支援的 HTML 標籤語法，點按鈕就能套用格式 |
| Discord 版本自動轉換 | 儲存模板時，Telegram HTML 標籤自動轉換成對應的 Discord Markdown 語法，並顯示在唯讀的「Discord 版本預覽」欄位供對照 | 只需要維護一份 Telegram 版模板，不用自己另外改寫一份 Discord 語法，兩邊格式定義也不會因為手動維護逐漸兜不起來 |
| 通用字符（token）按鈕 | 格式工具列正下方固定顯示一排按鈕（依目前類別列出適用項目，涵蓋 `@animation_name@`、`@episode@`、`@file_size@`、`@fail_reason@`、`@announcement_text@`、`@version_tag@` 等），按鈕上顯示的是中文說明（例如「番劇名稱」），滑鼠移上去會顯示對應的 `@xxx@` 字串，按下直接插入模板輸入框目前的游標位置；詳細說明另外收進「可用通用字符說明」摺疊區塊（預設收合，用法與「Telegram 格式標籤說明」一致，列出每個字符的用途與適用備註） | 中文標籤比原始 `@xxx@` 字串更容易一眼看懂用途，不用自己手打容易拼錯字的符號；按鈕常駐不用展開摺疊才能用，說明文字則摺疊起來不佔版面；可自由調整通知內容的措辭與排版順序，而不是只能收到固定格式的訊息；未使用到的 token 保留原樣不清空，方便發現自己拼錯字 |
| 預覽 | 按「預覽」跳出「通知預覽」視窗，用範例內容模擬 Telegram 訊息氣泡與 Discord 嵌入卡片的實際外觀，讀取的是輸入框裡「尚未儲存」的文字；可摺疊引用（`<blockquote expandable>`）會模擬真正的收合互動——內容達 4 行以上時預設收合並在右下角顯示向下箭頭，點擊展開全文、箭頭轉向上，再點一次收合回去，不足 4 行則維持一般引用樣式 | 不用先儲存、也不用真的觸發一次下載/公告/系統事件，就能立即看到修改後大概會長什麼樣子；可摺疊引用的收合/展開效果更貼近 Telegram 實際畫面 |
| 模板測試 | 「預覽」按鈕旁新增「模板測試」，按下後用目前類別**已儲存**的模板套用範例內容，透過已啟用的 Telegram／Discord 管道實際發送一次，逐一回報各管道成功/失敗結果 | 不用等真的觸發下載/公告/系統事件，就能確認模板格式在真正的 App 上收到時是否如預期；與「預覽」互補：預覽是模擬畫面，模板測試是真的送出去 |
| 恢復預設 | 按「恢復預設」把目前類別的模板（Telegram／Discord 兩版）還原成內建預設文字；未自訂過的類別會顯示「目前為預設值」徽章 | 改壞了或想不出更好的措辭時，隨時能一鍵退回官方預設文字 |

</details>

<details>
<summary><strong>通知發送歷史</strong></summary>

Telegram／Discord 通知設定區塊各自新增「查看發送歷史」按鈕，跳出「發送歷史」視窗。

| 功能 | 用法 | 好處 |
|---|---|---|
| 依管道查詢 | Telegram／Discord 各自的按鈕只查詢該管道自己的歷史紀錄（兩邊資料庫各自獨立儲存） | 排查「這則通知到底有沒有送出去」時不用去猜是哪個管道的問題 |
| 依類別／子類別篩選 | 視窗內「全部類別／下載通知／公告通知／系統通知」下拉選單，選定後子類別選單會列出對應的細項可再篩選 | 番劇一多時歷史紀錄會很長，篩選後能快速找到特定事件（例如只看某次裝置驗證異常）的發送紀錄 |
| 顯示發送結果 | 每筆紀錄顯示發送時間、實際發送的完整訊息內容，以及成功／失敗（失敗時附上錯誤原因） | 通知沒收到時可以直接對照歷史紀錄判斷是「沒送出」還是「送出了但 Token/Webhook 設定有問題」，不用憑印象猜測 |

</details>

</details>

<details>
<summary><strong><u>🐛 BUG 修正（1 項）</u></strong></summary>

<details>
<summary><strong>Telegram 格式標籤先前不會真的套用格式</strong></summary>

- 修正 Telegram 通知發送時未帶入 `parse_mode=HTML` 參數，導致模板即使用了 `<b>`／`<i>`／`<code>` 等格式標籤，<br>
Telegram 收到的還是純文字、標籤符號會原樣顯示出來而不是真的變成粗體/斜體/程式碼樣式；<br>
此次連同「通知模板」功能一併修正，模板裡使用的格式標籤現在會正確渲染

</details>

</details>

<details>
<summary><strong><u>🔧 其他改善（6 項）</u></strong></summary>

<details>
<summary><strong>設定頁控制項改用 flex 版面統一寬度</strong></summary>

- 「設定」頁各區塊的開關（switch）與下拉選單（select）改用 flex 版面統一計算寬度，取代原本不穩定的表格自動排版，修正過去不同欄位開關寬度/間距略有落差的問題

</details>

<details>
<summary><strong>下載設定／環境偽裝設定版面微調</strong></summary>

- 「下載設定」區塊部分欄位標籤同步精簡並重新排序/調整寬度，「環境偽裝設定」摺疊行為統一比照「代理設定」「通知設定」「其他」等區塊

</details>

<details>
<summary><strong>導覽列置中對齊</strong></summary>

- 導覽列（品牌標題＋選單連結）在「設定」頁與「任務」頁改為置中對齊頁面內容寬度，取代原本靠左對齊的排版

</details>

<details>
<summary><strong>通知測試結果改用彈窗顯示</strong></summary>

- Telegram「發送測試訊息」／「取得Chat ID」與 Discord「發送測試訊息」按鈕的執行結果，改用自訂結果彈窗顯示，取代原本瀏覽器原生的 `alert()` 彈出視窗

</details>

<details>
<summary><strong>Telegram／Discord 通知設定區塊搬移與 Discord 嵌入卡片調整</strong></summary>

- Telegram／Discord 通知設定區塊搬移到「通知類別」區塊上方（對應說明文字同步從「下方 Telegram/Discord」改為「上方 Telegram/Discord」）
- Discord 通知移除寫死的嵌入卡片作者「🔔 動畫瘋」欄位，「發送測試訊息」的標題統一改用與正式通知相同的 `【aniGamerPlus 客製強化版 vX.X.X 消息】` 格式

</details>

<details>
<summary><strong>Chat ID 欄位加入敏感遮罩</strong></summary>

- `telebot_chat_id`（Chat ID）欄位加入敏感欄位遮罩清單，比照 Token/Webhook 處理

</details>

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

<details>
<summary><strong>版本號由 v25.1.8 調整為 v25.1.9</strong></summary>

- 版本號由 v25.1.8 調整為 v25.1.9

</details>

</details>

---

> 完整變更歷史（v24.6 → v25.1.8）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
