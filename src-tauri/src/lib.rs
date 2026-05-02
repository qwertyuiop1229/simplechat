use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}, Manager, WindowEvent, Emitter};
use tauri::WebviewWindowBuilder;
use std::sync::Mutex;

#[derive(Default)]
struct NotificationState {
    active_notifications: Mutex<Vec<String>>,
}

fn get_screen_rect(app_handle: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    if let Some(win) = app_handle.get_webview_window("main") {
        if let Ok(Some(m)) = win.current_monitor() {
            let s = m.size(); let p = m.position();
            return Some((s.width as i32, s.height as i32, p.x, p.y));
        }
        if let Ok(Some(m)) = win.primary_monitor() {
            let s = m.size(); let p = m.position();
            return Some((s.width as i32, s.height as i32, p.x, p.y));
        }
    }
    None
}

fn emit_notification_positions(
    app_handle: &tauri::AppHandle,
    active: &[String],
    skip_label: Option<&str>,
) {
    let spacing = 110;
    let base_y = 140;
    let Some((sw, sh, sx, sy)) = get_screen_rect(app_handle) else { return };
    let tx = sx + sw - 380;

    for (i, label) in active.iter().rev().enumerate() {
        if skip_label.map_or(false, |s| s == label) { continue; }
        let ty = sy + sh - base_y - (i as i32 * spacing);
        if let Some(win) = app_handle.get_webview_window(label) {
            let _ = win.emit("move-to", serde_json::json!({ "x": tx, "y": ty }));
        }
    }
}

#[tauri::command]
fn show_notification_window(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    title: String,
    body: String,
    room_id: String,
) {
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("notification_{}", id);
    let url = format!(
        "/notification.html?title={}&body={}&roomId={}&id={}",
        urlencoding::encode(&title),
        urlencoding::encode(&body),
        urlencoding::encode(&room_id),
        urlencoding::encode(&id)
    );

    let screen_rect = get_screen_rect(&app_handle);

    let notification_window = WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into()),
    )
    .inner_size(360.0, 100.0)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build()
    .unwrap();

    {
        let mut active = state.active_notifications.lock().unwrap();
        let new_index = active.len();

        // 新しいウィンドウを表示前に正しい位置に配置
        if let Some((sw, sh, sx, sy)) = screen_rect {
            let tx = sx + sw - 380;
            let ty = sy + sh - 140 - (new_index as i32 * 110);
            let _ = notification_window.set_position(tauri::PhysicalPosition { x: tx, y: ty });
        }

        active.push(label.clone());

        // 既存ウィンドウをアニメーション付きで上にスライド
        emit_notification_positions(&app_handle, &active, Some(&label));
    }

    let _ = notification_window.show();
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
        emit_notification_positions(&app_handle, &active, None);
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
