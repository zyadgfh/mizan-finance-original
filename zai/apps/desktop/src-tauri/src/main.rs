// File: zai/apps/desktop/src-tauri/src/main.rs
// Z-Ai desktop shell entrypoint. The window loads the same /zai web build
// used by the browser and mobile apps (see tauri.conf.json build.devUrl /
// frontendDist) — no separate desktop UI code to maintain.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Z-Ai desktop application");
}
