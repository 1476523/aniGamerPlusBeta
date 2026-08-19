#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# @Time    : 2019/6/26 16:12
# @Author  : Miyouzi
# @File    : Server.py
# @Software: PyCharm

# 非阻塞
from gevent import monkey; monkey.patch_all()
from gevent import spawn

import json, sys, os, re, time
import threading, traceback
import random, string
import datetime

from aniGamerPlus import Config
from aniGamerPlus import Gossip
import NotifyDB
import GossipDB
import AccountVault
from flask import Flask, request, jsonify, session, redirect, url_for, Response
from flask import render_template
from aniGamerPlus import __cui as cui
from aniGamerPlus import run_schedule_scan, run_db_cleanup, run_db_cleanup_delete, run_episode_scan, run_full_recheck
from aniGamerPlus import submit_full_recheck_decisions
from aniGamerPlus import _retry_manual_batch_failed, _cancel_manual_batch
from aniGamerPlus import _retry_manual_single, _cancel_manual_single
from aniGamerPlus import _display_name_for_sn
import logging, termcolor
from ColorPrint import err_print
from logging.handlers import TimedRotatingFileHandler
import mimetypes
# ws 支持
import ssl
from flask_sockets import Sockets
from gevent.pywsgi import WSGIServer
from geventwebsocket.exceptions import WebSocketError
from geventwebsocket.handler import WebSocketHandler

mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/x-javascript', '.js')
template_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'templates')
static_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'static')
app = Flask(__name__, template_folder=template_path, static_folder=static_path)
app.debug = False
app.secret_key = Config.get_or_create_dashboard_secret_key()  # 簽章 session cookie 用
sockets = Sockets(app)


@app.after_request
def _no_cache_static(response):
    # 靜態資源(JS/CSS)網址上雖然帶有 ?v=<版號> 做快取破壞, 但版號沒變動時(例如同一個未發布版本內連續修正)
    # 瀏覽器仍可能沿用快取的舊檔案內容, 導致更新程式後網頁實際行為沒有跟著變, 難以排查
    # 強制要求 conditional GET(revalidate), 檔案真的有變動時一定會拿到最新內容, 沒變動時則只是多一次 304 往返
    if request.path.startswith('/static/'):
        response.headers['Cache-Control'] = 'no-cache'
    return response

# 日誌處理
# logger = logging.getLogger('werkzeug')
logger = logging.getLogger('geventwebsocket')
logging.basicConfig(level=logging.INFO)  # 記錄訪問
web_log_path = os.path.join(Config.get_working_dir(), 'logs', 'web.log')
handler = TimedRotatingFileHandler(filename=web_log_path, when='midnight', backupCount=7, encoding='utf-8')
handler.suffix = '%Y-%m-%d.log'
handler.extMatch = re.compile(r'^\d{4}-\d{2}-\d{2}.log')
logger.addHandler(handler)
logger.propagate = False  # 不在控制台上輸出

# websocket鑑權需要的 token, 隨機一個 32 位初始 token
websocket_token = ''.join(random.sample(string.ascii_letters + string.digits, 32))


# 處理 Flask 寫日誌到文件帶有顏色控制符的問題
def colored(text, color=None, on_color=None, attrs=None):
    who_invoked = traceback.extract_stack()[-2][2]  # 函數調用人
    if who_invoked == 'log_request':
        # 如果是來自 Flask/werkzeug 的調用
        return text
    else:
        # 來自其他的調用正常高亮
        COLORS = termcolor.COLORS
        HIGHLIGHTS = termcolor.HIGHLIGHTS
        ATTRIBUTES = termcolor.ATTRIBUTES
        RESET = termcolor.RESET
        if os.getenv('ANSI_COLORS_DISABLED') is None:
            fmt_str = '\033[%dm%s'
            if color is not None:
                text = fmt_str % (COLORS[color], text)
            if on_color is not None:
                text = fmt_str % (HIGHLIGHTS[on_color], text)
            if attrs is not None:
                for attr in attrs:
                    text = fmt_str % (ATTRIBUTES[attr], text)
            text += RESET
        return text


termcolor.colored = colored
app.logger.addHandler(handler)


# 讀取web需要的配置名稱列表
id_list_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'static', 'js', 'settings_id_list.js')
with open(id_list_path, 'r', encoding='utf-8') as f:
    id_list = re.sub(r'(var id_list\s*=\s*|\s*\n?)', '', f.read()).replace('\'', '"')
    id_list = json.loads(id_list)


LOGIN_EXEMPT_ENDPOINTS = {'login', 'static'}

# /login 暴力破解防護: 帳密比對沒有任何嘗試次數限制的話, 搭配 dashboard.password 預設值 'admin',
# 對外開放時風險很高。純記憶體內計數即可(重啟服務等於重置, 可接受, 不需要為此另外落地資料庫)。
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_LOCKOUT_SECONDS = 60
_login_failures = {}  # {ip: [連續失敗次數, 鎖定解除時間戳(0 表示目前未鎖定)]}
_login_failures_lock = threading.Lock()


def _login_lockout_remaining(ip):
    # 回傳這個 IP 目前還要等幾秒才能再嘗試登入, 0 表示現在沒有被鎖定
    with _login_failures_lock:
        record = _login_failures.get(ip)
        if not record:
            return 0
        locked_until = record[1]
        remaining = locked_until - time.time()
        return max(0, round(remaining))


def _login_register_failure(ip):
    with _login_failures_lock:
        count, locked_until = _login_failures.get(ip, [0, 0])
        count += 1
        if count >= _LOGIN_MAX_ATTEMPTS:
            locked_until = time.time() + _LOGIN_LOCKOUT_SECONDS
            count = 0  # 鎖定期滿後重新給滿額度, 不會一直維持在鎖定邊緣
        _login_failures[ip] = [count, locked_until]


def _login_register_success(ip):
    with _login_failures_lock:
        _login_failures.pop(ip, None)


@app.before_request
def require_login():
    # 靜態資源與登入頁本身一律不需要驗證, 提前判斷可以完全跳過底下的 Config.read_settings()(磁碟讀取 config.json + 解析 + 正規化)
    # 一次完整頁面載入通常會連帶十幾個靜態資源請求, 過去每個請求都重新讀一次設定檔, 在下載中同時有大量影片分段寫入磁碟、
    # 磁碟 I/O 競爭激烈時, 會讓整頁載入被拖得很慢、網頁看起來像卡死; 提前排除靜態資源後大幅減少這類不必要的磁碟讀取
    if request.endpoint in LOGIN_EXEMPT_ENDPOINTS:
        return None
    # 密碼保護總開關沿用 config.json 既有的 dashboard.BasicAuth 欄位(現已改為自訂登入頁機制, 不再是 HTTP Basic Auth)
    settings = Config.read_settings()
    if not settings['dashboard']['BasicAuth']:
        return None
    if session.get('logged_in'):
        return None
    if request.path.startswith('/data/') or request.path in ('/uploadConfig', '/manualTask', '/sn_list', '/cookie'):
        return jsonify({'status': '401', 'message': 'Unauthorized'}), 401
    return redirect(url_for('login', next=request.path))


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'GET':
        if session.get('logged_in'):
            return redirect(request.args.get('next') or url_for('home'))
        return render_template('login.html', asset_v=Config.aniGamerPlus_version)

    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    ip = request.remote_addr
    remaining = _login_lockout_remaining(ip)
    if remaining:
        return jsonify({'status': '429', 'message': f'嘗試次數過多, 請於 {remaining} 秒後再試'}), 429
    data = json.loads(request.get_data(as_text=True))
    settings = Config.read_settings()
    if data.get('username') == settings['dashboard']['username'] and data.get('password') == settings['dashboard']['password']:
        _login_register_success(ip)
        session.permanent = True
        session['logged_in'] = True
        return jsonify({'status': '200'})
    _login_register_failure(ip)
    return jsonify({'status': '401', 'message': '帳號或密碼錯誤'}), 401


@app.route('/logout', methods=['POST'])
def logout():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    session.clear()
    return jsonify({'status': '200'})


@app.route('/')
def home():
    return render_template('index.html', asset_v=Config.aniGamerPlus_version)


@app.route('/monitor')
def monitor():
    return render_template('monitor.html', asset_v=Config.aniGamerPlus_version)


# 內部/衍生欄位: 不屬於使用者設定, 不透過 Dashboard 讀取或寫入
# (config_version/database_version 由程式自行升級管理; working_dir/aniGamerPlus_version/use_gost 是啟動時才計算出的衍生值)
INTERNAL_ONLY_KEYS = {'config_version', 'database_version', 'working_dir', 'aniGamerPlus_version', 'use_gost'}

# 由伺服器端專屬端點管理的欄位: 網頁看得到(會出現在 /data/config.json 與前端的 dataArrays), 但不接受從
# /uploadConfig 寫回——否則使用者在頁面上按「保存」時, 會把頁面載入當下、還沒反映最新值的舊 dataArrays
# 整包送回來, 把之後才透過專屬端點存的新值(例如「略過此版本通知」)蓋掉
SERVER_MANAGED_KEYS = {'skipped_version_tag', 'skipped_prerelease_tag', 'skipped_version_hash',
                        'skipped_prerelease_hash', 'custom_dir_shortcuts'}


def _redact_dashboard_password(web_settings):
    # dashboard.password 跟 dashboard_login_status()(見上方註解「只回傳帳號...絕不回傳密碼」)一樣,
    # 不該透過任何端點以明文回傳給前端——沒有任何表單欄位需要顯示這個值(登入密碼變更走獨立的
    # dashboard_login_save, 一律要求重新輸入), 回傳它只會徒增外洩風險(尤其 BasicAuth 預設關閉時,
    # 這個端點對任何能連到 Dashboard 的人都是開放的)
    if isinstance(web_settings.get('dashboard'), dict) and 'password' in web_settings['dashboard']:
        web_settings = dict(web_settings)
        web_settings['dashboard'] = {k: v for k, v in web_settings['dashboard'].items() if k != 'password'}
    return web_settings


@app.route('/data/config.json', methods=['GET'])
def config():
    settings = Config.read_settings()
    # 過去只回傳 id_list(網頁表單有對應欄位的項目), 導致 dashboard/ftp/coolq_settings 等沒有表單欄位的舊設定
    # 完全無法被「讀取其他版本設定檔」功能比對到; 現在改成整份回傳, 只排除真正的內部/衍生欄位
    web_settings = {k: v for k, v in settings.items() if k not in INTERNAL_ONLY_KEYS}
    web_settings = _redact_dashboard_password(web_settings)

    # bangumi_dir/temp_dir 若目前連不到(網路磁碟離線), read_settings() 回傳的是已經被換成本機預設目錄的值;
    # 網頁表單要顯示「使用者設定的原始值」, 否則表單會顯示成本機路徑, 使用者按下保存就把原設定覆蓋掉了
    for field in ('bangumi_dir', 'temp_dir'):
        if Config.path_fallback_state.get(field + '_unreachable'):
            web_settings[field] = Config.path_fallback_state.get('configured_' + field, '')

    resp = jsonify(web_settings)
    resp.headers['Cache-Control'] = 'no-store'  # 避免瀏覽器快取舊設定, 導致存檔後網頁顯示不同步
    return resp


@app.route('/data/export/sn_list', methods=['GET'])
def export_sn_list():
    # v25.1.8 資料庫整併後新增: 讓改用資料庫儲存後、想放棄使用本客製版的使用者可以匯出回一般純文字檔
    # 透過 <a>/window.location 觸發瀏覽器下載, 不是 AJAX 請求, 故不套用 _reject_non_ajax() 的 CSRF 檢查
    content = Config.get_sn_list_content()
    resp = Response(content, mimetype='text/plain')  # Werkzeug 對 text/* 會自動補上 charset=utf-8, 這裡不需要重複指定
    resp.headers['Content-Disposition'] = 'attachment; filename="sn_list.txt"'
    return resp


@app.route('/data/export/config', methods=['GET'])
def export_config():
    # 同上, 匯出目前資料庫裡的 config.json(排除 INTERNAL_ONLY_KEYS 這些內部/衍生欄位)
    settings = Config.read_settings()
    web_settings = {k: v for k, v in settings.items() if k not in INTERNAL_ONLY_KEYS}
    web_settings = _redact_dashboard_password(web_settings)
    content = json.dumps(web_settings, ensure_ascii=False, indent=4)
    resp = Response(content, mimetype='application/json; charset=utf-8')
    resp.headers['Content-Disposition'] = 'attachment; filename="config.json"'
    return resp


def _reject_non_ajax():
    # CSRF 防護: 拒絕非本站 AJAX 發起的狀態變更請求 (普通表單/圖片/腳本標籤無法附加自定義請求頭)
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        return jsonify({'status': '403', 'message': 'Forbidden'}), 403
    return None


@app.route('/uploadConfig', methods=['POST'])
def recv_config():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    new_settings = Config.read_settings()
    # 逐一比對 id_list 才更新, 過去若 data 缺少某個 id_list 欄位會直接 KeyError; 改成只要 data 有帶這個欄位就更新,
    # 同時也讓「讀取其他版本設定檔」能更新 dashboard/ftp/coolq_settings 等沒有網頁表單、但有帶在 data 裡的欄位
    for key, value in data.items():
        if key in INTERNAL_ONLY_KEYS or key in SERVER_MANAGED_KEYS:
            continue
        new_settings[key] = value  # 更新配置
    Config.sanitize_ja3_akamai_in_settings(new_settings)  # 自動修正 curl_cffi 無法處理的 ja3 擴展編號
    Config.write_settings(new_settings)  # 保存配置
    Config.reset_device_id_cache()  # ja3/akamai 可能被改過, 讓下一次取用裝置ID時重新比對指紋快照
    err_print(0, 'Dashboard', '通過 Web 控制台更新了 config.json', no_sn=True, status=2)
    return '{"status":"200"}'


_manual_task_submit_lock = threading.Lock()  # 序列化 manual_task() 的「檢查是否已在跑」+「佔位標記 running」,
# 避免同一個 sn 快速連點兩次提交/瀏覽器重送同一筆 POST, 在各自的檢查都通過後才輪到佔位, 各自啟動一個下載


@app.route('/manualTask', methods=['POST'])
def manual_task():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if Config.maintenance_mode.is_set():
        return jsonify({'status': '409', 'message': '正在執行「取得當前新番更新時間」「資料庫整頓」「掃描集數」或「重新檢查排程更新」, 暫時無法下達新任務, 請稍後再試'}), 409
    data = json.loads(request.get_data(as_text=True))
    settings = Config.read_settings()

    # 下載清晰度
    if data.get('resolution') not in ('360', '480', '540', '720', '1080'):
        # 如果不是合法清晰度
        resolution = settings['download_resolution']
    else:
        resolution = data['resolution']

    # 下載模式
    if data.get('mode') not in ('single', 'latest', 'all', 'largest-sn', 'range'):
        mode = 'single'
    else:
        mode = data['mode']

    # range 模式(掃描集數後勾選的指定集數)所需的集數標籤清單; 沒帶清單就沒有意義, 退回單集模式
    ep_range = data.get('ep_range') or []
    if mode == 'range' and not ep_range:
        mode = 'single'

    # 下載線程數
    if data.get('thread'):
        try:
            thread = int(data['thread'])
        except (TypeError, ValueError):
            return jsonify({'status': '400', 'message': 'thread 必須是數字'}), 400
    else:
        thread = 1
    if thread > Config.get_max_multi_thread():
        # 是否超過最大允許線程數
        thread_limit = Config.get_max_multi_thread()
    else:
        thread_limit = thread

    # sn 為必填欄位, 缺少的話後續建立任務/寫入暫存紀錄檔都沒有意義, 直接回報 400 而不是讓後面的
    # data['classify']/data['danmu'] 等直接索引在缺欄位時拋出未捕捉的 KeyError、變成通用 500
    sn = data.get('sn')
    if not sn:
        return jsonify({'status': '400', 'message': '缺少 sn 參數'}), 400
    classify = data.get('classify', False)
    danmu = data.get('danmu', False)
    # 重新命名(可空): 原理跟 sn_list.txt 的 <重新命名> 標籤一樣, 留空就用線上解析到的預設番劇名稱,
    # 有填寫則不論下載模式(單話/最新一話/最後一話/全部)或掃描集數後的指定集數下載, 一律套用這個名稱;
    # 本篇/中文配音/特別篇的分類規則不受影響, 是另一套獨立邏輯(Anime.py 內部處理)
    rename = data.get('rename', '') or ''
    # 手動任務暫存紀錄檔: 提交時先記錄, 任務終結(成功/確定放棄)時才移除, 避免意外關機/當機導致任務悄悄遺失
    # 單集類(single/latest/largest-sn)與批次類(all/range)分開存放, 詳見 Config.py 開頭的說明
    task_params = {
        'sn': sn, 'mode': mode, 'resolution': resolution, 'classify': classify,
        'thread': thread, 'danmu': danmu, 'bilingual': data.get('bilingual', False),
        'ep_range': ep_range, 'rename': rename,
    }
    is_single_mode = mode in ('single', 'latest', 'largest-sn')
    # 提交前檢查這個 sn 是否已有同類型手動任務在跑: 不擋的話, 使用者連點兩次提交/瀏覽器重送同一筆 POST 會
    # 各自啟動一個完全獨立的下載, 且後送出的 Config.manual_single_progress[key]/manual_batch_progress[key]
    # 會直接覆蓋掉前一個的 'running' 紀錄(含 cancel 旗標與即時進度), 之後按「終止任務」實際影響到哪一個變得不確定。
    # 「檢查通過」到 cui() 內部真正把這個 key 標記成 running 之間還要經過 SN 解析冷卻等耗時步驟, 光靠原本
    # 的檢查擋不住競態——這裡改成在鎖裡檢查後立刻佔位標記 running, 關閉這段窗口; 稍後
    # _run_manual_single_download()/_run_manual_batch_download() 會用完整的進度紀錄整個覆蓋掉這個 key,
    # 不影響最終顯示內容
    progress_dict = Config.manual_single_progress if is_single_mode else Config.manual_batch_progress
    with _manual_task_submit_lock:
        existing = progress_dict.get(str(sn))
        if existing and existing.get('status') == 'running':
            return jsonify({'status': '409', 'message': '這個 sn 已經有手動任務正在進行中, 請等待完成或先終止後再提交'}), 409
        progress_dict[str(sn)] = {'status': 'running'}
    if is_single_mode:
        Config.add_manual_single_task(sn, task_params)
    else:
        Config.add_manual_batch_task(sn, task_params)

    def run_cui():
        try:
            cui(sn, resolution, mode, thread_limit, ep_range, classify=classify, realtime_show=False,
                cui_danmu=danmu, bilingual=data.get('bilingual', False), rename=rename,
                resize_thread_limiter=False, track_progress=mode in ('single', 'latest', 'largest-sn'))
        finally:
            if mode in ('single', 'latest', 'largest-sn'):
                # 這三種模式 cui() 內部同步下載完才會回傳(不論成功失敗, 含 sys.exit() 的情況也會執行到這裡), 可視為任務終結
                Config.remove_manual_single_task(sn)
            # all/range 模式 cui() 立即回傳(下載在背景執行緒進行), 移除交給 aniGamerPlus.py 的 _cleanup_batch_task_when_done()

    server = threading.Thread(target=run_cui)
    err_print(0, 'Dashboard', '通過 Web 控制台下達了手動任務', no_sn=True, status=2)
    server.start()  # 啓動手動任務線程
    return '{"status":"200"}'


def _maintenance_task_running():
    return (Config.schedule_scan_state.get('status') == 'running'
            or Config.db_cleanup_state.get('status') == 'running'
            or Config.episode_scan_state.get('status') == 'running'
            or Config.full_recheck_state.get('status') in ('running', 'awaiting_confirmation'))


@app.route('/data/schedule_scan/start', methods=['POST'])
def schedule_scan_start():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if _maintenance_task_running():
        return jsonify({'status': '409', 'message': '已有一個「取得當前新番更新時間」「資料庫整頓」「掃描集數」或「重新檢查排程更新」任務正在執行中'}), 409
    task = threading.Thread(target=run_schedule_scan)
    task.daemon = True
    task.start()
    err_print(0, 'Dashboard', '通過 Web 控制台啟動「取得當前新番更新時間」, 暫停自動檢查與新任務排入', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/schedule_scan/status', methods=['GET'])
def schedule_scan_status():
    resp = jsonify(Config.schedule_scan_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/schedule_scan/cancel', methods=['POST'])
def schedule_scan_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    Config.schedule_scan_state['cancel'] = True
    return jsonify({'status': '200'})


@app.route('/data/schedule_scan/apply', methods=['POST'])
def schedule_scan_apply():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    # {"<sn>": {"weekday": "一"~"日", "time": "HH:MM"}, ...} 只需帶想套用的項目, 沒帶的視為跳過
    decisions = json.loads(request.get_data(as_text=True))
    valid_sns = {entry['sn'] for entry in Config.schedule_scan_state.get('results', [])}
    changes = {}
    for sn_str, choice in decisions.items():
        try:
            sn = int(sn_str)
        except ValueError:
            continue
        weekday = choice.get('weekday')
        time_str = choice.get('time')
        if sn not in valid_sns or weekday not in Config.ZH_TO_WEEKDAY:
            continue
        if not re.match(r'^([01]\d|2[0-3]):[0-5]\d$', time_str or ''):
            continue
        changes[sn] = (weekday, time_str)

    new_content = Config.update_sn_list_schedule(changes)
    Config.write_sn_list(new_content)
    err_print(0, 'Dashboard', f'通過 Web 控制台套用新番更新時間排程, 共更新 {len(changes)} 筆', no_sn=True, status=2)
    return jsonify({'status': '200', 'applied': len(changes)})


@app.route('/data/db_cleanup/start', methods=['POST'])
def db_cleanup_start():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if _maintenance_task_running():
        return jsonify({'status': '409', 'message': '已有一個「取得當前新番更新時間」「資料庫整頓」「掃描集數」或「重新檢查排程更新」任務正在執行中'}), 409
    task = threading.Thread(target=run_db_cleanup)
    task.daemon = True
    task.start()
    err_print(0, 'Dashboard', '通過 Web 控制台啟動「資料庫整頓」, 暫停自動檢查與新任務排入', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/db_cleanup/status', methods=['GET'])
def db_cleanup_status():
    resp = jsonify(Config.db_cleanup_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/db_cleanup/cancel', methods=['POST'])
def db_cleanup_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    Config.db_cleanup_state['cancel'] = True
    return jsonify({'status': '200'})


@app.route('/data/db_cleanup/confirm', methods=['POST'])
def db_cleanup_confirm():
    # 掃描只列出候選, 使用者在 Dashboard 勾選要清除的項目後才呼叫這裡真正執行刪除
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if Config.db_cleanup_state.get('status') != 'done':
        return jsonify({'status': '409', 'message': '目前沒有可供確認的資料庫整頓掃描結果'}), 409
    anime_names = request.get_json(silent=True) and request.get_json(silent=True).get('anime_names')
    if not anime_names:
        return jsonify({'status': '400', 'message': '未提供要清除的項目'}), 400
    cleaned = run_db_cleanup_delete(anime_names)
    err_print(0, 'Dashboard', f'通過 Web 控制台確認清除資料庫整頓候選項目, 共 {len(cleaned)} 筆作品', no_sn=True, status=2)
    return jsonify({'status': '200', 'removed': cleaned})


@app.route('/data/episode_scan/start', methods=['POST'])
def episode_scan_start():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if _maintenance_task_running():
        return jsonify({'status': '409', 'message': '已有一個「取得當前新番更新時間」「資料庫整頓」「掃描集數」或「重新檢查排程更新」任務正在執行中'}), 409
    data = json.loads(request.get_data(as_text=True))
    try:
        sn = int(str(data.get('sn', '')).strip())
    except ValueError:
        return jsonify({'status': '400', 'message': '無法從影片鏈接解析出 sn, 請確認網址是否正確'}), 400
    task = threading.Thread(target=run_episode_scan, args=(sn,))
    task.daemon = True
    task.start()
    err_print(0, 'Dashboard', '通過 Web 控制台啟動「掃描集數」(sn=' + str(sn) + '), 暫停自動檢查與新任務排入', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/episode_scan/status', methods=['GET'])
def episode_scan_status():
    resp = jsonify(Config.episode_scan_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/episode_scan/cancel', methods=['POST'])
def episode_scan_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    Config.episode_scan_state['cancel'] = True
    return jsonify({'status': '200'})


@app.route('/data/full_recheck/start', methods=['POST'])
def full_recheck_start():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if _maintenance_task_running():
        return jsonify({'status': '409', 'message': '已有一個「取得當前新番更新時間」「資料庫整頓」「掃描集數」或「重新檢查排程更新」任務正在執行中'}), 409
    data = request.get_json(silent=True) or {}
    sn_filter = data.get('sn_filter') or None
    if sn_filter is not None:
        try:
            sn_filter = [int(x) for x in sn_filter]
        except (TypeError, ValueError):
            return jsonify({'status': '400', 'message': '指定排程清單格式錯誤'}), 400
        if not sn_filter:
            return jsonify({'status': '400', 'message': '請至少選擇一個排程'}), 400
    task = threading.Thread(target=run_full_recheck, args=(sn_filter,))
    task.daemon = True
    task.start()
    label = '檢查指定排程' if sn_filter else '檢查所有排程'
    err_print(0, 'Dashboard', '通過 Web 控制台啟動「重新檢查排程更新」(' + label + '), 暫停自動檢查與新任務排入直到處理完成',
              no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/full_recheck/status', methods=['GET'])
def full_recheck_status():
    resp = jsonify(Config.full_recheck_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/full_recheck/cancel', methods=['POST'])
def full_recheck_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    Config.full_recheck_state['cancel'] = True
    submit_full_recheck_decisions([])  # 若正卡在「等待確認」階段, 送空決定喚醒它, 讓上面的 cancel 旗標能被檢查到並結束
    return jsonify({'status': '200'})


@app.route('/data/full_recheck/confirm', methods=['POST'])
def full_recheck_confirm():
    # 檢查階段只列出候選, 使用者逐項選擇「下載」或「標記為已下載」後才呼叫這裡真正執行(同 db_cleanup 的兩段式流程)
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    decisions = data.get('decisions') or []
    if not submit_full_recheck_decisions(decisions):
        return jsonify({'status': '409', 'message': '目前沒有等待確認的檢查結果(可能已逾時取消)'}), 409
    err_print(0, 'Dashboard', '通過 Web 控制台確認重新檢查排程更新的處理方式, 共 ' + str(len(decisions)) + ' 筆',
              no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/full_recheck/schedule_options', methods=['GET'])
def full_recheck_schedule_options():
    # 供「檢查指定排程」的勾選清單使用; 與 /data/gossip_schedule_options 同樣的資料來源與顯示名稱規則,
    # 額外附上排程模式與自訂排程(星期/時間)方便使用者辨識要檢查哪幾部
    sn_dict = Config.read_sn_list()
    options = []
    for sn, info in sn_dict.items():
        sched = info.get('schedule')
        options.append({
            'sn': sn, 'name': _display_name_for_sn(sn, info), 'tag': info.get('tag') or '',
            'mode': info.get('mode') or '',
            'schedule': ('週' + Config.WEEKDAY_TO_ZH[sched['weekday']] + ' {:02d}:{:02d}'.format(sched['hour'], sched['minute']))
                        if sched else '',
        })
    options.sort(key=lambda o: (o['tag'], o['name']))
    resp = jsonify({'status': '200', 'options': options})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/manual_batch/status', methods=['GET'])
def manual_batch_status():
    # 手動批次任務(下載全部/掃描集數後指定範圍)的進度查詢, 供 Dashboard 輪詢顯示個別集數進度與整體進度
    sn = request.args.get('sn', '')
    resp = jsonify(Config.manual_batch_progress.get(str(sn), {'status': 'not_found'}))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/manual_batch/retry', methods=['POST'])
def manual_batch_retry():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    sn = data.get('sn', '')
    ep_sn = data.get('ep_sn')  # 指定時只重試這一集; 不指定則重試這個批次目前所有失敗的集數
    retried = _retry_manual_batch_failed(sn, ep_sn)
    if not retried:
        return jsonify({'status': '404', 'message': '找不到這個批次任務, 或目前沒有失敗的項目可供重試'}), 404
    err_print(0, 'Dashboard', '通過 Web 控制台重試批次手動任務(sn=' + str(sn) + ')的失敗集數' + (' ep_sn=' + str(ep_sn) if ep_sn else ''), no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/manual_batch/cancel', methods=['POST'])
def manual_batch_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    sn = data.get('sn', '')
    cancelled = _cancel_manual_batch(sn)
    if not cancelled:
        return jsonify({'status': '404', 'message': '找不到這個批次任務'}), 404
    err_print(0, 'Dashboard', '通過 Web 控制台終止批次手動任務(sn=' + str(sn) + ')', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/manual_single/status', methods=['GET'])
def manual_single_status():
    # 單集類手動任務(single/latest/largest-sn)的進度查詢, 供 Dashboard 輪詢顯示進度條, 見
    # aniGamerPlus.py 的 _run_manual_single_download() 與 Config.manual_single_progress 開頭的說明
    sn = request.args.get('sn', '')
    resp = jsonify(Config.manual_single_progress.get(str(sn), {'status': 'not_found'}))
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/manual_single/retry', methods=['POST'])
def manual_single_retry():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    sn = data.get('sn', '')
    retried = _retry_manual_single(sn)
    if not retried:
        return jsonify({'status': '404', 'message': '找不到這個任務, 或目前不是失敗狀態'}), 404
    err_print(0, 'Dashboard', '通過 Web 控制台重試單集手動任務(sn=' + str(sn) + ')', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/manual_single/cancel', methods=['POST'])
def manual_single_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    sn = data.get('sn', '')
    cancelled = _cancel_manual_single(sn)
    if not cancelled:
        return jsonify({'status': '404', 'message': '找不到這個任務'}), 404
    err_print(0, 'Dashboard', '通過 Web 控制台終止單集手動任務(sn=' + str(sn) + ')', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/manual_batch/active', methods=['GET'])
def manual_batch_active():
    # 供「手動添加任務」模態框判斷是否要顯示「顯示目前工作」按鈕: 列出目前所有還在進行中的批次手動任務
    active = [{'sn': sn, 'anime_name': state.get('anime_name', '')}
              for sn, state in Config.manual_batch_progress.items() if state.get('status') == 'running']
    resp = jsonify(active)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/scheduled_priority_status', methods=['GET'])
def scheduled_priority_status():
    # 排程下載插隊告知: 手動批次任務進行中若偵測到排程更新, 會暫停手動任務優先處理, 供 Dashboard 顯示不能關閉的提示
    resp = jsonify({'active': Config.scheduled_priority_active()})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


_SYSTEM_DRIVE = os.path.abspath((os.environ.get('SystemDrive') or 'C:') + '\\')
_DESKTOP_PATH = os.path.join(os.path.expanduser('~'), 'Desktop')
_DOWNLOADS_PATH = os.path.join(os.path.expanduser('~'), 'Downloads')


def _root_listing():
    # 最上層畫面: 只提供「桌面」「下載」捷徑與非系統磁碟機, 不列出系統磁碟機(通常是 C:\, 可能含 Windows/
    # Program Files/其他使用者帳號等機敏目錄, Dashboard 又可能開放外部存取)本身, 也不需要讓使用者多點一層
    # 才能到這兩個大家常把 aniGamerPlus 放的地方
    shortcuts = []
    if os.path.isdir(_DESKTOP_PATH):
        shortcuts.append({'label': '桌面', 'path': _DESKTOP_PATH})
    if os.path.isdir(_DOWNLOADS_PATH):
        shortcuts.append({'label': '下載', 'path': _DOWNLOADS_PATH})
    drives = [d + ':\\' for d in string.ascii_uppercase
              if os.path.exists(d + ':\\') and os.path.normcase(os.path.abspath(d + ':\\')) != os.path.normcase(_SYSTEM_DRIVE)]
    # 使用者自訂的喜好路徑(常見用途是網路路徑, 沒有磁碟機代號可以列出來, 存起來才不用每次手打); 不檢查
    # 是否存在/連得到——連不到只是代表現在點進去會被 browse_dir() 的存在性檢查退回最近的祖先目錄,
    # 而不是直接讓這個捷徑消失, 對離線中的 NAS 來說捷徑本身仍然有意義(等它恢復連線就能直接點進去)
    custom_shortcuts = Config.read_settings().get('custom_dir_shortcuts') or []
    return {'current': '', 'parent': None, 'dirs': [], 'shortcuts': shortcuts, 'drives': drives,
            'custom_shortcuts': custom_shortcuts}


def _is_within(path, base):
    # 正規化後判斷 path 是否等於 base 或在 base 底下: 用路徑分隔界線比對, 避免 "C:\Users\alice2" 這種
    # 只是字串前綴相符、實際上不是子目錄的路徑被誤判成 "C:\Users\alice" 底下。base 若本身就是磁碟機根目錄
    # (例如 "C:\", os.path.abspath 回傳時已經帶結尾反斜線)要特別處理, 不能再疊加一次分隔符號比對。
    path_n = os.path.normcase(os.path.abspath(path))
    base_n = os.path.normcase(os.path.abspath(base))
    if not base_n.endswith(os.sep):
        base_n += os.sep
    return path_n == base_n.rstrip(os.sep) or path_n.startswith(base_n)


def _is_system_drive_path_allowed(path):
    # 系統磁碟機底下只開放 _root_listing() 明確給出的桌面/下載捷徑, 以及使用者自訂捷徑(這兩者的子目錄也算),
    # 其餘一律視為不開放的目錄樹(例如 C:\Windows\System32\config、C:\Users\<其他帳號>)
    if _is_within(path, _DESKTOP_PATH) or _is_within(path, _DOWNLOADS_PATH):
        return True
    custom_shortcuts = Config.read_settings().get('custom_dir_shortcuts') or []
    return any(_is_within(path, shortcut) for shortcut in custom_shortcuts)


def _is_hidden_or_system(full_path):
    # 過濾掉隱藏/系統資料夾(例如 $RECYCLE.BIN、System Volume Information), 這些不是使用者會拿來當下載/暫存目錄的地方
    try:
        attrs = os.stat(full_path).st_file_attributes
    except (OSError, AttributeError):
        return False
    return bool(attrs & 0x2) or bool(attrs & 0x4)  # FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM


@app.route('/data/browse_dir', methods=['GET'])
def browse_dir():
    # 供「下載目錄」「暫存目錄」旁的「瀏覽...」按鈕使用: 網頁瀏覽器基於安全性無法跳出原生資料夾選擇視窗讀取
    # 伺服器端的絕對路徑(尤其 Dashboard 可能被遠端存取, 選的本來就該是執行 aniGamerPlus.exe 那台機器上的路徑),
    # 所以改成列出指定路徑底下的子目錄, 讓前端的目錄瀏覽器 modal 逐層點擊瀏覽
    path = request.args.get('path', '')
    if not path:
        return jsonify(_root_listing())

    requested = os.path.abspath(path)
    path = requested
    fell_back = False

    if not os.path.isdir(path):
        # 路徑不存在(例如下載目錄/暫存目錄還沒建立過、或原本所在的磁碟機已經拔除): 往上找最近一個確實存在的
        # 祖先目錄從那裡開始瀏覽, 比直接跳回最上層畫面更貼近使用者原本想要的位置; 連磁碟機本身都不存在時,
        # 逐層往上會變成空字串, 這時退回最上層畫面
        fell_back = True
        while path and not os.path.isdir(path):
            parent_of_missing = os.path.dirname(path)
            path = '' if parent_of_missing == path else parent_of_missing
        if not path:
            resp = _root_listing()
            resp.update({'fell_back': True, 'requested': requested})
            return jsonify(resp)

    # 安全性限制: 系統磁碟機不開放列出完整目錄樹, 直接當作是要看桌面, 不顯示中間的限制畫面。這裡刻意放在
    # 「往上找存在的祖先目錄」之後再檢查一次: 如果 aniGamerPlus 剛好就直接放在系統磁碟機根目錄下(例如 C:\),
    # 往上找到的祖先目錄可能剛好就是系統磁碟機本身, 沒有再檢查一次的話, 就會把系統磁碟機的完整目錄樹列出來,
    # 完全繞過了這個安全性限制。
    # 限制範圍是「整個系統磁碟機」而不只是磁碟機根目錄本身: 只比對 path 是否恰好等於磁碟機根目錄會漏掉
    # C:\Windows\System32\config、C:\Users\<其他帳號> 這類子目錄(可直接用 ?path= 帶入, 不需要真的逐層點進去),
    # 只有桌面/下載/使用者自訂捷徑(及其子目錄)例外開放。
    if _is_within(path, _SYSTEM_DRIVE) and not _is_system_drive_path_allowed(path):
        path = _DESKTOP_PATH

    try:
        entries = os.listdir(path)
    except OSError as e:
        return jsonify({'message': '讀取這個路徑時發生錯誤: ' + str(e)}), 400

    dirs = sorted(
        name for name in entries
        if os.path.isdir(os.path.join(path, name)) and not _is_hidden_or_system(os.path.join(path, name))
    )
    _, tail = os.path.splitdrive(path)
    if os.path.normcase(path) in (os.path.normcase(_DESKTOP_PATH), os.path.normcase(_DOWNLOADS_PATH)) or tail in ('', '\\', '/'):
        # 桌面/下載本身、或已經在磁碟機根目錄(例如 D:\): 上一層回到最上層畫面(捷徑+磁碟機清單)
        parent = ''
    else:
        parent = os.path.dirname(path)
    resp = {'current': path, 'parent': parent, 'dirs': dirs, 'shortcuts': [], 'drives': [], 'custom_shortcuts': []}
    if fell_back:
        resp.update({'fell_back': True, 'requested': requested})
    return jsonify(resp)


@app.route('/data/custom_dir_shortcut/add', methods=['POST'])
def custom_dir_shortcut_add():
    # 「選擇目錄」瀏覽器裡的「🩷 新增路徑」: 把使用者目前打在路徑輸入框裡的字串存成喜好路徑, 不檢查
    # 是否存在/連得到——這正是網路路徑(NAS 暫時離線)最需要的情境, 不能因為現在連不到就不給存
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    path = (data.get('path') or '').strip()
    if not path:
        return jsonify({'status': '400', 'message': '路徑不能是空的'}), 400
    # 系統磁碟機根目錄本身不能被存成喜好路徑: _is_system_drive_path_allowed() 會把喜好路徑本身及其底下
    # 所有子目錄都視為開放, 存進磁碟機根目錄等於直接讓 browse_dir() 的系統磁碟機限制整個失效, 上方磁碟機
    # 清單本來就能瀏覽到各磁碟機根目錄, 不需要也不應該再讓這個功能繞過限制
    if os.path.normcase(os.path.abspath(path).rstrip(os.sep) + os.sep) == os.path.normcase(_SYSTEM_DRIVE):
        return jsonify({'status': '400', 'message': '不能把磁碟機根目錄本身存成喜好路徑'}), 400
    settings = Config.read_settings()
    shortcuts = settings.get('custom_dir_shortcuts') or []
    if any(os.path.normcase(p) == os.path.normcase(path) for p in shortcuts):
        return jsonify({'status': '400', 'message': '這個路徑已經在喜好清單裡了'}), 400
    shortcuts.append(path)
    settings['custom_dir_shortcuts'] = shortcuts
    Config.write_settings(settings)
    err_print(0, 'Dashboard', '通過 Web 控制台新增喜好路徑: ' + path, no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/custom_dir_shortcut/remove', methods=['POST'])
def custom_dir_shortcut_remove():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    path = data.get('path') or ''
    settings = Config.read_settings()
    shortcuts = settings.get('custom_dir_shortcuts') or []
    remaining = [p for p in shortcuts if os.path.normcase(p) != os.path.normcase(path)]
    if len(remaining) == len(shortcuts):
        return jsonify({'status': '400', 'message': '找不到這個喜好路徑(可能已經被移除過了)'}), 400
    settings['custom_dir_shortcuts'] = remaining
    Config.write_settings(settings)
    err_print(0, 'Dashboard', '通過 Web 控制台移除喜好路徑: ' + path, no_sn=True, status=2)
    return jsonify({'status': '200'})


# ---------------------------------------------------------------------------
# 下載目錄/暫存目錄設定成網路磁碟(UNC 路徑)時, 連不到的可見化與處理選項
# ---------------------------------------------------------------------------

@app.route('/data/path_fallback_status', methods=['GET'])
def path_fallback_status():
    resp = jsonify(Config.path_fallback_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/path_fallback/use_default', methods=['POST'])
def path_fallback_use_default():
    # 「暫時改用本機預設資料夾」: 把該欄位清成空字串, 讓它明確地(而不是被動地)使用 <程式目錄>/bangumi 或 /temp
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    fields = [f for f in (data.get('fields') or []) if f in ('bangumi_dir', 'temp_dir')]
    if not fields:
        return jsonify({'status': '400', 'message': '未指定要改用預設資料夾的欄位'}), 400
    settings = Config.read_settings()
    for field in fields:
        settings[field] = ''
    Config.write_settings(settings)
    err_print(0, 'Dashboard', '通過 Web 控制台將 ' + '/'.join(fields) + ' 改為使用本機預設資料夾', no_sn=True, status=2)
    return jsonify({'status': '200'})


# ---------------------------------------------------------------------------
# 版本更新檢查(過去只印在主控台與 Telegram/Discord, 這裡讓 Dashboard 網頁也能看到結果)
# ---------------------------------------------------------------------------

@app.route('/data/update_check/status', methods=['GET'])
def update_check_status():
    # 回傳目前的檢查結果, 並附上「這個 tag/內容是否已經被使用者略過」讓前端決定要不要自動彈窗。
    # v25.2.2 起「略過」除了比對 tag_name, 還要比對內容雜湊(body_hash)——預告版本常常邊寫邊補內容,
    # tag 沒變但 GitHub 上的說明文字已經被編輯過時, 視為新內容, 重新提示使用者(而不是永遠不再出現)
    settings = Config.read_settings()
    state = Config.update_check_state
    is_prerelease = state.get('is_prerelease')
    skipped_tag = settings.get('skipped_prerelease_tag' if is_prerelease else 'skipped_version_tag', '')
    skipped_hash = settings.get('skipped_prerelease_hash' if is_prerelease else 'skipped_version_hash', '')
    skipped = (bool(state.get('tag_name')) and state.get('tag_name') == skipped_tag and
               state.get('body_hash', '') == skipped_hash)
    resp = jsonify({
        'status': '200',
        'update_available': bool(state.get('update_available')),
        'is_prerelease': bool(is_prerelease),
        'tag_name': state.get('tag_name', ''), 'body': state.get('body', ''),
        'body_html': state.get('body_html', ''),
        'html_url': state.get('html_url', ''), 'checked_at': state.get('checked_at', ''),
        'skipped': skipped,
        'current_version': Config.aniGamerPlus_version,
    })
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/update_check/skip', methods=['POST'])
def update_check_skip():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    tag_name = (data.get('tag_name') or '').strip()
    if not tag_name:
        return jsonify({'status': '400', 'message': '缺少版本 tag'}), 400
    is_prerelease = bool(data.get('is_prerelease'))
    tag_key = 'skipped_prerelease_tag' if is_prerelease else 'skipped_version_tag'
    hash_key = 'skipped_prerelease_hash' if is_prerelease else 'skipped_version_hash'
    settings = Config.read_settings()
    settings[tag_key] = tag_name  # 正式版與預告版各自獨立, 略過其中一種不影響另一種
    # 雜湊一律從伺服器目前的檢查結果取得(不信任前端傳來的值), 確保記住的是「使用者這次實際看到的內容」
    settings[hash_key] = Config.update_check_state.get('body_hash', '')
    Config.write_settings(settings)
    err_print(0, 'Dashboard', '通過 Web 控制台略過版本通知: ' + tag_name, no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/sn_list', methods=['GET'])
def show_sn_list():
    return Config.get_sn_list_content()


@app.route('/data/cookie', methods=['GET'])
def show_cookie():
    return Config.get_cookie_content()


@app.route('/cookie', methods=['POST'])
def set_cookie():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = request.get_data(as_text=True)
    Config.write_cookie_content(data)
    Config.reset_device_id_cache()  # cookie 已更新, 讓下一次取用裝置ID時重新判斷是否需要跟著換新的
    Config.download_failure_counts.clear()  # cookie 已更新, 讓先前因連續失敗被暫停自動重試的項目重新獲得機會
    Config.download_paused_notified.clear()  # 同步清空暫停通知紀錄, 避免同一批項目之後再次暫停時不會通知
    err_print(0, 'Dashboard', '通過 Web 控制台更新了 cookie', no_sn=True, status=2)
    return '{"status":"200"}'


@app.route('/data/quick_fetch/start', methods=['POST'])
def quick_fetch_start():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if Config.quick_fetch_state.get('status') == 'running':
        return jsonify({'status': '409', 'message': '已有一個「快速取得」任務正在執行中'}), 409
    data = json.loads(request.get_data(as_text=True))
    mode = data.get('mode')
    if mode not in ('cookie', 'fingerprint', 'login'):
        return jsonify({'status': '400', 'message': '不明的取得模式'}), 400
    pin = data.get('pin') or None
    task = threading.Thread(target=Config.run_quick_fetch, args=(mode, pin))
    task.daemon = True
    task.start()
    label = {'cookie': 'Cookie', 'fingerprint': 'UA/JA3/Akamai', 'login': '動畫瘋登入自動代填'}[mode]
    err_print(0, 'Dashboard', '通過 Web 控制台啟動「快速取得' + label + '」', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/quick_fetch/status', methods=['GET'])
def quick_fetch_status():
    resp = jsonify(Config.quick_fetch_state)
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/quick_fetch/cancel', methods=['POST'])
def quick_fetch_cancel():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    Config.cancel_quick_fetch()
    return jsonify({'status': '200'})


# ---------------------------------------------------------------------------
# 動畫瘋登入設定(客製強化版獨有功能): 加密儲存帳號密碼/2FA密鑰, 供「快速取得 Cookie」升級成
# 自動代填使用, 只支援 Windows(DPAPI), 實際加解密邏輯全部在 AccountVault.py
# ---------------------------------------------------------------------------

@app.route('/data/account_vault/status', methods=['GET'])
def account_vault_status():
    # 安全, 可直接回給前端: AccountVault.get_status() 保證絕不含 password/totp_secret
    resp = jsonify(AccountVault.get_status())
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/account_vault/save', methods=['POST'])
def account_vault_save():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    if not AccountVault.is_supported():
        return jsonify({'status': '400', 'message': '此功能僅支援 Windows'}), 400
    data = json.loads(request.get_data(as_text=True))
    account = (data.get('account') or '').strip()
    password = data.get('password') or ''
    totp_secret = (data.get('totp_secret') or '').strip() or None
    pin = data.get('pin') or None
    try:
        AccountVault.save_credentials(account, password, totp_secret, pin)
    except ValueError as e:
        return jsonify({'status': '400', 'message': str(e)}), 400
    err_print(0, 'Dashboard', '通過 Web 控制台儲存了動畫瘋登入設定', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/account_vault/delete', methods=['POST'])
def account_vault_delete():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    AccountVault.delete_credentials()
    err_print(0, 'Dashboard', '通過 Web 控制台清除了動畫瘋登入設定', no_sn=True, status=2)
    return jsonify({'status': '200'})


# ---------------------------------------------------------------------------
# aniGamerPlus 自身的 Dashboard 登入帳號密碼(不是動畫瘋帳號, 那個在上面的 AccountVault 區塊)。
# 沿用 config 既有的 dashboard.username / dashboard.password 兩個欄位(明文儲存, 與現況相同);
# 這兩個欄位是巢狀 dict、沒有對應的網頁表單欄位, 不走 id_list 的通用機制, 所以獨立成這兩支端點
# ---------------------------------------------------------------------------

@app.route('/data/dashboard_login/status', methods=['GET'])
def dashboard_login_status():
    # 只回傳帳號(供輸入框預填), 絕不回傳密碼
    settings = Config.read_settings()
    resp = jsonify({'status': '200', 'username': settings['dashboard'].get('username', '')})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/data/dashboard_login/save', methods=['POST'])
def dashboard_login_save():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'status': '400', 'message': '帳號與密碼皆為必填'}), 400
    # dashboard 是巢狀 dict, recv_config() 的通用合併是以「頂層鍵」為單位處理, 這裡改成
    # 讀取 -> 只改這兩個子欄位 -> 寫回的小型讀改寫, 不影響 host/port/SSL/BasicAuth 等其他子欄位
    settings = Config.read_settings()
    settings['dashboard']['username'] = username
    settings['dashboard']['password'] = password
    Config.write_settings(settings)
    err_print(0, 'Dashboard', '通過 Web 控制台更新了 Dashboard 登入帳號密碼', no_sn=True, status=2)
    return jsonify({'status': '200'})


@app.route('/data/notify_test', methods=['POST'])
def notify_test():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    channel = data.get('channel')
    if channel not in ('telegram', 'discord'):
        return jsonify({'status': '400', 'message': '不明的測試管道'}), 400
    override_value = data.get('value') or None
    ok, info = Config.send_test_notification(channel, override_value)
    if ok:
        err_print(0, 'Dashboard', '通過 Web 控制台發送' + channel + '測試訊息成功', no_sn=True, status=2)
        return jsonify({'status': '200', 'message': info})
    return jsonify({'status': '500', 'message': info}), 500


@app.route('/data/telegram_chat_id', methods=['POST'])
def telegram_chat_id():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    override_value = data.get('value') or None
    ok, info = Config.fetch_telegram_chat_id(override_value)
    if ok:
        return jsonify({'status': '200', 'chat_id': info})
    return jsonify({'status': '500', 'message': info}), 500


@app.route('/data/notify_templates', methods=['GET'])
def get_notify_templates():
    return jsonify({'status': '200', 'templates': NotifyDB.get_all_templates()})


@app.route('/data/notify_templates', methods=['POST'])
def post_notify_templates():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    category = data.get('category')
    if category not in NotifyDB.NOTIFY_CATEGORY_TO_TEMPLATE:
        return jsonify({'status': '400', 'message': '不明的通知類別'}), 400
    if data.get('reset'):
        template, template_discord = NotifyDB.reset_template(category)
    else:
        template = data.get('template') or ''
        template_discord = NotifyDB.set_template(category, template)
    err_print(0, 'Dashboard', '通過 Web 控制台更新了通知模板(' + category + ')', no_sn=True, status=2)
    return jsonify({'status': '200', 'template': template, 'template_discord': template_discord})


@app.route('/data/notify_preview', methods=['POST'])
def post_notify_preview():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    category = data.get('category')
    if category not in NotifyDB.NOTIFY_CATEGORY_TO_TEMPLATE:
        return jsonify({'status': '400', 'message': '不明的通知類別'}), 400
    template = data.get('template') or ''
    title = Config.notify_title(NotifyDB.NOTIFY_CATEGORY_TITLE_SUFFIX[category])
    preview = NotifyDB.render_preview(category, template, title)
    return jsonify({
        'status': '200',
        'telegram_html': preview['telegram_html'],
        'discord_html': preview['discord_html'],
        'discord_title': preview['discord_title'],
    })


@app.route('/data/notify_template_test', methods=['POST'])
def post_notify_template_test():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    category = data.get('category')
    ok, message = Config.send_notify_template_test(category)
    err_print(0, 'Dashboard', '通過 Web 控制台測試發送通知模板(' + str(category) + ')', no_sn=True, status=2)
    return jsonify({'status': '200' if ok else '500', 'message': message}), (200 if ok else 500)


@app.route('/data/notify_history', methods=['GET'])
def get_notify_history():
    channel = request.args.get('channel')
    if channel not in ('telegram', 'discord'):
        return jsonify({'status': '400', 'message': '不明的通知管道'}), 400
    category = request.args.get('category') or None
    subcategory = request.args.get('subcategory') or None
    history = NotifyDB.get_history(channel, category=category, subcategory=subcategory)
    return jsonify({'status': '200', 'history': history})


@app.route('/data/notify_history/retry', methods=['POST'])
def post_notify_history_retry():
    # 目前僅支援 Telegram: Discord 的發送歷史沒有存標題(embed 標題另外組成, 見 Config._send_discord_notification),
    # 重試需要另外重建標題, 跟這裡「原封不動重送當初那則訊息」的簡單語意不一致, 之後有需要再獨立處理
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    if data.get('channel') != 'telegram':
        return jsonify({'status': '400', 'message': '目前僅支援 Telegram 手動重試'}), 400
    try:
        history_id = int(data.get('id'))
    except (TypeError, ValueError):
        return jsonify({'status': '400', 'message': '不明的紀錄編號'}), 400
    ok, message = Config.retry_telegram_notification(history_id)
    err_print(0, 'Dashboard', '通過 Web 控制台手動重試 Telegram 通知(history_id=' + str(history_id) + ')',
              no_sn=True, status=2 if ok else 1)
    return jsonify({'status': '200' if ok else '500', 'message': message}), (200 if ok else 500)


# ---------------------------------------------------------------------------
# 隱藏除錯開關(v25.2.3): 不做成一般設定項按鈕, 由 Dashboard「影片檔名前綴」輸入框輸入 toc.icu 並按 Enter 觸發,
# 見 aniGamerPlus.js/Config.toggle_debug_mode()
# ---------------------------------------------------------------------------

@app.route('/data/debug_mode', methods=['GET'])
def get_debug_mode():
    return jsonify({'status': '200', 'enabled': Config.is_debug_mode_enabled()})


@app.route('/data/debug_mode/toggle', methods=['POST'])
def post_debug_mode_toggle():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    enabled = Config.toggle_debug_mode()
    err_print(0, 'Dashboard', '通過隱藏開關切換除錯模式: ' + ('開啟' if enabled else '關閉'), no_sn=True, status=2)
    return jsonify({'status': '200', 'enabled': enabled})


@app.route('/data/placeholder_reference', methods=['GET'])
def get_placeholder_reference():
    return jsonify({'status': '200', 'reference': NotifyDB.get_placeholder_reference()})


# ---------------------------------------------------------------------------
# 公告面板(v25.2.0): 歷史公告/操作處置/機動調整 三個摺疊區塊共用的資料 API
# ---------------------------------------------------------------------------

def _gossip_event_view(ev):
    # 補一個 display_name 給前端直接用: 有比對到追蹤作品就用作品名稱, 否則退回公告裡寫的標題,
    # 再退回原始整句公告文字(例如「無法判斷」且沒有《書名號》標題的公告, 像首播預告)
    display_name = ev.get('name') or ev.get('title_in_gossip') or ev.get('raw_clause')
    return {
        'id': ev['id'], 'processed_at': ev['processed_at'], 'raw_clause': ev['raw_clause'],
        'display_name': display_name, 'sn': ev['sn'], 'match_status': ev['match_status'],
        'status_label': ev['status_label'], 'episode_display': ev['episode_display'],
        'system_suggestion': ev['system_suggestion'], 'disposition': ev['disposition'],
        'disposition_locked': bool(ev['disposition_locked']), 'disposition_applied': bool(ev['disposition_applied']),
        'custom_check_date': ev['custom_check_date'], 'custom_check_time': ev['custom_check_time'],
        'custom_check_time_start': ev['custom_check_time_start'], 'custom_check_time_end': ev['custom_check_time_end'],
        'custom_episode_count': ev['custom_episode_count'], 'target_date': ev['target_date'],
        'target_time': ev['target_time'], 'target_time_start': ev['target_time_start'],
        'target_time_end': ev['target_time_end'],
    }


@app.route('/data/gossip_history', methods=['GET'])
def get_gossip_history():
    try:
        limit = min(int(request.args.get('limit', 200)), 500)
        offset = max(int(request.args.get('offset', 0)), 0)
    except ValueError:
        limit, offset = 200, 0
    rows, total = GossipDB.get_history(limit=limit, offset=offset)
    return jsonify({'status': '200', 'history': [_gossip_event_view(r) for r in rows], 'total': total})


@app.route('/data/gossip_actionable', methods=['GET'])
def get_gossip_actionable():
    today_str = datetime.date.today().isoformat()
    rows = GossipDB.get_actionable(today_str)
    return jsonify({
        'status': '200',
        'actionable': [_gossip_event_view(r) for r in rows],
        'disposition_options': list(GossipDB.DISPOSITION_OPTIONS),
    })


@app.route('/data/gossip_dynamic_schedule', methods=['GET'])
def get_gossip_dynamic_schedule():
    pending = GossipDB.list_pending('pending')
    pending.sort(key=lambda e: (e['check_date'], e['check_time'] or ''), reverse=True)
    return jsonify({'status': '200', 'pending': pending})


@app.route('/data/gossip_schedule_options', methods=['GET'])
def get_gossip_schedule_options():
    # 供「操作處置」畫面「選擇指定排程」下拉選單使用: 列出目前追蹤清單(sn_list.txt)裡的所有作品,
    # 讓公告內容無法自動比對到作品時(match_status='unmatched'), 使用者可以直接手動指定對應哪一部
    sn_dict = Config.read_sn_list()
    options = [{'sn': sn, 'name': _display_name_for_sn(sn, info), 'tag': info.get('tag') or ''}
               for sn, info in sn_dict.items()]
    options.sort(key=lambda o: (o['tag'], o['name']))
    return jsonify({'status': '200', 'options': options})


@app.route('/data/gossip_disposition', methods=['POST'])
def post_gossip_disposition():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = json.loads(request.get_data(as_text=True))
    event_id = data.get('event_id')
    disposition = data.get('disposition')
    manual_sn = data.get('manual_sn')
    if not event_id or disposition not in GossipDB.DISPOSITION_OPTIONS:
        return jsonify({'status': '400', 'message': '缺少子事件編號或處置方式不明'}), 400
    try:
        if manual_sn:
            Gossip.assign_manual_sn(int(event_id), int(manual_sn), Config.read_sn_list())
        Gossip.apply_disposition_for_event(
            int(event_id), disposition,
            custom_check_date=data.get('custom_check_date') or None,
            custom_check_time=data.get('custom_check_time') or None,
            custom_episode_count=data.get('custom_episode_count') or None,
            custom_check_time_start=data.get('custom_check_time_start') or None,
            custom_check_time_end=data.get('custom_check_time_end') or None,
        )
    except ValueError as e:
        return jsonify({'status': '400', 'message': str(e)}), 400
    err_print(0, 'Dashboard', '通過 Web 控制台確認了公告處置(event_id=' + str(event_id) + ', ' + disposition + ')',
              no_sn=True, status=2)
    return jsonify({'status': '200', 'event': _gossip_event_view(GossipDB.get_event(int(event_id)))})


@app.route('/data/get_token', methods=['GET'])
def get_token():
    global websocket_token
    # 生成 32 位隨機字符串作為token
    websocket_token = ''.join(random.sample(string.ascii_letters + string.digits, 32))
    return websocket_token, '200 ok'


@sockets.route('/data/tasks_progress')
def tasks_progress(ws):
    # 鑑權
    global websocket_token
    token = request.args.get('token')
    if token != websocket_token:
        ws.send('Unauthorized')
        ws.close()
    else:
        # 一次性 token
        websocket_token = ''

    # 推送任務進度數據
    # https://blog.csdn.net/sinat_32651363/article/details/87912701
    while not ws.closed:
        msg = json.dumps(Config.tasks_progress_rate)
        try:
            ws.send(msg)
            # 進度條 CSS 過場動畫為 0.3s (layui.css .layui-progress-bar), 推送頻率需比它更快才會感覺流暢
            # 原本每 1s 推送一次, 動畫跑完後有 0.7s 靜止, 造成明顯的「跳一下停一下」卡頓感
            time.sleep(0.3)
        except WebSocketError:
            # 連接中斷
            ws.close()
            break


@app.route('/sn_list', methods=['POST'])
def set_sn_list():
    rejected = _reject_non_ajax()
    if rejected:
        return rejected
    data = request.get_data(as_text=True)
    Config.write_sn_list(data)
    err_print(0, 'Dashboard', '通過 Web 控制台更新了 sn_list', no_sn=True, status=2)
    return '{"status":"200"}'


def run():
    settings = Config.read_settings()  # 讀取配置

    port = settings['dashboard']['port']
    host = settings['dashboard']['host']

    if settings['dashboard']['SSL']:
        # SSL 配置
        ssl_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'sslkey')
        ssl_crt = os.path.join(ssl_path, 'server.crt')
        ssl_key = os.path.join(ssl_path, 'server.key')
        # ssl_keys = (ssl_crt, ssl_key)
        # app.run(use_reloader=False, port=port, host=host, ssl_context=ssl_keys)
        server = WSGIServer((host, port), app, handler_class=WebSocketHandler, certfile=ssl_crt, keyfile=ssl_key)

        wrap_socket = server.wrap_socket
        wrap_socket_and_handle = server.wrap_socket_and_handle

        # 處理一些瀏覽器(比如Chrome)嘗試 SSL v3 訪問時報錯
        def my_wrap_socket(sock, **_kwargs):
            try:
                # print('my_wrap_socket')
                return wrap_socket(sock, **_kwargs)
            except ssl.SSLError:
                # print('my_wrap_socket ssl.SSLError')
                pass

        # 此方法依賴上面的返回值, 因此當嘗試訪問 SSL v3 時, 這個也會出錯
        def my_wrap_socket_and_handle(client_socket, address):
            try:
                # print('my_wrap_socket_and_handle')
                return wrap_socket_and_handle(client_socket, address)
            except AttributeError:
                # print('my_wrap_socket_and_handle AttributeError')
                pass

        server.wrap_socket = my_wrap_socket
        server.wrap_socket_and_handle = my_wrap_socket_and_handle

    else:
        # app.run(use_reloader=False, port=port, host=host)
        server = WSGIServer((host, port), app, handler_class=WebSocketHandler)

    server.serve_forever()


if __name__ == '__main__':
    run()
    pass
