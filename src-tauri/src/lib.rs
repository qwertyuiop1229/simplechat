use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}, Manager, WindowEvent, Emitter};
use tauri::WebviewWindowBuilder;
use std::sync::Mutex;

// HTML を実行ファイルに埋め込む（バンドル不在時のフォールバック）
const CONTAINER_HTML: &str = include_str!("../../public/notification-container.html");

// ファイルが正常ロードされなかった場合に init_script で強制注入するための JS を作る。
// HTML 内に JS の template literal (${...}) があるため、URL エンコードして
// JS 側で decodeURIComponent するアプローチを取る。
fn build_container_init_script() -> String {
    let html_encoded: String = urlencoding::encode(CONTAINER_HTML).into_owned();
    format!(
        r#"(function() {{
  console.log('[init_script] starting...');
  var html_encoded = "{}";
  function inject() {{
    try {{
      var html = decodeURIComponent(html_encoded);
      if (document.getElementById('notifList')) {{
        console.log('[init_script] container HTML already loaded from file, skipping');
        return;
      }}
      console.log('[init_script] file did not load, injecting embedded HTML');
      document.open();
      document.write(html);
      document.close();
    }} catch(e) {{
      console.error('[init_script] inject failed:', e);
      try {{
        document.body.innerHTML = '<div style="color:red;padding:10px;font:13px monospace;background:#fff">[init_script] inject failed: ' + (e && e.message) + '</div>';
      }} catch(_){{}}
    }}
  }}
  if (document.readyState === 'complete' || document.readyState === 'interactive') {{
    setTimeout(inject, 50);
  }} else {{
    document.addEventListener('DOMContentLoaded', function() {{ setTimeout(inject, 50); }});
  }}
}})();"#,
        html_encoded
    )
}

const CONTAINER_LABEL: &str = "notif_container";
const PICKER_LABEL: &str = "notif_pos_picker";

const CONTAINER_W: i32 = 360;
const CONTAINER_H_INITIAL: i32 = 100;       // 初期は1枚分の高さだけ
const CONTAINER_H_DEFAULT: i32 = 600;       // 「右下」デフォルト計算用の見込み高さ
const CONTAINER_H_MIN: i32 = 90;            // カードなしのとき
const CONTAINER_H_MAX_RATIO: f64 = 0.85;    // モニター高さの比率上限
const PICKER_W: i32 = 360;
const PICKER_H: i32 = 200;
const SCREEN_MARGIN: i32 = 20;
const OFFSCREEN_X: i32 = -32000;
const OFFSCREEN_Y: i32 = -32000;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct SavedPosition {
    monitor_index: Option<usize>,
    x_in_monitor: i32,
    y_in_monitor: i32,
    stack_direction: String, // "up" (新着が下、古いのが上) | "down" (新着が上、古いのが下)
}

#[derive(Clone)]
struct PendingNotif {
    id: String,
    title: String,
    body: String,
    room_id: String,
    stack_dir: String,
}

#[derive(Default)]
struct NotificationState {
    saved_position: Mutex<Option<SavedPosition>>,
    container_ready: Mutex<bool>,
    pending: Mutex<Vec<PendingNotif>>,
}

#[derive(serde::Serialize)]
struct MonitorInfo {
    index: usize,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    is_primary: bool,
    scale_factor: f64,
}

// ===========================================================================
// 位置計算ヘルパー
// ===========================================================================

fn pick_monitor(
    app_handle: &tauri::AppHandle,
    monitor_index: Option<usize>,
) -> Option<tauri::Monitor> {
    let win = app_handle.get_webview_window("main")?;
    let monitors = win.available_monitors().ok()?;
    if let Some(idx) = monitor_index {
        if let Some(m) = monitors.get(idx) {
            return Some(m.clone());
        }
    }
    if let Ok(Some(m)) = win.primary_monitor() {
        return Some(m);
    }
    monitors.into_iter().next()
}

fn container_height_for_monitor(monitor: &tauri::Monitor) -> i32 {
    let mh = monitor.size().height as f64;
    (mh * 0.8).min(CONTAINER_H_DEFAULT as f64).max(200.0) as i32
}

// 保存位置 (None なら primary 右下デフォルト) を実際の物理座標に解決
// 戻り値: (window_x, window_y, stack_direction)
fn resolve_window_position(
    app_handle: &tauri::AppHandle,
    saved: Option<&SavedPosition>,
) -> Option<(i32, i32, String)> {
    let monitor = pick_monitor(app_handle, saved.and_then(|s| s.monitor_index))?;
    let mp = monitor.position();
    let ms = monitor.size();
    let mw = ms.width as i32;
    let mh = ms.height as i32;

    if let Some(s) = saved {
        let wx = mp.x + s.x_in_monitor;
        let wy = mp.y + s.y_in_monitor;
        Some((wx, wy, s.stack_direction.clone()))
    } else {
        // デフォルト: 右下
        let container_h = container_height_for_monitor(&monitor);
        let wx = mp.x + mw - CONTAINER_W - SCREEN_MARGIN;
        let wy = mp.y + mh - container_h - SCREEN_MARGIN;
        Some((wx, wy, "up".to_string()))
    }
}

// ===========================================================================
// コンテナウィンドウ生成・取得
// ===========================================================================

fn ensure_container_window(
    app_handle: &tauri::AppHandle,
) -> Result<(tauri::WebviewWindow, bool), String> {
    if let Some(win) = app_handle.get_webview_window(CONTAINER_LABEL) {
        return Ok((win, false));
    }

    // 初期サイズは小さめ。カード追加時に JS から resize_notif_container を呼んで動的に伸びる
    // バンドルから読まれなかった場合に備えて init_script で HTML を強制注入
    let init_script = build_container_init_script();
    let win = WebviewWindowBuilder::new(
        app_handle,
        CONTAINER_LABEL,
        tauri::WebviewUrl::App("/notification-container.html".into()),
    )
    .inner_size(CONTAINER_W as f64, CONTAINER_H_INITIAL as f64)
    .position(OFFSCREEN_X as f64, OFFSCREEN_Y as f64)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(true)
    .focused(false)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("container build failed: {}", e))?;

    log::info!("Container window created");

    // 診断のため devtools を自動オープン（問題切り分け用）
    // 落ち着いたら削除する
    win.open_devtools();

    Ok((win, true))
}

// JS から呼ばれるコンテナリサイズ。
// stack_direction によってアンカー（top or bottom）を維持する
#[tauri::command]
fn resize_notif_container(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    height: u32,
) -> Result<(), String> {
    let win = app_handle
        .get_webview_window(CONTAINER_LABEL)
        .ok_or_else(|| "container not found".to_string())?;

    // モニターから最大高を計算
    let monitor = pick_monitor(&app_handle, None);
    let max_h = monitor
        .as_ref()
        .map(|m| (m.size().height as f64 * CONTAINER_H_MAX_RATIO) as i32)
        .unwrap_or(CONTAINER_H_DEFAULT);
    let new_h = height.max(CONTAINER_H_MIN as u32).min(max_h as u32);

    let saved = state.saved_position.lock().unwrap().clone();
    let stack_dir = saved
        .as_ref()
        .map(|s| s.stack_direction.clone())
        .unwrap_or_else(|| "up".to_string());

    let cur_pos = win.outer_position().map_err(|e| e.to_string())?;
    let cur_size = win.outer_size().map_err(|e| e.to_string())?;

    if stack_dir == "up" {
        // 「up」(下から積む): bottom anchor を維持。top を新しい高さに合わせて上下調整
        let bottom = cur_pos.y + cur_size.height as i32;
        let new_top = bottom - new_h as i32;
        win.set_size(tauri::PhysicalSize {
            width: cur_size.width,
            height: new_h,
        })
        .map_err(|e| format!("set_size failed: {}", e))?;
        win.set_position(tauri::PhysicalPosition {
            x: cur_pos.x,
            y: new_top,
        })
        .map_err(|e| format!("set_position failed: {}", e))?;
    } else {
        // 「down」(上から積む): top anchor 維持。サイズだけ変える
        win.set_size(tauri::PhysicalSize {
            width: cur_size.width,
            height: new_h,
        })
        .map_err(|e| format!("set_size failed: {}", e))?;
    }

    Ok(())
}

// ===========================================================================
// コマンド: 通知エンキュー
// ===========================================================================

#[tauri::command]
fn enqueue_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    title: String,
    body: String,
    room_id: String,
) -> Result<(), String> {
    log::info!("enqueue_notification: title={}, body={}", title, body);

    let saved = state.saved_position.lock().unwrap().clone();
    let (window, was_new) = ensure_container_window(&app_handle)?;

    if was_new {
        // 新規作成時は ready フラグをクリア（JS が container_loaded 呼ぶまで未準備）
        *state.container_ready.lock().unwrap() = false;
        log::info!("Container window created, waiting for ready signal");
    }

    // 物理ピクセルで正確な位置に移動
    if let Some((wx, wy, _stack_dir)) = resolve_window_position(&app_handle, saved.as_ref()) {
        window
            .set_position(tauri::PhysicalPosition { x: wx, y: wy })
            .map_err(|e| format!("set_position failed: {}", e))?;
    }

    let stack_dir = saved
        .as_ref()
        .map(|s| s.stack_direction.clone())
        .unwrap_or_else(|| "up".to_string());

    let id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "id": id,
        "title": title.clone(),
        "body": body.clone(),
        "roomId": room_id.clone(),
        "stackDir": stack_dir.clone(),
    });

    let ready = *state.container_ready.lock().unwrap();
    if ready {
        log::info!("Container ready, emitting new-notif directly");
        window
            .emit("new-notif", payload)
            .map_err(|e| format!("emit failed: {}", e))?;
    } else {
        log::info!("Container not ready, queueing notification");
        state.pending.lock().unwrap().push(PendingNotif {
            id,
            title,
            body,
            room_id,
            stack_dir,
        });
    }

    Ok(())
}

// コンテナの JS が起動完了したときに呼ばれる
#[tauri::command]
fn container_loaded(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
) -> Result<(), String> {
    log::info!("container_loaded called");
    *state.container_ready.lock().unwrap() = true;

    // 溜まっている notifications をすべて flush
    let pending: Vec<PendingNotif> = std::mem::take(&mut *state.pending.lock().unwrap());
    log::info!("Flushing {} pending notifications", pending.len());

    let window = app_handle
        .get_webview_window(CONTAINER_LABEL)
        .ok_or_else(|| "container not found".to_string())?;

    for p in pending {
        let payload = serde_json::json!({
            "id": p.id,
            "title": p.title,
            "body": p.body,
            "roomId": p.room_id,
            "stackDir": p.stack_dir,
        });
        if let Err(e) = window.emit("new-notif", payload) {
            log::error!("flush emit failed: {}", e);
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_notif_container(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window(CONTAINER_LABEL) {
        // hide() バグ回避のため画面外に移動して実質非表示にする
        let _ = win.set_position(tauri::PhysicalPosition {
            x: OFFSCREEN_X,
            y: OFFSCREEN_Y,
        });
    }
}

#[tauri::command]
fn close_notification(_app_handle: tauri::AppHandle, _label: String) {
    // 互換性のため残すがコンテナ方式では使わない
}

// ===========================================================================
// コマンド: 位置ピッカー
// ===========================================================================

#[tauri::command]
fn open_position_picker(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window(PICKER_LABEL) {
        let _ = win.close();
    }

    let saved = state.saved_position.lock().unwrap().clone();
    let (initial_x, initial_y) = resolve_window_position(&app_handle, saved.as_ref())
        .map(|(x, y, _)| (x, y))
        .unwrap_or((100, 100));

    let win = WebviewWindowBuilder::new(
        &app_handle,
        PICKER_LABEL,
        tauri::WebviewUrl::App("/notification-picker.html".into()),
    )
    .inner_size(PICKER_W as f64, PICKER_H as f64)
    .position(initial_x as f64, initial_y as f64)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| format!("picker build failed: {}", e))?;

    let _ = win.set_position(tauri::PhysicalPosition {
        x: initial_x,
        y: initial_y,
    });

    // F12 で開閉可能（devtools feature 有効）
    Ok(())
}

#[tauri::command]
fn open_devtools_for_picker(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window(PICKER_LABEL) {
        win.open_devtools();
    }
}

#[tauri::command]
fn open_devtools_for_container(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window(CONTAINER_LABEL) {
        win.open_devtools();
    }
}

// ログディレクトリをエクスプローラーで開く
#[tauri::command]
fn open_log_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("app_log_dir failed: {}", e))?;
    // ディレクトリがまだ作られていなければ作る
    if !path.exists() {
        std::fs::create_dir_all(&path).map_err(|e| format!("create_dir_all failed: {}", e))?;
    }
    // ログファイルが空でも何か書いておく
    let log_marker = path.join("opened_at.txt");
    let _ = std::fs::write(
        &log_marker,
        format!("Log dir opened: {:?}\n", std::time::SystemTime::now()),
    );

    let path_str = path.to_string_lossy().to_string();
    log::info!("Opening log dir: {}", path_str);
    // explorer で開く
    std::process::Command::new("explorer")
        .arg(&path_str)
        .spawn()
        .map_err(|e| format!("spawn explorer failed: {}", e))?;
    Ok(path_str)
}

#[tauri::command]
fn save_notification_position(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
) -> Result<SavedPosition, String> {
    let win = app_handle
        .get_webview_window(PICKER_LABEL)
        .ok_or_else(|| "picker window not found".to_string())?;

    let pos = win
        .outer_position()
        .map_err(|e| format!("outer_position failed: {}", e))?;

    let main = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitors = main
        .available_monitors()
        .map_err(|e| format!("monitors failed: {}", e))?;

    // ピッカー位置 (左上) から所属モニターを判定
    let found = monitors.iter().enumerate().find(|(_, m)| {
        let mp = m.position();
        let ms = m.size();
        pos.x >= mp.x
            && pos.x < mp.x + ms.width as i32
            && pos.y >= mp.y
            && pos.y < mp.y + ms.height as i32
    });

    let (monitor_idx, monitor) = match found {
        Some((i, m)) => (Some(i), m.clone()),
        None => {
            let m = monitors.first().cloned().ok_or_else(|| "no monitors".to_string())?;
            (Some(0), m)
        }
    };

    let mp = monitor.position();
    let ms = monitor.size();
    let x_in_monitor = pos.x - mp.x;
    let y_in_monitor = pos.y - mp.y;

    // y がモニター高の 1/3 未満なら下方向にスタック (top stack)、それ以外は上方向
    let stack_direction = if y_in_monitor < (ms.height as i32) / 3 {
        "down".to_string()
    } else {
        "up".to_string()
    };

    let saved = SavedPosition {
        monitor_index: monitor_idx,
        x_in_monitor,
        y_in_monitor,
        stack_direction: stack_direction.clone(),
    };

    {
        let mut lock = state.saved_position.lock().unwrap();
        *lock = Some(saved.clone());
    }

    let _ = win.close();

    if let Some(main) = app_handle.get_webview_window("main") {
        let _ = main.emit("position-saved", &saved);
    }

    // 既存コンテナがあれば即時再配置
    if let Some(container) = app_handle.get_webview_window(CONTAINER_LABEL) {
        if let Some((wx, wy, _)) = resolve_window_position(&app_handle, Some(&saved)) {
            let _ = container.set_position(tauri::PhysicalPosition { x: wx, y: wy });
        }
    }

    Ok(saved)
}

#[tauri::command]
fn cancel_position_picker(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window(PICKER_LABEL) {
        let _ = win.close();
    }
}

// メインウィンドウ内で完結する位置設定: 絶対物理ピクセル座標を受け取って保存
#[tauri::command]
fn save_position_absolute(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    x: i32,
    y: i32,
) -> Result<SavedPosition, String> {
    log::info!("save_position_absolute called: x={}, y={}", x, y);

    let main = app_handle
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitors = main
        .available_monitors()
        .map_err(|e| format!("monitors failed: {}", e))?;

    // 与えられた座標を含むモニターを判定
    let found = monitors.iter().enumerate().find(|(_, m)| {
        let mp = m.position();
        let ms = m.size();
        x >= mp.x && x < mp.x + ms.width as i32
            && y >= mp.y && y < mp.y + ms.height as i32
    });

    let (monitor_idx, monitor) = match found {
        Some((i, m)) => (Some(i), m.clone()),
        None => {
            // 座標がどのモニターにも含まれない場合は primary または 1 番目
            let m = main.primary_monitor().ok().flatten()
                .or_else(|| monitors.first().cloned())
                .ok_or_else(|| "no monitors".to_string())?;
            (Some(0), m)
        }
    };

    let mp = monitor.position();
    let ms = monitor.size();
    let x_in_monitor = x - mp.x;
    let y_in_monitor = y - mp.y;

    let stack_direction = if y_in_monitor < (ms.height as i32) / 3 {
        "down".to_string()
    } else {
        "up".to_string()
    };

    let saved = SavedPosition {
        monitor_index: monitor_idx,
        x_in_monitor,
        y_in_monitor,
        stack_direction,
    };

    {
        let mut lock = state.saved_position.lock().unwrap();
        *lock = Some(saved.clone());
    }

    log::info!("Saved position: {:?}", serde_json::to_string(&saved).ok());

    // 既存コンテナがあれば即時再配置
    if let Some(container) = app_handle.get_webview_window(CONTAINER_LABEL) {
        if let Some((wx, wy, _)) = resolve_window_position(&app_handle, Some(&saved)) {
            let _ = container.set_position(tauri::PhysicalPosition { x: wx, y: wy });
        }
    }

    Ok(saved)
}

#[tauri::command]
fn set_saved_position(state: tauri::State<'_, NotificationState>, saved: SavedPosition) {
    let mut lock = state.saved_position.lock().unwrap();
    *lock = Some(saved);
}

#[tauri::command]
fn get_saved_position(state: tauri::State<'_, NotificationState>) -> Option<SavedPosition> {
    state.saved_position.lock().unwrap().clone()
}

#[tauri::command]
fn get_available_monitors(app_handle: tauri::AppHandle) -> Vec<MonitorInfo> {
    let Some(win) = app_handle.get_webview_window("main") else {
        return vec![];
    };
    let monitors = match win.available_monitors() {
        Ok(m) => m,
        Err(_) => return vec![],
    };
    let primary = win.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| {
        let p = m.position();
        (p.x, p.y)
    });

    monitors
        .iter()
        .enumerate()
        .map(|(idx, m)| {
            let s = m.size();
            let p = m.position();
            let is_primary = primary_pos.map_or(false, |(px, py)| px == p.x && py == p.y);
            MonitorInfo {
                index: idx,
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", idx + 1)),
                x: p.x,
                y: p.y,
                width: s.width,
                height: s.height,
                is_primary,
                scale_factor: m.scale_factor(),
            }
        })
        .collect()
}

// ===========================================================================
// グローバルショートカット
// ===========================================================================

fn char_to_code(key: &str) -> Option<tauri_plugin_global_shortcut::Code> {
    use tauri_plugin_global_shortcut::Code;
    match key.to_uppercase().as_str() {
        "A" => Some(Code::KeyA), "B" => Some(Code::KeyB), "C" => Some(Code::KeyC),
        "D" => Some(Code::KeyD), "E" => Some(Code::KeyE), "F" => Some(Code::KeyF),
        "G" => Some(Code::KeyG), "H" => Some(Code::KeyH), "I" => Some(Code::KeyI),
        "J" => Some(Code::KeyJ), "K" => Some(Code::KeyK), "L" => Some(Code::KeyL),
        "M" => Some(Code::KeyM), "N" => Some(Code::KeyN), "O" => Some(Code::KeyO),
        "P" => Some(Code::KeyP), "Q" => Some(Code::KeyQ), "R" => Some(Code::KeyR),
        "S" => Some(Code::KeyS), "T" => Some(Code::KeyT), "U" => Some(Code::KeyU),
        "V" => Some(Code::KeyV), "W" => Some(Code::KeyW), "X" => Some(Code::KeyX),
        "Y" => Some(Code::KeyY), "Z" => Some(Code::KeyZ),
        _ => None,
    }
}

#[tauri::command]
fn update_shortcut_key(app_handle: tauri::AppHandle, key: String) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};
    let _ = app_handle.global_shortcut().unregister_all();
    if let Some(code) = char_to_code(&key) {
        let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), code);
        let _ = app_handle.global_shortcut().register(shortcut);
    }
}

// ===========================================================================
// run()
// ===========================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(NotificationState::default())
        .invoke_handler(tauri::generate_handler![
            enqueue_notification,
            container_loaded,
            hide_notif_container,
            resize_notif_container,
            close_notification,
            open_position_picker,
            save_notification_position,
            cancel_position_picker,
            save_position_absolute,
            set_saved_position,
            get_saved_position,
            get_available_monitors,
            update_shortcut_key,
            open_devtools_for_picker,
            open_devtools_for_container,
            open_log_dir,
        ])
        .setup(|app| {
            let _handle = app.handle().clone();

            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState, ShortcutEvent};

            let ctrl_shift_s = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);

            let shortcut_plugin = {
                let h = app.handle().clone();
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, _sc, event: ShortcutEvent| {
                        if event.state() == ShortcutState::Pressed {
                            if let Some(window) = h.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                                let _ = window.eval("if(window.focusMessageInput) window.focusMessageInput()");
                            }
                        }
                    })
                    .build()
            };
            app.handle().plugin(shortcut_plugin)?;

            let _ = app.global_shortcut().register(ctrl_shift_s);

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show SimpleChat", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => { app.exit(0); }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: None }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
