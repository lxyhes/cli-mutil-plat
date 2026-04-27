Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$BuildDir = Join-Path $PSScriptRoot '..\build'
$Sizes = @(16, 32, 48, 64, 128, 256, 512)

function New-RoundedRectPath {
  param([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R)
  $rectPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $R * 2
  $rectPath.AddArc($X, $Y, $d, $d, 180, 90)
  $rectPath.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
  $rectPath.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
  $rectPath.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
  $rectPath.CloseFigure()
  return $rectPath
}

function Fill-Circle {
  param($Graphics, [float]$Cx, [float]$Cy, [float]$R, $Color)
  $brush = [System.Drawing.SolidBrush]::new($Color)
  $Graphics.FillEllipse($brush, $Cx - $R, $Cy - $R, $R * 2, $R * 2)
  $brush.Dispose()
}

function New-PrismOpsPng {
  param([int]$Size, [string]$Path)

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $tile = New-RoundedRectPath ($Size * 0.035) ($Size * 0.035) ($Size * 0.93) ($Size * 0.93) ($Size * 0.23)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new(0, 0, $Size, $Size),
    [System.Drawing.Color]::FromArgb(255, 17, 26, 43),
    [System.Drawing.Color]::FromArgb(255, 18, 16, 27),
    45
  )
  $g.FillPath($bgBrush, $tile)

  $g.SetClip($tile)
  $shineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(36, 79, 216, 255))
  $g.FillEllipse($shineBrush, -$Size * 0.1, -$Size * 0.16, $Size * 0.9, $Size * 0.72)
  $g.ResetClip()

  $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 37, 52, 72), [Math]::Max(1, $Size * 0.006))
  $g.DrawPath($borderPen, $tile)

  $flowBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new($Size * 0.18, $Size * 0.12, $Size * 0.64, $Size * 0.76),
    [System.Drawing.Color]::FromArgb(255, 79, 216, 255),
    [System.Drawing.Color]::FromArgb(255, 255, 209, 102),
    45
  )
  $flowPen = [System.Drawing.Pen]::new($flowBrush, $Size * 0.078)
  $flowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $flowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $flowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $shapePath = New-Object System.Drawing.Drawing2D.GraphicsPath
  [System.Drawing.PointF[]]$points = @(
    [System.Drawing.PointF]::new($Size * 0.335, $Size * 0.285),
    [System.Drawing.PointF]::new($Size * 0.665, $Size * 0.285),
    [System.Drawing.PointF]::new($Size * 0.460, $Size * 0.500),
    [System.Drawing.PointF]::new($Size * 0.665, $Size * 0.715),
    [System.Drawing.PointF]::new($Size * 0.335, $Size * 0.715),
    [System.Drawing.PointF]::new($Size * 0.540, $Size * 0.500),
    [System.Drawing.PointF]::new($Size * 0.335, $Size * 0.285)
  )
  $shapePath.AddLines($points)
  $g.DrawPath($flowPen, $shapePath)

  $connectorPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(190, 110, 207, 255), [Math]::Max(1, $Size * 0.038))
  $connectorPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $connectorPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($connectorPen, $Size * 0.20, $Size * 0.50, $Size * 0.34, $Size * 0.50)
  $g.DrawLine($connectorPen, $Size * 0.80, $Size * 0.50, $Size * 0.66, $Size * 0.50)
  $g.DrawLine($connectorPen, $Size * 0.50, $Size * 0.20, $Size * 0.50, $Size * 0.315)
  $g.DrawLine($connectorPen, $Size * 0.50, $Size * 0.80, $Size * 0.50, $Size * 0.685)

  Fill-Circle $g ($Size * 0.20) ($Size * 0.50) ($Size * 0.054) ([System.Drawing.Color]::FromArgb(255, 79, 216, 255))
  Fill-Circle $g ($Size * 0.80) ($Size * 0.50) ($Size * 0.054) ([System.Drawing.Color]::FromArgb(255, 255, 209, 102))
  Fill-Circle $g ($Size * 0.50) ($Size * 0.20) ($Size * 0.046) ([System.Drawing.Color]::FromArgb(255, 139, 124, 255))
  Fill-Circle $g ($Size * 0.50) ($Size * 0.80) ($Size * 0.046) ([System.Drawing.Color]::FromArgb(255, 139, 124, 255))

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

  $shapePath.Dispose()
  $flowPen.Dispose()
  $flowBrush.Dispose()
  $connectorPen.Dispose()
  $borderPen.Dispose()
  $shineBrush.Dispose()
  $bgBrush.Dispose()
  $tile.Dispose()
  $g.Dispose()
  $bmp.Dispose()
}

function New-IcoFromPngs {
  param([string[]]$PngPaths, [string]$IcoPath)

  $images = @($PngPaths | ForEach-Object { [System.IO.File]::ReadAllBytes($_) })
  $ms = [System.IO.MemoryStream]::new()
  $bw = [System.IO.BinaryWriter]::new($ms)

  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]$images.Count)

  $offset = 6 + (16 * $images.Count)
  for ($i = 0; $i -lt $images.Count; $i++) {
    $size = [int]([System.IO.Path]::GetFileNameWithoutExtension($PngPaths[$i]) -replace 'icon-', '')
    $byteSize = if ($size -eq 256) { 0 } else { $size }
    $bw.Write([Byte]$byteSize)
    $bw.Write([Byte]$byteSize)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$images[$i].Length)
    $bw.Write([UInt32]$offset)
    $offset += $images[$i].Length
  }

  foreach ($image in $images) {
    $bw.Write($image)
  }

  [System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
  $bw.Dispose()
  $ms.Dispose()
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

foreach ($size in $Sizes) {
  New-PrismOpsPng -Size $size -Path (Join-Path $BuildDir "icon-$size.png")
  Write-Host "wrote icon-$size.png"
}

Copy-Item -Force (Join-Path $BuildDir 'icon-512.png') (Join-Path $BuildDir 'icon.png')
New-IcoFromPngs -PngPaths @(
  (Join-Path $BuildDir 'icon-16.png'),
  (Join-Path $BuildDir 'icon-32.png'),
  (Join-Path $BuildDir 'icon-48.png'),
  (Join-Path $BuildDir 'icon-256.png')
) -IcoPath (Join-Path $BuildDir 'icon.ico')
Write-Host "wrote icon.ico"
