# AGENTS.md · 给接手这个项目的 AI

> **如果你是新的对话里的 AI，接手修改「推进」这个项目，请先完整读完这个文件。**
> 这里记录的是「改之前必须知道的事」：架构、契约、边界、以及已经踩过的坑。
> 读完之后再读 `README.md`（面向用户的功能说明）和 `改造契约.md`（接口细节）。

---

## 一、这是什么

「推进」是一个**本地运行**的 Windows 桌面进度管理程序。把想做的事写下来，设完成度，拆成能开始的小节点。

- **不联网**：所有数据存本机，不上传。
- **两个窗口**：左边「工作台」（主界面），右边「桌面浮层」（可以一直放在桌面上的小卡片）。
- 技术栈：**C# / WinForms + WebView2** 承载窗口，界面是**纯 HTML/CSS/JS**（无构建步骤、无框架、无 npm）。

---

## 二、一分钟看懂架构

```
┌─────────────────────────────────────────────────────────┐
│  native/Tuijin/         C# 宿主（WinForms + WebView2）    │
│    Program.cs           入口、单实例互斥                  │
│    AppHost.cs           总控：窗口、托盘、快捷键、桥接路由  │
│    WebWindow.cs         WebView2 窗口基类（资源映射、消息）  │
│    Windows.cs           MainForm（工作台）/ WidgetForm（浮层）│
│    Models.cs            数据结构 + 外观白名单               │
│    TaskStore.cs         读写 data.json、全部业务逻辑        │
│    AppPaths.cs          路径解析（含 %APPDATA% 不可写兜底）  │
└──────────────────────┬──────────────────────────────────┘
                       │  postMessage / PostWebMessageAsJson
                       │  （window.api → 命令 → 宿主 → response）
┌──────────────────────┴──────────────────────────────────┐
│  src/renderer/          界面（HTML/CSS/JS，无构建）        │
│    index.html main.js main.css     工作台                 │
│    widget.html widget.js widget.css 桌面浮层（三种形态）   │
│    base.css  shared.js  webview-api.js  两端共用          │
└─────────────────────────────────────────────────────────┘
```

**通信方式**：界面调 `window.api.xxx()` → 发 `{type, id, payload}` 给宿主 → `AppHost.HandleBridgeMessage` 里 `switch (type)` 路由 → 回 `{type:"response", id, ok, data}`。
宿主主动推送：`{type:"state", state}` / `{type:"widget-mode", mode}` / `{type:"maximized"}`。
桥接层的 JS 封装在 `src/renderer/webview-api.js`，**新增命令要同时改 C# 的 switch 和这个文件**。

---

## 三、动手前必读的三条铁律

### 1. 改任何东西之前，先读 `改造契约.md`

那份文件规定了 C# 宿主 / 桌面浮层 / 工作台三方共享的接口：设置字段名、桥接命令、CSS 变量、窗口尺寸。
**改契约要先改文档，再改代码，不要单方面改标识符。**

### 2. 桌面浮层是「有形状的窗口」，没有透明通道

宿主用 `SetWindowRgn` 把窗口裁成圆形 / 圆角矩形，**窗口没有 alpha 通道**：

- HTML 必须**精确铺满** 100% × 100%，不能指望窗口背景透出去。
- 圆形的部分要自己画成圆（`border-radius: 50%`），四角会被系统裁掉。
- 任何「悬浮在半空的元素」「带阴影的透明边」都做不出来，视觉上会变成一块矩形。
- 屏幕外或透明区域的像素不会被绘制，**不要假设能用透明背景做异形窗口**。

### 3. 不要随便改数据字段名

`data.json` 是用户的真实数据（`%APPDATA%\Tuijin\data.json`）。改字段名 = 用户数据丢失。
新增字段必须做到：**老数据没有这个字段时走默认值，不能崩**。参考 `TaskStore.Normalize()` 里的写法。

---

## 四、代码地图：想改什么，改哪里

| 想做的事 | 改这些文件 |
| --- | --- |
| 改工作台界面 / 布局 / 交互 | `src/renderer/index.html`、`main.js`、`main.css` |
| 改桌面浮层（球 / 卡通人 / 自定义图） | `src/renderer/widget.html`、`widget.js`、`widget.css` |
| 改浮层窗口尺寸 / 形状 / 拖动 | `native/Tuijin/Windows.cs`（`ModeSize` / `ModeRadius`）+ `AppHost.cs` |
| 新增一个桥接命令 | `AppHost.cs` 的 `HandleBridgeMessage` switch + `src/renderer/webview-api.js` |
| 新增一个设置项 | `Models.cs`（字段）→ `TaskStore.cs`（`Normalize` + `UpdateSettings`）→ 两端界面 |
| 改数据存储 / 业务逻辑 | `native/Tuijin/TaskStore.cs` |
| 改托盘菜单 / 快捷键 | `native/Tuijin/AppHost.cs`（`RefreshTrayMenu` / `RegisterHotKey`） |
| 改主题 / 字号 / 强调色 / 壁纸 | `base.css`（CSS 变量）+ 两端 `applyAppearance()` |

### 关键实现点（容易改错的地方）

- **`AppHost.DpiScale`**：进程是 PerMonitorV2。**不要在窗口句柄刚建好时调 `GetDpiForWindow`**，那时窗口还没落到显示器上会返回 96，高 DPI 屏上所有窗口都会缩水。用 `GetDpiForSystem`。
- **`Screen.WorkingArea` 是物理像素**，而代码里的尺寸常量是 DIP。涉及屏幕坐标换算时要乘除 `DpiScale`。
- **浮层是拖出来的**：拖动走 `widget:drag-start/move/end`，用 `screenX/screenY` 算增量（**不能用 `clientX`**，窗口跟着光标移动会让读数形成正反馈，产生「窗口追着自己跑」）。
- **浮层形态**有四个：`ball`（圆）/ `buddy`（卡通人）/ `custom`（用户自定义图）/ `expanded`（详情面板）。`custom` 和 `buddy` **共用同一套窗口尺寸**（176×208，圆角 28）。
- **`widgetVisible` 是浮层显隐的唯一真源**：工作台开关 / 托盘菜单 / `Alt+Shift+D` / 浮层里的「隐藏」全部读写这一个字段。不要额外再存一份状态。
- **工作台最大化不会隐藏浮层**（这个自动隐藏行为已经被移除，两者可以共存）。

---

## 五、构建与运行

### 环境要求

- **.NET 9 SDK**
- **WebView2 Runtime**（Windows 11 内置；Win10 可能要装）
- **git**（可选，用于版本管理）

### 只编译（快速验证改没改坏）

```powershell
dotnet build native\Tuijin\Tuijin.csproj -c Release
```

预期：`0 个错误`。会有几条 `MSB3277 WindowsBase 版本冲突` 的警告，**这是历史遗留，不是你的问题，忽略**。

### 发布成可运行版本

```powershell
dotnet publish native\Tuijin\Tuijin.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false -o release\推进
```

`csproj` 里配置了 `src/renderer/**` 自动复制到输出目录的 `renderer\`，所以**改完界面只要重新 publish，不用手动拷文件**。

产物：`release\推进\推进.exe`（自包含，目标机器不需要装 .NET）。

### 验证界面改动的小技巧

改 HTML/CSS/JS **不需要重新编译**，直接改 `release\推进\renderer\` 下对应文件再重启程序即可。
但记得最后把改动同步回 `src\renderer\`（源码才是真的，发布目录会被覆盖）。

---

## 六、这台机器上的坑（血泪教训，务必看）

### 1. 工作区目录带 Low 完整性标签

`D:\DS_project\20261104_plug` 整棵树被标了 **Low 完整性**（`S-1-16-4096`）。在这个目录里启动的 `推进.exe` 会以低完整性进程运行，**写不进 `%APPDATA%`**，启动时报：

```
Access to the path '...\AppData\Local\Tuijin\WebView2' is denied
```

也可能报 `灾难性故障 (0x8000FFFF)`。

**这不是代码 bug。** 程序已经做了兜底（`AppPaths.ResolveRoot` 会探测 `%APPDATA%` 是否可写，不可写就退回程序目录下的 `userdata\roaming\`），所以不会崩，但**数据会写到 `release\推进\userdata\` 而不是 `%APPDATA%`**。

**怎么判断你踩到了这个坑**：启动程序后看 `release\推进\userdata\` 有没有被创建。如果有，说明进程是 Low 完整性。

**排查/规避方法**：
1. 用 `icacls <目录>` 看有没有 `Mandatory Label\Low Mandatory Level`。
2. 用 `whoami /groups | Select-String "Mandatory Label"` 看自己进程的完整性。
3. 把同一个 exe 复制到 `%TEMP%` 或桌面（Medium 完整性）跑一次做对比 —— 同一份二进制、只换位置，这是最快的定位手段。
4. 验证功能优先在 `%TEMP%` 这类 Medium 位置跑，别在工作区里跑。
5. 跑完记得删掉 `release\推进\userdata\`，否则会被打进发布包。

### 2. 设备像素比是 1.5（实际 2560×1440，150% 缩放）

**注意：在 DPI-unaware 的终端里查会得到错误的数字。**
PowerShell 默认 DPI-unaware，`GetDpiForSystem` 会返回 96、`Screen.Bounds` 会报 1707×960 —— 这是**逻辑分辨率**，不是真实物理分辨率。

真实情况：物理 2560×1440，缩放 150%，实际 DPI = 144（`2560 / 1707 ≈ 1.4997`）。

对代码的影响：`AppHost.DpiScale` 会返回 1.5，所有窗口尺寸 = DIP × 1.5。
例如 `CustomSize("small")` 是 DIP 150×177，窗口实际报 225×266。
**不要被物理像素迷惑，误以为是 bug。**

### 3. 中文文件名在 git 里显示为八进制转义

已经设置了 `git config core.quotepath false`。如果换了新机器看不到中文文件名，执行同样命令即可。

### 4. 首次运行会有 SmartScreen 提示

程序没有代码签名，「Windows 已保护你的电脑」是正常的，点「更多信息」→「仍要运行」。

---

## 七、数据存哪里

```
%APPDATA%\Tuijin\
  data.json           ← 主数据（任务 + 设置）
  data.json.bak       ← 上一次的备份
  wallpaper\          ← 自定义壁纸（用户选的图，已压缩）
  widget-custom\      ← 桌面浮层的自定义图片
  app.log             ← 错误日志（出问题时先看这个）
```

**如果 `%APPDATA%` 不可写**，会自动改存到程序旁边的 `userdata\roaming\`（见上面第 1 条）。

### 数据结构（`data.json`）

```
AppData
├── version   固定 1
├── tasks     TaskItem[]       任务列表
│   ├── id / title / note / category / dueDate
│   ├── progress (0-100) / prevProgress / autoProgress
│   ├── milestones    Milestone[]   节点
│   │   └── id / title / done / dueDate / doneAt
│   └── status (active|done) / completedAt / order
├── settings  AppSettings      见下
└── meta      createdAt / updatedAt
```

### `settings` 全字段

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `theme` | string | `light` | `light` / `dark` |
| `widgetPinned` | bool | `true` | 浮层置顶 |
| `widgetVisible` | bool | `true` | **球的开关**，浮层显隐唯一真源 |
| `widgetStyle` | string | `ball` | `ball` / `buddy` / `custom` |
| `widgetSize` | string | `small` | `small` / `medium` / `large` |
| `widgetBounds` | object | null | 浮层位置（存的是**收起态**的矩形） |
| `mainBounds` | object | null | 工作台位置尺寸 |
| `fontScale` | double | `1.0` | 0.8 – 1.6，步进 0.05 |
| `accent` | string | `clay` | `clay`/`sage`/`ocean`/`plum`/`amber`/`ink` |
| `sort` | string | `manual` | `manual` / `due` / `progress` |
| `composerCategory` | string | `life` | 新建任务的默认分类 |
| `firstRun` | bool | `true` | 是否首次启动 |
| `wallpaper` | object | — | `{kind, preset, file, dim, blur, onMain}` |
| `widgetCustom` | object | — | `{file, fit, dim, showText}` |

---

## 八、桥接命令速查

完整列表见 `改造契约.md`。核心的几条：

**窗口**：`window:open-main` `window:close-main` `window:minimize-main` `window:toggle-maximize` `window:open-widget` `window:hide-widget` `window:toggle-widget` `window:drag` `window:resize-start/move/end`

**浮层形态**：`widget:expand` `widget:collapse` `widget:drag-start/move/end`

**数据**：`app:get-state` `task:create/update/delete/toggle-done` `milestone:add/update/toggle/delete` `tasks:clear-completed`

**设置**：`settings:update`（`payload.patch` 浅合并；`wallpaper` 和 `widgetCustom` 按字段合并，不是整块覆盖）

**文件选择**：`wallpaper:pick` `wallpaper:clear` `widget-custom:pick` `widget-custom:clear`

**其它**：`app:open-data-folder` `debug:log`

---

## 九、改完要自检

`自检清单.md` 里是发布前逐条核对的列表。至少确认：

- [ ] `dotnet build` 零错误
- [ ] 老 `data.json`（缺新字段）能正常加载
- [ ] 新字段写回后重启仍保留
- [ ] `release\推进\renderer\` 是**最新源码**（比对时间戳，别交了旧界面）
- [ ] 发布包里没有 `app.log`、`userdata\`、`widget-custom\` 这些运行时产物

---

## 十、项目文档索引

| 文件 | 用途 | 谁该读 |
| --- | --- | --- |
| `README.md` | 面向用户的功能说明 | 想知道「这程序能干啥」 |
| `AGENTS.md` | **本文件**，接手开发必读 | 要改代码的 AI |
| `改造契约.md` | 三方共享接口约定 | 改动涉及宿主 ↔ 界面交互 |
| `自检清单.md` | 发布前核对列表 | 交付之前 |
| `错误复盘-启动失败排查.md` | 一次真实故障的完整排查记录 | 遇到「启动失败 / 权限」类问题时 |
