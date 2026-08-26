$ErrorActionPreference = "Stop"

$logicalRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$appRoot = $logicalRoot
$assetsDirectory = Join-Path $appRoot "assets"
$iconPath = Join-Path $assetsDirectory "autumn.ico"
$previewPath = Join-Path $assetsDirectory "autumn-icon.png"
$launcherPath = Join-Path $appRoot "scripts\launch-autumn-recruitment.ps1"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutName = ([char[]]@(0x79CB, 0x62DB, 0x52A9, 0x624B) -join "") + ".lnk"
$shortcutPath = Join-Path $desktop $shortcutName

[System.IO.Directory]::CreateDirectory($assetsDirectory) | Out-Null
Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$gradient = $null
$borderPen = $null
$font = $null
$textBrush = $null
$format = $null

try {
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $inset = 10
  $diameter = 54
  $rect = [System.Drawing.RectangleF]::new($inset, $inset, $size - 2 * $inset, $size - 2 * $inset)
  $path.AddArc($rect.Left, $rect.Top, $diameter, $diameter, 180, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Top, $diameter, $diameter, 270, 90)
  $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($rect.Left, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  $navy = [System.Drawing.ColorTranslator]::FromHtml("#173B91")
  $cobalt = [System.Drawing.ColorTranslator]::FromHtml("#2357D5")
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $navy, $cobalt, 45.0)
  $graphics.FillPath($gradient, $path)

  $borderColor = [System.Drawing.Color]::FromArgb(78, 255, 255, 255)
  $borderPen = [System.Drawing.Pen]::new($borderColor, 4)
  $graphics.DrawPath($borderPen, $path)

  $fontFamily = [System.Drawing.FontFamily]::new("Microsoft YaHei UI")
  $font = [System.Drawing.Font]::new($fontFamily, 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
  $textRect = [System.Drawing.RectangleF]::new(0, -7, $size, $size)
  $graphics.DrawString([string][char]0x79CB, $font, $textBrush, $textRect, $format)

  $bitmap.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  if ($format) { $format.Dispose() }
  if ($textBrush) { $textBrush.Dispose() }
  if ($font) { $font.Dispose() }
  if ($borderPen) { $borderPen.Dispose() }
  if ($gradient) { $gradient.Dispose() }
  $path.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

# Windows ICO supports a PNG payload. A 256 px entry stays crisp while the
# shell automatically scales it for desktop, taskbar, and list views.
$pngBytes = [System.IO.File]::ReadAllBytes($previewPath)
$iconStream = [System.IO.File]::Create($iconPath)
$writer = [System.IO.BinaryWriter]::new($iconStream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
} finally {
  $writer.Dispose()
  $iconStream.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = [char[]]@(
  0x6253, 0x5F00, 0x79CB, 0x62DB, 0x5C97, 0x4F4D, 0x4E0E,
  0x6295, 0x9012, 0x8FDB, 0x5EA6, 0x7BA1, 0x7406
) -join ""
$shortcut.Save()

Write-Output $shortcutPath
