<p align="center">
  <img src="icons/icon-128.png" width="88" height="88" alt="TideLock logo" />
</p>

<h1 align="center">TideLock（潮汐锁定）</h1>

<p align="center">
  <strong>让 YouTube 首页稳如磐石——看完视频退回首页不再刷新推荐流，不用开一堆新标签页。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="#三层防丢失架构">技术原理</a> ·
  <a href="#本地安装使用">安装使用</a> ·
  <a href="PRIVACY.md">隐私声明</a>
</p>

---

## 为什么做 TideLock？

平时刷 YouTube 首页时，经常在同一屏同时看到**两三个想看的视频**。点开第一个看上半小时，再点后退返回首页——YouTube 却直接整页刷新，把刚才旁边那几个想看的视频冲得一干二净。

每次靠中键开一堆新标签页又麻烦，特别是用 **桌面独立 YouTube 应用窗口（PWA）** 时根本没有标签栏。

**TideLock（潮汐锁定）** 从底层解决这个问题：**默认全自动生效、无需额外弹窗/新标签页、100% 兼容你现有的 YouTube 插件生态**。

---

## 核心功能

- **默认全自动首页锁定**：点视频看 10 分钟还是 2 小时，按浏览器后退（或从视频页点左上角 YouTube Logo 返回）时，自动把上次刷到的首页推荐流原样交还给 YouTube 原生渲染——连你之前向下滚动翻出的多屏视频也一并保留。
- **精准滚动定位**：自动回到离开前的精确滚动位置或刚点开的卡片附近；一旦你手动滚轮，立即停止接管，绝不抢鼠标。
- **轻量化「刚刚看过」角标**：在本次会话点开过的卡片左上角打一个克制的半透明角标，回到 5 列首页一眼就能锁定旁边还没看的那个视频。
- **「刚才的首页」本地快照时光机**：本地自动留存最近 **5 批** 首页快照，支持 **全部 / 未看 / 已看** 筛选与实时搜索——哪怕手滑按了 `F5`、重开了浏览器或连看十个视频退不回来，也能一键找回。
- **一键「待看暂存」**：首页卡片悬停右上角或快照列表里点图钉图标即可临时存进 TideLock 本地暂存栏，不污染官方“稍后观看”列表。
- **专为桌面独立窗口（PWA）优化**：页面右下角提供极轻的 Shadow DOM 自适应深浅色胶囊入口与侧滑抽屉（全屏看视频时自动隐藏），没有浏览器工具栏也能随时展开快照或一键换一批。
- **绝不拦截你的主动刷新**：按 `F5`、切换首页分类标签、**已在首页时**再点左上角 YouTube Logo，或点「立即换一批」，都会立刻拉取全新推荐流。
- **与热门插件无缝共存**：完整兼容 **Enhancer for YouTube™**、**Right Side Comments**、**SponsorBlock**、**DeArrow**、**YouTube Anti Translate**、**沉浸式翻译**、**Video Speed Controller**、**Return YouTube Dislike**、**PocketTube**、**uBlock Origin Lite**。
- **纯本地、零依赖、零追踪**：标准 Manifest V3，仅作用于 `https://www.youtube.com/*`，全代码零 `innerHTML`（原生遵循 YouTube Trusted Types），内置简体中文 & 英文双语界面。

---

## 三层防丢失架构

1. **Layer 1 · 主世界 InnerTube 拦截与翻页拼接 (`src/content/page-bridge.js`)**：捕获首次 SSR 的 `ytInitialData` 与 `/youtubei/v1/browse`（`FEwhat_to_watch`），滚动加载新页时自动去重拼接并保留尾部翻页令牌；回退首页时拦截过期自动刷新，主动刷新时透明放行。
2. **Layer 2 · 隔离世界体验增强 (`src/content/content-main.js`)**：同时解析 2025–2026 新版 `lockupViewModel` 与经典 `videoRenderer`，分帧渲染已看角标与悬停暂存按钮，通过 Shadow DOM 隔离渲染轻提示和快照抽屉。
3. **Layer 3 · 本地快照保险箱 (`chrome.storage.local`)**：LRU 机制维护最近 5 次首页快照与待看暂存栏，纯本地落盘零外连。

---

## 本地安装使用

### 在 Chrome / Edge / Brave 中免费加载（30 秒）

1. 克隆仓库或下载源码包：
   ```bash
   git clone https://github.com/qiao-obs/TideLock.git
   ```
2. 在浏览器地址栏打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
3. 打开右上角 **「开发者模式」**。
4. 点击左上角 **「加载已解压的扩展程序」**，选中 `TideLock` 文件夹即可。
5. 刷新一次 YouTube 页面，即可默认全自动生效。

---

## 开发与打包

```bash
# 运行自动化测试（InnerTube 解析、翻页拼接、意图状态机、Manifest 与安全合规检查）
npm test

# 校验清单和图标尺寸，生成可直接上架商店的 dist/tidelock-v1.0.0.zip
npm run build

# 使用 Python Pillow 重新生成 4x 超采样高清图标
npm run icons
```

> 💡 **免注册费上架提示**：`npm run build` 打出的 `.zip` 包既可用于 Chrome 网上应用店（需 Google 一次性 \$5 注册费），也可以 **\$0 免费** 提交至 **Microsoft Edge 外接程序商店**。完整上架文案与权限说明见 [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)。

## License

[MIT](LICENSE)
