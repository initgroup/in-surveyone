$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

try {
    chcp.com 65001 | Out-Null
}
catch {
    # Console code-page switching is best effort; .NET encodings above are authoritative.
}
