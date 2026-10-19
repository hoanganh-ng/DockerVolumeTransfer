/// Escapes a shell argument by wrapping it in single quotes and escaping inner quotes.
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape_volume_name() {
        assert_eq!(shell_escape("my-vol.v2"), "'my-vol.v2'");
        assert_eq!(shell_escape("vol with spaces"), "'vol with spaces'");
        assert_eq!(shell_escape("vol'quote"), "'vol'\\''quote'");
        assert_eq!(shell_escape("simple"), "'simple'");
    }

    #[test]
    fn test_shell_escape_review_focus() {
        assert_eq!(shell_escape("vol'quote"), "'vol'\\''quote'");
        assert_eq!(shell_escape("vol with spaces"), "'vol with spaces'");
        assert_eq!(shell_escape("my-vol.v2"), "'my-vol.v2'");
        assert_eq!(shell_escape(""), "''");
        assert_eq!(shell_escape("a'b'c"), "'a'\\''b'\\''c'");
    }
}
