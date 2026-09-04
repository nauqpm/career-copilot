# M1 — Backup và khôi phục local

Áp dụng cho dữ liệu JSON/Markdown hiện tại. Không migration, không upload, không archive engine. Backup chứa dữ liệu nghề nghiệp riêng tư và không được đưa vào Git.

Artifact storage yêu cầu filesystem local hỗ trợ hard link và atomic rename (ví dụ NTFS). Volume không hỗ trợ sẽ báo lỗi ghi, không chuyển sang cách ghi đè thiếu an toàn. Bản backup có thể được copy sang volume khác; trước khi chạy ứng dụng trên bản restore, chọn filesystem hỗ trợ các thao tác này.

## Trước khi copy

1. Dừng dashboard, CLI và agent đang ghi; đóng editor đang sửa artifact.
2. Xác định đúng workspace root (mặc định repository, hoặc `CAREER_WORKSPACE_ROOT` khi chạy dashboard). Thư mục cần backup là `data/` bên dưới root đó.
3. Chọn destination local mới bên ngoài repository và ngoài source workspace. Không merge vào một backup cũ.
4. Không dùng symlink/junction trong cây dữ liệu. Nếu còn `.lock` hoặc `.tmp`, kiểm tra theo mục recovery trước khi tiếp tục; không âm thầm bỏ chúng rồi gọi đó là backup hợp lệ.

## Copy và đối chiếu trên PowerShell

Thay các đường dẫn ví dụ bằng workspace/destination bạn đã kiểm tra. Script chỉ copy; không xóa hay thay thế dữ liệu hiện có. Dừng mọi writer trước khi chạy và giữ chúng dừng đến hết bước đối chiếu.

```powershell
$workspacePath = (Resolve-Path -LiteralPath 'C:\CareerWorkspace').Path
$sourceDataPath = (Resolve-Path -LiteralPath (Join-Path $workspacePath 'data')).Path
$backupPath = [IO.Path]::GetFullPath('C:\CareerBackups\backup-2026-09-04-01')
$restorePath = [IO.Path]::GetFullPath('C:\CareerRestores\restore-2026-09-04-01')

function Assert-PlainDirectoryPath([string]$path) {
  $candidate = [IO.Path]::GetFullPath($path)
  while ($candidate) {
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked path: $candidate" }
      if (-not $item.PSIsContainer) { throw "Not a directory: $candidate" }
    }
    $parent = Split-Path -Parent $candidate
    if ($parent -eq $candidate) { break }
    $candidate = $parent
  }
}

function Get-DataManifest([string]$base) {
  function Visit-Data([string]$directory) {
    foreach ($item in Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked data: $($item.FullName)" }
      if ($item.Name -match '\.(lock|tmp)$') { throw "Unresolved writer state: $($item.FullName)" }
      if ($item.PSIsContainer) { Visit-Data $item.FullName }
      else {
        $name = $item.FullName.Substring($base.TrimEnd('\').Length + 1)
        $digest = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
        "$name`t$digest"
      }
    }
  }
  @(Visit-Data $base | Sort-Object)
}

foreach ($path in @($sourceDataPath, $backupPath, $restorePath)) { Assert-PlainDirectoryPath $path }
foreach ($destination in @($backupPath, $restorePath)) {
  if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }
  if ($destination.Equals($workspacePath, [StringComparison]::OrdinalIgnoreCase) -or
      $destination.StartsWith($workspacePath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use a destination outside the source workspace/repository.'
  }
}
if ($restorePath.Equals($backupPath, [StringComparison]::OrdinalIgnoreCase) -or
    $restorePath.StartsWith($backupPath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $backupPath.StartsWith($restorePath.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup and restore roots must be separate.'
}
$originalManifest = @(Get-DataManifest $sourceDataPath)
New-Item -ItemType Directory -Path $backupPath -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $sourceDataPath -Destination $backupPath -Recurse -ErrorAction Stop
$backupDataPath = Join-Path $backupPath 'data'
if (($originalManifest -join "`n") -cne (@(Get-DataManifest $backupDataPath) -join "`n")) { throw 'Backup hashes differ' }
if (($originalManifest -join "`n") -cne (@(Get-DataManifest $sourceDataPath) -join "`n")) { throw 'Source changed during backup; stop writers and retry into a new destination' }

New-Item -ItemType Directory -Path $restorePath -ErrorAction Stop | Out-Null
Copy-Item -LiteralPath $backupDataPath -Destination $restorePath -Recurse -ErrorAction Stop
if (($originalManifest -join "`n") -cne (@(Get-DataManifest (Join-Path $restorePath 'data')) -join "`n")) { throw 'Restore hashes differ' }
Write-Output 'Backup and new-root restore have identical relative file paths and SHA-256 hashes.'
```

Sau đó, từ application checkout, mở bản restore để kiểm tra JD/profile/CV mẫu:

```powershell
$env:CAREER_WORKSPACE_ROOT = 'C:\CareerRestores\restore-2026-09-04-01'
pnpm web
```

Dashboard vẫn tải assets từ application checkout và chỉ lưu dữ liệu vào root đã chọn. Dừng server rồi bỏ biến môi trường để trở lại root mặc định. Không copy đè bản restore lên workspace đang dùng. Một copy có hash khớp chứng minh bytes được bảo toàn; không chứng minh JSON gốc vốn hợp lệ. Kiểm tra parser/dashboard riêng trước khi sử dụng.

## Dữ liệu hỏng và conflict

- Raw JD hỏng xuất hiện thành một dòng cảnh báo; jobs khác vẫn dùng được. Profile hỏng hiển thị lỗi và không mở editor như một profile trống. File hỏng không bị xóa/sửa tự động.
- Giữ một bản copy bytes hỏng ngoài cây đang dùng trước khi sửa thủ công. Ưu tiên mở backup vào root mới để xác minh. Không đưa raw error/PII lên dịch vụ ngoài.
- Khi lưu nhận conflict: copy draft đang nhập sang nơi riêng tư, reload trang để lấy dữ liệu mới, mở lại editor rồi đối chiếu. Bấm refresh nội bộ không tự đổi token của draft cũ.
- `file.lock` còn lại sau crash: chỉ xử lý khi chắc chắn mọi CLI/server/agent/editor đã dừng. Kiểm tra file đích và temp có liên quan, copy recovery material ra chỗ riêng. Chỉ xóa đúng lock file đã kiểm tra bằng `Remove-Item -LiteralPath <exact-lock-file>`; không xóa theo wildcard hoặc tuổi file.
- Temp không được tự phục hồi thành artifact. Bản đích hợp lệ được giữ nếu lỗi xảy ra trước publish; nếu crash sau publish, bản mới có thể đã tồn tại. Đọc/validate file đích trước khi thử lại.
- Per-file locking bảo vệ các writer của ứng dụng cùng tuân thủ API, không khóa được một editor/agent tự viết trực tiếp. Không có transaction đa file; backup phải thực hiện khi đã dừng toàn bộ writer.

## HTTP/CLI compatibility

- JSON artifact schema không đổi. API profile/note GET trả ETag; PUT và source POST cần `If-Match`. `"missing"` nghĩa tạo khi chưa tồn tại. Thiếu token: 428; token cũ/lock bận: 409. Client cũ phải reload để nhận mã giao diện mới.
- CLI `--out` chỉ tạo mới. Muốn thay một output đơn, lấy SHA-256 của đúng file đang đọc và dùng `--expected-hash sha256:<lowercase hex>`. Không có `--force`; batch báo từng collision và exit 1 khi có lỗi.
- Hash M1 là SHA-256 bytes, không phải chữ ký, content-addressed store hay canonical JSON envelope của M2+. Không tự thêm field vào profile/analysis cũ.
- Privacy checks chỉ cảnh báo Git tracking/ignore, không sửa cấu hình và không bảo đảm chống vô tình share ngoài Git. Workspace check chạy lại trước request ghi và mỗi lần đọc summary.
