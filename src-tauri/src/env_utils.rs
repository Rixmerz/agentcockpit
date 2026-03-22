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
