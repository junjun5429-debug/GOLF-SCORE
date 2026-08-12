Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot 'icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-Icon([int]$size, [string]$path, [bool]$rounded) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # 背景（グリーングラデーション）
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $c1 = [System.Drawing.Color]::FromArgb(27, 125, 63)
    $c2 = [System.Drawing.Color]::FromArgb(20, 92, 46)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
    if ($rounded) {
        $g.FillEllipse($brush, $rect)
    } else {
        $g.FillRectangle($brush, $rect)
    }

    # ゴルフボール（白丸）
    $ballR = [int]($size * 0.30)
    $ballX = [int]($size * 0.5 - $ballR)
    $ballY = [int]($size * 0.30)
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($white, $ballX, $ballY, $ballR * 2, $ballR * 2)

    # ディンプル
    $dimple = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 226, 228))
    $dr = [Math]::Max(2, [int]($size * 0.028))
    for ($ix = -1; $ix -le 1; $ix++) {
        for ($iy = -1; $iy -le 1; $iy++) {
            $dx = [int]($size * 0.5 + $ix * $size * 0.11 - $dr)
            $dy = [int]($ballY + $ballR + $iy * $size * 0.11 - $dr)
            $g.FillEllipse($dimple, $dx, $dy, $dr * 2, $dr * 2)
        }
    }

    # ティー（三角）
    $teeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 220, 130))
    $pts = @(
        (New-Object System.Drawing.PointF([single]($size * 0.42), [single]($ballY + $ballR * 2 - $size * 0.02))),
        (New-Object System.Drawing.PointF([single]($size * 0.58), [single]($ballY + $ballR * 2 - $size * 0.02))),
        (New-Object System.Drawing.PointF([single]($size * 0.5),  [single]($size * 0.82)))
    )
    $g.FillPolygon($teeBrush, $pts)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $brush.Dispose()
    Write-Output "created: $path"
}

New-Icon 192 (Join-Path $outDir 'icon-192.png') $false
New-Icon 512 (Join-Path $outDir 'icon-512.png') $false
New-Icon 180 (Join-Path $outDir 'apple-touch-icon-180.png') $false
