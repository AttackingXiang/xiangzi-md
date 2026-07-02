use serde::Serialize;
use std::{fmt, io};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
            retryable: false,
        }
    }

    pub fn io(context: &str, error: io::Error) -> Self {
        Self {
            code: "io_error".into(),
            message: format!("{context}: {error}"),
            details: None,
            retryable: matches!(
                error.kind(),
                io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
            ),
        }
    }

    pub fn forbidden(path: &std::path::Path) -> Self {
        Self::new(
            "path_not_allowed",
            format!("未授权访问该路径：{}", path.display()),
        )
    }

    pub fn task(message: impl Into<String>) -> Self {
        Self::new("background_task_failed", message)
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn conflict(path: &std::path::Path) -> Self {
        Self::new(
            "file_conflict",
            "文件已被其他程序修改，请重新加载、比较差异或确认覆盖",
        )
        .with_details(serde_json::json!({ "path": path.to_string_lossy() }))
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}
