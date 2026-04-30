use tauri::{tray::TrayIconBuilder, menu::{Menu, MenuItem}, Manager, WindowEvent};
use tauri::WebviewWindowBuilder;

#[tauri::command]
fn show_notification_window(app_handle: tauri::AppHandle, title: String, body: String, room_id: String) {
    // 既存の通知ウィンドウがあれば閉じる
    if let Some(window) = app_handle.get_webview_window("notification") {
        let _ = window.close();
    }

    // クエリパラメータで通知内容を渡す
    let url = format!("/notification.html?title={}&body={}&roomId={}", 
        urlencoding::encode(&title), 
        urlencoding::encode(&body),
        urlencoding::encode(&room_id)
    );

    let _notification_window = WebviewWindowBuilder::new(
        &app_handle,
        "notification",
        tauri::WebviewUrl::App(url.into())
    )
    .inner_size(360.0, 100.0)
    .always_on_top(true)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false) // 初期は非表示（画面外に配置するため）
    .build()
    .unwrap();

    // 画面の右下に配置
    if let Some(window) = app_handle.get_webview_window("notification") {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let size = monitor.size();
            let position = tauri::PhysicalPosition {
                x: (size.width as i32) - 380, // 右端から20px
                y: (size.height as i32) - 140, // 下端から40px
            };
            let _ = window.set_position(position);
            let _ = window.show();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![show_notification_window])
    .setup(|app| {
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
                    let _ = window.eval("if(window.blockingUpdateCheck) window.blockingUpdateCheck()");
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
                    let _ = window.eval("if(window.blockingUpdateCheck) window.blockingUpdateCheck()");
                }
            }
        })
        .build(app)?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window.hide();
        }
    })
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.eval("if(window.blockingUpdateCheck) window.blockingUpdateCheck()");
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
