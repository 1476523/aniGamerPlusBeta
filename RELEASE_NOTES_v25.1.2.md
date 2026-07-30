## v25.1.2

延續 v25.1.1，本次新增 ja3/akamai 自訂指紋支援，並修正一處遺漏的主控台崩潰風險。

<details>
<summary><strong><u>🛡️ 反爬蟲與連線穩定性（3 項）</u></strong></summary>

- 新增 `ja3`／`akamai` 自訂指紋支援：可在 Dashboard 設定頁或 `config.json` 填入自己瀏覽器實際採集到的指紋（取代 curl_cffi 內建的罐頭指紋），需與取得 cookie 的瀏覽器一致；
`ja3` 與 `akamai` 須同時填寫才會生效，只填一個會警示並自動退回內建指紋，不影響現有使用者
- Dashboard 設定頁新增對應欄位，並在下方加了 [ja3.zone/check](https://ja3.zone/check) 的快速開啟按鈕，方便採集後直接回來貼上
- `config.json` 自動升級（config_version 17.2 → 17.3），舊設定檔會自動補上這兩個新欄位（預設空值，不影響既有行為）

</details>

<details>
<summary><strong><u>🐛 錯誤處理與穩定性（1 項）</u></strong></summary>

- 修正另一處遺漏的主控台 Unicode 編碼崩潰風險（讀取設定檔失敗時的提示訊息），與 v25.1.1 修正的問題同一類，這次補齊

</details>

<details>
<summary><strong><u>📦 版本（1 項）</u></strong></summary>

- 版本號由 v25.1.1 調整為 v25.1.2

</details>

---

> 完整變更歷史（v24.6 → v25.1.1）請參閱先前的 release notes。
> 
> 如果喜歡的可以按下 Star 來表示喜歡
> 可以給予咖啡表示支持 
> <a href="https://www.buymeacoffee.com/tocsh" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy SH A Coffee" height="36" width="120"></a>
