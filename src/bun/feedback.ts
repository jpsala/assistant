import type { ReplaceStatus } from "./replace";
import { createLogger } from "./logger";

const log = createLogger("feedback");

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function runPowerShell(script: string, event: string, meta: Record<string, unknown>): void {
  try {
    const encoded = encodePowerShell(script);
    Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { stdout: "ignore", stderr: "ignore" },
    );
    log.info(event, meta);
  } catch (error) {
    log.warn(`${event}.failed`, { ...meta, error });
  }
}

function showCustomToast(
  title: string,
  message: string,
  subtitle: string,
  isError = false,
  durationMs = 3200,
): void {
  const accent = isError ? "#ff8b86" : "#8b5cf6";
  const glow = isError ? "#ff6a61" : "#9d7cff";
  const chipText = isError ? title.toUpperCase() : title.toUpperCase();
  const fadeInMs = 140;
  const fadeOutMs = 220;

  const script = `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$window = New-Object System.Windows.Window
$window.Width = 380
$window.Height = 94
$window.WindowStyle = 'None'
$window.ResizeMode = 'NoResize'
$window.ShowInTaskbar = $false
$window.Topmost = $true
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.ShowActivated = $false
$window.Opacity = 0

$workArea = [System.Windows.SystemParameters]::WorkArea
$window.Left = $workArea.Right - $window.Width - 18
$window.Top = $workArea.Bottom - $window.Height - 18

$root = New-Object System.Windows.Controls.Border
$root.CornerRadius = New-Object System.Windows.CornerRadius(18)
$root.BorderThickness = New-Object System.Windows.Thickness(1)
$root.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#3a2b45'))
$root.Background = New-Object System.Windows.Media.LinearGradientBrush(
  [System.Windows.Media.ColorConverter]::ConvertFromString('#151426'),
  [System.Windows.Media.ColorConverter]::ConvertFromString('#24192f'),
  0
)
$root.Padding = New-Object System.Windows.Thickness(16, 12, 16, 12)
$window.Content = $root

$grid = New-Object System.Windows.Controls.Grid
$col1 = New-Object System.Windows.Controls.ColumnDefinition
$col1.Width = New-Object System.Windows.GridLength(44)
$col2 = New-Object System.Windows.Controls.ColumnDefinition
$col2.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
$grid.ColumnDefinitions.Add($col1)
$grid.ColumnDefinitions.Add($col2)
$root.Child = $grid

$accentBar = New-Object System.Windows.Shapes.Rectangle
$accentBar.Width = 4
$accentBar.RadiusX = 2
$accentBar.RadiusY = 2
$accentBar.HorizontalAlignment = 'Left'
$accentBar.VerticalAlignment = 'Stretch'
$accentBar.Margin = New-Object System.Windows.Thickness(-16, -12, 0, -12)
$accentBar.Fill = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString(${psString(accent)}))
$grid.Children.Add($accentBar)

$iconBorder = New-Object System.Windows.Controls.Border
$iconBorder.Width = 44
$iconBorder.Height = 44
$iconBorder.CornerRadius = New-Object System.Windows.CornerRadius(14)
$iconBorder.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#1a1c32'))
$iconBorder.BorderThickness = New-Object System.Windows.Thickness(1)
$iconBorder.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#2c335a'))
$iconBorder.Margin = New-Object System.Windows.Thickness(4, 8, 14, 8)
[System.Windows.Controls.Grid]::SetColumn($iconBorder, 0)
$grid.Children.Add($iconBorder)

$iconText = New-Object System.Windows.Controls.TextBlock
$iconText.Text = '!'
$iconText.FontSize = 18
$iconText.FontWeight = 'Bold'
$iconText.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#ffffff'))
$iconText.HorizontalAlignment = 'Center'
$iconText.VerticalAlignment = 'Center'
$iconText.TextAlignment = 'Center'
$iconBorder.Child = $iconText

$stack = New-Object System.Windows.Controls.StackPanel
$stack.VerticalAlignment = 'Center'
[System.Windows.Controls.Grid]::SetColumn($stack, 1)
$grid.Children.Add($stack)

$chip = New-Object System.Windows.Controls.Border
$chip.CornerRadius = New-Object System.Windows.CornerRadius(999)
$chip.Padding = New-Object System.Windows.Thickness(10, 3, 10, 3)
$chip.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
$chip.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#2a1f36'))
$stack.Children.Add($chip)

$chipLabel = New-Object System.Windows.Controls.TextBlock
$chipLabel.Text = ${psString(chipText)}
$chipLabel.FontSize = 10
$chipLabel.FontWeight = 'Bold'
$chipLabel.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString(${psString(accent)}))
$chipLabel.TextWrapping = 'Wrap'
$chip.Child = $chipLabel

$messageBlock = New-Object System.Windows.Controls.TextBlock
$messageBlock.Text = ${psString(message)}
$messageBlock.FontSize = 16
$messageBlock.FontWeight = 'SemiBold'
$messageBlock.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#ffffff'))
$messageBlock.Margin = New-Object System.Windows.Thickness(0, 0, 0, 4)
$stack.Children.Add($messageBlock)

$subtitleBlock = New-Object System.Windows.Controls.TextBlock
$subtitleBlock.Text = ${psString(subtitle)}
$subtitleBlock.FontSize = 12
$subtitleBlock.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.ColorConverter]::ConvertFromString('#d7dcff'))
$stack.Children.Add($subtitleBlock)

$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString(${psString(glow)})
$shadow.BlurRadius = 18
$shadow.Opacity = 0.18
$shadow.ShadowDepth = 0
$root.Effect = $shadow

$fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [System.Windows.Duration]::new([System.TimeSpan]::FromMilliseconds(${fadeInMs})))
$fadeOut = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, [System.Windows.Duration]::new([System.TimeSpan]::FromMilliseconds(${fadeOutMs})))
$fadeOut.BeginTime = [System.TimeSpan]::FromMilliseconds(${durationMs})
$fadeOut.Add_Completed({ $window.Close() })

$storyboard = New-Object System.Windows.Media.Animation.Storyboard
[System.Windows.Media.Animation.Storyboard]::SetTarget($fadeIn, $window)
[System.Windows.Media.Animation.Storyboard]::SetTargetProperty($fadeIn, (New-Object System.Windows.PropertyPath('Opacity')))
[System.Windows.Media.Animation.Storyboard]::SetTarget($fadeOut, $window)
[System.Windows.Media.Animation.Storyboard]::SetTargetProperty($fadeOut, (New-Object System.Windows.PropertyPath('Opacity')))
$storyboard.Children.Add($fadeIn) | Out-Null
$storyboard.Children.Add($fadeOut) | Out-Null

$window.Add_ContentRendered({ $storyboard.Begin() })
$window.Show()
$dispatcher = [System.Windows.Threading.Dispatcher]::CurrentDispatcher
[System.Windows.Threading.Dispatcher]::Run()
`;

  runPowerShell(script, "custom_toast.spawned", {
    title,
    message,
    subtitle,
    isError,
  });
}

function trimErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}...` : compact;
}

export function handleReplaceStatus(status: ReplaceStatus): void {
  log.info("status.received", status);

  if (status.stage === "capturing" || status.stage === "pasting") {
    return;
  }

  if (status.stage === "processing") {
    showCustomToast(
      "Assistant is working",
      status.promptName,
      status.model,
      false,
      5000,
    );
    return;
  }

  if (status.stage === "success") {
    showCustomToast(
      "Prompt completed",
      "Text updated",
      `${status.promptName} · ${status.model}`,
      false,
      3000,
    );
    return;
  }

  if (status.stage === "error") {
    showCustomToast(
      `Could not run ${status.promptName}`,
      trimErrorMessage(status.detail),
      "Assistant is working in the background.",
      true,
      4200,
    );
  }
}
