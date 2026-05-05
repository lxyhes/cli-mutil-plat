//! Git commands

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<String>,
    pub modified: Vec<String>,
    pub untracked: Vec<String>,
}

#[tauri::command]
pub async fn git_get_status(work_dir: String) -> Result<GitStatus, String> {
    use tokio::process::Command;

    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&work_dir)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut staged = Vec::new();
    let mut modified = Vec::new();
    let mut untracked = Vec::new();

    for line in stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = &line[0..2];
        let file = &line[3..];
        match status {
            "M " | "MM" => modified.push(file.to_string()),
            "??" => untracked.push(file.to_string()),
            _ => {
                if status.chars().all(|c| c == ' ' || c == 'M' || c == 'A') {
                    if !status.contains('?') {
                        staged.push(file.to_string());
                    }
                }
            }
        }
    }

    let branch = String::from_utf8_lossy(
        &Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&work_dir)
            .output()
            .await
            .map_err(|e| e.to_string())?
            .stdout,
    )
    .trim()
    .to_string();

    Ok(GitStatus {
        branch,
        ahead: 0,
        behind: 0,
        staged,
        modified,
        untracked,
    })
}

#[tauri::command]
pub async fn git_commit(work_dir: String, message: String) -> Result<String, String> {
    use tokio::process::Command;

    let output = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&work_dir)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok("Commit successful".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_stage(work_dir: String, file: String) -> Result<(), String> {
    use tokio::process::Command;

    Command::new("git")
        .args(["add", &file])
        .current_dir(&work_dir)
        .output()
        .await
        .map_err(|e| e.to_string())?
        .status
        .success()
        .then_some(())
        .ok_or_else(|| "git add failed".to_string())
}
