use crate::domain::error::{AppError, AppResult};

const MAX_CUSTOM_PANDOC_ARGS: usize = 64;

/// Parses common command-line quoting but returns argv directly to Command;
/// custom values are never evaluated by a shell.
pub(super) fn parse_pandoc_args(raw: &str) -> AppResult<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Quote {
        None,
        Single,
        Double,
    }

    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = Quote::None;
    let mut escaped = false;

    for ch in raw.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match (quote, ch) {
            (Quote::None | Quote::Double, '\\') => escaped = true,
            (Quote::None, '\'') => quote = Quote::Single,
            (Quote::None, '"') => quote = Quote::Double,
            (Quote::Single, '\'') => quote = Quote::None,
            (Quote::Double, '"') => quote = Quote::None,
            (Quote::None, value) if value.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            (_, value) => current.push(value),
        }
    }

    if escaped || quote != Quote::None {
        return Err(AppError::new(
            "pandoc_args_invalid",
            "Pandoc 附加参数中存在未闭合的引号或转义符",
        ));
    }
    if !current.is_empty() {
        args.push(current);
    }
    if args.len() > MAX_CUSTOM_PANDOC_ARGS {
        return Err(AppError::new(
            "pandoc_args_invalid",
            format!("Pandoc 附加参数不能超过 {MAX_CUSTOM_PANDOC_ARGS} 项"),
        ));
    }
    if let Some(argument) = args
        .iter()
        .find(|argument| is_reserved_pandoc_arg(argument))
    {
        return Err(AppError::new(
            "pandoc_args_reserved",
            format!("参数 {argument} 由应用管理，请使用对应设置项"),
        ));
    }
    Ok(args)
}

fn is_reserved_pandoc_arg(argument: &str) -> bool {
    const LONG: &[&str] = &[
        "--from",
        "--to",
        "--output",
        "--extract-media",
        "--reference-doc",
    ];
    LONG.iter()
        .any(|name| argument == *name || argument.starts_with(&format!("{name}=")))
        || ["-f", "-t", "-o"].iter().any(|name| {
            argument == *name
                || (argument.starts_with(name)
                    && argument.len() > name.len()
                    && !argument.starts_with("--"))
        })
}

#[cfg(test)]
mod tests {
    use super::parse_pandoc_args;

    #[test]
    fn rejects_more_arguments_than_the_bounded_argv_allows() {
        let raw = std::iter::repeat_n("--standalone", 65)
            .collect::<Vec<_>>()
            .join(" ");
        let error = parse_pandoc_args(&raw).expect_err("argument count should be bounded");
        assert_eq!(error.code, "pandoc_args_invalid");
    }
}
