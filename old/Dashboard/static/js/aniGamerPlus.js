var dataArrays; //用戶配置json
var proxy_protocol;
var proxy_ip;
var proxy_port;
var proxy_user = '';
var proxy_passwd = '';
id_list.push('proxy_protocol', 'proxy_ip', 'proxy_port', 'proxy_user', 'proxy_passwd');

$.ajax({
	type: "get",
	url: "data/config.json",
	dataType: "json",
	async: true,
	cache: false,
	success: function(data) {
		dataArrays = data;
		parseProxy(data.proxy);
		$(function (){
			renderJson();
			loadNotifyTemplate();
		});
	}
});

showSnList();
refreshAccountVaultStatus();

// ---------------------------------------------------------------------------
// 隱藏除錯開關(v25.2.3): 不做成一般設定項按鈕, 在「影片檔名前綴」輸入框(customized_video_filename_prefix,
// 只有設定頁 index.html 才有這個欄位, monitor.html 等頁面沒有時 jQuery 選到空集合、以下事件綁定直接安靜無效果)
// 輸入 toc.icu 並按 ESC 觸發切換, 按下當下欄位裡真正打的內容(不是 toc.icu)一律丟棄還原成觸發前的值,
// 不會被誤存成真正的檔名前綴設定。
// 故意不用 Enter: 這個檔案下方有一個 document 層級、capture 階段攔截的全域 Enter 處理器(專門把「文字輸入框
// 按 Enter」導去點擊 [data-enter-submit] 按鈕, 設定頁沒有任何 modal 開著時對應的正是「保存」按鈕), 用的是
// stopImmediatePropagation(), 會在事件到達這裡的 bubble 階段 jQuery 監聽器之前就整個吃掉, 導致這裡永遠收
// 不到那個按鍵、變成每次都直接觸發保存。改用 ESC 則完全不會撞到——同一個檔案下方的全域 ESC 處理器只在「有
// modal 開著」時才會攔截並吃掉事件(用來關閉最上層 modal), 設定頁平常沒有任何 modal 開著, ESC 會正常傳遞到
// 這裡; 如果剛好有提示訊息(modal)開著, ESC 會先被那個全域處理器攔截去關閉提示視窗, 這裡就不會觸發, 這是可
// 接受的例外情況(此時使用者應該會先處理掉提示視窗, 不會同時想切換除錯開關)
// ---------------------------------------------------------------------------
var _originalPageTitle = '';

function applyDebugModeTitle(enabled) {
	var parts = _originalPageTitle.split(' - ');
	if (enabled) {
		parts[0] = '開啟除錯模式';
	}
	document.title = parts.join(' - ');
}

$(function() {
	// 這支 script 在 HTML 裡是在 <title> 標籤之前被載入/執行的(index.html 裡 <script> 排在 <title> 前面),
	// 若在最上層直接讀 document.title 會讀到空字串(瀏覽器解析到 <title> 之前的預設值), 之後拿這個空字串
	// 組回 document.title 會讓分頁標題整個消失、退回顯示網址/IP; 改成放進 $(document).ready 裡讀取,
	// 確保 <title> 標籤這時候一定已經被瀏覽器解析完成
	_originalPageTitle = document.title;
	$.get({ url: '/data/debug_mode', cache: false, success: function(resp) {
		applyDebugModeTitle(resp.enabled);
	}});

	var $prefixInput = $('#customized_video_filename_prefix');
	var valueBeforeEdit = '';
	$prefixInput.on('focus', function() {
		valueBeforeEdit = $(this).val();
	});
	$prefixInput.on('keydown', function(e) {
		if (e.key !== 'Escape' && e.keyCode !== 27) return;
		if ($(this).val() !== 'toc.icu') return;
		e.preventDefault();
		$(this).val(valueBeforeEdit);
		$.ajax({
			url: '/data/debug_mode/toggle',
			type: 'post',
			headers: { "X-Requested-With": "XMLHttpRequest" },
			success: function(resp) {
				applyDebugModeTitle(resp.enabled);
			}
		});
	});
});

$(function() {
	// 每次重新打開手動任務視窗、或使用者改動影片鏈接, 都清空上一次「掃描集數」殘留的勾選結果,
	// 避免鏈接換成別部作品後, 舊的勾選集數(對應到舊作品的 sn)被誤帶入這次提交
	$('#manualTasks').on('show.bs.modal', function() {
		$('#episodeScanResultBody').empty();
		$('#episodeScanResultWrapper').hide();
		refreshActiveManualBatchButton();
	});
	$('#manual_link').on('input', function() {
		$('#episodeScanResultBody').empty();
		$('#episodeScanResultWrapper').hide();
	});
});

var activeManualBatches = [];

function refreshActiveManualBatchButton() {
	// 供「手動添加任務」視窗判斷是否要顯示「顯示目前工作」按鈕: exe 重啟後自動續跑、網頁分頁關掉重開、
	// 或不小心關掉進度視窗, 都能透過這顆按鈕找回背景仍在進行中的批次任務進度
	$.get({ url: '/data/manual_batch/active', cache: false, success: function(list) {
		activeManualBatches = list || [];
		$('#manualBatchShowActiveBtn').toggle(activeManualBatches.length > 0);
	}, error: function() {
		$('#manualBatchShowActiveBtn').hide();
	}});
}

function showActiveManualBatch() {
	if (!activeManualBatches.length) {
		return;
	}
	$('#manualTasks').modal('hide');
	startManualBatchProgress(activeManualBatches[0].sn);
}

function cancelManualBatch() {
	if (!manualBatchCurrentSn) {
		return;
	}
	showConfirm('確定要終止這個批次任務嗎？已經在下載中的集數也會被中止(尚未開始的集數會直接取消)。', function() {
		$.ajax({
			url: '/data/manual_batch/cancel',
			type: 'post',
			contentType: 'application/json',
			data: JSON.stringify({ sn: manualBatchCurrentSn }),
			headers: { "X-Requested-With": "XMLHttpRequest" },
			error: function(xhr) {
				showAlert((xhr.responseJSON && xhr.responseJSON.message) || '終止失敗');
			}
		});
	});
}

// 這個 modal 顯示時把遮罩換成灰色(可稍微看到後面畫面), 跟其他一般 modal 的黑色遮罩區分開來,
// 樣式定義見 aniGamerPlus.css 的 .modal-backdrop.schedule-priority-backdrop; 用 $(function(){...}) 包住,
// 確保綁定時 DOM(此 modal 的 HTML) 已經存在, 跟這個檔案裡其他 modal 事件綁定的寫法一致
$(function() {
	$('#schedulePriorityModal').on('shown.bs.modal', function() {
		$('.modal-backdrop').last().addClass('schedule-priority-backdrop');
	});
});

var schedulePriorityPollTimer = setInterval(pollSchedulePriorityStatus, 2000);

function pollSchedulePriorityStatus() {
	// 全域輪詢(跟手動任務視窗是否開啟無關): 手動任務進行中如果排程檢查偵測到新更新, 會優先處理並暫停手動任務,
	// 這裡跳出不能被使用者關閉的提示, 處理完成後(active 變 false)自動收起, 不需要使用者互動
	$.get({ url: '/data/scheduled_priority_status', cache: false, success: function(state) {
		if (state.active) {
			if (!$('#schedulePriorityModal').hasClass('show')) {
				$('#schedulePriorityModal').modal('show');
			}
		} else {
			$('#schedulePriorityModal').modal('hide');
		}
	}});
}

function parseProxy(proxy) {
	proxy_protocol = proxy.replace(/:\/\/.*/i, '').toUpperCase();
	if (/.*@.*/.test(proxy)) {
		proxy_user = /:\/\/.*?:/g.exec(proxy)[0].replace(/:(\/\/)?/g, '');
		proxy_passwd = /:.*@/.exec(proxy)[0].replace(proxy_user, '')
			.replace(/(:\/\/:)?@?/g, '');
		proxy = proxy.replace(proxy_user + ':' + proxy_passwd + '@', '');
	}
	var tmp = proxy.replace(/.*:\/\//i, '');
	if (proxy.length > 0) {
		proxy_ip = /:.*:/.exec(proxy)[0].replace(/:(\/\/)?/g, '');
		proxy_port = /:\d+/.exec(proxy)[0].replace(/:/, '');
	} else {
		proxy_ip = '';
		proxy_port = '';
	}
	
	dataArrays.proxy_protocol = proxy_protocol;
	dataArrays.proxy_ip = proxy_ip;
	dataArrays.proxy_port = proxy_port;
	dataArrays.proxy_user = proxy_user;
	dataArrays.proxy_passwd = proxy_passwd;
}

function reloadSetting() {
	readJson();
	renderJson();
}

function readJson() {
	$.ajax({
		url: "data/config.json",
		dataType: "json",
		cache: false,
		success: function(data) {
			dataArrays = data;
			parseProxy(data.proxy); // 解析代理配置
		}
	});
}

var QUICK_FETCH_FIELD_SET_PLACEHOLDER = '已設定（如需更換請按下方「快速取得」功能或直接輸入）';

function renderCookieField() {
	// cookie 走獨立的 cookie.txt 儲存機制, 不併入 config.json/id_list, 故獨立於 renderJson() 的迴圈外處理
	// 遮罩顯示方式與 ja3/akamai 一致: 已設定時輸入框留空並顯示提示, 需輸入新值才會覆蓋原值
	var el = $('#cookie');
	if (el.data('default-placeholder') === undefined) {
		el.data('default-placeholder', el.attr('placeholder'));
	}
	$.ajax({
		url: 'data/cookie',
		cache: false,
		success: function(data) {
			el.data('saved', data || '');
			el.val('');
			if (data) {
				el.attr('placeholder', QUICK_FETCH_FIELD_SET_PLACEHOLDER);
			} else {
				el.attr('placeholder', el.data('default-placeholder'));
			}
		}
	});
}

function applyGossipDependencyUI() {
	// 機動調整時間的前提是監視公告要先開啟, 公告保存天數也只有監視公告開啟時才有意義可編輯
	// 注意順序: bootstrapSwitch 停用後 state() 設值會被忽略, 必須先把值強制關掉, 再套用 disabled
	var monitorOn = $('#gossip_monitor').is(':checked');
	if (!monitorOn && $('#gossip_dynamic_schedule').bootstrapSwitch('state')) {
		$('#gossip_dynamic_schedule').bootstrapSwitch('state', false, true);
	}
	$('#gossip_dynamic_schedule').bootstrapSwitch('disabled', !monitorOn);
	$('#gossip_retention_days').prop('disabled', !monitorOn);
}
$(document).on('switchChange.bootstrapSwitch', '#gossip_monitor', applyGossipDependencyUI);

var NOTIFY_CATEGORY_KEYS = [
	'download_manual_success', 'download_manual_failed', 'download_manual_cancelled',
	'download_schedule_success', 'download_schedule_failed',
	'gossip_pause', 'gossip_delay', 'gossip_extra_episode', 'gossip_other',
	'system_cookie_invalid', 'system_device_error', 'system_new_version', 'system_daily_digest',
	'system_path_unreachable'
];

function renderNotifyCategories() {
	// notify_categories 是巢狀 dict, 不在 id_list 裡, 跟 cookie 一樣獨立於 renderJson() 主迴圈外處理
	var categories = dataArrays.notify_categories || {};
	NOTIFY_CATEGORY_KEYS.forEach(function(key) {
		$('#notify_' + key).bootstrapSwitch('state', categories[key] !== false);
	});
}

function renderJson() {
	renderCookieField();
	renderNotifyCategories();
	for (var id of id_list) {
		if (id == 'proxy') continue; //代理設置已被分解
		if (id == 'ja3' || id == 'akamai' || id == 'telebot_token' || id == 'discord_token' || id == 'telebot_chat_id') {
			// 敏感字串(指紋/token/webhook/Chat ID)不直接顯示明文, 已設定時改用 placeholder 提示, 輸入框留空
			var el = $("#" + id);
			if (el.data('default-placeholder') === undefined) {
				el.data('default-placeholder', el.attr('placeholder'));
			}
			el.data('saved', dataArrays[id] || '');
			if (dataArrays[id]) {
				var setText = (id == 'ja3' || id == 'akamai') ? QUICK_FETCH_FIELD_SET_PLACEHOLDER
					: (id == 'telebot_chat_id') ? '已設定'  // 這個欄位是 col-md-4 窄欄位, 放不下較長的提示文字, 只顯示簡短版本
					: '已設定（如需更換請直接輸入新的進行覆蓋）';
				el.val('').attr('placeholder', setText);
			} else {
				el.val('').attr('placeholder', el.data('default-placeholder'));
			}
			continue;
		}
		var idEl = document.getElementById(id);
		if (!idEl) continue;  // 監控頁(monitor.html)等非完整設定頁沒有這些欄位, 跳過避免整個迴圈中斷
		var idType = idEl.type;
		switch (idType) {
			case 'text':
			case 'number':
			case 'password':
				$("#" + id).val(dataArrays[id]);
				break;
			case 'checkbox':
				$("#" + id).bootstrapSwitch('state', dataArrays[id]);
				break;
			case 'select-one':
				if (id == 'proxy_protocol') {
					$("#" + id).selectpicker('val', dataArrays[id].toUpperCase());
				} else if (id == 'default_download_mode') {
					// 選項顯示文字已改成中文(最後/全部/最近), 跟實際存的值(latest/all/largest-sn)不同,
					// 不能再用文字比對, 改用 <option value="..."> 直接比對值(見對應的 HTML 標籤)
					$("#" + id).selectpicker('val', dataArrays[id]);
				} else {
					$("#" + id).find("option:contains('" + dataArrays[id] + "')")
						.prop("selected", true);
					$("#" + id).selectpicker('render');
				}
				break;

		}
	}
	applyGossipDependencyUI();
}


function readSettings() {
	// notify_categories 同樣不在 id_list 裡, 讀取時獨立收集回巢狀 dict
	var notifyCategories = {};
	NOTIFY_CATEGORY_KEYS.forEach(function(key) {
		notifyCategories[key] = $('#notify_' + key).is(':checked');
	});
	dataArrays.notify_categories = notifyCategories;

	// cookie 走獨立的 /cookie 端點寫入 cookie.txt, 不併入下面的 dataArrays/uploadConfig 流程
	// 留空(維持遮罩狀態)視為沿用原本已存的值, 不會發送請求覆蓋原檔案
	var typedCookie = $('#cookie').val();
	if (typedCookie) {
		$.ajax({
			url: '/cookie',
			type: 'post',
			dataType: 'text',
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"X-Requested-With": "XMLHttpRequest"
			},
			contentType: 'text/plain; charset=utf-8',
			data: typedCookie,
			success: function() {
				renderCookieField();
			},
			error: function() {
				$('#uploadOk').hide();
				$('#uploadFailed').show();
				$('#uploadStatus').modal();
			}
		});
	}

	for (var id of id_list) {
		if (id == 'proxy') continue; //代理設置已被分解
		if (id == 'ja3' || id == 'akamai' || id == 'telebot_token' || id == 'discord_token' || id == 'telebot_chat_id') {
			// 輸入框顯示為遮罩狀態, 留空視為沿用原本已存的值, 有輸入新值才覆蓋
			var typed = $("#" + id).val();
			dataArrays[id] = typed ? typed : ($("#" + id).data('saved') || '');
			continue;
		}

		var idType = document.getElementById(id).type;
		switch (idType) {
			case 'number':
				dataArrays[id] = Number($("#" + id).val());
				break;
			case 'text':
			case 'password':
				dataArrays[id] = $("#" + id).val();
				break;
			case 'checkbox':
				dataArrays[id] = $("#" + id).is(":checked");
				break;
			case 'select-one':
				if (id == 'proxy_protocol') {
					dataArrays[id] = $("#proxy_protocol").val().toLowerCase();
				} else if (id == 'download_resolution') {
					dataArrays[id] = $("#download_resolution").val().replace('P', '');
				} else {
					dataArrays[id] = $("#" + id).val();
				}
				break;
		}

		// 合併代理配置
		var a = ['proxy_protocol', 'proxy_ip', 'proxy_port', 'proxy_user', 'proxy_passwd'];
		for (var i in a) {
			var ip_port = dataArrays["proxy_ip"] + ':' + dataArrays["proxy_port"];
			var protocol = dataArrays["proxy_protocol"] + '://';
			if (dataArrays["proxy_user"]?.length * dataArrays["proxy_passwd"]?.length == 0) {
				// 如果沒有用戶密碼
				dataArrays["proxy"] = protocol + ip_port;
			} else {
				// 如果有用戶密碼
				var user_pw = dataArrays["proxy_user"] + ':' + dataArrays["proxy_passwd"] + '@';
				dataArrays["proxy"] = protocol + user_pw + ip_port;
			}

		}
	}

	$.ajax({
		url: '/uploadConfig',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(dataArrays),
		success: function(data) {
			// 向用戶提示提交成功
			$('#uploadOk').show();
			$('#uploadFailed').hide();
			$('#uploadStatus').modal();
			reloadSetting();
		},
		error:function(status){
			// 向用戶提示提交失敗
			$('#uploadOk').hide();
			$('#uploadFailed').show();
			$('#uploadStatus').modal();
		}
	})
}

function doLogout() {
	$.ajax({
		url: '/logout',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			window.location.href = '/login';
		},
		error: function(xhr) {
			// 不要在登出請求實際失敗時還導向登入頁, 否則使用者會誤以為已經登出,
			// 但伺服器端的 session 其實還活著(/login 偵測到仍是登入狀態又會導回主頁, 看起來像「按登出沒反應」)
			showAlert('登出失敗(HTTP ' + xhr.status + ')，session 可能未被清除。如果你是透過反向代理/DDNS 存取，'
				+ '請確認代理有正確轉發 Cookie 與自訂標頭後再試一次。');
		}
	});
}

var quickFetchPollTimer = null;

function startQuickFetch(mode, pin){
	$.ajax({
		url: '/data/quick_fetch/start',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ mode: mode, pin: pin || undefined }),
		success: function() {
			var title = (mode === 'cookie' || mode === 'login') ? '快速取得Cookie' : '快速取得 UA／JA3／Akamai';
			var text;
			if (mode === 'login') {
				text = '已自動嘗試代填帳號/密碼/驗證碼, 請在彈出的瀏覽器視窗中完成頁面驗證並確認登入成功後, 按視窗上的「取得Cookie」按鈕';
			} else if (mode === 'cookie') {
				text = '請在彈出的瀏覽器視窗中登入動畫瘋, 登入完成後按視窗上的「取得Cookie」按鈕';
			} else {
				text = '請等待彈出的瀏覽器視窗載入完成, 再按視窗上的「取得UA、JA3、Akamai」按鈕';
			}
			$('#quickFetchProgressTitle').text(title);
			$('#quickFetchProgressText').text(text);
			$('#quickFetchProgressModal').modal('show');
			quickFetchPollTimer = setInterval(pollQuickFetchStatus, 1000);
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '啟動失敗');
		}
	});
}

function cancelQuickFetch(){
	$.ajax({
		url: '/data/quick_fetch/cancel',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" }
	});
}

function pollQuickFetchStatus(){
	$.get({ url: '/data/quick_fetch/status', cache: false, success: function(state) {
		if (state.status === 'running') {
			return;
		}
		clearInterval(quickFetchPollTimer);
		$('#quickFetchProgressModal').modal('hide');
		if (state.status === 'done') {
			// 填入欄位後直接呼叫 readSettings() 自動儲存, 不用再手動按「保存」——readSettings() 自己會跳出
			// #uploadStatus 的提交結果彈窗, 這裡不再另外彈一層 showAlert()。
			// 副作用(使用者要求下的刻意行為, 不是 bug): 這會把整個表單一起送出保存, 若在按下「快速取得」前
			// 有改到別的欄位但還沒存, 那些改動也會一併生效
			if (state.type === 'cookie') {
				$('#cookie').val(state.value || '');
				readSettings();
			} else if (state.type === 'fingerprint') {
				$('#ua').val(state.ua || '');
				$('#ja3').val(state.ja3 || '');
				$('#akamai').val(state.akamai || '');
				readSettings();
			}
		} else if (state.status === 'cancelled') {
			// 使用者自行取消或關掉瀏覽器視窗, 不需要另外提示
		} else if (state.status === 'error') {
			if (state.error === 'pin_wrong') {
				$('#accountVaultPinPromptError').text('PIN 碼錯誤, 請重新輸入').show();
				$('#accountVaultPinPromptModal').modal('show');
			} else if (state.error === 'pin_required') {
				startAccountVaultLogin();
			} else if (state.error === 'not_configured' || state.error === 'not_supported') {
				openAccountVaultModal();
			} else {
				var msg = state.error === 'browser_not_found'
					? '找不到系統上已安裝的 Chrome 或 Edge 瀏覽器, 請改用手動貼上的方式填寫'
					: ('取得失敗: ' + (state.error || '未知錯誤'));
				showAlert(msg);
			}
		}
	}, error: function() {
		clearInterval(quickFetchPollTimer);
		$('#quickFetchProgressModal').modal('hide');
		showAlert('查詢進度時發生連線錯誤(可能是登入狀態已失效)，請重新整理頁面後確認執行狀況');
	}});
}

// ---------------------------------------------------------------------------
// 動畫瘋登入設定(客製強化版獨有功能): 加密儲存帳號密碼/2FA密鑰, 供「快速取得 Cookie」按鈕升級成
// 自動代填使用, 只支援 Windows(DPAPI), 資料來源見 Dashboard/Server.py 的 /data/account_vault/*
// ---------------------------------------------------------------------------

var accountVaultStatus = { supported: false, configured: false, pin_enabled: false };

function refreshAccountVaultStatus(){
	$.get({ url: 'data/account_vault/status', cache: false, success: function(status){
		accountVaultStatus = status;
		$('#accountVaultSettingsBtn').toggle(!!status.supported);
	}});
}

function openAccountVaultModal(){
	$.get({ url: 'data/account_vault/status', cache: false, success: function(status){
		accountVaultStatus = status;
		$('#accountVaultAccount').val('');
		$('#accountVaultPassword').val('');
		$('#accountVaultTotpSecret').val('');
		$('#accountVaultPin').val('');
		$('#accountVaultPinConfirm').val('');
		$('#accountVaultSaveError').hide();
		if (status.configured) {
			$('#accountVaultCurrentAccount').text(status.account || '');
			$('#accountVaultCurrentInfo').show();
		} else {
			$('#accountVaultCurrentInfo').hide();
		}
		$('#accountVaultPinEnabled').prop('checked', !!status.pin_enabled);
		$('#accountVaultPinFields').toggle(!!status.pin_enabled);
		$('#accountVaultModal').modal('show');
	}});
}

function onAccountVaultPinEnabledChange(){
	$('#accountVaultPinFields').toggle($('#accountVaultPinEnabled').is(':checked'));
}

function saveAccountVault(){
	var account = $('#accountVaultAccount').val().trim();
	var password = $('#accountVaultPassword').val();
	var totpSecret = $('#accountVaultTotpSecret').val().trim();
	var pinEnabled = $('#accountVaultPinEnabled').is(':checked');
	var pin = $('#accountVaultPin').val();
	var pinConfirm = $('#accountVaultPinConfirm').val();

	function showError(msg){
		$('#accountVaultSaveError').text(msg).show();
	}

	if (!account || !password) {
		showError('帳號與密碼為必填');
		return;
	}
	if (pinEnabled) {
		if (!pin) {
			showError('已勾選 PIN 碼保護, 請輸入 PIN 碼');
			return;
		}
		if (pin !== pinConfirm) {
			showError('兩次輸入的 PIN 碼不一致');
			return;
		}
	}

	$.ajax({
		url: 'data/account_vault/save',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({
			account: account, password: password, totp_secret: totpSecret || undefined,
			pin: pinEnabled ? pin : undefined
		}),
		success: function() {
			$('#accountVaultModal').modal('hide');
			refreshAccountVaultStatus();
			showAlert('已儲存動畫瘋登入設定');
		},
		error: function(xhr) {
			showError((xhr.responseJSON && xhr.responseJSON.message) || '儲存失敗');
		}
	});
}

function deleteAccountVault(){
	showConfirm('確定要清除已儲存的動畫瘋登入設定嗎?', function() {
		$.ajax({
			url: 'data/account_vault/delete',
			type: 'post',
			headers: { "X-Requested-With": "XMLHttpRequest" },
			success: function() {
				refreshAccountVaultStatus();
				$('#accountVaultCurrentInfo').hide();
				showAlert('已清除動畫瘋登入設定');
			}
		});
	});
}

function startAccountVaultLogin(){
	// 綁在既有的「Cookie」按鈕上: 尚未設定「動畫瘋登入設定」時, 完全比照原本的手動流程,
	// 不會意外彈出設定視窗打斷使用者; 只有已設定過才會升級成自動代填。
	// 這裡刻意每次點擊都重新查詢一次最新狀態(不直接信任先前快取的 accountVaultStatus), 避免剛儲存完
	// 設定、狀態還沒即時反映就點下 Cookie, 誤判成「尚未設定」而退回舊的手動流程
	$.get({ url: 'data/account_vault/status', cache: false, success: function(status){
		accountVaultStatus = status;
		if (!status.configured) {
			startQuickFetch('cookie');
			return;
		}
		if (status.pin_enabled) {
			$('#accountVaultPinPromptInput').val('');
			$('#accountVaultPinPromptError').hide();
			$('#accountVaultPinPromptModal').modal('show');
		} else {
			startQuickFetch('login');
		}
	}, error: function(){
		// 查詢狀態失敗時保守退回原本手動流程, 不阻擋使用者原有的取得 Cookie 功能
		startQuickFetch('cookie');
	}});
}

function submitAccountVaultPinPrompt(){
	var pin = $('#accountVaultPinPromptInput').val();
	$('#accountVaultPinPromptModal').modal('hide');
	startQuickFetch('login', pin);
}

// ---------------------------------------------------------------------------
// aniGamerPlus 登入設定: 本控制台自身的登入帳號密碼(config 的 dashboard.username/password,
// 不是動畫瘋帳號, 那個是上面的動畫瘋登入設定)。資料來源見 Dashboard/Server.py 的 /data/dashboard_login/*
// ---------------------------------------------------------------------------

function openDashboardLoginModal(){
	$.get({ url: 'data/dashboard_login/status', cache: false, success: function(resp){
		$('#dashboardLoginUsername').val(resp.username || '');
		$('#dashboardLoginPassword').val('');  // 密碼永遠不預填(後端也不會回傳)
		$('#dashboardLoginSaveError').hide();
		$('#dashboardLoginModal').modal('show');
	}, error: function(){
		showAlert('讀取目前登入設定失敗, 請重新整理頁面後再試');
	}});
}

function saveDashboardLoginSettings(){
	var username = $('#dashboardLoginUsername').val().trim();
	var password = $('#dashboardLoginPassword').val();
	if (!username || !password) {
		$('#dashboardLoginSaveError').text('帳號與密碼皆為必填').show();
		return;
	}
	$.ajax({
		url: 'data/dashboard_login/save',
		type: 'post',
		dataType: 'json',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ username: username, password: password }),
		success: function(){
			$('#dashboardLoginModal').modal('hide');
			// 重新抓一次 config.json 更新 dataArrays: 否則之後按「保存」時, readSettings() 會把頁面載入
			// 當下那份(還是舊帳密的) dashboard 物件整包送回 /uploadConfig, 把剛存的帳密蓋回去
			readJson();
			showAlert('已更新 aniGamerPlus 登入帳號密碼, 下次登入請使用新的帳號密碼(目前的登入狀態不受影響)');
		},
		error: function(xhr){
			$('#dashboardLoginSaveError').text((xhr.responseJSON && xhr.responseJSON.message) || '儲存失敗').show();
		}
	});
}

// ---------------------------------------------------------------------------
// 下載目錄/暫存目錄設定成網路磁碟(UNC 路徑)時, 連不到的可見化與處理選項
// 資料來源見 Dashboard/Server.py 的 /data/path_fallback_status、/data/path_fallback/use_default
// ---------------------------------------------------------------------------

var pathFallbackState = null;

function refreshPathFallbackStatus() {
	if (!document.getElementById('pathFallbackAlert')) return;  // monitor.html 沒有這個區塊
	$.get({ url: 'data/path_fallback_status', cache: false, success: function(state) {
		pathFallbackState = state;
		var bad = [];
		if (state.bangumi_dir_unreachable) bad.push('下載目錄「' + state.configured_bangumi_dir + '」');
		if (state.temp_dir_unreachable) bad.push('暫存目錄「' + state.configured_temp_dir + '」');
		if (!bad.length) { $('#pathFallbackAlert').hide(); return; }
		$('#pathFallbackAlertText').text('⚠ ' + bad.join('、') + ' 目前無法存取(網路磁碟未連線?)，已暫時改用程式所在資料夾底下的預設目錄，檔案會下載到本機。');
		$('#pathFallbackAlert').show();
	}});
}
$(function() { refreshPathFallbackStatus(); setInterval(refreshPathFallbackStatus, 60000); });

function openPathFallbackModal() {
	if (!pathFallbackState) return;
	var bad = [];
	if (pathFallbackState.bangumi_dir_unreachable) bad.push('下載目錄「' + pathFallbackState.configured_bangumi_dir + '」');
	if (pathFallbackState.temp_dir_unreachable) bad.push('暫存目錄「' + pathFallbackState.configured_temp_dir + '」');
	$('#pathFallbackModalText').text(bad.join('、') + ' 目前無法存取，請選擇要如何處理：');
	$('#pathFallbackModal').modal('show');
}

function _pathFallbackUnreachableField() {
	// 兩個欄位都連不到時優先處理下載目錄, 暫存目錄留給使用者處理完下載目錄後再開一次這個視窗
	return (pathFallbackState && pathFallbackState.bangumi_dir_unreachable) ? 'bangumi_dir' : 'temp_dir';
}

function pathFallbackGoToSettings() {
	// 「前往修改路徑設定」: 純前端導覽, 展開含有路徑欄位的下載設定摺疊區塊並捲過去讓使用者自己輸入正確路徑
	$('#pathFallbackModal').modal('hide');
	$('#downloadSettingsBody').collapse('show');
	$('#downloadSettingsBody').one('shown.bs.collapse', function() {
		var target = $('#' + _pathFallbackUnreachableField());
		$('html, body').animate({ scrollTop: target.offset().top - 100 }, 300);
		target.focus();
	});
}

function pathFallbackBrowse() {
	// 「暫時改用其他路徑」: 沿用既有的目錄瀏覽器; 選好之後仍要按「保存」才生效, 而且是直接覆寫設定值, 不會自動還原
	$('#pathFallbackModal').modal('hide');
	$('#downloadSettingsBody').collapse('show');
	openDirBrowser(_pathFallbackUnreachableField());
}

function pathFallbackUseDefault() {
	// 「暫時改用本機預設資料夾」: 明確清空成使用 aniGamerPlus.exe 旁邊的預設 bangumi/temp 資料夾
	var fields = [];
	if (pathFallbackState && pathFallbackState.bangumi_dir_unreachable) fields.push('bangumi_dir');
	if (pathFallbackState && pathFallbackState.temp_dir_unreachable) fields.push('temp_dir');
	if (!fields.length) { $('#pathFallbackModal').modal('hide'); return; }
	$.ajax({
		url: 'data/path_fallback/use_default',
		type: 'post',
		dataType: 'json',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ fields: fields }),
		success: function() {
			$('#pathFallbackModal').modal('hide');
			readJson();
			refreshPathFallbackStatus();
			showAlert('已改為使用本機預設資料夾');
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '設定失敗');
		}
	});
}

// ---------------------------------------------------------------------------
// 版本更新檢查(過去只印在主控台與 Telegram/Discord, 這裡讓 Dashboard 網頁也能看到結果並自動彈窗提示)
// 資料來源見 Dashboard/Server.py 的 /data/update_check/status、/data/update_check/skip
// ---------------------------------------------------------------------------

var updateCheckStatus = null;
var _updateCheckAutoShown = false;  // 每次頁面載入最多自動彈一次, 之後只更新導覽列按鈕, 避免使用者關掉後又立刻被彈出來

function refreshUpdateCheckStatus() {
	if (!document.getElementById('updateCheckNavItem')) return;
	$.get({ url: 'data/update_check/status', cache: false, success: function(resp) {
		updateCheckStatus = resp;
		var label = resp.is_prerelease ? '新版本預告' : '有新版本';
		$('#updateCheckNavBtn').text(label);
		$('#updateCheckNavItem').toggle(!!resp.update_available);
		if (resp.update_available && !resp.skipped && !_updateCheckAutoShown) {
			_updateCheckAutoShown = true;
			openUpdateCheckModal();
		}
		if (!resp.update_available) { _updateCheckAutoShown = false; }  // 之後出現更新的版本時可以再自動彈一次
	}});
}
$(function() { refreshUpdateCheckStatus(); setInterval(refreshUpdateCheckStatus, 60000); });

function openUpdateCheckModal() {
	if (!updateCheckStatus || !updateCheckStatus.update_available) return;
	var isPrerelease = updateCheckStatus.is_prerelease;
	$('#updateCheckModalTitle').text(isPrerelease ? '發現新版本預告' : '發現新版本');
	$('#updateCheckCurrentVersion').text(updateCheckStatus.current_version || '');
	$('#updateCheckTagName').text(updateCheckStatus.tag_name || '');
	// body_html 由後端轉換(保留 <details> 摺疊結構), 讓每個項目可以個別收合; 沒有內容時退回純文字提示
	$('#updateCheckBody').html(updateCheckStatus.body_html || '(這個版本沒有提供更新說明)');
	// 「前往 GitHub 下載」只適合正式版; 預告版(pre-release)通常還沒有可下載的建置產物, 改用「查看」措辭
	$('#updateCheckLink').text(isPrerelease ? '前往 GitHub 查看' : '前往 GitHub 下載')
		.attr('href', updateCheckStatus.html_url || '#').toggle(!!updateCheckStatus.html_url);
	$('#updateCheckModal').modal('show');
}

function skipUpdateNotification() {
	if (!updateCheckStatus) return;
	$.ajax({
		url: 'data/update_check/skip',
		type: 'post',
		dataType: 'json',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ tag_name: updateCheckStatus.tag_name, is_prerelease: updateCheckStatus.is_prerelease }),
		success: function() {
			$('#updateCheckModal').modal('hide');
			updateCheckStatus.skipped = true;
			readJson();  // 同步更新 dataArrays, 避免之後按「保存」時把舊的 skipped_* 值送回去蓋掉
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '設定失敗');
		}
	});
}

function showNotifyTestResult(ok, message) {
	if (ok) {
		$('#notifyTestResultOkText').text(message);
		$('#notifyTestResultOk').show();
		$('#notifyTestResultFailed').hide();
	} else {
		$('#notifyTestResultFailedText').text(message);
		$('#notifyTestResultFailed').show();
		$('#notifyTestResultOk').hide();
	}
	$('#notifyTestResultModal').modal();
}

function sendTestNotification(channel){
	// Bot Token/Webhook URL 已設定時輸入框會被遮罩清空(見 renderJson()), 這裡讀到的是使用者「目前打算換成」的新值;
	// 留空就是沿用已儲存的設定值, 交給後端 Config.send_test_notification() 判斷
	var fieldId = channel === 'telegram' ? 'telebot_token' : 'discord_token';
	var typedValue = $('#' + fieldId).val();
	var btn = $('button[onclick="sendTestNotification(\'' + channel + '\')"]');
	btn.prop('disabled', true);
	$.ajax({
		url: '/data/notify_test',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ channel: channel, value: typedValue }),
		complete: function() {
			btn.prop('disabled', false);
		},
		success: function(resp) {
			showNotifyTestResult(true, resp.message || '測試訊息已送出');
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '測試失敗');
		}
	});
}

function fetchTelegramChatId(){
	// 同 sendTestNotification(): 優先用輸入框裡「還沒存檔」的新 token, 留空才用已儲存的
	var typedValue = $('#telebot_token').val();
	var btn = $('button[onclick="fetchTelegramChatId()"]');
	btn.prop('disabled', true);
	$.ajax({
		url: '/data/telegram_chat_id',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ value: typedValue }),
		complete: function() {
			btn.prop('disabled', false);
		},
		success: function(resp) {
			$('#telebot_chat_id').val(resp.chat_id);
			showNotifyTestResult(true, '已取得聊天室ID: ' + resp.chat_id + ', 別忘了按下方「保存」才會生效');
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '取得失敗');
		}
	});
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// 通知模板(NotifyDB.py): 每個通知類別可自訂實際發送的文字內容, 資料存在 aniGamer.db 內,
// 不隨「匯出設定與排程檔」匯出。下方兩個快取(_notifyTemplatesCache/_placeholderReferenceCache)
// 只在本次頁面停留期間有效, 每次重新整理頁面都會重新抓一次最新資料
// ---------------------------------------------------------------------------

var _notifyTemplatesCache = null;
var _placeholderReferenceCache = null;

// 通用字符適用的通知類別(純前端過濾用, 對應 NotifyDB.py 的 PLACEHOLDER_REFERENCE 說明文字), 'all' 代表所有類別皆可用
var TOKEN_APPLICABLE_CATEGORIES = {
	'@animation_name@': ['download_manual_success', 'download_manual_failed', 'download_schedule_success', 'download_schedule_failed',
		'gossip_pause', 'gossip_delay', 'gossip_extra_episode', 'gossip_other'],
	'@download_time@': ['download_manual_success', 'download_manual_failed', 'download_schedule_success', 'download_schedule_failed'],
	'@new_sn_time@': ['download_manual_success', 'download_manual_failed', 'download_schedule_success', 'download_schedule_failed'],
	'@announcement_time@': ['gossip_pause', 'gossip_delay', 'gossip_extra_episode', 'gossip_other'],
	'@postpone_time@': ['gossip_delay'],
	'@finish_time@': 'all',
	'@episode@': ['download_manual_success', 'download_manual_failed', 'download_schedule_success', 'download_schedule_failed'],
	'@file_size@': ['download_manual_success', 'download_schedule_success'],
	'@fail_reason@': ['download_manual_failed', 'download_schedule_failed'],
	'@error_message@': ['system_device_error'],
	'@announcement_text@': ['gossip_pause', 'gossip_delay', 'gossip_extra_episode', 'gossip_other'],
	'@digest_date@': ['system_daily_digest'],
	'@today_schedule_count@': ['system_daily_digest'],
	'@today_schedule_list@': ['system_daily_digest'],
	'@dynamic_adjustment_count@': ['system_daily_digest'],
	'@dynamic_adjustment_list@': ['system_daily_digest'],
	'@path_label@': ['system_path_unreachable'],
	'@configured_path@': ['system_path_unreachable'],
	'@fallback_path@': ['system_path_unreachable'],
};

function loadNotifyTemplate() {
	if (!document.getElementById('notifyTemplateCategory')) return;  // 監控頁(monitor.html)沒有這個區塊
	var category = $('#notifyTemplateCategory').val();
	function render(templates) {
		var info = templates[category];
		$('#notifyTemplateText').val(info.template);
		$('#notifyTemplateDiscordPreview').val(info.template_discord);
		$('#notifyTemplateDefaultBadge').toggle(info.is_default);
		$('#notifyTemplateResetBtn').prop('disabled', info.is_default);
		renderNotifyTemplateTokens(category);
	}
	if (_notifyTemplatesCache) {
		render(_notifyTemplatesCache);
		return;
	}
	$.get('/data/notify_templates', function(resp) {
		_notifyTemplatesCache = resp.templates;
		render(_notifyTemplatesCache);
		renderNotifyTemplateTagHelp();
	});
}

function saveNotifyTemplate() {
	var category = $('#notifyTemplateCategory').val();
	var template = $('#notifyTemplateText').val();
	$.ajax({
		url: '/data/notify_templates',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ category: category, template: template }),
		success: function(resp) {
			if (_notifyTemplatesCache) {
				_notifyTemplatesCache[category] = { template: resp.template, template_discord: resp.template_discord, is_default: false };
			}
			$('#notifyTemplateDiscordPreview').val(resp.template_discord);
			$('#notifyTemplateDefaultBadge').hide();
			$('#notifyTemplateResetBtn').prop('disabled', false);
			showNotifyTestResult(true, '模板已儲存, 立即生效(下方可看到自動轉換好的 Discord 版本)');
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '儲存失敗');
		}
	});
}

function resetNotifyTemplate() {
	var category = $('#notifyTemplateCategory').val();
	$.ajax({
		url: '/data/notify_templates',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ category: category, reset: true }),
		success: function(resp) {
			$('#notifyTemplateText').val(resp.template);
			$('#notifyTemplateDiscordPreview').val(resp.template_discord);
			if (_notifyTemplatesCache) {
				_notifyTemplatesCache[category] = { template: resp.template, template_discord: resp.template_discord, is_default: true };
			}
			$('#notifyTemplateDefaultBadge').show();
			$('#notifyTemplateResetBtn').prop('disabled', true);
			showNotifyTestResult(true, '已恢復為預設模板');
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '恢復失敗');
		}
	});
}

// Telegram HTML 標籤工具列: 把目前選取的文字包上對應標籤(沒有選取文字時, 就插入一組空標籤並把游標停在中間)
var NOTIFY_TEMPLATE_TAGS = {
	'b': { open: '<b>', close: '</b>' },
	'i': { open: '<i>', close: '</i>' },
	'u': { open: '<u>', close: '</u>' },
	's': { open: '<s>', close: '</s>' },
	'code': { open: '<code>', close: '</code>' },
	'pre': { open: '<pre>', close: '</pre>' },
	'blockquote': { open: '<blockquote>', close: '</blockquote>' },
	'blockquote-expandable': { open: '<blockquote expandable>', close: '</blockquote>' },
	'spoiler': { open: '<tg-spoiler>', close: '</tg-spoiler>' },
};

function wrapNotifyTemplateSelection(tagKey) {
	// 注意: 這裡刻意不用 window.prompt() 問網址(部分瀏覽器情境下 prompt() 可能被擋掉或沒反應, 使用者會覺得按鈕
	// 沒作用), 改成統一直接插入/包住標籤, 網址用 https:// 佔位, 跟其他按鈕的行為一致, 使用者自己在輸入框裡改
	var textarea = document.getElementById('notifyTemplateText');
	var start = textarea.selectionStart;
	var end = textarea.selectionEnd;
	var selected = textarea.value.slice(start, end);

	var open, close, selectPlaceholder = false;
	if (tagKey === 'a') {
		open = '<a href="https://">';
		close = '</a>';
		selectPlaceholder = true;  // 插入後直接選取 "https://" 這段, 方便使用者立刻打上真正的網址覆蓋掉它
	} else {
		open = NOTIFY_TEMPLATE_TAGS[tagKey].open;
		close = NOTIFY_TEMPLATE_TAGS[tagKey].close;
	}

	var newValue = textarea.value.slice(0, start) + open + selected + close + textarea.value.slice(end);
	textarea.value = newValue;
	textarea.focus();
	if (selectPlaceholder) {
		var urlStart = start + '<a href="'.length;
		var urlEnd = urlStart + 'https://'.length;
		textarea.setSelectionRange(urlStart, urlEnd);
		return;
	}
	// 沒有選取文字時, 把游標停在開合標籤中間, 方便直接輸入內容
	var cursorPos = selected ? start + open.length + selected.length + close.length : start + open.length;
	textarea.setSelectionRange(cursorPos, cursorPos);
}

// Telegram 格式標籤參考表: 靜態內容, 只需要在頁面載入時渲染一次
var TELEGRAM_HTML_TAGS_HELP = [
	['<b>文字</b>', '粗體', '也可用 <strong>文字</strong>'],
	['<i>文字</i>', '斜體', '也可用 <em>文字</em>'],
	['<u>文字</u>', '底線', '也可用 <ins>文字</ins>'],
	['<s>文字</s>', '刪除線', '也可用 <strike>文字</strike> 或 <del>文字</del>'],
	['<code>文字</code>', '單行程式碼', '適合短片段, 例如指令或變數名稱'],
	['<pre>文字</pre>', '多行程式碼區塊', '保留換行與空白, 不特別標示語言'],
	['<pre><code class="language-python">文字</code></pre>', '指定語言的程式碼區塊', '將 language-python 換成想要的語言名稱即可'],
	['<blockquote>文字</blockquote>', '引用', '整段內縮並標示引用樣式'],
	['<blockquote expandable>文字</blockquote>', '可摺疊引用', '內容需至少 4 行才會顯示收合箭頭(實測結果); 行數不足時 Telegram 只會顯示成一般引用。Discord 沒有對應功能, 轉換後會退化成一般引用'],
	['<a href="網址">文字</a>', '超連結', '把「網址」換成實際連結'],
	['<tg-spoiler>文字</tg-spoiler>', '防劇透(點擊後才顯示)', 'Discord 會轉換成對應的防雷符號'],
];

var _notifyTemplateTagHelpRendered = false;
function renderNotifyTemplateTagHelp() {
	if (_notifyTemplateTagHelpRendered) return;
	var tbody = document.getElementById('notifyTemplateTagHelpBody-table');
	if (!tbody) return;
	var html = TELEGRAM_HTML_TAGS_HELP.map(function(row) {
		return '<tr><td><code>' + escapeHtml(row[0]) + '</code></td><td>' + escapeHtml(row[1]) + '</td><td>' + escapeHtml(row[2]) + '</td></tr>';
	}).join('');
	tbody.innerHTML = html;
	_notifyTemplateTagHelpRendered = true;
}

function openNotifyPreview() {
	var category = $('#notifyTemplateCategory').val();
	var template = $('#notifyTemplateText').val();  // 讀輸入框「目前」的內容, 不用先存檔就能預覽
	$.ajax({
		url: '/data/notify_preview',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ category: category, template: template }),
		success: function(resp) {
			document.getElementById('notifyPreviewTelegramText').innerHTML = resp.telegram_html;
			document.getElementById('notifyPreviewDiscordTitle').textContent = resp.discord_title;
			document.getElementById('notifyPreviewDiscordText').innerHTML = resp.discord_html;
			bindNotifyPreviewSpoilers();
			bindNotifyPreviewExpandableQuotes();
			$('#notifyPreviewModal').modal();
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '預覽失敗');
		}
	});
}

function bindNotifyPreviewSpoilers() {
	// Telegram 的 <tg-spoiler> 跟 Discord 的 ||防雷|| 在真正的 App 裡都是「點一下才顯示」, 這裡模擬同樣的互動,
	// 讓預覽不只是靜態畫面
	document.querySelectorAll('#notifyPreviewTelegramText tg-spoiler').forEach(function(el) {
		el.onclick = function() { el.classList.toggle('revealed'); };
	});
	document.querySelectorAll('#notifyPreviewDiscordText .discord-spoiler-preview').forEach(function(el) {
		el.onclick = function() { el.classList.toggle('revealed'); };
	});
}

function bindNotifyPreviewExpandableQuotes() {
	// 模擬 Telegram 實際的「可摺疊引用」互動: 預設收合只露出前幾行＋右下角向下箭頭, 點擊展開全文並把箭頭轉向上,
	// 再點一次收合回去。跟 NotifyDB.py TELEGRAM_HTML_TAGS_HELP 裡註記的實測結果一致:
	// 內容需至少 4 行才會出現收合箭頭, 不足 4 行時 Telegram 只會顯示成一般引用(這裡就不加互動, 維持原樣)
	document.querySelectorAll('#notifyPreviewTelegramText blockquote[expandable]').forEach(function(bq) {
		var lineCount = bq.textContent.split('\n').length;
		if (lineCount < 4) return;
		bq.classList.add('notify-preview-expandable-quote', 'collapsed');
		var toggle = document.createElement('span');
		toggle.className = 'notify-preview-quote-toggle';
		toggle.innerHTML = '<i class="fas fa-chevron-down"></i>';
		toggle.onclick = function() {
			var collapsed = bq.classList.toggle('collapsed');
			toggle.innerHTML = collapsed ? '<i class="fas fa-chevron-down"></i>' : '<i class="fas fa-chevron-up"></i>';
		};
		bq.appendChild(toggle);
	});
}

function testNotifyTemplate() {
	// 跟「發送測試訊息」(sendTestNotification)不同: 那個測的是輸入框裡的 Token/Webhook 本身有沒有填對,
	// 這裡測的是目前選擇的通知類別「已經儲存」的模板實際發送出去會長什麼樣子(套用範例內容), 兩者互補
	var category = $('#notifyTemplateCategory').val();
	var btn = $('button[onclick="testNotifyTemplate()"]');
	btn.prop('disabled', true);
	$.ajax({
		url: '/data/notify_template_test',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ category: category }),
		complete: function() {
			btn.prop('disabled', false);
		},
		success: function(resp) {
			showNotifyTestResult(true, resp.message);
		},
		error: function(xhr) {
			showNotifyTestResult(false, (xhr.responseJSON && xhr.responseJSON.message) || '測試失敗');
		}
	});
}

function renderNotifyTemplateTokens(category) {
	function render(ref) {
		var applicable = [];
		['placeholder_name', 'placeholder_time', 'placeholder_content'].forEach(function(table) {
			ref[table].forEach(function(row) {
				var cats = TOKEN_APPLICABLE_CATEGORIES[row.token];
				if (cats === 'all' || (cats && cats.indexOf(category) !== -1)) {
					applicable.push(row);
				}
			});
		});
		// 按鈕列跟上方格式標籤工具列同一種操作方式、放在同一個位置(工具列正下方, 固定顯示不摺疊):
		// 按下直接把 token 插入模板輸入框目前的游標位置, 不用自己手打容易拼錯字的 @xxx@ 字串。
		// 按鈕上顯示中文說明(而非 @xxx@ 原始字串)較容易一眼看懂用途, 實際的 token 字串放在 title 提示裡供對照
		var buttonsHtml = applicable.map(function(row) {
			return '<button type="button" class="btn btn-outline-dark btn-sm" title="' + escapeHtml(row.token) + '" onclick="insertNotifyTemplateToken(\'' + row.token + '\')">' + escapeHtml(row.description) + '</button>';
		}).join('');
		$('#notifyTemplateTokenButtons').html(buttonsHtml || '<p class="text-muted small mb-0">此類別沒有適用的通用字符</p>');

		// 摺疊區塊純粹放說明文字(每個字符的用途/適用備註), 用法跟「Telegram 格式標籤說明」一致,
		// 不放按鈕(按鈕已經固定顯示在工具列下方, 這裡摺疊起來不影響操作)
		var tableHtml = applicable.map(function(row) {
			return '<tr><td><code>' + escapeHtml(row.token) + '</code></td><td>' + escapeHtml(row.description) + '</td><td>' + escapeHtml(row.usage) + '</td></tr>';
		}).join('');
		$('#notifyTemplateTokenHelpBody-table').html(tableHtml || '<tr><td colspan="3" class="text-muted">此類別沒有適用的通用字符</td></tr>');
	}
	if (_placeholderReferenceCache) {
		render(_placeholderReferenceCache);
		return;
	}
	$.get('/data/placeholder_reference', function(resp) {
		_placeholderReferenceCache = resp.reference;
		render(_placeholderReferenceCache);
	});
}

function insertNotifyTemplateToken(token) {
	// 沿用 wrapNotifyTemplateSelection() 同一顆輸入框, 但通用字符不用「包住選取文字」, 單純插入游標位置即可
	var textarea = document.getElementById('notifyTemplateText');
	var start = textarea.selectionStart;
	var end = textarea.selectionEnd;
	textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
	textarea.focus();
	var cursorPos = start + token.length;
	textarea.setSelectionRange(cursorPos, cursorPos);
}

// ---------------------------------------------------------------------------
// 通知發送歷史: Telegram/Discord 各自獨立的歷史表, 這裡共用同一個 modal 檢視介面
// ---------------------------------------------------------------------------

var _notifyHistoryChannel = null;

// 主分類(對應 NotifyDB.py 的 TEMPLATE_TABLES 分組) -> 子分類(11 個通知類別)下拉選項
var NOTIFY_HISTORY_SUBCATEGORIES = {
	download: [
		{ value: 'download_manual_success', label: '手動任務-下載完成' },
		{ value: 'download_manual_failed', label: '手動任務-下載失敗' },
		{ value: 'download_schedule_success', label: '排程任務-下載完成' },
		{ value: 'download_schedule_failed', label: '排程任務-下載失敗' },
	],
	announcement: [
		{ value: 'gossip_pause', label: '停止更新通知' },
		{ value: 'gossip_delay', label: '延後更新通知' },
		{ value: 'gossip_extra_episode', label: '臨時加更通知' },
		{ value: 'gossip_other', label: '其他通知' },
	],
	system: [
		{ value: 'system_cookie_invalid', label: 'Cookie失效' },
		{ value: 'system_device_error', label: '裝置驗證異常' },
		{ value: 'system_new_version', label: '新版本可用' },
		{ value: 'system_daily_digest', label: '每日新番通知' },
	],
};

function openNotifyHistory(channel) {
	_notifyHistoryChannel = channel;
	$('#notifyHistoryModalTitle').text((channel === 'telegram' ? 'Telegram' : 'Discord') + ' 發送歷史');
	$('#notifyHistoryCategoryFilter').selectpicker('val', '');
	onNotifyHistoryCategoryChange();
	$('#notifyHistoryModal').modal();
	queryNotifyHistory();
}

function onNotifyHistoryCategoryChange() {
	var group = $('#notifyHistoryCategoryFilter').val();
	var sub = $('#notifyHistorySubcategoryFilter');
	sub.empty();
	sub.append('<option value="">全部</option>');
	(NOTIFY_HISTORY_SUBCATEGORIES[group] || []).forEach(function(item) {
		sub.append('<option value="' + item.value + '">' + item.label + '</option>');
	});
	sub.selectpicker('refresh');
}

function queryNotifyHistory(retryFeedback) {
	// retryFeedback: 手動重試剛送出的結果(見 retryNotifyHistory()), 顯示在清單最上方——故意不用 showAlert()
	// 彈窗, 因為這個查詢視窗本身就是一個 modal, 疊一個新 modal 在上面時 Bootstrap 沒有自動處理堆疊層級,
	// 新彈窗會被蓋在目前這個「發送歷史」視窗底下、使用者看不到(要先關掉歷史視窗才會發現), 直接嵌在清單裡最保險
	var group = $('#notifyHistoryCategoryFilter').val();
	var sub = $('#notifyHistorySubcategoryFilter').val();
	var params = { channel: _notifyHistoryChannel };
	if (group) params.category = group;
	if (sub) params.subcategory = sub;
	$.get('/data/notify_history', params, function(resp) {
		var rows = resp.history;
		var feedbackHtml = retryFeedback
			? '<div class="alert alert-secondary py-1 px-2 mb-2">' + escapeHtml(retryFeedback) + '</div>' : '';
		if (!rows.length) {
			$('#notifyHistoryList').html(feedbackHtml + '<p class="text-muted mb-0">沒有符合條件的紀錄</p>');
			return;
		}
		var html = rows.map(function(row) {
			var badge = row.success ? '<span class="badge badge-success">成功</span>' : '<span class="badge badge-danger">失敗</span>';
			// 手動重試按鈕: 目前只支援 Telegram, 且只在自動重試(見 Config._telegram_send_with_retry)已經
			// 用盡、確定救不回來的 Bad Gateway 失敗紀錄旁邊顯示, 其他失敗原因(設定錯誤等)重試沒有意義
			var canRetry = _notifyHistoryChannel === 'telegram' && !row.success && row.error && row.error.indexOf('Bad Gateway') !== -1;
			var retryBtn = canRetry ? ' <button type="button" class="btn btn-outline-danger btn-sm py-0" onclick="retryNotifyHistory(' + row.id + ', this)">手動重試</button>' : '';
			var errorLine = row.error ? '<br><span class="text-danger small">' + escapeHtml(row.error) + '</span>' + retryBtn : '';
			return '<div class="mb-2 pb-2" style="border-bottom: 1px solid #eee;">'
				+ '<div>' + escapeHtml(row.sent_at) + ' ' + badge + '</div>'
				+ '<div style="white-space: pre-wrap;">' + escapeHtml(row.message) + '</div>'
				+ errorLine
				+ '</div>';
		}).join('');
		$('#notifyHistoryList').html(feedbackHtml + html);
	});
}

function retryNotifyHistory(historyId, btn) {
	var $btn = $(btn);
	$btn.prop('disabled', true).text('重試中...');
	$.ajax({
		url: '/data/notify_history/retry',
		type: 'post',
		dataType: 'json',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ channel: 'telegram', id: historyId }),
		success: function(resp) {
			queryNotifyHistory(resp.message);
		},
		error: function(xhr) {
			queryNotifyHistory((xhr.responseJSON && xhr.responseJSON.message) || '手動重試失敗');
			$btn.prop('disabled', false).text('手動重試');
		}
	});
}

function readManualConfig(){
	var manualData = {};
	var link = $('#manual_link').val();
	if (link.length == 0) {
		showAlert('請輸入影片鏈接！')
	} else {
		var sn = link.replace(/(https:\/\/)?ani\.gamer\.com\.tw\/animeVideo\.php\?sn=/i, '');
		manualData['sn'] = sn;

		var rename = $('#manual_rename').val();
		manualData['rename'] = rename;

		var mode = $("#manual_mode").val();
		// 若「掃描集數」有勾選的項目, 以勾選結果為準, 改用 range 模式取代下拉選單的下載模式
		var checkedEpisodes = $('.episode-scan-choice:checked');
		if (checkedEpisodes.length > 0) {
			mode = 'range';
			manualData['ep_range'] = checkedEpisodes.map(function() {
				return $(this).data('label').toString();
			}).get();
		}
		manualData['mode'] = mode;

		var resolution = $('#manual_resolution').val().replace('P', '');
		manualData['resolution'] = resolution;
		
		var classify = $('#manual_classify').is(":checked");
		manualData['classify'] = classify;
		
		// 手動任務不再有獨立的並發下載數欄位, 統一沿用「下載設定」的「最大並發下載數」(multi-thread);
		// dataArrays 在任何頁面(設定頁/監控頁)載入時都會抓一份, 不依賴當前頁面是否有對應的表單欄位
		manualData['thread'] = dataArrays['multi-thread'];

		var danmu = $('#manual_danmu').is(":checked");
		manualData['danmu'] = danmu;

		var bilingual = $('#manual_bilingual').is(":checked");
		manualData['bilingual'] = bilingual;

		$.ajax({
			url: '/manualTask',
			type: 'post',
			dataType: 'json',
			headers: {
				"Content-Type": "application/json;charset=utf-8",
				"X-Requested-With": "XMLHttpRequest"
			},
			contentType: 'application/json; charset=utf-8',
			data: JSON.stringify(manualData),
			success: function(data) {
				reloadSetting();
				if (mode === 'all' || mode === 'range') {
					// 批次下載(下載全部/指定範圍集數): 開啟進度視窗, 顯示個別集數進度與整體進度, 失敗時可重試
					$('#manualTasks').modal('hide');
					startManualBatchProgress(sn);
				} else {
					// 單集類手動任務(僅本集/最後一集/最近上傳一集): 開啟進度視窗, 顯示下載進度, 失敗時可重試
					$('#manualTasks').modal('hide');
					startManualSingleProgress(sn);
				}
			},
			error:function(status){
				// 向用戶提示提交失敗
				$('#uploadOk').hide();
				$('#uploadFailed').show();
				$('#uploadStatus').modal();
			}
		})
	}

}

var manualBatchPollTimer = null;
var manualBatchCurrentSn = null;
// 必須與 aniGamerPlus.py 的 _MANUAL_BATCH_FAILED_STATUS 完全一致: 只有「重試3次後最終放棄」才會被列進失敗清單,
// 重試過程中的暫時性狀態(例如「失敗! 重啓中」)雖然文字上也帶有「失敗」兩字, 但還在自動重試中, 不算數
var MANUAL_BATCH_FAILED_STATUS = '失敗, 已放棄';

function startManualBatchProgress(sn) {
	manualBatchCurrentSn = sn;
	$('#manualBatchPhaseTitle').text('正在下載...');
	$('#manualBatchProgressBar').css('width', '0%').text('0%');
	$('#manualBatchTaskList').html('<p class="text-muted mb-0">準備中...</p>');
	$('#manualBatchFailedSection').hide();
	$('#manualBatchProgressModal').modal('show');
	if (manualBatchPollTimer) {
		clearInterval(manualBatchPollTimer);
	}
	manualBatchPollTimer = setInterval(pollManualBatchStatus, 1000);
	pollManualBatchStatus();
}

function pollManualBatchStatus() {
	$.get({ url: '/data/manual_batch/status', data: { sn: manualBatchCurrentSn }, cache: false, success: function(state) {
		if (state.status === 'not_found') {
			return;  // 剛送出, 背景協調函式可能還沒建立進度紀錄, 下一輪再試
		}
		renderManualBatchProgress(state);
		if (state.status !== 'running') {
			clearInterval(manualBatchPollTimer);
		}
	}, error: function() {
		clearInterval(manualBatchPollTimer);
	}});
}

function renderManualBatchProgress(state) {
	var tasks = state.tasks || [];
	var animeName = state.anime_name ? '《' + _escapeHtmlAttr(state.anime_name) + '》' : '';
	var failedTasks = tasks.filter(function(t) { return t.status === MANUAL_BATCH_FAILED_STATUS; });
	var cancelledCount = tasks.filter(function(t) { return t.status === '已取消'; }).length;
	if (state.status === 'running') {
		$('#manualBatchPhaseTitle').text('正在下載' + animeName + '...');
	} else {
		var summary = [];
		if (failedTasks.length) summary.push(failedTasks.length + ' 項失敗');
		if (cancelledCount) summary.push(cancelledCount + ' 項已取消');
		$('#manualBatchPhaseTitle').text(animeName + '下載完成' + (summary.length ? '(' + summary.join('，') + ')' : ''));
	}
	var pct = state.total_progress || 0;
	$('#manualBatchProgressBar').css('width', pct + '%').text(pct + '%');

	if (!tasks.length) {
		$('#manualBatchTaskList').html('<p class="text-muted mb-0">準備中...</p>');
	} else {
		var html = '';
		tasks.forEach(function(t) {
			var displayFailed = t.status.indexOf('失敗') === 0;  // 視覺樣式: 重啟中/最終放棄都用紅色提示
			var displayCancelled = t.status === '已取消';
			var barClass = displayFailed ? 'bg-danger' : (displayCancelled ? 'bg-secondary' : 'bg-success');
			var textClass = displayFailed ? 'text-danger' : (displayCancelled ? 'text-muted' : 'text-muted');
			html += '<div class="mb-2">'
				+ '<div class="small">' + _escapeHtmlAttr(t.filename) + '　<span class="' + textClass + '">(' + _escapeHtmlAttr(t.status) + ')</span></div>'
				+ '<div class="progress" style="height: 0.8rem;">'
				+ '<div class="progress-bar ' + barClass + '" role="progressbar" style="width: ' + Math.round(t.rate) + '%;"></div>'
				+ '</div>'
				+ '</div>';
		});
		$('#manualBatchTaskList').html(html);
	}

	// 失敗清單: 只列出重試3次後最終放棄的項目, 個別附上「重試」按鈕(只重試那一項), 旁邊另有「重試所有失敗項目」
	$('#manualBatchFailedSection').toggle(failedTasks.length > 0);
	if (failedTasks.length) {
		$('#manualBatchFailedHeader').text('失敗清單(共 ' + failedTasks.length + ' 項，可捲動查看)：');
		var failedHtml = '';
		failedTasks.forEach(function(t) {
			failedHtml += '<div class="mb-2">'
				+ '<div class="small">' + _escapeHtmlAttr(t.filename)
				+ ' <button type="button" class="btn btn-outline-danger btn-sm py-0 px-1" onclick="retryManualBatchEpisode(' + t.ep_sn + ')">重試</button></div>'
				+ '<div class="progress" style="height: 0.8rem;">'
				+ '<div class="progress-bar bg-danger" role="progressbar" style="width: ' + Math.round(t.rate) + '%;"></div>'
				+ '</div>'
				+ '</div>';
		});
		$('#manualBatchFailedList').html(failedHtml);
	}
}

function retryManualBatchFailed() {
	$.ajax({
		url: '/data/manual_batch/retry',
		type: 'post',
		contentType: 'application/json',
		data: JSON.stringify({ sn: manualBatchCurrentSn }),
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			if (manualBatchPollTimer) {
				clearInterval(manualBatchPollTimer);
			}
			manualBatchPollTimer = setInterval(pollManualBatchStatus, 1000);
			pollManualBatchStatus();
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '重試失敗');
		}
	});
}

function retryManualBatchEpisode(epSn) {
	$.ajax({
		url: '/data/manual_batch/retry',
		type: 'post',
		contentType: 'application/json',
		data: JSON.stringify({ sn: manualBatchCurrentSn, ep_sn: epSn }),
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			if (manualBatchPollTimer) {
				clearInterval(manualBatchPollTimer);
			}
			manualBatchPollTimer = setInterval(pollManualBatchStatus, 1000);
			pollManualBatchStatus();
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '重試失敗');
		}
	});
}

// ---------------------------------------------------------------------------
// 手動單集任務(僅本集/最後一集/最近上傳一集)進度視窗: 比照上面批次任務的做法(startManualBatchProgress 等),
// 但只有一個任務、一個進度條, 資料來源見 Dashboard/Server.py 的 /data/manual_single/status、
// /data/manual_single/retry, 後端狀態見 aniGamerPlus.py 的 Config.manual_single_progress
// ---------------------------------------------------------------------------

var manualSinglePollTimer = null;
var manualSingleCurrentSn = null;

function startManualSingleProgress(sn) {
	manualSingleCurrentSn = sn;
	$('#manualSinglePhaseTitle').text('正在下載...');
	$('#manualSingleFilename').text('');
	$('#manualSingleProgressBar').removeClass('bg-success bg-danger').addClass('bg-primary').css('width', '0%').text('0%');
	$('#manualSingleFailedHint').hide();
	$('#manualSingleRetryBtn').hide();
	$('#manualSingleProgressModal').modal('show');
	if (manualSinglePollTimer) {
		clearInterval(manualSinglePollTimer);
	}
	manualSinglePollTimer = setInterval(pollManualSingleStatus, 1000);
	pollManualSingleStatus();
}

function pollManualSingleStatus() {
	$.get({ url: '/data/manual_single/status', data: { sn: manualSingleCurrentSn }, cache: false, success: function(state) {
		if (state.status === 'not_found') {
			return;  // 剛送出, 背景協調函式可能還沒建立進度紀錄, 下一輪再試
		}
		renderManualSingleProgress(state);
		if (state.status !== 'running') {
			clearInterval(manualSinglePollTimer);
		}
	}, error: function() {
		clearInterval(manualSinglePollTimer);
	}});
}

function renderManualSingleProgress(state) {
	$('#manualSingleFilename').text(state.filename || '');
	var pct = Math.round(state.rate || 0);
	var bar = $('#manualSingleProgressBar');
	bar.css('width', pct + '%').text(pct + '%');

	if (state.status === 'running') {
		$('#manualSinglePhaseTitle').text('正在下載...');
		bar.removeClass('bg-success bg-danger').addClass('bg-primary');
		$('#manualSingleFailedHint').hide();
		$('#manualSingleRetryBtn').hide();
	} else if (state.status === 'done') {
		$('#manualSinglePhaseTitle').text('下載完成');
		bar.removeClass('bg-primary bg-danger').addClass('bg-success');
		$('#manualSingleFailedHint').hide();
		$('#manualSingleRetryBtn').hide();
	} else if (state.status === 'cancelled') {
		$('#manualSinglePhaseTitle').text('已取消');
		bar.removeClass('bg-primary bg-success').addClass('bg-danger');
		$('#manualSingleFailedHint').hide();
		$('#manualSingleRetryBtn').hide();
	} else {
		// failed
		$('#manualSinglePhaseTitle').text('下載失敗');
		bar.removeClass('bg-primary bg-success').addClass('bg-danger');
		$('#manualSingleFailedHint').show();
		$('#manualSingleRetryBtn').show();
	}
}

function cancelManualSingle() {
	// 對應 index.html/monitor.html 進度視窗的「終止任務」按鈕(手動單集任務: 僅本集/最後一集/最近上傳一集)。
	// 後端路由 /data/manual_single/cancel 與 _cancel_manual_single() 一直都存在, 但這支前端函式先前漏寫,
	// 按鈕按下去會直接觸發「cancelManualSingle is not defined」, 在 onclick 內聯處理常式裡靜默失敗、
	// 畫面上完全沒有任何反應——寫法比照批次任務的 cancelManualBatch()
	if (!manualSingleCurrentSn) {
		return;
	}
	showConfirm('確定要終止這個任務嗎？已經在下載中的部分也會被中止。', function() {
		$.ajax({
			url: '/data/manual_single/cancel',
			type: 'post',
			contentType: 'application/json',
			data: JSON.stringify({ sn: manualSingleCurrentSn }),
			headers: { "X-Requested-With": "XMLHttpRequest" },
			error: function(xhr) {
				showAlert((xhr.responseJSON && xhr.responseJSON.message) || '終止失敗');
			}
		});
	});
}

function retryManualSingle() {
	$.ajax({
		url: '/data/manual_single/retry',
		type: 'post',
		contentType: 'application/json',
		data: JSON.stringify({ sn: manualSingleCurrentSn }),
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			$('#manualSingleFailedHint').hide();
			$('#manualSingleRetryBtn').hide();
			if (manualSinglePollTimer) {
				clearInterval(manualSinglePollTimer);
			}
			manualSinglePollTimer = setInterval(pollManualSingleStatus, 1000);
			pollManualSingleStatus();
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '重試失敗');
		}
	});
}

var episodeScanPollTimer = null;
var episodeScanProgressPct = 0;

function triggerEpisodeScan() {
	var link = $('#manual_link').val();
	if (!link) {
		showAlert('請先輸入影片鏈接！');
		return;
	}
	$('#episodeScanConfirmModal').modal('show');
}

function confirmEpisodeScan() {
	var link = $('#manual_link').val();
	var sn = link.replace(/(https:\/\/)?ani\.gamer\.com\.tw\/animeVideo\.php\?sn=/i, '');
	$.ajax({
		url: '/data/episode_scan/start',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ sn: sn }),
		success: function() {
			$('#episodeScanConfirmModal').modal('hide');
			episodeScanProgressPct = 0;
			$('#episodeScanProgressBar').css('width', '0%').text('0%');
			$('#episodeScanCurrentItem').text('準備中...');
			$('#episodeScanProgressModal').modal('show');
			episodeScanPollTimer = setInterval(pollEpisodeScanStatus, 1000);
		},
		error: function(xhr) {
			$('#episodeScanConfirmModal').modal('hide');
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '啟動失敗');
		}
	});
}

function cancelEpisodeScan() {
	$.ajax({
		url: '/data/episode_scan/cancel',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" }
	});
}

function pollEpisodeScanStatus() {
	$.get({ url: '/data/episode_scan/status', cache: false, success: function(state) {
		if (state.status === 'running') {
			// 掃描集數只有單一步驟(取得該作品完整集數清單), 不像多項目掃描有天然的 N/M 進度,
			// 改用時間概略推進做視覺回饋讓使用者知道還在跑, 最多到 90%, 完成時才跳到 100%
			episodeScanProgressPct = Math.min(90, episodeScanProgressPct + 10);
			$('#episodeScanProgressBar').css('width', episodeScanProgressPct + '%').text(episodeScanProgressPct + '%');
			$('#episodeScanCurrentItem').text('正在查詢 sn=' + state.sn + ' 的集數清單...');
			return;
		}
		clearInterval(episodeScanPollTimer);
		$('#episodeScanProgressBar').css('width', '100%').text('100%');
		$('#episodeScanProgressModal').modal('hide');
		if (state.status === 'done') {
			renderEpisodeScanResult(state);
		} else if (state.status === 'cancelled') {
			showAlert('已取消');
		} else if (state.status === 'error') {
			showAlert('掃描失敗: ' + state.error);
		}
	}, error: function() {
		clearInterval(episodeScanPollTimer);
		$('#episodeScanProgressModal').modal('hide');
		showAlert('查詢進度時發生連線錯誤(可能是登入狀態已失效)，請重新整理頁面後確認執行狀況');
	}});
}

function _escapeHtmlAttr(s) {
	return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var _epScanRenderSeq = 0; // 每次重新渲染都遞增, 避免連續掃描多次時摺疊區塊的 id 互相衝突

function renderEpisodeScanResult(state) {
	var groups = state.groups || {};
	var bilingualEnabled = $('#manual_bilingual').is(':checked');
	var renderSeq = ++_epScanRenderSeq;

	// 集數較多時(單一分類 > 20 話)版面會過長導致按不到下方的提交按鈕, 改成每 100 話切一個可摺疊區塊、預設收合
	var COLLAPSE_THRESHOLD = 20;
	var CHUNK_SIZE = 100;

	function renderCheckboxes(title, items, offset) {
		var checkboxesHtml = '';
		items.forEach(function(item, idx) {
			var id = 'epScan_' + renderSeq + '_' + title + '_' + (offset + idx);
			checkboxesHtml += '<div class="form-check" style="display:inline-block; width:20%; min-width:80px;">'
				+ '<input class="form-check-input episode-scan-choice" type="checkbox" data-label="' + _escapeHtmlAttr(item.label) + '" id="' + id + '">'
				+ ' <label class="form-check-label" for="' + id + '">' + _escapeHtmlAttr(item.display) + '</label>'
				+ '</div>';
		});
		return checkboxesHtml;
	}

	function renderGroup(title, items) {
		if (!items || !items.length) return '';
		var groupHtml = '<div class="ep-scan-group" data-group="' + title + '">';
		groupHtml += '<div class="mt-2 mb-1"><strong>' + title + '</strong>（勾選要下載的集數）'
			+ ' <button type="button" class="btn btn-outline-secondary btn-sm ep-scan-select-all" style="padding:0 .4rem;">全選</button>'
			+ ' <button type="button" class="btn btn-outline-secondary btn-sm ep-scan-invert-select" style="padding:0 .4rem;">反選</button>'
			+ ' <button type="button" class="btn btn-outline-secondary btn-sm ep-scan-deselect-all" style="padding:0 .4rem;">取消</button>'
			+ '</div>';

		if (items.length <= COLLAPSE_THRESHOLD) {
			groupHtml += renderCheckboxes(title, items, 0);
			groupHtml += '</div>';
			return groupHtml;
		}

		for (var start = 0; start < items.length; start += CHUNK_SIZE) {
			var chunk = items.slice(start, start + CHUNK_SIZE);
			var chunkId = 'epScanChunk_' + renderSeq + '_' + title + '_' + start;
			var rangeLabel = chunk[0].display + ' ~ ' + chunk[chunk.length - 1].display + '（共 ' + chunk.length + ' 話, 點擊展開）';
			groupHtml += '<div class="card mb-1">'
				+ '<div class="card-header p-2" style="cursor:pointer;" data-toggle="collapse" data-target="#' + chunkId + '">'
				+ rangeLabel
				+ ' <span class="badge badge-success epScanChunkCheckedCount" style="display:none;"></span>'
				+ '</div>'
				+ '<div class="collapse" id="' + chunkId + '"><div class="card-body p-2">'
				+ renderCheckboxes(title, chunk, start)
				+ '</div></div>'
				+ '</div>';
		}
		groupHtml += '</div>';
		return groupHtml;
	}

	var html = '<p><strong>《' + _escapeHtmlAttr(state.anime_name || ('sn=' + state.sn)) + '》</strong> 共找到以下集數:</p>';
	html += renderGroup('本篇', groups.main);
	if (bilingualEnabled) {
		html += renderGroup('中文配音', groups.dub);
	}
	html += renderGroup('特別篇', groups.special);

	if (!groups.main || !groups.main.length) {
		if ((!groups.dub || !groups.dub.length) && (!groups.special || !groups.special.length)) {
			html += '<p class="text-muted">沒有找到任何集數</p>';
		}
	}

	$('#episodeScanResultBody').html(html);
	$('#episodeScanResultWrapper').show();
}

// 摺疊區塊收合時看不到裡面勾了哪些集數, 在標題列加上已勾選數量提示; 綁在容器上做事件委派,
// 這樣不論 renderEpisodeScanResult() 重新渲染幾次都只需要綁一次, 不會重複綁定
$(document).on('change', '#episodeScanResultBody .episode-scan-choice', function() {
	var card = $(this).closest('.card');
	if (!card.length) return;
	var count = card.find('.episode-scan-choice:checked').length;
	var badge = card.find('.epScanChunkCheckedCount');
	if (count > 0) {
		badge.text('已勾選 ' + count).show();
	} else {
		badge.text('').hide();
	}
});

// 全選/反選: 只作用在按鈕所屬的那個分類(本篇/中文配音/特別篇各自獨立), 不影響其他分類已勾選的狀態
$(document).on('click', '#episodeScanResultBody .ep-scan-select-all', function() {
	$(this).closest('.ep-scan-group').find('.episode-scan-choice').prop('checked', true).trigger('change');
});
$(document).on('click', '#episodeScanResultBody .ep-scan-invert-select', function() {
	$(this).closest('.ep-scan-group').find('.episode-scan-choice').each(function() {
		$(this).prop('checked', !$(this).prop('checked'));
	}).trigger('change');
});
$(document).on('click', '#episodeScanResultBody .ep-scan-deselect-all', function() {
	$(this).closest('.ep-scan-group').find('.episode-scan-choice').prop('checked', false).trigger('change');
});

// Shift + 拖曳滑鼠左鍵快速選取: 在勾選框上 Shift+按下滑鼠左鍵決定這次拖曳要「勾選」還是「取消勾選」
// (依第一格目前的狀態反過來決定), 拖曳滑過的每一格都套用同一個結果, 放開左鍵或滑出視窗時結束
var _epScanDragChecking = null;

$(document).on('mousedown', '#episodeScanResultBody .form-check', function(e) {
	if (!e.shiftKey || e.button !== 0) return;
	var checkbox = $(this).find('.episode-scan-choice');
	if (!checkbox.length) return;
	e.preventDefault();  // 避免拖曳時瀏覽器把文字整段反白選取
	_epScanDragChecking = !checkbox.prop('checked');
	checkbox.prop('checked', _epScanDragChecking).trigger('change');
});
$(document).on('mouseenter', '#episodeScanResultBody .form-check', function(e) {
	if (_epScanDragChecking === null) return;
	if (e.buttons !== 1) { _epScanDragChecking = null; return; }  // 左鍵已放開, 結束拖曳
	var checkbox = $(this).find('.episode-scan-choice');
	if (!checkbox.length || checkbox.prop('checked') === _epScanDragChecking) return;
	checkbox.prop('checked', _epScanDragChecking).trigger('change');
});
$(document).on('mouseup', function() {
	_epScanDragChecking = null;
});

var scheduleScanPollTimer = null;

function confirmScheduleScan() {
	$.ajax({
		url: '/data/schedule_scan/start',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			$('#scheduleScanConfirmModal').modal('hide');
			$('#scheduleScanProgressBar').css('width', '0%').text('0%');
			$('#scheduleScanCurrentItem').text('準備中...');
			$('#scheduleScanProgressModal').modal('show');
			scheduleScanPollTimer = setInterval(pollScheduleScanStatus, 1000);
		},
		error: function(xhr) {
			$('#scheduleScanConfirmModal').modal('hide');
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '啟動失敗');
		}
	});
}

function cancelScheduleScan() {
	$.ajax({
		url: '/data/schedule_scan/cancel',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" }
	});
}

function pollScheduleScanStatus() {
	$.get({ url: '/data/schedule_scan/status', cache: false, success: function(state) {
		if (state.status === 'running') {
			var pct = state.total ? Math.round(state.done / state.total * 100) : 0;
			$('#scheduleScanProgressBar').css('width', pct + '%').text(pct + '%');
			$('#scheduleScanCurrentItem').text('正在查詢 (' + state.done + '/' + state.total + '): '
				+ (state.current_title || state.current_sn || ''));
			return;
		}
		clearInterval(scheduleScanPollTimer);
		$('#scheduleScanProgressModal').modal('hide');
		if (state.status === 'done') {
			renderScheduleScanResults(state.results || []);
			$('#scheduleScanResultModal').modal('show');
		} else if (state.status === 'cancelled') {
			showAlert('已取消');
		} else if (state.status === 'error') {
			showAlert('執行時發生錯誤: ' + state.error);
		}
	}, error: function() {
		clearInterval(scheduleScanPollTimer);
		$('#scheduleScanProgressModal').modal('hide');
		showAlert('查詢進度時發生連線錯誤(可能是登入狀態已失效)，請重新整理頁面後確認執行狀況');
	}});
}

var WEEKDAY_OPTIONS = ['一', '二', '三', '四', '五', '六', '日'];

function _scheduleScanRenderItem(r, weekdaySelectOptions) {
	var name = 'choice_' + r.sn;
	var html = '<li class="list-group-item">';
	html += '<div><strong>sn=' + r.sn + (r.anime_name ? ' 《' + r.anime_name + '》' : '') + '</strong></div>';
	html += '<div class="text-muted small">原本設定: '
		+ (r.old_weekday ? ('*' + r.old_weekday + '* $' + r.old_time + '$') : '尚未設定排程') + '</div>';
	if (r.message) {
		html += '<div class="text-muted small">' + r.message + '</div>';
	}

	html += '<div class="mt-2">';
	html += '<div class="form-check">'
		+ '<input class="form-check-input schedule-choice" type="radio" name="' + name + '" value="skip" data-sn="' + r.sn + '" checked>'
		+ ' <label class="form-check-label">跳過, 這次不改</label></div>';

	(r.candidates || []).forEach(function(c, idx) {
		html += '<div class="form-check">'
			+ '<input class="form-check-input schedule-choice" type="radio" name="' + name + '" value="candidate" data-sn="' + r.sn
			+ '" data-weekday="' + c.weekday + '" data-time="' + c.time + '">'
			+ ' <label class="form-check-label">第' + c.episode + '集 上架時間: 星期' + c.weekday + ' ' + c.time
			+ ' (' + c.datetime + ')</label></div>';
	});

	html += '<div class="form-check">'
		+ '<input class="form-check-input schedule-choice" type="radio" name="' + name + '" value="custom" data-sn="' + r.sn + '">'
		+ ' <label class="form-check-label">自訂:'
		+ ' <select class="custom-weekday" data-sn="' + r.sn + '">' + weekdaySelectOptions + '</select>'
		+ ' <input type="text" class="custom-time" data-sn="' + r.sn + '" placeholder="HH:MM" style="width:5em">'
		+ '</label></div>';
	html += '</div></li>';
	return html;
}

function renderScheduleScanResults(results) {
	if (!results.length) {
		$('#scheduleScanResultBody').html('<p>sn_list.txt 目前沒有項目可供分析</p>');
		return;
	}

	var weekdaySelectOptions = WEEKDAY_OPTIONS.map(function(w) { return '<option value="' + w + '">' + w + '</option>'; }).join('');

	// 依「最新一集的上架時段是否跟 sn_list.txt 目前設定的時段一致」分成兩組: 時段不同的才需要使用者決定,
	// 時段相同的本來就不用改(預設就是跳過), 分開放可以不用滑過一堆不需要處理的項目才找到真正要看的那幾筆
	var changed = [];
	var unchanged = [];
	results.forEach(function(r) {
		var latest = (r.candidates || [])[0];
		var isUnchanged = latest && r.old_weekday && latest.weekday === r.old_weekday && latest.time === r.old_time;
		(isUnchanged ? unchanged : changed).push(r);
	});

	var html = '<p class="text-muted">請對每一部作品選擇要套用的時段、自訂時間、或跳過(預設跳過, 不會更動)，最後按下方「套用變更」統一寫回 sn_list.txt。</p>';

	html += '<h6 class="mt-2">時段不同, 需要確認（' + changed.length + ' 部）</h6>';
	if (changed.length) {
		html += '<div style="max-height: 380px; overflow-y: auto;"><ul class="list-group">';
		changed.forEach(function(r) { html += _scheduleScanRenderItem(r, weekdaySelectOptions); });
		html += '</ul></div>';
	} else {
		html += '<p class="text-muted small">沒有偵測到時段變動的作品</p>';
	}

	html += '<h6 class="mt-3">時段相同, 不需修改（' + unchanged.length + ' 部）</h6>';
	if (unchanged.length) {
		html += '<div style="max-height: 220px; overflow-y: auto;"><ul class="list-group">';
		unchanged.forEach(function(r) { html += _scheduleScanRenderItem(r, weekdaySelectOptions); });
		html += '</ul></div>';
	} else {
		html += '<p class="text-muted small">沒有時段相同的作品</p>';
	}

	$('#scheduleScanResultBody').html(html);
}

function applyScheduleScanResults() {
	var decisions = {};
	var invalidSns = [];
	$('.schedule-choice:checked').each(function() {
		var sn = $(this).data('sn');
		var value = $(this).val();
		if (value === 'candidate') {
			decisions[sn] = { weekday: $(this).data('weekday'), time: $(this).data('time') };
		} else if (value === 'custom') {
			var weekday = $('.custom-weekday[data-sn="' + sn + '"]').val();
			var timeStr = $('.custom-time[data-sn="' + sn + '"]').val();
			if (timeStr && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) {
				decisions[sn] = { weekday: weekday, time: timeStr };
			} else {
				invalidSns.push(sn);
			}
		}
	});
	if (invalidSns.length) {
		showAlert('以下 sn 的自訂時間格式不正確(需為 HH:MM)，請修正後再套用: ' + invalidSns.join(', '));
		return;
	}
	$.ajax({
		url: '/data/schedule_scan/apply',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(decisions),
		success: function(data) {
			$('#scheduleScanResultModal').modal('hide');
			showAlert('已套用 ' + data.applied + ' 筆排程變更');
			showSnList();
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '套用失敗');
		}
	});
}

var dbCleanupPollTimer = null;

function confirmDbCleanup() {
	$.ajax({
		url: '/data/db_cleanup/start',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" },
		success: function() {
			$('#dbCleanupConfirmModal').modal('hide');
			$('#dbCleanupProgressBar').css('width', '0%').text('0%');
			$('#dbCleanupCurrentItem').text('準備中...');
			$('#dbCleanupProgressModal').modal('show');
			dbCleanupPollTimer = setInterval(pollDbCleanupStatus, 1000);
		},
		error: function(xhr) {
			$('#dbCleanupConfirmModal').modal('hide');
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '啟動失敗');
		}
	});
}

function cancelDbCleanup() {
	$.ajax({
		url: '/data/db_cleanup/cancel',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" }
	});
}

function pollDbCleanupStatus() {
	$.get({ url: '/data/db_cleanup/status', cache: false, success: function(state) {
		if (state.status === 'running') {
			var pct = state.total ? Math.round(state.done / state.total * 100) : 0;
			$('#dbCleanupProgressBar').css('width', pct + '%').text(pct + '%');
			$('#dbCleanupCurrentItem').text('正在查詢 (' + state.done + '/' + state.total + '): '
				+ (state.current_title || state.current_sn || ''));
			return;
		}
	clearInterval(dbCleanupPollTimer);
		$('#dbCleanupProgressModal').modal('hide');
		if (state.status === 'done') {
			renderDbCleanupCandidates(state.candidates || []);
			$('#dbCleanupResultModal').modal('show');
		} else if (state.status === 'cancelled') {
			showAlert('已取消');
		} else if (state.status === 'error') {
			showAlert('執行時發生錯誤: ' + state.error);
		}
	}, error: function() {
		clearInterval(dbCleanupPollTimer);
		$('#dbCleanupProgressModal').modal('hide');
		showAlert('查詢進度時發生連線錯誤(可能是登入狀態已失效)，請重新整理頁面後確認執行狀況');
	}});
}

function renderDbCleanupCandidates(candidates) {
	var html;
	if (candidates.length) {
		html = '<p>以下作品在資料庫裡有紀錄，但目前 sn_list.txt 已經沒有在追蹤(只影響資料庫紀錄，不會刪除已下載的檔案)。'
			+ '請勾選要清除的項目：</p>';
		html += '<div class="form-check mb-2">'
			+ '<input class="form-check-input" type="checkbox" id="dbCleanupSelectAll">'
			+ ' <label class="form-check-label" for="dbCleanupSelectAll"><strong>全選(共 ' + candidates.length + ' 部)</strong></label>'
			+ '</div>';
		html += '<div style="max-height: 300px; overflow-y: auto; border: 1px solid #dee2e6; border-radius: .25rem; padding: .5rem;">';
		candidates.forEach(function(c, idx) {
			var id = 'dbCleanupChoice_' + idx;
			html += '<div class="form-check">'
				+ '<input class="form-check-input db-cleanup-choice" type="checkbox" data-name="' + _escapeHtmlAttr(c.anime_name) + '" id="' + id + '">'
				+ ' <label class="form-check-label" for="' + id + '">《' + _escapeHtmlAttr(c.anime_name) + '》- '
				+ c.episode_count + ' 筆紀錄</label>'
				+ '</div>';
		});
		html += '</div>';
		$('#dbCleanupConfirmDeleteBtn').show();
	} else {
		html = '<p>沒有找到疑似不再追蹤的舊資料</p>';
		$('#dbCleanupConfirmDeleteBtn').hide();
	}
	$('#dbCleanupResultBody').html(html);
}

// 頂部全選勾選框: 勾選/取消全部個別項目; 個別項目變動時反向同步全選框的勾選/中間(indeterminate)狀態
$(document).on('change', '#dbCleanupSelectAll', function() {
	$('#dbCleanupResultBody .db-cleanup-choice').prop('checked', this.checked);
});
$(document).on('change', '#dbCleanupResultBody .db-cleanup-choice', function() {
	var all = $('#dbCleanupResultBody .db-cleanup-choice');
	var checked = all.filter(':checked');
	var selectAll = $('#dbCleanupSelectAll');
	selectAll.prop('checked', checked.length === all.length);
	selectAll.prop('indeterminate', checked.length > 0 && checked.length < all.length);
});

function confirmDbCleanupDelete() {
	var names = $('#dbCleanupResultBody .db-cleanup-choice:checked').map(function() {
		return $(this).data('name');
	}).get();
	if (!names.length) {
		showAlert('請至少勾選一個要清除的項目');
		return;
	}
	showConfirm('確定要清除已勾選的 ' + names.length + ' 部作品的資料庫紀錄嗎？(不影響已下載的檔案，此動作無法復原)', function() {
		$.ajax({
			url: '/data/db_cleanup/confirm',
			type: 'post',
			contentType: 'application/json',
			data: JSON.stringify({ anime_names: names }),
			headers: { "X-Requested-With": "XMLHttpRequest" },
			success: function(resp) {
				var removed = resp.removed || [];
				var html = '<p>已清除以下項目：</p><ul class="list-group">';
				removed.forEach(function(r) {
					html += '<li class="list-group-item">《' + _escapeHtmlAttr(r.anime_name) + '》- 清除 ' + r.removed_count + ' 筆紀錄</li>';
				});
				html += '</ul>';
				if (removed.length < names.length) {
					html += '<p class="text-warning">部分項目在確認前已被重新加回 sn_list.txt，已自動跳過未刪除</p>';
				}
				$('#dbCleanupResultBody').html(html);
				$('#dbCleanupConfirmDeleteBtn').hide();
			},
			error: function(xhr) {
				showAlert((xhr.responseJSON && xhr.responseJSON.message) || '清除失敗');
			}
		});
	});
}

var fullRecheckPollTimer = null;
var fullRecheckCandidates = [];

function startFullRecheck(snFilter) {
	$.ajax({
		url: '/data/full_recheck/start',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ sn_filter: snFilter || null }),
		success: function() {
			$('#fullRecheckConfirmModal').modal('hide');
			$('#fullRecheckSchedulePickerModal').modal('hide');
			$('#fullRecheckProgressBar').css('width', '0%').text('0%');
			$('#fullRecheckPhaseTitle').text('正在重新檢查排程更新...');
			$('#fullRecheckPhaseText').text('準備中...');
			$('#fullRecheckTaskList').html('<p class="text-muted mb-0">尚未找到需要下載的項目</p>');
			$('#fullRecheckProgressModal').modal('show');
			fullRecheckPollTimer = setInterval(pollFullRecheckStatus, 1000);
		},
		error: function(xhr) {
			$('#fullRecheckConfirmModal').modal('hide');
			$('#fullRecheckSchedulePickerModal').modal('hide');
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '啟動失敗');
		}
	});
}

function openFullRecheckSchedulePicker() {
	$.get({ url: '/data/full_recheck/schedule_options', cache: false, success: function(resp) {
		var options = resp.options || [];
		if (!options.length) { showAlert('目前沒有任何排程項目(sn_list 是空的)'); return; }
		var html = '';
		options.forEach(function(o) {
			var extra = [o.tag, o.mode, o.schedule].filter(function(x) { return x; });
			var suffix = extra.length
				? ('　<span class="text-muted small">(' + extra.map(_escapeHtmlAttr).join(' / ') + ')</span>')
				: '';
			html += '<div class="form-check">'
				+ '<label class="form-check-label">'
				+ '<input type="checkbox" class="form-check-input full-recheck-schedule-choice" value="' + o.sn + '"> '
				+ _escapeHtmlAttr(o.name) + suffix
				+ '</label>'
				+ '</div>';
		});
		$('#fullRecheckSchedulePickerList').html(html);
		$('#fullRecheckConfirmModal').modal('hide');
		$('#fullRecheckSchedulePickerModal').modal('show');
	}, error: function() { showAlert('讀取排程清單失敗'); } });
}

function confirmFullRecheckScheduleSelection() {
	var sns = $('#fullRecheckSchedulePickerList .full-recheck-schedule-choice:checked').map(function() {
		return parseInt($(this).val(), 10);
	}).get();
	if (!sns.length) { showAlert('請至少選擇一個排程'); return; }
	startFullRecheck(sns);
}

// 「檢查指定排程」勾選清單的全選/反選/取消: 沿用「掃描集數」既有的按鈕樣式(ep-scan-group/ep-scan-select-all 等
// class 名稱一致), 但因為容器不在 #episodeScanResultBody 底下, 另外委派一份, 避免動到既有掃描集數的行為
$(document).on('click', '#fullRecheckSchedulePickerGroup .ep-scan-select-all', function() {
	$(this).closest('.ep-scan-group').find('.full-recheck-schedule-choice').prop('checked', true);
});
$(document).on('click', '#fullRecheckSchedulePickerGroup .ep-scan-invert-select', function() {
	$(this).closest('.ep-scan-group').find('.full-recheck-schedule-choice').each(function() {
		$(this).prop('checked', !$(this).prop('checked'));
	});
});
$(document).on('click', '#fullRecheckSchedulePickerGroup .ep-scan-deselect-all', function() {
	$(this).closest('.ep-scan-group').find('.full-recheck-schedule-choice').prop('checked', false);
});

function cancelFullRecheck() {
	$.ajax({
		url: '/data/full_recheck/cancel',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest" }
	});
}

function pollFullRecheckStatus() {
	$.get({ url: '/data/full_recheck/status', cache: false, success: function(state) {
		if (state.status === 'running') {
			renderFullRecheckProgress(state);
			return;
		}
		if (state.status === 'awaiting_confirmation') {
			clearInterval(fullRecheckPollTimer);
			$('#fullRecheckProgressModal').modal('hide');
			renderFullRecheckCandidates(state.candidates || []);
			$('#fullRecheckCandidatesModal').modal('show');
			return;
		}
		clearInterval(fullRecheckPollTimer);
		$('#fullRecheckProgressModal').modal('hide');
		if (state.status === 'done') {
			var count = (state.tasks || []).length;
			var markedCount = (state.marked_done || []).length;
			var msg = [];
			if (count) msg.push('下載 ' + count + ' 個項目');
			if (markedCount) msg.push('標記 ' + markedCount + ' 個項目為已下載');
			showAlert(msg.length ? ('已完成, 共處理: ' + msg.join('、')) : '已完成檢查, 沒有找到任何新更新');
		} else if (state.status === 'cancelled') {
			showAlert('已取消' + (state.error ? '(' + state.error + ')' : '(已在下載中的項目會繼續完成, 不會中斷)'));
		} else if (state.status === 'error') {
			showAlert('執行時發生錯誤: ' + state.error);
		}
	}, error: function() {
		clearInterval(fullRecheckPollTimer);
		$('#fullRecheckProgressModal').modal('hide');
		showAlert('查詢進度時發生連線錯誤(可能是登入狀態已失效)，請重新整理頁面後確認執行狀況');
	}});
}

function renderFullRecheckCandidates(candidates) {
	fullRecheckCandidates = candidates || [];
	if (!fullRecheckCandidates.length) {
		$('#fullRecheckCandidateList').html('<p class="text-muted mb-0">沒有找到任何更新</p>');
		return;
	}
	var html = '';
	fullRecheckCandidates.forEach(function(c) {
		html += '<div class="d-flex justify-content-between align-items-center mb-2 full-recheck-candidate-row" data-ep-sn="' + c.ep_sn + '">'
			+ '<div class="mr-2">' + _escapeHtmlAttr(c.title) + '</div>'
			+ '<select class="form-control form-control-sm full-recheck-candidate-action" style="width: auto; flex: none;">'
			+ '<option value="download" selected>下載</option>'
			+ '<option value="mark_done">標記為已下載</option>'
			+ '</select>'
			+ '</div>';
	});
	$('#fullRecheckCandidateList').html(html);
}

function setAllFullRecheckActions(action) {
	$('#fullRecheckCandidateList .full-recheck-candidate-action').val(action);
}

function confirmFullRecheckDecisions() {
	var decisions = $('#fullRecheckCandidateList .full-recheck-candidate-row').map(function() {
		return { ep_sn: parseInt($(this).data('ep-sn'), 10), action: $(this).find('.full-recheck-candidate-action').val() };
	}).get();
	$.ajax({
		url: '/data/full_recheck/confirm',
		type: 'post',
		headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json;charset=utf-8" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ decisions: decisions }),
		success: function() {
			$('#fullRecheckCandidatesModal').modal('hide');
			$('#fullRecheckProgressBar').css('width', '0%').text('0%');
			$('#fullRecheckPhaseTitle').text('正在下載找到的更新...');
			$('#fullRecheckPhaseText').text('準備中...');
			$('#fullRecheckTaskList').html('<p class="text-muted mb-0">尚未找到需要下載的項目</p>');
			$('#fullRecheckProgressModal').modal('show');
			fullRecheckPollTimer = setInterval(pollFullRecheckStatus, 1000);
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '確認失敗');
		}
	});
}

function renderFullRecheckProgress(state) {
	var pct;
	if (state.phase === 'checking') {
		$('#fullRecheckPhaseTitle').text('正在檢查排程是否有更新...');
		pct = state.total_sn ? Math.round(state.checked_sn / state.total_sn * 100) : 0;
		$('#fullRecheckPhaseText').text('正在檢查 (' + state.checked_sn + '/' + state.total_sn + '): sn=' + (state.current_sn == null ? '' : state.current_sn));
	} else {
		$('#fullRecheckPhaseTitle').text('正在下載找到的更新...');
		pct = state.total_progress || 0;
		$('#fullRecheckPhaseText').text('下載進度: ' + pct + '%（共 ' + (state.tasks || []).length + ' 個項目）');
	}
	$('#fullRecheckProgressBar').css('width', pct + '%').text(pct + '%');
	renderFullRecheckTasks(state.tasks || []);
}

function renderFullRecheckTasks(tasks) {
	if (!tasks.length) {
		$('#fullRecheckTaskList').html('<p class="text-muted mb-0">尚未找到需要下載的項目</p>');
		return;
	}
	var html = '';
	tasks.forEach(function(t) {
		html += '<div class="mb-2">'
			+ '<div class="small">' + _escapeHtmlAttr(t.filename) + '　<span class="text-muted">(' + _escapeHtmlAttr(t.status) + ')</span></div>'
			+ '<div class="progress" style="height: 0.8rem;">'
			+ '<div class="progress-bar bg-success" role="progressbar" style="width: ' + Math.round(t.rate) + '%;"></div>'
			+ '</div>'
			+ '</div>';
	});
	$('#fullRecheckTaskList').html(html);
}

function postSnList(){
	var sn_list = $('#sn_list').val();
	
	$.ajax({
		url: '/sn_list',
		type: 'post',
		dataType: 'text',
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'text/plain; charset=utf-8',
		data: sn_list,
		success: function(data) {
			// 向用戶提示提交成功
			$('#uploadOk').show();
			$('#uploadFailed').hide();
			$('#uploadStatus').modal();
			showSnList();
		},
		error:function(status){
			// 向用戶提示提交失敗
			$('#uploadOk').hide();
			$('#uploadFailed').show();
			$('#uploadStatus').modal();
		}
	})
}

function showSnList(){
	$.get("data/sn_list", function(data) {
		$("#sn_list").val(data);
	})
}

function confirmExportConfigFiles(){
	// v25.1.8 資料庫整併後新增: 從資料庫重建 sn_list.txt / config.json 讓瀏覽器下載, 供不想繼續使用本客製版
	// (資料庫儲存)的使用者匯出成一般純文字檔; 確認提示已改成頁面內的 #exportConfigConfirmModal, 不再用瀏覽器原生 confirm()
	$('#exportConfigConfirmModal').modal('hide');
	// 用暫時的 <a download> 觸發下載(而非直接改 window.location), 避免連續兩次改變網址時瀏覽器只認得最後一次;
	// 兩次下載間隔一小段時間, 讓瀏覽器有機會各自完成獨立的下載請求
	var triggerDownload = function(url){
		var a = document.createElement('a');
		a.href = url;
		a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	};
	triggerDownload('data/export/sn_list');
	setTimeout(function(){ triggerDownload('data/export/config'); }, 300);
}

// 內部/衍生欄位: 與 Server.py 的 INTERNAL_ONLY_KEYS 一致, 不參與比對匯入; 5 個 proxy_* 是網頁端由 proxy 分解出來的, 原始設定檔不會有
var IMPORT_CONFIG_EXCLUDED_TOP_KEYS = ['config_version', 'database_version', 'working_dir', 'aniGamerPlus_version', 'use_gost',
	'proxy_protocol', 'proxy_ip', 'proxy_port', 'proxy_user', 'proxy_passwd'];
// 沒有網頁表單可對應的欄位(例如 dashboard/ftp 內的子欄位), 給個好懂一點的中文標籤; 沒列到的就直接顯示原始欄位路徑
var IMPORT_CONFIG_LABEL_MAP = {
	'dashboard.host': 'Dashboard 監聽位址(host)',
	'dashboard.port': 'Dashboard 監聽埠(port)',
	'dashboard.SSL': 'Dashboard 啟用 SSL',
	'dashboard.BasicAuth': 'Dashboard 登入保護開關',
	'dashboard.username': 'Dashboard 登入帳號',
	'dashboard.password': 'Dashboard 登入密碼',
	'use_dashboard': '啟用 Dashboard',
	'ftp.server': 'FTP 伺服器位址',
	'ftp.port': 'FTP 埠',
	'ftp.user': 'FTP 帳號',
	'ftp.pwd': 'FTP 密碼',
	'ftp.tls': 'FTP 使用 TLS',
	'ftp.cwd': 'FTP 存放目錄',
	'ftp.show_error_detail': 'FTP 顯示詳細錯誤',
	'ftp.max_retry_num': 'FTP 最大重試次數',
	'upload_to_server': '上傳至遠端伺服器開關',
	'user_command': '下載完成後執行的自訂指令',
	'no_proxy_akamai': '不代理 akamai CDN(影片流)',
	'classify_season': '建立季度子資料夾',
	'multi_upload': '最大並發上傳數',
	'segment_max_retry': '分段下載最大重試次數',
	'customized_bangumi_name_suffix': '番劇名自訂後綴',
	'video_filename_extension': '影片副檔名',
	'faststart_movflags': '影片 faststart 標記',
	'audio_language': '偏好音軌語言',
	'danmu_ban_words': '彈幕屏蔽字詞',
	'only_use_vip': '鎖定會員帳號下載',
	'zerofill': '劇集名補零',
	'parse_max_retry': '解析最大重試次數',
	'parse_retry_base_delay': '解析重試延遲秒數',
	'prevent_guest_download': '阻止訪客下載'
};
// 會影響 Dashboard 本身連線方式/登入資訊的高風險欄位, 匯入前需要額外跳出確認
var IMPORT_CONFIG_HIGH_IMPACT_PATHS = ['dashboard.host', 'dashboard.port', 'dashboard.SSL', 'dashboard.BasicAuth',
	'dashboard.username', 'dashboard.password', 'use_dashboard'];
var importConfigDiff = []; // 暫存本次比對出的可匯入欄位, 供 applyImportConfig() 使用

function triggerImportConfig() {
	$('#importConfigFile').val(''); // 清空, 允許重複選同一個檔案也能觸發 onchange
	$('#importConfigFile').click();
}

function isPlainObject(v) {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function importConfigPath(topKey, subKey) {
	return subKey ? (topKey + '.' + subKey) : topKey;
}

function getFieldLabel(topKey, subKey) {
	var path = importConfigPath(topKey, subKey);
	if (IMPORT_CONFIG_LABEL_MAP[path]) return IMPORT_CONFIG_LABEL_MAP[path];
	if (!subKey) {
		// 優先嘗試從網頁表單欄位抓取現成的中文標籤(id_list 裡的欄位才會有對應的 DOM 元素)
		var label = $('#' + topKey).closest('.input-group').find('.input-group-text').first().text().trim();
		if (label) return label;
	}
	return path;
}

function isSensitiveImportPath(path) {
	// 用關鍵字模糊比對, 不用寫死清單, 避免之後新增類似欄位時忘記加進遮罩名單
	return /password|pwd|token|secret|akamai|ja3/i.test(path);
}

function formatImportConfigValue(path, value) {
	if (isSensitiveImportPath(path)) {
		return value ? '•••••• (已遮罩)' : '(空)';
	}
	if (typeof value === 'boolean') {
		return value ? '開啟' : '關閉';
	}
	if (value === '' || value === null || value === undefined) {
		return '(空)';
	}
	// 這份字串會透過 renderImportConfigDiff() 直接塞進 .html(), 而值本身來自使用者匯入、不受信任的
	// config.json, 必須跳脫才能塞進 innerHTML, 避免惡意欄位值(例如 <img onerror=...>)被當成 HTML 執行
	if (typeof value === 'object') {
		return escapeHtml(JSON.stringify(value));
	}
	return escapeHtml(String(value));
}

function handleImportConfigFile(input) {
	var file = input.files && input.files[0];
	if (!file) return;

	var reader = new FileReader();
	reader.onload = function(e) {
		var oldSettings;
		try {
			oldSettings = JSON.parse(e.target.result);
		} catch (err) {
			showAlert('讀取失敗: 不是有效的 JSON 檔案');
			return;
		}
		renderImportConfigDiff(oldSettings);
		$('#importConfigResultModal').modal('show');
	};
	reader.onerror = function() {
		showAlert('讀取檔案時發生錯誤');
	};
	reader.readAsText(file, 'utf-8');
}

function renderImportConfigDiff(oldSettings) {
	// 比對整份舊設定檔的所有欄位, 不再侷限於網頁表單有對應輸入框的 id_list——
	// dashboard/ftp/coolq_settings 這類沒有網頁欄位的舊設定也能被找到並選擇性匯入。
	// 巢狀物件(例如 dashboard/ftp)攤平一層逐項比對, 讓使用者可以只匯入其中單一子欄位(例如只匯入密碼、不動 port)
	importConfigDiff = [];
	Object.keys(oldSettings).forEach(function(topKey) {
		if (IMPORT_CONFIG_EXCLUDED_TOP_KEYS.indexOf(topKey) !== -1) return;
		var oldValue = oldSettings[topKey];

		if (isPlainObject(oldValue)) {
			var currentParent = dataArrays[topKey];
			Object.keys(oldValue).forEach(function(subKey) {
				var subOldValue = oldValue[subKey];
				var subCurrentValue = isPlainObject(currentParent) ? currentParent[subKey] : undefined;
				if (JSON.stringify(subOldValue) === JSON.stringify(subCurrentValue)) return;
				importConfigDiff.push({
					topKey: topKey, subKey: subKey, label: getFieldLabel(topKey, subKey),
					oldValue: subOldValue, currentValue: subCurrentValue
				});
			});
			return;
		}

		var currentValue = dataArrays[topKey];
		if (JSON.stringify(oldValue) === JSON.stringify(currentValue)) return;
		importConfigDiff.push({
			topKey: topKey, subKey: null, label: getFieldLabel(topKey, null),
			oldValue: oldValue, currentValue: currentValue
		});
	});

	if (!importConfigDiff.length) {
		$('#importConfigResultBody').html('<p>這份設定檔跟目前設定相比, 沒有找到可以匯入的差異項目</p>');
		return;
	}

	var html = '<p class="text-muted">請勾選要從舊設定檔匯入、覆蓋目前設定的項目(預設不勾選, 不會更動任何東西)，最後按下方「套用選取的設定」統一套用並保存。</p>';
	html += '<p class="text-danger small">標示 <strong>⚠</strong> 的項目會影響 Dashboard 本身的連線方式或登入資訊，匯入並保存後可能需要改用新的網址或帳密才能重新連上，請小心勾選。</p>';
	html += '<ul class="list-group">';
	importConfigDiff.forEach(function(d, idx) {
		var path = importConfigPath(d.topKey, d.subKey);
		var warn = IMPORT_CONFIG_HIGH_IMPACT_PATHS.indexOf(path) !== -1;
		html += '<li class="list-group-item">';
		html += '<div class="form-check">';
		html += '<input class="form-check-input import-config-choice" type="checkbox" data-idx="' + idx + '" id="importChoice' + idx + '">';
		html += ' <label class="form-check-label" for="importChoice' + idx + '"><strong>' + (warn ? '⚠ ' : '') + escapeHtml(d.label) + '</strong></label>';
		html += '</div>';
		html += '<div class="text-muted small" style="margin-left: 1.5em;">目前: ' + formatImportConfigValue(path, d.currentValue)
			+ '　→　舊設定檔: ' + formatImportConfigValue(path, d.oldValue) + '</div>';
		html += '</li>';
	});
	html += '</ul>';
	$('#importConfigResultBody').html(html);
}

function applyImportConfig() {
	// 先只「收集」勾選的項目、判斷是否包含高風險欄位, 完全不動 dataArrays;
	// 這樣如果使用者在下面的確認框按下取消, dataArrays 保持原樣, 不會留下半套已套用的變更
	var selected = [];
	var hasHighImpact = false;
	$('.import-config-choice:checked').each(function() {
		var idx = $(this).data('idx');
		var d = importConfigDiff[idx];
		if (!d) return;
		var path = importConfigPath(d.topKey, d.subKey);
		if (IMPORT_CONFIG_HIGH_IMPACT_PATHS.indexOf(path) !== -1) hasHighImpact = true;
		selected.push(d);
	});

	if (!selected.length) {
		$('#importConfigResultModal').modal('hide');
		return;
	}

	function doApplyImportConfig() {
		selected.forEach(function(d) {
			if (d.subKey) {
				var parent = dataArrays[d.topKey];
				dataArrays[d.topKey] = isPlainObject(parent) ? Object.assign({}, parent) : {}; // 淺拷貝, 避免多個子欄位互相覆蓋時共用到同一個參照
				dataArrays[d.topKey][d.subKey] = d.oldValue;
			} else {
				dataArrays[d.topKey] = d.oldValue;
			}
		});

		$.ajax({
			url: '/uploadConfig',
			type: 'post',
			dataType: 'json',
			headers: {
				"Content-Type": "application/json;charset=utf-8",
				"X-Requested-With": "XMLHttpRequest"
			},
			contentType: 'application/json; charset=utf-8',
			data: JSON.stringify(dataArrays),
			success: function(data) {
				$('#importConfigResultModal').modal('hide');
				$('#uploadOk').show();
				$('#uploadFailed').hide();
				$('#uploadStatus').modal();
				reloadSetting();
			},
			error: function(status) {
				$('#importConfigResultModal').modal('hide');
				$('#uploadOk').hide();
				$('#uploadFailed').show();
				$('#uploadStatus').modal();
			}
		});
	}

	if (hasHighImpact) {
		showConfirm('你勾選的項目包含會影響 Dashboard 連線方式或登入資訊的設定(標示 ⚠ 的項目)，套用並保存後可能需要改用新的網址或帳密才能重新連上 Dashboard。確定要繼續嗎？', doApplyImportConfig);
	} else {
		doApplyImportConfig();
	}
}

var dirBrowserTargetInput = null;
var dirBrowserCurrentPath = '';
var dirBrowserParentPath = null;
var dirBrowserShowingRoot = false;

function openDirBrowser(targetInputId) {
	dirBrowserTargetInput = targetInputId;
	var currentValue = $('#' + targetInputId).val();
	$('#dirBrowserModal').modal('show');
	// 若輸入框目前已經有值, 直接從那裡開始瀏覽; 該路徑若還不存在, 後端會自動往上找最近一個確實存在的
	// 祖先目錄開始顯示(見 Server.py browse_dir()), 不會顯示錯誤訊息
	loadDirBrowserPath(currentValue || '');
}

function loadDirBrowserPath(path) {
	$.get({ url: '/data/browse_dir', data: { path: path }, cache: false, success: function(data) {
		$('#dirBrowserError').hide();
		// fell_back: 想瀏覽的路徑(通常是輸入框裡原本已填的下載目錄/暫存目錄)不存在, 後端已經自動往上找到
		// 最近的祖先目錄顯示; 用溫和的提示告知使用者(而不是紅色的技術性錯誤訊息), 説明現在看到的不是原本設定的那個目錄
		$('#dirBrowserNotice').toggle(!!data.fell_back);
		renderDirBrowser(data);
	}, error: function(xhr) {
		// 走到這裡代表真的發生錯誤(例如沒有讀取權限), 不是單純路徑還不存在(那種情況後端已經自動退到最近的
		// 上層目錄, 不會回傳錯誤)
		$('#dirBrowserNotice').hide();
		$('#dirBrowserError').text((xhr.responseJSON && xhr.responseJSON.message) || '讀取失敗').show();
	}});
}

function _jsStringEscape(s) {
	// 供組成 onclick="loadDirBrowserPath('...')" 內嵌的 JS 字串常值使用: 跳脫反斜線與單引號,
	// 跟 _escapeHtmlAttr() 是分開的兩件事(那個是給 HTML 屬性/顯示文字用的)
	return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _dirBrowserRow(icon, label, path) {
	return '<button type="button" class="list-group-item list-group-item-action" onclick="loadDirBrowserPath(\''
		+ _jsStringEscape(path) + '\')">' + icon + ' ' + _escapeHtmlAttr(label) + '</button>';
}

function _dirBrowserCustomRow(path) {
	// 使用者自訂的喜好路徑: 沿用跟一般捷徑同樣的 list-group-item 邊距/對齊(不能用 p-0, 不然文字會貼太左邊,
	// 跟其他列對不齊), 只是右側多一顆刪除鈕。整列點擊會導覽過去, 刪除鈕要擋掉事件冒泡, 不然點下去
	// 除了觸發刪除還會一起觸發外層的導覽
	return '<div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" '
		+ 'style="cursor:pointer;" onclick="loadDirBrowserPath(\'' + _jsStringEscape(path) + '\')">'
		+ '<span class="text-truncate mr-2">🩷 ' + _escapeHtmlAttr(path) + '</span>'
		+ '<button type="button" class="btn btn-sm text-danger p-0" title="移除這個喜好路徑" '
		+ 'onclick="event.stopPropagation(); removeCustomDirShortcut(\'' + _jsStringEscape(path) + '\')">🗑️</button>'
		+ '</div>';
}

function renderDirBrowser(data) {
	dirBrowserCurrentPath = data.current || '';
	dirBrowserParentPath = data.parent;
	$('#dirBrowserPathInput').val(dirBrowserCurrentPath);
	dirBrowserShowingRoot = data.parent === null || data.parent === undefined;

	var html = '';
	if (dirBrowserParentPath !== null && dirBrowserParentPath !== undefined) {
		html += _dirBrowserRow('⬆', '上一層', dirBrowserParentPath);
	}
	(data.drives || []).forEach(function(drive) {
		html += _dirBrowserRow('💽', drive, drive);
	});
	(data.shortcuts || []).forEach(function(shortcut) {
		html += _dirBrowserRow('⭐', shortcut.label, shortcut.path);
	});
	if (dirBrowserShowingRoot) {
		// 只在最上層畫面(跟桌面/下載捷徑同一層)提供已存的喜好路徑, 「新增路徑」固定放在清單最後面,
		// 這樣新增之後清單往下長、按鈕本身位置不會亂跳，操作起來跟「一路往下加」的直覺一致
		(data.custom_shortcuts || []).forEach(function(path) {
			html += _dirBrowserCustomRow(path);
		});
		// 主要給連不到的網路路徑用: 先在上方路徑欄輸入完整路徑(不用先按「前往」, 網路磁碟離線時按「前往」
		// 只會被退回這個畫面、清空輸入框), 再按這一列直接把輸入框目前的內容存成喜好路徑
		html += '<button type="button" class="list-group-item list-group-item-action" onclick="addCustomDirShortcut()">🩷 新增路徑</button>';
	}
	(data.dirs || []).forEach(function(name) {
		var fullPath = dirBrowserCurrentPath + (dirBrowserCurrentPath.endsWith('\\') || dirBrowserCurrentPath.endsWith('/') ? '' : '/') + name;
		html += _dirBrowserRow('📁', name, fullPath);
	});
	if (!html) {
		html = '<p class="text-muted mb-0 p-2">這個目錄底下沒有子資料夾</p>';
	}
	$('#dirBrowserList').html(html);
}

function addCustomDirShortcut() {
	var path = $('#dirBrowserPathInput').val().trim();
	if (!path) {
		$('#dirBrowserError').text('請先在上方路徑欄輸入要加入喜好清單的路徑').show();
		return;
	}
	$.ajax({
		url: '/data/custom_dir_shortcut/add',
		type: 'post',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ path: path }),
		success: function() {
			$('#dirBrowserError').hide();
			loadDirBrowserPath(dirBrowserCurrentPath);
		},
		error: function(xhr) {
			$('#dirBrowserError').text((xhr.responseJSON && xhr.responseJSON.message) || '新增失敗').show();
		}
	});
}

function removeCustomDirShortcut(path) {
	$.ajax({
		url: '/data/custom_dir_shortcut/remove',
		type: 'post',
		headers: { "Content-Type": "application/json;charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify({ path: path }),
		success: function() {
			$('#dirBrowserError').hide();
			loadDirBrowserPath(dirBrowserCurrentPath);
		},
		error: function(xhr) {
			$('#dirBrowserError').text((xhr.responseJSON && xhr.responseJSON.message) || '移除失敗').show();
		}
	});
}

function selectDirBrowserPath() {
	if (!dirBrowserTargetInput) {
		return;
	}
	// 直接採用路徑輸入框目前顯示的內容(使用者可能手動編輯過, 而不是單純點清單選的), 跟「前往」按鈕用的是同一個來源
	$('#' + dirBrowserTargetInput).val($('#dirBrowserPathInput').val());
	$('#dirBrowserModal').modal('hide');
}

// ---------------------------------------------------------------------------
// 公告面板(GossipDB.py, v25.2.0): 歷史公告/操作處置/機動調整 三個摺疊區塊, 資料來源見 Dashboard/Server.py
// 的 /data/gossip_history、/data/gossip_actionable、/data/gossip_dynamic_schedule、/data/gossip_disposition
// ---------------------------------------------------------------------------

var gossipRefreshTimer = null;
var gossipDispositionOptions = [];
var gossipScheduleOptions = [];  // 「選擇指定排程」下拉選單資料, 開啟公告視窗時載入一次即可(排程清單不會頻繁變動)

$(function() {
	$('#gossipPanel').on('show.bs.modal', function() {
		loadGossipScheduleOptions();
		refreshGossipPanel();  // 開啟公告視窗當下三個區塊都重新讀取一次(此時使用者還沒開始操作, 不會有衝突)
		if (gossipRefreshTimer) clearInterval(gossipRefreshTimer);
		// 只讓「歷史公告」與「機動調整」定期刷新; 「操作處置」故意不放進定期刷新, 否則使用者選好處置方式、
		// 還沒按下確認就被刷新蓋掉下拉選單目前的選擇, 等於選了等於沒選。操作處置只在重新開啟本視窗、或按下
		// 該列「確認」成功之後才會重新讀取(見 confirmGossipDisposition())
		gossipRefreshTimer = setInterval(refreshGossipPassive, 10000);
	});
	$('#gossipPanel').on('hidden.bs.modal', function() {
		if (gossipRefreshTimer) {
			clearInterval(gossipRefreshTimer);
			gossipRefreshTimer = null;
		}
	});
});

function refreshGossipPanel() {
	loadGossipHistory();
	loadGossipActionable();
	loadGossipDynamicSchedule();
}

function refreshGossipPassive() {
	// 供定期刷新使用, 刻意不包含 loadGossipActionable(), 避免蓋掉使用者正在操作到一半的處置下拉選單
	loadGossipHistory();
	loadGossipDynamicSchedule();
}

// 通用提示框, 取代瀏覽器原生 alert(): 原名 showGossipActionResult(), 一開始只給公告處置用, 後來與快速取得
// Cookie/UA-JA3-Akamai 共用, 現已擴展成全站通用的訊息提示, 改成這個名字才不會誤導
function showAlert(message) {
	$('#alertModalText').text(message);
	$('#alertModal').modal();
}

// 通用確認框, 取代瀏覽器原生 confirm(): confirm() 是同步阻塞的(按下確定/取消才會往下執行呼叫端接著寫的程式碼),
// 網頁彈窗天生是非同步的(使用者按下按鈕後才觸發事件), 所以呼叫端原本寫在 confirm() 之後的程式碼都要改成
// callback 函式傳進來, 按下「確定」才會執行; 按「取消」或叉掉視窗則什麼都不做(等同原本 confirm() 回傳 false)
var _genericConfirmCallback = null;
function showConfirm(message, onConfirm) {
	$('#confirmModalText').text(message);
	_genericConfirmCallback = onConfirm;
	$('#confirmModal').modal('show');
}
function _runGenericConfirm() {
	$('#confirmModal').modal('hide');
	var callback = _genericConfirmCallback;
	_genericConfirmCallback = null;
	if (callback) callback();
}
function _cancelGenericConfirm() {
	_genericConfirmCallback = null;
}
// 不管透過哪個路徑關閉(X/取消按鈕、下面的 ESC 處理、或未來新增的其他關閉方式), 都要清掉待執行的 callback,
// 用 hidden.bs.modal 當唯一權威來源, 而不是要求每個新的關閉入口都自己記得呼叫 _cancelGenericConfirm()
$(function() {
	$('#confirmModal').on('hidden.bs.modal', _cancelGenericConfirm);
});

// Bootstrap 4.3.1 的 modal z-index 是 CSS 寫死的固定值, 不會依開啟順序遞增——同時有兩個 modal 開著時,
// 疊在畫面最上層的其實是「DOM 位置比較後面」的那個, 跟兩者實際的開啟先後順序無關(例如批次任務進度框
// 開著時再彈出「確定要終止這個批次任務嗎？」確認框, 若確認框在 HTML 裡宣告的位置比進度框早, 就會被
// 進度框蓋住、看不到也點不到, 是那類「彈窗被另一個仍開著的彈窗擋住」問題的通用成因, 不是單一彈窗各自的
// bug)。這裡補上 Bootstrap 沒做的事: 每次任一 modal 顯示完成後, 若畫面上還有其他 modal 同時開著,
// 把這個後開的 modal 與它對應的遮罩疊到比目前最上層更高的 z-index, 讓「後開的一定蓋在先開的上面」
// 這個直覺永遠成立, 一次性解決全站各處這類彈窗互相遮擋的問題
$(document).on('shown.bs.modal', '.modal', function() {
	var thisEl = this;
	var maxZ = 0;
	document.querySelectorAll('.modal.show').forEach(function(el) {
		if (el === thisEl) return;
		var z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
		if (z > maxZ) maxZ = z;
	});
	if (!maxZ) return;  // 沒有其他 modal 同時開著, 維持預設 z-index 即可
	var newZ = maxZ + 20;
	$(thisEl).css('z-index', newZ);
	// Bootstrap 每次顯示 modal 都會在 <body> 底下多插入一個對應的 .modal-backdrop, 顯示順序跟對應 modal
	// 一致, 取最後一個(剛為這次顯示新建的那個)調整即可, 疊在這個 modal 本身下面一階
	$('.modal-backdrop').last().css('z-index', newZ - 1);
});

// 找出目前顯示中、z-index 最大(畫面上最上層)的那個 modal; 沒有任何 modal 開著時回傳 null。
// 供下面的 ESC(關閉最上層)與 Enter(送出最上層的預設按鈕)共用同一份「誰是最上層」判斷邏輯
function _topmostOpenModal() {
	var openModals = Array.prototype.slice.call(document.querySelectorAll('.modal.show'));
	if (!openModals.length) return null;
	return openModals.reduce(function(top, el) {
		var z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
		var topZ = top ? (parseInt(getComputedStyle(top).zIndex, 10) || 0) : -1;
		return z >= topZ ? el : top;
	}, null);
}

// ESC 鍵統一由這裡攔截處理, 取代 bootstrap 自己每個 modal 各自綁定的 ESC 邏輯: 這個專案的彈窗常常疊多層
// (例如「添加手動任務」上面再彈一個「確認」), bootstrap 預設每一層 modal 都各自監聽 document 的 ESC,
// 疊多層時同一次按鍵會被每一層都接收到、全部一起關掉。這裡改成: 只關掉最上層的那個 modal, 其餘不受影響;
// 並且攔截事件不讓它繼續傳遞, bootstrap 自己的 ESC 處理就不會再被觸發。用 capture 階段(第三個參數 true)
// 搶在 bootstrap 綁在 document 上的 bubble 階段處理常式之前執行。
//
// 短暫防抖(_escCooldownUntil): 避免按住 ESC 不放時, 系統重複觸發的 keydown 在同一瞬間連續關掉好幾層彈窗
// (使用者感覺像是「卡鍵」一次關掉全部), 一次只處理一層, 冷卻時間內的後續 ESC 直接吃掉不處理
var _escCooldownUntil = 0;
var ESC_COOLDOWN_MS = 400;
document.addEventListener('keydown', function(e) {
	if (e.key !== 'Escape' && e.keyCode !== 27) return;
	var topModal = _topmostOpenModal();
	if (!topModal) return;  // 沒有任何彈窗開著, 不攔截, 讓 ESC 照常做其他事(例如關閉下拉選單)

	e.preventDefault();
	e.stopPropagation();
	if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

	var now = Date.now();
	if (now < _escCooldownUntil) return;  // 冷卻中, 這次按鍵直接吃掉, 不關閉任何東西
	_escCooldownUntil = now + ESC_COOLDOWN_MS;
	$(topModal).modal('hide');
}, true);

// Enter 鍵統一由這裡攔截處理: 聚焦在文字類輸入框(<input>, 不含 checkbox/radio/button 等非文字類型)時按下
// Enter, 觸發目前最上層 modal(邏輯與上面的 ESC 共用 _topmostOpenModal())裡標記了 [data-enter-submit] 的
// 按鈕(例如「確認」框的「確定」、「添加手動任務」的「提交」); 沒有任何 modal 開著時, 改成觸發目前頁面上
// 標記了同一個屬性的按鈕(例如設定頁的「保存」)。textarea(例如通知模板編輯器)不處理, 保留原生換行行為。
// 同樣用 capture 階段攔截, 避免瀏覽器對「表單內文字輸入框按 Enter」的原生隱式送出行為意外觸發兩次
document.addEventListener('keydown', function(e) {
	if (e.key !== 'Enter') return;
	var target = e.target;
	if (!target || target.tagName !== 'INPUT') return;
	var type = (target.getAttribute('type') || 'text').toLowerCase();
	if (['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].indexOf(type) !== -1) return;

	var topModal = _topmostOpenModal();
	if (topModal && !topModal.contains(target)) return;  // 有 modal 開著時, 只處理該 modal 內的輸入框

	var btn;
	if (topModal) {
		btn = topModal.querySelector('[data-enter-submit]');
	} else {
		// 沒有 modal 開著時, document.querySelector() 會照 DOM 順序抓到「第一個」符合的按鈕, 可能是某個
		// 目前關閉中的 modal 裡的按鈕(該 modal 在 HTML 原始碼裡剛好排在前面, 但實際上是隱藏的、不該被觸發);
		// 改成只挑「畫面上真的看得到」的那個(offsetParent !== null 是排除 display:none 祖先的標準判斷方式)
		btn = Array.prototype.slice.call(document.querySelectorAll('[data-enter-submit]'))
			.find(function(b) { return b.offsetParent !== null; });
	}
	if (!btn || btn.disabled) return;
	e.preventDefault();
	e.stopPropagation();
	if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
	btn.click();
}, true);

function loadGossipHistory() {
	$.get({ url: '/data/gossip_history', cache: false, dataType: 'json', success: function(resp) {
		renderGossipHistory(resp.history || []);
	}});
}

function renderGossipHistory(rows) {
	if (!rows.length) {
		$('#gossipHistoryTableBody').html('<tr><td colspan="4" class="text-muted">尚無資料</td></tr>');
		return;
	}
	var html = '';
	rows.forEach(function(row) {
		html += '<tr>'
			+ '<td>' + escapeHtml(row.processed_at) + '</td>'
			+ '<td>' + escapeHtml(row.display_name || '') + '</td>'
			+ '<td>' + escapeHtml(row.episode_display || '-') + '</td>'
			+ '<td>' + escapeHtml(row.status_label) + '</td>'
			+ '</tr>';
	});
	$('#gossipHistoryTableBody').html(html);
}

function loadGossipActionable() {
	$.get({ url: '/data/gossip_actionable', cache: false, dataType: 'json', success: function(resp) {
		gossipDispositionOptions = resp.disposition_options || [];
		renderGossipActionable(resp.actionable || []);
	}});
}

function loadGossipScheduleOptions() {
	$.get({ url: '/data/gossip_schedule_options', cache: false, dataType: 'json', success: function(resp) {
		gossipScheduleOptions = resp.options || [];
	}});
}

// 只有這幾種處置方式需要使用者額外填日期/時間(/連續集數), 其餘處置方式的目標時間都是系統從公告內容
// 直接算出來的, 不需要使用者再手動輸入; 「自訂時間範圍」額外需要「開始~結束時間」(GOSSIP_WINDOW_DISPOSITIONS),
// 而不是單一時間點, 用於公告只給模糊時段(白天/早上/上午/中午/下午/晚上/深夜等)、沒有明確時刻的情況——
// 在這段範圍內每分鐘檢查一次, 見 Gossip.py 的 override_check_window
var GOSSIP_CUSTOM_DISPOSITIONS = ['自訂更新時間', '自訂連續更新時間', '自訂時間範圍'];
var GOSSIP_WINDOW_DISPOSITIONS = ['自訂時間範圍'];

function renderGossipActionable(rows) {
	if (!rows.length) {
		$('#gossipActionableTableBody').html('<tr><td colspan="4" class="text-muted">尚無資料</td></tr>');
		return;
	}
	var html = '';
	rows.forEach(function(row) {
		var rowId = 'gossipActionable_' + row.id;
		var selectHtml = '<select id="' + rowId + '_select" class="form-control form-control-sm" '
			+ 'onchange="onGossipDispositionChange(' + row.id + ')">';
		gossipDispositionOptions.forEach(function(opt) {
			var selected = (opt === row.disposition) ? ' selected' : '';
			selectHtml += '<option value="' + escapeHtml(opt) + '"' + selected + '>' + escapeHtml(opt) + '</option>';
		});
		selectHtml += '</select>';

		// 直向排列(而非擠在同一列的 col-5/col-4/col-3)——「處置方式」欄位在表格裡本來就窄, 擠成一列會讓日期/
		// 時間輸入框顯示不全(v25.2.3 使用者回報的問題), 改成每個欄位獨立一行, 欄寬只需容納單一輸入框即可
		var showCustom = GOSSIP_CUSTOM_DISPOSITIONS.indexOf(row.disposition) !== -1;
		var showWindow = GOSSIP_WINDOW_DISPOSITIONS.indexOf(row.disposition) !== -1;
		var customHtml = '<div id="' + rowId + '_custom" class="mt-1" style="display:' + (showCustom ? 'block' : 'none') + ';">'
			+ '<div class="form-group mb-1"><label class="small mb-0 text-muted">日期</label>'
			+ '<input type="date" id="' + rowId + '_date" class="form-control form-control-sm" value="' + escapeHtml(row.custom_check_date || row.target_date || '') + '"></div>'
			+ '<div id="' + rowId + '_time_group" class="form-group mb-1" style="display:' + (showWindow ? 'none' : 'block') + ';">'
			+ '<label class="small mb-0 text-muted">時間</label>'
			+ '<input type="time" id="' + rowId + '_time" class="form-control form-control-sm" value="' + escapeHtml(row.custom_check_time || row.target_time || '') + '"></div>'
			+ '<div id="' + rowId + '_window_group" class="form-group mb-1" style="display:' + (showWindow ? 'block' : 'none') + ';">'
			+ '<label class="small mb-0 text-muted">開始時間 ~ 結束時間(範圍內每分鐘檢查)</label>'
			+ '<div class="form-row">'
			+ '<div class="col-6 pr-1"><input type="time" id="' + rowId + '_time_start" class="form-control form-control-sm" value="' + escapeHtml(row.custom_check_time_start || row.target_time_start || '') + '"></div>'
			+ '<div class="col-6"><input type="time" id="' + rowId + '_time_end" class="form-control form-control-sm" value="' + escapeHtml(row.custom_check_time_end || row.target_time_end || '') + '"></div>'
			+ '</div></div>'
			+ '<div class="form-group mb-0"><label class="small mb-0 text-muted">集數</label>'
			+ '<input type="number" min="1" step="1" id="' + rowId + '_count" class="form-control form-control-sm" placeholder="集數" value="' + escapeHtml(row.custom_episode_count || 2) + '"></div>'
			+ '</div>';

		var badge = row.disposition_locked ? ' <span class="badge badge-info">已手動確認</span>' : '';
		var rawClauseHtml = (row.raw_clause && row.raw_clause !== row.display_name)
			? '<div class="text-muted small">' + escapeHtml(row.raw_clause) + '</div>' : '';
		// 公告內容無法自動比對到追蹤作品時(row.sn 為 null), 提供「選擇指定排程」下拉選單讓使用者手動指定
		// 這則公告對應追蹤清單裡的哪一部作品, 選好後跟處置方式一起送出(見 confirmGossipDisposition())
		var scheduleSelectHtml = '';
		if (row.sn === null || row.sn === undefined) {
			var scheduleOptionsHtml = '<option value="">-- 選擇指定排程 --</option>';
			gossipScheduleOptions.forEach(function(opt) {
				var label = (opt.tag ? '[' + opt.tag + '] ' : '') + opt.name + ' (sn=' + opt.sn + ')';
				scheduleOptionsHtml += '<option value="' + opt.sn + '">' + escapeHtml(label) + '</option>';
			});
			scheduleSelectHtml = '<select id="' + rowId + '_sn" class="form-control form-control-sm mt-1">'
				+ scheduleOptionsHtml + '</select>';
		}
		var nameContentHtml = '<div>' + escapeHtml(row.display_name || '') + badge + '</div>' + rawClauseHtml + scheduleSelectHtml;

		html += '<tr>'
			+ '<td>' + escapeHtml(row.processed_at) + '</td>'
			+ '<td>' + nameContentHtml + '</td>'
			+ '<td>' + selectHtml + customHtml + '</td>'
			+ '<td class="text-center align-middle"><button type="button" class="btn btn-success btn-sm" onclick="confirmGossipDisposition(' + row.id + ', this)">確認</button></td>'
			+ '</tr>';
	});
	$('#gossipActionableTableBody').html(html);
}

function onGossipDispositionChange(eventId) {
	var rowId = 'gossipActionable_' + eventId;
	var disposition = $('#' + rowId + '_select').val();
	var showCustom = GOSSIP_CUSTOM_DISPOSITIONS.indexOf(disposition) !== -1;
	var showWindow = GOSSIP_WINDOW_DISPOSITIONS.indexOf(disposition) !== -1;
	$('#' + rowId + '_custom').css('display', showCustom ? 'block' : 'none');
	$('#' + rowId + '_time_group').css('display', showWindow ? 'none' : 'block');
	$('#' + rowId + '_window_group').css('display', showWindow ? 'block' : 'none');
}

// 這兩種處置方式不需要比對到作品也能套用(單純標記這則公告不用管/先擱置), 其餘處置方式都需要 sn
// 才能建立臨時排程覆蓋, 所以「無法判斷」項目要嘛選了指定排程、要嘛只能選這兩種之一
var GOSSIP_DISPOSITIONS_WITHOUT_SN = ['等待處置', '忽略此公告'];

function confirmGossipDisposition(eventId, btnEl) {
	// 送出後到成功/失敗回應回來前先停用按鈕, 避免快速連點兩次對同一個事件送出兩筆重疊的請求
	// (後端 apply_disposition_for_event 雖然已用鎖序列化、不會再寫出兩筆矛盾紀錄, 但這裡仍應避免無謂的重複請求)
	if (btnEl && btnEl.disabled) return;
	if (btnEl) btnEl.disabled = true;
	var rowId = 'gossipActionable_' + eventId;
	var disposition = $('#' + rowId + '_select').val();
	var payload = { event_id: eventId, disposition: disposition };
	if (GOSSIP_CUSTOM_DISPOSITIONS.indexOf(disposition) !== -1) {
		payload.custom_check_date = $('#' + rowId + '_date').val();
		payload.custom_episode_count = $('#' + rowId + '_count').val();
		if (GOSSIP_WINDOW_DISPOSITIONS.indexOf(disposition) !== -1) {
			payload.custom_check_time_start = $('#' + rowId + '_time_start').val();
			payload.custom_check_time_end = $('#' + rowId + '_time_end').val();
		} else {
			payload.custom_check_time = $('#' + rowId + '_time').val();
		}
	}
	var scheduleSelect = $('#' + rowId + '_sn');
	if (scheduleSelect.length) {
		var manualSn = scheduleSelect.val();
		if (manualSn) {
			payload.manual_sn = manualSn;
		} else if (GOSSIP_DISPOSITIONS_WITHOUT_SN.indexOf(disposition) === -1) {
			showAlert('這則公告尚未比對到追蹤作品, 請先於「選擇指定排程」挑選對應的作品, 或改選「等待處置」/「忽略此公告」');
			if (btnEl) btnEl.disabled = false;
			return;
		}
	}
	$.ajax({
		url: '/data/gossip_disposition',
		type: 'post',
		dataType: 'json',
		headers: {
			"Content-Type": "application/json;charset=utf-8",
			"X-Requested-With": "XMLHttpRequest"
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(payload),
		success: function() {
			showAlert('已套用處置: ' + disposition);
			refreshGossipPanel();
		},
		error: function(xhr) {
			showAlert((xhr.responseJSON && xhr.responseJSON.message) || '套用處置失敗');
			if (btnEl) btnEl.disabled = false;
		}
	});
}

function loadGossipDynamicSchedule() {
	$.get({ url: '/data/gossip_dynamic_schedule', cache: false, dataType: 'json', success: function(resp) {
		renderGossipDynamicSchedule(resp.pending || []);
	}});
}

var GOSSIP_PENDING_STATUS_LABEL = { pending: '進行中', done: '已完成', expired: '已過期' };

function _formatGossipPendingAdjustment(entry) {
	if (entry.type === 'skip_check') {
		var text = entry.check_date + ' 暫停檢查(該次跳過, 下次照常排程)';
		if (entry.resume_date) {
			text += ', 預計 ' + entry.resume_date + ' 恢復';
		}
		return text;
	}
	var timeDesc = entry.check_time ? entry.check_time
		: (entry.check_time_start ? (entry.check_time_start + '~' + entry.check_time_end) : '');
	var text = '改為 ' + entry.check_date + (timeDesc ? ' ' + timeDesc : '') + ' 檢查';
	if (entry.type === 'override_check_window') {
		text += '(範圍內每分鐘檢查)';
	}
	if (entry.expect_episode_count > 1) {
		text += ', 預期 ' + entry.found_episode_count + '/' + entry.expect_episode_count + ' 集';
	}
	return text;
}

function renderGossipDynamicSchedule(rows) {
	if (!rows.length) {
		$('#gossipDynamicScheduleTableBody').html('<tr><td colspan="3" class="text-muted">尚無資料</td></tr>');
		return;
	}
	var html = '';
	rows.forEach(function(row) {
		html += '<tr>'
			+ '<td>' + escapeHtml(row.name || row.sn) + '</td>'
			+ '<td>' + escapeHtml(_formatGossipPendingAdjustment(row)) + '</td>'
			+ '<td>' + escapeHtml(GOSSIP_PENDING_STATUS_LABEL[row.status] || row.status) + '</td>'
			+ '</tr>';
	});
	$('#gossipDynamicScheduleTableBody').html(html);
}