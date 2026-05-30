#!/usr/bin/env bash
# 建「小耳花销墙」Dock 小程序：点开 → Hammerspoon 弹富面板。带 👂 图标，钉到 Dock。
set -euo pipefail
APP="/Applications/小耳花销墙.app"
HS="/opt/homebrew/bin/hs"
ICON="/tmp/xiaoer-pay-icon.png"

# 1. 建 AppleScript 应用（后台触发 hs 面板）
rm -rf "$APP"
osacompile -e "do shell script \"$HS -c \\\"xiaoerPay.panel()\\\" > /dev/null 2>&1 &\"" -o "$APP"

# 2. 渲染 👂 图标（Hammerspoon 原生 emoji）并设为 app 图标
"$HS" -c '
local sz=1024
local c=hs.canvas.new({x=0,y=0,w=sz,h=sz})
c[1]={type="rectangle",roundedRectRadii={xRadius=180,yRadius=180},
      fillGradient="linear",fillGradientColors={{hex="#1a1c22"},{hex="#0e0f13"}},
      fillGradientAngle=45,action="fill"}
c[2]={type="text",text="👂",textSize=620,frame={x=0,y=130,w=sz,h=sz},textAlignment="center"}
c:imageFromCanvas():saveToFile("'"$ICON"'")
'
fileicon set "$APP" "$ICON"

# 3. 钉到 Dock（若尚未存在）
if ! defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "小耳花销墙"; then
  defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$APP</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
  killall Dock
fi
echo "✅ 小耳花销墙 已装入 Dock"
