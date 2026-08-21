## v25.1.3

延續 v25.1.2，本次修正 Dashboard 設定頁存檔後顯示不同步的問題、將 ja3/akamai 指紋欄位改為遮罩顯示與版面調整，並修正自訂星期排程在程式重啟時會補檢查過去天數的問題。

<details>
<summary><strong><u>🐛 BUG 修正（2 項）</u></strong></summary>

<details>
<summary><strong>`/data/config.json` 回應被瀏覽器快取，導致存檔後網頁欄位未即時反映最新設定</strong></summary>

- 修正 `/data/config.json` 回應可能被瀏覽器快取，<br>
導致存檔後網頁欄位沒有即時反映最新設定（尤其是 ja3/akamai/ua 等欄位）的問題：後端回應加上 `Cache-Control: no-store`，前端讀取設定的請求也一併加上禁用快取

</details>

<details>
<summary><strong>自訂星期／時間排程重啟時會誤補檢查本週已過去的天數</strong></summary>

- 修正自訂星期／時間排程在程式重啟時的補檢查邏輯：先前只要重啟就會把「本週一到今天」所有已設定排程的星期都補檢查一次；<br>
現在只有排程對應到「今天」且時段已過才會補檢查一次，本週已經過去的其他天數會直接跳過，等下週同一時段再檢查

</details>

</details>

<details>
<summary><strong><u>🔧 其他改善（3 項）</u></strong></summary>

<details>
<summary><strong>自訂 ja3/akamai 指紋欄位不再於網頁明文顯示</strong></summary>

- 自訂 ja3/akamai 指紋欄位不再於網頁明文顯示：已設定時欄位顯示為空白並以 placeholder 提示「●●●●●● 已設定」，<br>
需重新輸入完整指紋才會覆蓋原值，避免不小心截圖或分享畫面時外流指紋內容

</details>

<details>
<summary><strong>ja3/akamai 欄位留空儲存時會自動沿用原值，不會被誤蓋成空值</strong></summary>

- 承上，儲存其他設定時若 ja3/akamai 欄位維持空白（未重新輸入），會自動沿用原本已存的值，不會被誤蓋成空值（注意：此改動下，<br>
若要清空 ja3/akamai 改回 curl_cffi 內建指紋，目前只能直接編輯 config.json，網頁上留空不會清空）

</details>

<details>
<summary><strong>自訂 ja3/akamai 指紋欄位版面調整</strong></summary>

- 自訂 ja3/akamai 指紋欄位版面調整：由左右並列改為各自獨立一列，並統一標籤寬度，讓兩個輸入框長度一致，已設定時的提示文字也能完整顯示不被截斷

</details>

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

<details>
<summary><strong>版本號由 v25.1.2 調整為 v25.1.3</strong></summary>

- 版本號由 v25.1.2 調整為 v25.1.3

</details>

</details>

---

> 完整變更歷史（v24.6 → v25.1.2）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡<br>
> 可以給予咖啡表示支持<br>
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
