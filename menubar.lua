-- 小耳 AI 花销墙 👂  菜单栏图标 + HTML 富面板（月度账单模式）
local M = {}
local sourcePath = debug.getinfo(1, "S").source:gsub("^@", "")
local PROJECT_DIR = sourcePath:match("^(.*)/[^/]+$") or ((os.getenv("HOME") or "") .. "/.hammerspoon/xiaoer-ai-pay")
local MONTHS_DIR  = PROJECT_DIR .. "/data/months"
local LEGACY_STATE = PROJECT_DIR .. "/data/state.json"  -- 老快照，仅作 fallback
local PANEL = PROJECT_DIR .. "/panel/index.html"

local function detectNode()
  local explicit = os.getenv("XIAOER_AI_PAY_NODE")
  if explicit and explicit ~= "" and hs.fs.attributes(explicit) then
    return explicit
  end
  local output = hs.execute("/usr/bin/env bash -lc 'command -v node'")
  local path = tostring(output or ""):match("^%s*(.-)%s*$")
  if path ~= "" and hs.fs.attributes(path) then
    return path
  end
  return nil
end

xiaoerPay = M
M.bar = M.bar or hs.menubar.new()

local function currentPeriod()
  return os.date("%Y-%m")
end

local function readFileRaw(path)
  local f = io.open(path, "r"); if not f then return nil end
  local c = f:read("*a"); f:close()
  return c
end

-- 优先读当月账单，没有则回退到老 state.json（首次跑/历史数据）
local function readStateRaw()
  return readFileRaw(MONTHS_DIR .. "/" .. currentPeriod() .. ".json")
      or readFileRaw(LEGACY_STATE)
end

local function injectState()
  if not M.web then return end
  local raw = readStateRaw() or "null"
  local js = "window.XIAOER_PAY_STATE = " .. raw .. "; window.xiaoerPayRender && window.xiaoerPayRender();"
  M.web:evaluateJavaScript(js)
end

-- 后台跑 compute-month（默认当月），完成后重新注入。
-- 失败 provider 由 lib/compute-month.js 用 data/months/<当月>.json 上次成功值占位，绝不抹零。
function M.compute()
  local node = detectNode()
  if not node then
    hs.notify.new({ title = "👂 花销墙", informativeText = "未找到 Node.js，请先安装 Node.js。" }):send()
    return
  end
  hs.task.new(node, function()
    injectState()
    local raw = readStateRaw()
    if raw then
      local ok, st = pcall(hs.json.decode, raw)
      if ok and st then
        for _, p in ipairs(st.providers or {}) do
          if p.color == "red" then
            hs.notify.new({ title = "👂 花销墙预警", informativeText = p.name .. " 逼近上限！" }):send()
          end
        end
      end
    end
  end, { PROJECT_DIR .. "/refresh.js" }):start()
end

-- 打开/关闭富面板
function M.panel()
  if M.web then  -- 已开 → 关（toggle）
    M.web:delete(); M.web = nil; return
  end
  local screen = hs.screen.mainScreen():frame()
  local W, H = 450, 800
  local rect = hs.geometry.rect(screen.x + screen.w - W - 24, screen.y + 36, W, math.min(H, screen.h - 60))

  -- panel 上的 Refresh 按钮已删，但保留 usercontent 容器（webview 需要），
  -- callback 留空 no-op 防误触。
  local uc = hs.webview.usercontent.new("xiaoerPay")
  uc:setCallback(function(_) end)

  M.web = hs.webview.new(rect, { developerExtrasEnabled = true }, uc)
    :windowStyle({ "titled", "closable", "utility", "HUD" })
    :level(hs.drawing.windowLevels.floating)
    :allowTextEntry(true)
    :darkMode(true)
    :shadow(true)
    :deleteOnClose(true)
    :windowTitle("小耳 AI 花销墙")
    :windowCallback(function(action)
      -- 用 × / Cmd+W 关窗时 deleteOnClose 会销毁 webview，但 M.web 引用还在；
      -- 这里同步置 nil，否则下次 toggle 误判「还开着」→ 点不出来
      if action == "closing" then M.web = nil end
    end)
    :navigationCallback(function(action)
      if action == "didFinishNavigation" then injectState() end
    end)
  M.web:url("file://" .. PANEL)
  M.web:show()
  M.web:bringToFront(true)
  M.compute()  -- 打开面板时算一次当月（防误抹由 lib/compute-month.js 保护）
end

-- 菜单栏 👂：左键点开面板
M.bar:setTitle("👂")
M.bar:setClickCallback(function() M.panel() end)

-- 旧的 doEvery(900) 自动 refresh 已删——它是"按 refresh 抹零"的另一个触发器。
-- 现在数据只在打开面板时算一次，compute-month 防误抹。

return M
