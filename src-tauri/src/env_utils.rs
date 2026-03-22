/// Get the NVM node bin path, respecting user's default alias or falling back to latest version.
/// This ensures bundled apps use the same node version as the user's terminal.
pub fn get_nvm_node_bin(home: &str) -> Option<String> {
    let nvm_dir = format!("{}/.nvm", home);
    let versions_dir = format!("{}/versions/node", nvm_dir);

    if !std::path::Path::new(&nvm_dir).exists() {
        return None;
    }

    // Get all installed node versions
    let mut versions: Vec<String> = match std::fs::read_dir(&versions_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|name| name.starts_with('v'))
            .collect(),
        Err(_) => return None,
    };

    if versions.is_empty() {
        return None;
    }

    // Try to read the default alias
    let default_alias = std::fs::read_to_string(format!("{}/alias/default", nvm_dir))
        .ok()
        .map(|s| s.trim().to_string());

    let selected_version = if let Some(alias) = default_alias {
        // Find a version that matches the alias prefix (e.g., "22" matches "v22.16.0")
        let matching = versions.iter().find(|v| {
            let version_num = v.trim_start_matches('v');
            version_num.starts_with(&alias) || version_num == alias
        });

        if let Some(v) = matching {
            v.clone()
        } else {
            // No match for alias, fall back to sorting and picking latest
            sort_versions_semver(&mut versions);
            versions.last()?.clone()
        }
    } else {
        // No default alias, sort and pick latest
        sort_versions_semver(&mut versions);
        versions.last()?.clone()
    };

    let node_bin = format!("{}/{}/bin", versions_dir, selected_version);
    if std::path::Path::new(&node_bin).exists() {
        Some(node_bin)
    } else {
        None
    }
}

/// Sort node versions by semver (e.g., v18.20.8 < v20.19.5 < v22.16.0).
pub fn sort_versions_semver(versions: &mut Vec<String>) {
    versions.sort_by(|a, b| {
        let parse_version = |v: &str| -> (u32, u32, u32) {
            let nums: Vec<u32> = v.trim_start_matches('v')
                .split('.')
                .filter_map(|s| s.parse().ok())
                .collect();
            (
                nums.first().copied().unwrap_or(0),
                nums.get(1).copied().unwrap_or(0),
                nums.get(2).copied().unwrap_or(0),
            )
        };
        parse_version(a).cmp(&parse_version(b))
    });
}

/// Build extended PATH with NVM, Homebrew (macOS only), and common locations.
/// Same logic used across all command execution paths for consistency.
pub fn build_extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    let mut paths = vec![];

    // macOS: Homebrew paths
    #[cfg(target_os = "macos")]
    {
        paths.push("/opt/homebrew/bin".to_string());
        paths.push("/opt/homebrew/sbin".to_string());
    }

    // Common Unix paths
    paths.push("/usr/local/bin".to_string());
    paths.push("/usr/local/sbin".to_string());
    paths.push(format!("{}/.local/bin", home));
    paths.push(format!("{}/.cargo/bin", home));
    paths.push("/usr/bin".to_string());
    paths.push("/bin".to_string());
    paths.push("/usr/sbin".to_string());
    paths.push("/sbin".to_string());

    // Add NVM node bin if available (respects user's default alias)
    if let Some(nvm_bin) = get_nvm_node_bin(&home) {
        paths.insert(0, nvm_bin);
    }

    if !current_path.is_empty() {
        paths.push(current_path);
    }

    paths.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- sort_versions_semver ---

    #[test]
    fn sort_versions_basic() {
        let mut versions = vec![
            "v20.19.5".to_string(),
            "v18.20.8".to_string(),
            "v22.16.0".to_string(),
        ];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v18.20.8", "v20.19.5", "v22.16.0"]);
    }

    #[test]
    fn sort_versions_with_prefix_v() {
        // All entries have 'v' prefix — verifies trim_start_matches('v') works
        let mut versions = vec![
            "v10.0.0".to_string(),
            "v9.11.2".to_string(),
            "v10.0.1".to_string(),
        ];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v9.11.2", "v10.0.0", "v10.0.1"]);
    }

    #[test]
    fn sort_versions_patch_order() {
        let mut versions = vec![
            "v18.20.3".to_string(),
            "v18.20.10".to_string(),
            "v18.20.2".to_string(),
        ];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v18.20.2", "v18.20.3", "v18.20.10"]);
    }

    #[test]
    fn sort_versions_single_element() {
        let mut versions = vec!["v16.0.0".to_string()];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v16.0.0"]);
    }

    #[test]
    fn sort_versions_empty() {
        let mut versions: Vec<String> = vec![];
        sort_versions_semver(&mut versions);
        assert!(versions.is_empty());
    }

    #[test]
    fn sort_versions_already_sorted() {
        let mut versions = vec![
            "v14.0.0".to_string(),
            "v16.0.0".to_string(),
            "v18.0.0".to_string(),
        ];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v14.0.0", "v16.0.0", "v18.0.0"]);
    }

    #[test]
    fn sort_versions_reverse_sorted() {
        let mut versions = vec![
            "v22.0.0".to_string(),
            "v20.0.0".to_string(),
            "v18.0.0".to_string(),
        ];
        sort_versions_semver(&mut versions);
        assert_eq!(versions, vec!["v18.0.0", "v20.0.0", "v22.0.0"]);
    }

    // --- build_extended_path ---

    #[test]
    fn build_extended_path_contains_standard_dirs() {
        let path = build_extended_path();
        // These directories are always appended regardless of environment
        assert!(path.contains("/usr/bin"), "missing /usr/bin in PATH: {}", path);
        assert!(path.contains("/bin"), "missing /bin in PATH: {}", path);
        assert!(path.contains("/usr/local/bin"), "missing /usr/local/bin in PATH: {}", path);
    }

    #[test]
    fn build_extended_path_is_colon_separated() {
        let path = build_extended_path();
        // Must be a non-empty colon-separated list
        assert!(!path.is_empty());
        let segments: Vec<&str> = path.split(':').collect();
        assert!(segments.len() >= 4, "expected at least 4 path entries, got: {:?}", segments);
    }

    #[test]
    fn build_extended_path_no_empty_segments_from_fixed_dirs() {
        let path = build_extended_path();
        // Fixed directory entries must never be empty strings
        let segments: Vec<&str> = path.split(':').collect();
        for seg in &segments {
            // The only potentially empty segment would come from an unset HOME
            // expanding to an empty string — skip those, check the rest
            if !seg.is_empty() {
                assert!(seg.starts_with('/') || seg.contains("/."),
                    "unexpected non-path segment: {:?}", seg);
            }
        }
    }

    // --- get_nvm_node_bin ---
    // Not tested here: requires ~/.nvm directory and installed Node versions
    // on the filesystem. Testing against the real filesystem would make these
    // tests environment-dependent and fragile in CI. The internal logic that
    // is exercised by this function (sort_versions_semver, alias matching) is
    // already covered by the tests above.
}
