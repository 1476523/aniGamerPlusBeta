#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 快速取得 Cookie / UA-JA3-Akamai: 開一個獨立、乾淨(全新暫存設定檔)的瀏覽器視窗讓使用者登入/查看頁面,
# 搭配一個完全獨立於瀏覽器內容之外的 tkinter 控制面板視窗(取得/關閉按鈕), 透過 Chrome DevTools Protocol
# 讀取瀏覽器的 cookie 或頁面欄位值, 寫回結果檔後自動關閉瀏覽器與面板。
#
# 以獨立子行程(python <本檔> <mode> <result_path>)執行, 不與 Dashboard 的 Flask/gevent 主行程共用,
# 避免 tkinter 的阻塞式事件迴圈影響 Web 伺服器本身。
#
# 設計上的幾個重要限制(都是實測踩出來的坑, 之後修改請留意):
#   - 按鈕改用獨立的 tkinter 視窗, 不注入分頁 DOM: SPA 重新渲染/瀏覽器自己的系統對話框都會把注入的 DOM 節點清掉
#   - 絕不呼叫 Network.enable: 啟用後瀏覽器會持續推送大量事件塞滿沒人讀取的連線, 等待使用者操作期間會被斷線
#   - Network.getCookies 不帶 urls 參數, 用「目前這個分頁自己的網址」預設行為, 這樣才能連 HttpOnly cookie 都讀到
#   - 加上 --incognito: 有使用者回報一般視窗每次登入都會被要求 reCAPTCHA、手動開無痕視窗登入則不會。
#     最可能的原因是這裡透過 CDP 呼叫 Runtime.evaluate(填欄位/讀取登入結果/讀取指紋頁面內容都要用到)會啟用
#     Runtime domain, 這是公開已知、reCAPTCHA 風險評分等反機器人機制會偵測的「CDP Runtime.enable 洩漏」訊號
#     (跟 --remote-debugging-port 本身不同, 單純開著除錯埠不會被網頁 JS 偵測到, 但呼叫 Runtime.evaluate 會);
#     搭配每次都是全新暫存設定檔(沒有任何瀏覽紀錄/信任 cookie 可參考), 風險分數更容易被判定偏高。
#     --incognito 無法解決 Runtime.enable 本身的訊號, 但符合回報者實測有效的解法, 先採用；
#     這個修正沒有真實帳號無法驗證是否真的解決問題, 上線後請留意是否仍會頻繁跳出驗證
import json
import os
import subprocess
import sys
import tempfile
import time
import tkinter as tk
import urllib.request

import websocket  # pip: websocket-client

# AccountVault.py 放在 repo 根目錄(Dashboard/ 的上一層), 非 frozen 模式下這個檔案是被
# Config.run_quick_fetch() 用 `python Dashboard/quick_fetch.py ...` 開成獨立行程執行,
# 此時 sys.path[0] 預設只有 Dashboard/ 自己, 抓不到上一層的 AccountVault, 故手動補上
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import AccountVault  # noqa: E402  (需先補好 sys.path 才能 import, 故意放在這裡)

def _icon_path():
    # 跟主程式共用同一個圖示檔; Dashboard/ 資料夾本身不會被打包進 exe(每次都是從磁碟讀取), 所以打包後
    # 要以 sys.executable(exe 本身)所在目錄為基準, 而不是這個檔案(quick_fetch.py)在 frozen 模式下
    # 可能拿到、指向 PyInstaller 暫存解壓目錄的 __file__
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, 'Dashboard', 'static', 'img', 'aniGamerPlus.ico')


def _apply_icon(root):
    # 圖示只是外觀細節, 找不到/設定失敗都不影響主要功能, 不能讓這裡的例外中斷整個流程
    try:
        root.iconbitmap(_icon_path())
    except Exception:
        pass


COOKIE_URL = 'https://ani.gamer.com.tw/'
FINGERPRINT_URL = 'https://ja3.zone/check'
# login 模式(動畫瘋登入設定自動代填)直接導到真正的登入頁面(獨立分頁, 不透過 iframe),
# 徹底避開「一般網頁 JS 無法跨網域讀寫 iframe 內容」的限制
LOGIN_URL = 'https://user.gamer.com.tw/login.php'
# 登入(含人工完成的 reCAPTCHA)成功後, 動畫瘋會把分頁導到這個入口網站首頁; 偵測到分頁網址變成這個開頭,
# 就代表使用者已經自己完成驗證且登入成功, 才自動把分頁導回 ani.gamer.com.tw 並取得 Cookie——
# 這裡只偵測「導向到哪裡」這個結果, 不涉及、也不會去動驗證本身的任何一步, 驗證仍完全由使用者親自完成
_LOGIN_SUCCESS_URL_PREFIX = 'https://www.gamer.com.tw/'
_LOGIN_SUCCESS_POLL_INTERVAL = 1.0

# 登入表單欄位/送出按鈕/兩步驟驗證欄位的選擇器集中定義成常數, 方便之後依實際頁面 DOM 微調而不必動到主流程。
# 明確風險提示: 送出按鈕的精確選擇器、#input-2sa 出現的確切時機/機制, 無法在不登入使用者真實帳號的情況下
# 事先驗證, 是本功能已知且刻意接受的「第一次上線需要使用者親自測試、視情況微調選擇器」風險點
_ACCOUNT_FIELD_SELECTOR = 'input[name="userid"]'
_PASSWORD_FIELD_SELECTOR = 'input[name="password"]'
_TWO_STEP_INPUT_SELECTOR = '#input-2sa'
_PAGE_LOAD_TIMEOUT = 15  # 秒, 等待登入表單(帳號欄位)出現的逾時時間
_TWO_STEP_WAIT_TIMEOUT = 15  # 秒, 等待 2FA 欄位出現的逾時時間
_POLL_INTERVAL = 0.5

_FILL_FIELD_JS = """
(function(sel, val){
    var el = document.querySelector(sel);
    if (!el) return false;
    el.focus();
    el.dispatchEvent(new Event('focus', {bubbles: true}));
    var proto = Object.getPrototypeOf(el);
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
    el.blur();
    el.dispatchEvent(new Event('blur', {bubbles: true}));
    return true;
})(%s, %s);
"""

# 找到帳號欄位所在的 <form>, 點擊裡面的送出按鈕(刻意不用 form.submit(), 避免略過網站可能綁在
# 按鈕 click 事件上的驗證邏輯, 例如觸發 AJAX 檢查主要帳密並顯示兩步驟驗證欄位)
_CLICK_SUBMIT_JS = """
(function(){
    var field = document.querySelector(%s);
    if (!field) return false;
    var form = field.closest('form');
    if (!form) return false;
    var btn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn) return false;
    btn.click();
    return true;
})();
""" % json.dumps(_ACCOUNT_FIELD_SELECTOR)

_CHECK_VISIBLE_JS = """
(function(sel){
    var el = document.querySelector(sel);
    return !!(el && el.offsetParent !== null);
})(%s);
"""

_CHECK_EXISTS_JS = """
(function(sel){
    return !!document.querySelector(sel);
})(%s);
"""

FINGERPRINT_SCRAPE_JS = """
(function(){
    var raws = Array.prototype.slice.call(document.querySelectorAll('textarea[aria-label="Raw"]'));
    var ja3 = raws[0] ? raws[0].value : '';
    var akamai = raws[3] ? raws[3].value : '';
    var allTextareas = Array.prototype.slice.call(document.querySelectorAll('textarea'));
    var lastRawIndex = allTextareas.indexOf(raws[3]);
    var ua = '';
    for (var i = lastRawIndex + 1; i < allTextareas.length; i++) {
        if (!allTextareas[i].getAttribute('aria-label')) { ua = allTextareas[i].value; break; }
    }
    return JSON.stringify({ja3: ja3, akamai: akamai, ua: ua});
})();
"""


def _find_browser():
    # 依序找 Chrome / Edge 實際安裝路徑(透過登錄檔 App Paths, 不依賴固定安裝路徑),
    # 兩者都是 Chromium 核心, CDP 操作方式完全相同; Chrome 優先(實測 Edge 在部分機器上有帳號同步對話框、
    # 背景常駐行程等幹擾), 找不到 Chrome 才退回 Edge
    try:
        import winreg
    except ImportError:
        return None
    app_names = ('chrome.exe', 'msedge.exe')
    for app_name in app_names:
        key_path = r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\%s' % app_name
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for flags in (0, getattr(winreg, 'KEY_WOW64_32KEY', 0), getattr(winreg, 'KEY_WOW64_64KEY', 0)):
                try:
                    with winreg.OpenKey(hive, key_path, 0, winreg.KEY_READ | flags) as key:
                        value, _ = winreg.QueryValueEx(key, None)
                        if value and os.path.exists(value):
                            return value
                except (FileNotFoundError, OSError):
                    continue
    return None


def _wait_for_devtools(port, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=1) as r:
                json.load(r)
                return True
        except Exception:
            time.sleep(0.3)
    return False


def _get_page_target(port):
    with urllib.request.urlopen('http://127.0.0.1:%d/json/list' % port, timeout=2) as r:
        targets = json.load(r)
    for t in targets:
        if t.get('type') == 'page':
            return t
    return None


def _write_result(result_path, result):
    with open(result_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)


def _wait_for_expr(call, js_expr, timeout):
    # 輪詢直到 js_expr 回傳真值, 或逾時回傳 False
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = call('Runtime.evaluate', {'expression': js_expr, 'returnByValue': True})
        if (resp or {}).get('result', {}).get('result', {}).get('value'):
            return True
        time.sleep(_POLL_INTERVAL)
    return False


def _wait_for(call, js_template, selector, timeout):
    # 套用 selector 後交給 _wait_for_expr() 輪詢。用來等待頁面實際載入完成(剛連上 CDP 時分頁可能還在
    # 導航中, DOM 尚未就緒)、或等待伺服器驗證完主要帳密後才動態顯示的欄位
    return _wait_for_expr(call, js_template % json.dumps(selector), timeout)


def _autofill_login(call, creds):
    # 自動代填帳號/密碼, 點擊送出後等待兩步驟驗證欄位出現再填入即時算出的 TOTP 碼。
    # 全程用 try/except 包起來且不論成功與否都不中斷後續流程——自動代填只是輔助, 失敗時
    # 使用者仍可以在彈出的瀏覽器視窗裡自己手動完成登入, 沿用既有(mode='cookie')的手動路徑
    try:
        if not _wait_for(call, _CHECK_EXISTS_JS, _ACCOUNT_FIELD_SELECTOR, _PAGE_LOAD_TIMEOUT):
            return  # 逾時內都沒載入出登入表單, 放棄自動代填, 使用者仍可在瀏覽器裡自行操作

        call('Runtime.evaluate', {'expression': _FILL_FIELD_JS % (
            json.dumps(_ACCOUNT_FIELD_SELECTOR), json.dumps(creds.get('account', '')))})
        call('Runtime.evaluate', {'expression': _FILL_FIELD_JS % (
            json.dumps(_PASSWORD_FIELD_SELECTOR), json.dumps(creds.get('password', '')))})
        call('Runtime.evaluate', {'expression': _CLICK_SUBMIT_JS})

        totp_secret = creds.get('totp_secret')
        if not totp_secret:
            return
        if _wait_for(call, _CHECK_VISIBLE_JS, _TWO_STEP_INPUT_SELECTOR, _TWO_STEP_WAIT_TIMEOUT):
            code = AccountVault.generate_totp(totp_secret)
            call('Runtime.evaluate', {'expression': _FILL_FIELD_JS % (
                json.dumps(_TWO_STEP_INPUT_SELECTOR), json.dumps(code))})
    except Exception:
        pass


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    creds = None
    if len(argv) == 3 and argv[0] == 'login':
        mode, result_path, creds_path = argv
        try:
            with open(creds_path, 'r', encoding='utf-8') as f:
                creds = json.load(f)
        finally:
            try:
                os.remove(creds_path)  # 帳密等機敏資料, 讀完立即刪除, 不留在磁碟上
            except OSError:
                pass
    elif len(argv) == 2 and argv[0] in ('cookie', 'fingerprint'):
        mode, result_path = argv[0], argv[1]
    else:
        print('usage: quick_fetch.py <cookie|fingerprint> <result_path> | quick_fetch.py login <result_path> <creds_path>')
        sys.exit(1)

    browser_path = _find_browser()
    if not browser_path:
        _write_result(result_path, {'ok': False, 'error': 'browser_not_found'})
        return

    port = {'cookie': 9400, 'fingerprint': 9401, 'login': 9402}[mode]
    user_data_dir = tempfile.mkdtemp(prefix='anigamer_quickfetch_')
    url = {'cookie': COOKIE_URL, 'fingerprint': FINGERPRINT_URL, 'login': LOGIN_URL}[mode]

    proc = subprocess.Popen([
        browser_path,
        '--remote-debugging-port=%d' % port,
        '--remote-allow-origins=http://127.0.0.1:%d' % port,
        '--user-data-dir=%s' % user_data_dir,
        '--no-first-run',
        '--new-window',
        '--incognito',  # 使用者回報一般視窗每次登入都會被要求 reCAPTCHA、無痕視窗則不會, 見本檔開頭的說明
        url,
    ])

    _write_result(result_path, {'ok': False, 'status': 'launching', 'pid': proc.pid})

    if not _wait_for_devtools(port):
        _write_result(result_path, {'ok': False, 'error': 'devtools_not_ready', 'pid': proc.pid})
        proc.terminate()
        return

    target = None
    for _ in range(30):
        target = _get_page_target(port)
        if target:
            break
        time.sleep(0.3)
    if not target:
        _write_result(result_path, {'ok': False, 'error': 'no_page_target', 'pid': proc.pid})
        proc.terminate()
        return

    ws = websocket.create_connection(target['webSocketDebuggerUrl'], timeout=30)
    msg_id = 0

    def send(method, params=None):
        nonlocal msg_id
        msg_id += 1
        ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params or {}}))
        return msg_id

    def call(method, params=None, timeout=10):
        cid = send(method, params)
        deadline = time.time() + timeout
        while time.time() < deadline:
            ws.settimeout(max(0.1, deadline - time.time()))
            try:
                raw = ws.recv()
            except Exception:
                break
            data = json.loads(raw)
            if data.get('id') == cid:
                return data
        return None

    _write_result(result_path, {'ok': False, 'status': 'browser_ready', 'pid': proc.pid})

    # ---- 獨立的小型控制面板視窗(不注入分頁 DOM, 不受頁面重繪/瀏覽器內建對話框影響) ----
    # login 模式沿用 cookie 模式的面板與 Network.getCookies 邏輯, 最終取得 Cookie 的步驟一律由使用者
    # 確認頁面驗證通過後手動按下按鈕, 不嘗試自動判斷登入是否成功。
    #
    # 自動代填故意不在「顯示面板前」自動執行——真實網站的實際載入時間比本機測試頁面長很多,
    # 若在顯示面板前先同步等待(最長 15~30 秒)才叫出面板, 使用者會誤以為程式沒有反應、
    # 提早自己手動操作瀏覽器; 改成面板一開始就先顯示, 代填改成一顆可以隨時按、可以重複按的按鈕,
    # 讓使用者自己判斷「頁面載入好了」再觸發, 也不會跟主執行緒共用的 ws 連線產生多執行緒競爭問題
    root = tk.Tk()
    root.title('快速取得' + ('Cookie' if mode in ('cookie', 'login') else ' UA / JA3 / Akamai'))
    root.attributes('-topmost', True)
    _apply_icon(root)
    # 視窗加寬到 340: 一方面讓「快速取得 UA / JA3 / Akamai」這個較長的標題不會被視窗邊框截斷,
    # 另一方面搭配下面 Label 的 wraplength 讓提示文字能正常換行、不會超出視窗顯示不完整
    root.geometry('340x150+40+40' if mode == 'login' else '340x110+40+40')

    if mode == 'login':
        label_text = '請等待頁面載入完成後按「自動代填」,\n完成頁面驗證並確認登入成功後再按「取得Cookie」'
        action_text = '取得Cookie'
    elif mode == 'cookie':
        label_text = '請先在瀏覽器登入動畫瘋,\n再按下方按鈕'
        action_text = '取得Cookie'
    else:
        label_text = '請等待頁面載入完成,\n再按下方按鈕'
        action_text = '取得UA、JA3、Akamai'

    status_label = tk.Label(root, text=label_text, font=('Microsoft JhengHei', 10),
                             wraplength=310, justify='center')
    status_label.pack(pady=(8, 4))
    if mode == 'login':
        def on_autofill():
            status_label.config(text='正在嘗試自動代填, 請稍候...')
            root.update_idletasks()
            _autofill_login(call, creds or {})
            status_label.config(text='已嘗試自動代填(可重複按), 完成驗證後請按「取得Cookie」')
        tk.Button(root, text='自動代填', bg='#e0a800', fg='white', width=30,
                  command=on_autofill).pack(pady=(0, 4))
    btn_frame = tk.Frame(root)
    btn_frame.pack()

    closed = {'done': False}

    def do_close(fetched_result=None):
        if closed['done']:
            return  # 避免按鈕觸發的關閉跟 check_browser_alive 偵測到的關閉重複執行、對已銷毀的 root 操作
        closed['done'] = True
        if fetched_result is not None:
            fetched_result['pid'] = proc.pid
            _write_result(result_path, fetched_result)
        try:
            ws.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        root.destroy()

    def check_browser_alive():
        # 使用者自己把彈出的瀏覽器視窗關掉(而不是按面板上的按鈕)時, 面板留著也沒用(CDP 連線已經斷了,
        # 按任何按鈕都只會失敗), 這裡每秒檢查一次瀏覽器行程是否還在, 不在的話就連同面板一起關閉,
        # 沿用「取消」的收尾方式(不寫入任何結果, 呼叫端視同使用者取消)
        if closed['done']:
            return
        if proc.poll() is not None:
            do_close({'ok': False, 'status': 'cancelled'})
            return
        root.after(1000, check_browser_alive)

    root.after(1000, check_browser_alive)

    def on_action():
        if mode in ('cookie', 'login'):
            resp = call('Network.getCookies', {})
            cookies = (resp or {}).get('result', {}).get('cookies', [])
            cookie_str = '; '.join('%s=%s' % (c['name'], c['value']) for c in cookies)
            do_close({'ok': True, 'type': 'cookie', 'value': cookie_str})
        else:
            resp = call('Runtime.evaluate', {'expression': FINGERPRINT_SCRAPE_JS, 'returnByValue': True})
            raw_value = (resp or {}).get('result', {}).get('result', {}).get('value')
            try:
                parsed = json.loads(raw_value) if raw_value else {}
            except (TypeError, ValueError):
                parsed = {}
            do_close({'ok': True, 'type': 'fingerprint',
                      'ua': parsed.get('ua', ''), 'ja3': parsed.get('ja3', ''), 'akamai': parsed.get('akamai', '')})

    def on_close_only():
        do_close({'ok': False, 'status': 'cancelled'})

    tk.Button(btn_frame, text=action_text, bg='#2d6cdf', fg='white', width=max(14, len(action_text) + 6),
              command=on_action).pack(side='left', padx=4)
    tk.Button(btn_frame, text='關閉', bg='#666666', fg='white', width=8,
              command=on_close_only).pack(side='left', padx=4)

    if mode == 'login':
        def check_login_success():
            # 只偵測「使用者自己完成驗證並登入成功後, 分頁被導到哪裡」這個結果, 完全不涉及驗證過程本身。
            # 偵測到後改導回 ani.gamer.com.tw 並自動觸發跟按「取得Cookie」按鈕完全相同的邏輯,
            # 手動按鈕仍保留, 偵測失敗或没抓到跳轉時使用者一樣可以自己按
            if closed['done']:
                return
            resp = call('Runtime.evaluate', {'expression': 'location.href', 'returnByValue': True}, timeout=3)
            href = (resp or {}).get('result', {}).get('result', {}).get('value') or ''
            if href.startswith(_LOGIN_SUCCESS_URL_PREFIX):
                status_label.config(text='偵測到登入成功, 正在自動取得 Cookie...')
                root.update_idletasks()
                call('Page.navigate', {'url': COOKIE_URL})
                # 同時檢查網址已經真的換成 ani.gamer.com.tw、且該頁完全載入完成, 避免導航還沒真正開始前
                # 就抓到舊頁面(www.gamer.com.tw)當下的 readyState, 誤判成已經載入完成
                _wait_for_expr(call, 'location.href.indexOf("ani.gamer.com.tw") !== -1 '
                                      '&& document.readyState === "complete"', 10)
                if not closed['done']:
                    on_action()
                return
            root.after(int(_LOGIN_SUCCESS_POLL_INTERVAL * 1000), check_login_success)

        root.after(int(_LOGIN_SUCCESS_POLL_INTERVAL * 1000), check_login_success)

    root.protocol('WM_DELETE_WINDOW', on_close_only)
    root.mainloop()


if __name__ == '__main__':
    main()
