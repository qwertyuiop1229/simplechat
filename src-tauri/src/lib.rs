use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}, Manager, WindowEvent, Emitter};
use tauri::WebviewWindowBuilder;
use std::sync::Mutex;

#[derive(Default)]
struct NotificationState {
    active_notifications: Mutex<Vec<String>>,
    // 最後に使った位置情報。close 時の再配置にも使う。
    last_position: Mutex<Option<(Option<usize>, String)>>, // (monitor_index, position_key)
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

const NOTIF_W: i32 = 360;
const NOTIF_H: i32 = 100;
const STACK_SPACING: i32 = 110;
const SCREEN_MARGIN: i32 = 20;

// monitor_index が指定されていればそのインデックスのモニターを、
// そうでなければ current_monitor → primary_monitor の順で返す。
// 戻り値: (monitor_x, monitor_y, monitor_w, monitor_h)
fn get_monitor_rect(
    app_handle: &tauri::AppHandle,
    monitor_index: Option<usize>,
) -> Option<(i32, i32, i32, i32)> {
    let win = app_handle.get_webview_window("main")?;
    if let Some(idx) = monitor_index {
        if let Ok(monitors) = win.available_monitors() {
            if let Some(m) = monitors.get(idx) {
                let s = m.size();
                let p = m.position();
                return Some((p.x, p.y, s.width as i32, s.height as i32));
            }
        }
    }
    if let Ok(Some(m)) = win.current_monitor() {
        let s = m.size(); let p = m.position();
        return Some((p.x, p.y, s.width as i32, s.height as i32));
    }
    if let Ok(Some(m)) = win.primary_monitor() {
        let s = m.size(); let p = m.position();
        return Some((p.x, p.y, s.width as i32, s.height as i32));
    }
    None
}

// position は "top-left", "top-center", ..., "bottom-right" の9種
// stack_idx: 0 が「最新」(基準位置)、1, 2, ... がそれより古い
fn calc_position(
    mx: i32, my: i32, mw: i32, mh: i32,
    position: &str,
    stack_idx: i32,
) -> (i32, i32) {
    let stack_offset = stack_idx * STACK_SPACING;
    let parts: Vec<&str> = position.split('-').collect();
    let v = parts.first().copied().unwrap_or("bottom");
    let h = parts.get(1).copied().unwrap_or("right");

    let x = match h {
        "left"   => mx + SCREEN_MARGIN,
        "center" => mx + (mw - NOTIF_W) / 2,
        _        => mx + mw - NOTIF_W - SCREEN_MARGIN,  // right
    };
    let y_base = match v {
        "top"    => my + SCREEN_MARGIN,
        "middle" => my + (mh - NOTIF_H) / 2,
        _        => my + mh - NOTIF_H - SCREEN_MARGIN,  // bottom
    };
    // top の場合は古いものが下に、bottom/middle の場合は古いものが上に積む
    let y = if v == "top" { y_base + stack_offset } else { y_base - stack_offset };
    (x, y)
}

fn emit_notification_positions(
    app_handle: &tauri::AppHandle,
    state: &tauri::State<'_, NotificationState>,
    active: &[String],
    skip_label: Option<&str>,
) {
    let last = state.last_position.lock().unwrap();
    let (monitor_idx, position) = match last.as_ref() {
        Some((m, p)) => (*m, p.clone()),
        None => (None, "bottom-right".to_string()),
    };
    drop(last);

    let Some((mx, my, mw, mh)) = get_monitor_rect(app_handle, monitor_idx) else { return };

    for (i, label) in active.iter().rev().enumerate() {
        if skip_label.map_or(false, |s| s == label) { continue; }
        let (tx, ty) = calc_position(mx, my, mw, mh, &position, i as i32);
        if let Some(win) = app_handle.get_webview_window(label) {
            let _ = win.emit("move-to", serde_json::json!({ "x": tx, "y": ty }));
        }
    }
}

#[tauri::command]
fn get_available_monitors(app_handle: tauri::AppHandle) -> Vec<MonitorInfo> {
    let Some(win) = app_handle.get_webview_window("main") else { return vec![]; };
    let monitors = match win.available_monitors() {
        Ok(m) => m,
        Err(_) => return vec![],
    };
    let primary = win.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| {
        let p = m.position();
        (p.x, p.y)
    });

    monitors.iter().enumerate().map(|(idx, m)| {
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
    }).collect()
}

#[tauri::command]
fn show_notification_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    title: String,
    body: String,
    room_id: String,
    monitor_index: Option<usize>,
    position: Option<String>,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("notification_{}", id);
    let url = format!(
        "/notification.html?title={}&body={}&roomId={}&id={}",
        urlencoding::encode(&title),
        urlencoding::encode(&body),
        urlencoding::encode(&room_id),
        urlencoding::encode(&id)
    );

    let pos_key = position.unwrap_or_else(|| "bottom-right".to_string());
    // 設定をstateに保存（close時の再配置でも使う）
    {
        let mut last = state.last_position.lock().unwrap();
        *last = Some((monitor_index, pos_key.clone()));
    }

    let monitor_rect = get_monitor_rect(&app_handle, monitor_index);

    // 注:
    // - transparent(true) は Tauri v2 + WebView2 の一部 Windows 環境で
    //   ウィンドウが完全に不可視になるバグがあるため使わない
    // - visible(false) → show() のパターンも一部環境で show() が
    //   無視されるバグがあるため、最初から visible(true) で画面外に作って
    //   set_position で正しい位置に移動する方式に変更
    let new_index = state.active_notifications.lock().unwrap().len();

    // 最終的に表示したい位置を計算
    let target_pos = monitor_rect.map(|(mx, my, mw, mh)| {
        calc_position(mx, my, mw, mh, &pos_key, new_index as i32)
    });

    // ビルド時には画面外に置いてフラッシュを防ぐ
    let initial_x = target_pos.map(|(x, _)| x).unwrap_or(-9999);
    let initial_y = target_pos.map(|(_, y)| y).unwrap_or(-9999);

    let notification_window = WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .inner_size(NOTIF_W as f64, NOTIF_H as f64)
    .position(initial_x as f64, initial_y as f64)
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    // visible はデフォルト true。明示的な show() は呼ばない
    .build()
    .map_err(|e| format!("WebviewWindowBuilder build failed: {}", e))?;

    {
        let mut active = state.active_notifications.lock().unwrap();

        // physical pixel での正確な位置に再設定（DPI対応）
        if let Some((tx, ty)) = target_pos {
            notification_window
                .set_position(tauri::PhysicalPosition { x: tx, y: ty })
                .map_err(|e| format!("set_position failed: {}", e))?;
        }

        active.push(label.clone());

        // 既存ウィンドウをアニメーション付きで反対方向にスライド
        emit_notification_positions(&app_handle, &state, &active, Some(&label));
    }

    Ok(())
}

#[tauri::command]
fn close_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    label: String,
) {
    if let Some(win) = app_handle.get_webview_window(&label) {
        let _ = win.close();
    }
    let mut active = state.active_notifications.lock().unwrap();
    if let Some(pos) = active.iter().position(|l| l == &label) {
        active.remove(pos);
        emit_notification_positions(&app_handle, &state, &active, None);
    }
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(NotificationState::default())
    .invoke_handler(tauri::generate_handler![
        show_notification_window,
        close_notification,
        update_shortcut_key,
        get_available_monitors,
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
            } = event {
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
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec![]),
    ))
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
