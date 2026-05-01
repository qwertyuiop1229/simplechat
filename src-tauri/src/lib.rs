use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}, Manager, WindowEvent};
use tauri::WebviewWindowBuilder;
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

#[derive(Default)]
struct NotificationState {
    active_notifications: Mutex<Vec<String>>,
}

#[tauri::command]
fn show_notification_window(
    app_handle: tauri::AppHandle, 
    state: tauri::State<'_, NotificationState>,
    title: String, 
    body: String, 
    room_id: String
) {
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("notification_{}", id);

    // クエリパラメータで通知内容を渡す
    let url = format!("/notification.html?title={}&body={}&roomId={}&id={}", 
        urlencoding::encode(&title), 
        urlencoding::encode(&body),
        urlencoding::encode(&room_id),
        urlencoding::encode(&id)
    );

    let notification_window = WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::App(url.into())
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

    // 通知をリストに追加
    {
        let mut active = state.active_notifications.lock().unwrap();
        active.push(label.clone());
        
        // 全通知の位置を更新
        update_notification_positions(&app_handle, &active);
    }

    let _ = notification_window.show();
}

#[tauri::command]
fn close_notification(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, NotificationState>,
    label: String
) {
    if let Some(window) = app_handle.get_webview_window(&label) {
        let _ = window.close();
    }

    let mut active = state.active_notifications.lock().unwrap();
    if let Some(pos) = active.iter().position(|l| l == &label) {
        active.remove(pos);
        update_notification_positions(&app_handle, &active);
    }
}

fn update_notification_positions(app_handle: &tauri::AppHandle, active: &[String]) {
    // 画面の右下に配置。新しいものが下、古いものが上。
    // LINEのように、新しいものが一番下に来るようにする。
    let spacing = 110; // ウィンドウの高さ + 余白
    let base_y_offset = 140; // 一番下の通知のY位置（下端からの距離）

    for (i, label) in active.iter().rev().enumerate() {
        if let Some(window) = app_handle.get_webview_window(label) {
            if let Ok(Some(monitor)) = window.current_monitor() {
                let size = monitor.size();
                let position = tauri::PhysicalPosition {
                    x: (size.width as i32) - 380, // 右端から20px
                    y: (size.height as i32) - base_y_offset - (i as i32 * spacing),
                };
                let _ = window.set_position(position);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(NotificationState::default())
    .invoke_handler(tauri::generate_handler![show_notification_window, close_notification])
    .setup(|app| {
      let handle = app.handle().clone();
      
      // グローバルショートカットの登録
      // デフォルトは Ctrl+Shift+S (SimpleChatのS)
      // ユーザー設定はフロントエンドで行うが、ここではバックエンドの登録を行う
      use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

      let ctrl_shift_s = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyS);
      
      app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::with_handler(move |app, shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.eval("if(window.focusMessageInput) window.focusMessageInput()");
                }
            }
        })
        .build(),
      )?;

      let _ = app.global_shortcut().register(ctrl_shift_s);

      let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let show_i = MenuItem::with_id(app, "show", "Show SimpleChat", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
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
            // メインウィンドウが閉じられようとしたら隠すだけに（トレイ常駐）
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
