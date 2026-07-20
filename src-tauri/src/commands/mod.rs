pub mod app;
pub mod assets;
pub mod attachment;
pub mod drafts;
pub mod pandoc;
pub mod raster_export;
pub mod search;
pub mod settings;
pub mod updates;
pub mod workspace;

use crate::domain::error::{AppError, AppResult};

pub async fn blocking<T, F>(task: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::task(error.to_string()))?
}
