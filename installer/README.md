# Obsidian v1.12.7 Windows Installer

GitHub 100MB 제한으로 인해 95MB 단위로 분할되어 있습니다.

## 복원 방법

### Windows (PowerShell)
```powershell
Get-Content Obsidian-1.12.7.exe.partaa, Obsidian-1.12.7.exe.partab, Obsidian-1.12.7.exe.partac -Encoding Byte -ReadCount 0 | Set-Content Obsidian-1.12.7.exe -Encoding Byte
```

### Linux / macOS / MSYS2
```bash
cat Obsidian-1.12.7.exe.part* > Obsidian-1.12.7.exe
```

## 파일 정보

| 파일 | 크기 |
|------|------|
| Obsidian-1.12.7.exe.partaa | 95 MB |
| Obsidian-1.12.7.exe.partab | 95 MB |
| Obsidian-1.12.7.exe.partac | 92 MB |
| **원본 합계** | **282 MB** |

- 버전: v1.12.7
- 원본 출처: https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.12.7
