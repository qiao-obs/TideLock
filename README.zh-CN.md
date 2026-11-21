<p align="center">
  <img src="icons/icon-128.png" width="88" height="88" alt="TideLock logo" />
</p>

<h1 align="center">TideLock（潮汐锁定）</h1>

<p align="center">
  <strong>让 YouTube 首页稳如磐石——看完视频退回首页不再刷新推荐流，不用开一堆新标签页。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#v20-终局升级亮点">v2.0 亮点</a> ·
  <a href="#四层防丢失架构">技术架构</a> ·
  <a href="#本地安装使用">安装使用</a> ·
  <a href="PRIVACY.md">隐私声明</a>
</p>

---

## 为什么做 TideLock？

刷 YouTube 首页时，经常在同一屏同时看到**两三个想看的视频**。点开第一个看上半小时，再点后退返回首页——YouTube 却直接整页刷新，把刚才旁边那几个想看的视频冲得一干二净。

每次靠中键开一堆新标签页既杂乱，在 **桌面独立 YouTube 应用窗口（PWA）** 里更不方便。**TideLock（潮汐锁定）** 在同一个窗口内彻底解决这个问题：**默认全自动生效、零额外标签页、完整兼容你现有的 YouTube 插件生态**。

---

## v2.0 终局升级亮点

- **零刷新原生 SPA 跳转**：在快照抽屉、同屏邻近栏或暂存栏点选视频时，直接调用 YouTube 原生路由（`yt-navigate`）在 ~150ms 内丝滑切换，**绝不整页重载**，也不会清掉已锁定的首页缓存。
- **IndexedDB 跨重载持久化（`TideLockFeedCache`）**：把已拼接的多屏首页推荐流持久化在同源 IndexedDB（12 小时自动过期）。即使你在视频页刷新过页面、Chrome 内存回收休眠了标签页，甚至重开了桌面 PWA 窗口，退回首页照样稳稳还原。
- **一键「撤回误刷新」时光倒流**：手滑在首页按了 `F5` 把好视频刷没了？TideLock 采用双槽位缓存（`current` + `previous`），点一下 **「撤回刷新」** 就能把刚才被刷掉的那一批首页**原位重放回 YouTube 原生 5 列网格**！
- **「刚才同屏未看」上下文直达栏**：在看第一个视频的页面里按 **`Alt + Shift + T`**（或点右下角胶囊）展开抽屉，最顶部会自动置顶刚才首页紧挨在你点开卡片左右的未看视频，一键原位切过去看。
- **多页面精准滚动锚定**：不仅锁住 **首页（`/`）**，还同步记住 **订阅页（`/feed/subscriptions`）** 与 **搜索结果页（`/results`）** 的滚动位置和已看角标；内置抗 Polymer 二次归零状态机，且手动滚轮瞬间让位绝不抢鼠标。
- **中英双语标题同步与混合搜索**：完美适配 **沉浸式翻译** 和 **DeArrow**——同时留存英文原标题与页面中文译文，抽屉里直接显示中文标题，搜索时输入中文或英文关键词都能命中；自身 UI 全程 `notranslate` 防误翻。
- **全站右键一键暂存 + Markdown 导出**：在 YouTube 任何页面右键视频链接即可 **「暂存到 TideLock 待看栏」**；抽屉和弹窗支持一键 **复制 Markdown 清单**，直接贴进 **Obsidian / Notion** 做学习整理。
- **性能与质感全面重构**：取消全页 `document.body` 监听，改为精准容器监听 + 220ms 防抖 + O(1) 状态指纹跳过；全套手写线性矢量 SVG 图标（零 emoji、零 `innerHTML`、原生遵循 Trusted Types）。

---

## 四层防丢失架构

1. **Layer 1 · 主世界 InnerTube 拦截与原生 SPA 桥 (`src/content/page-bridge.js`)**：捕获 SSR `ytInitialData` 与 `/youtubei/v1/browse`（`FEwhat_to_watch`），拼接无限滚动翻页数据并保留续翻令牌；支持零刷新 `yt-navigate` 跳转和一键撤回重放；`F5`/分类标签/首页再点 Logo/点换一批透明放行。
2. **Layer 2 · 同源 IndexedDB 双槽位缓存 (`src/content/idb-cache.js`)**：持久化保存 `current` 与 `previous` 两批首页数据（12 小时 TTL），抗页面刷新与标签休眠。
3. **Layer 3 · 隔离世界高精度交互 (`src/content/content-main.js`)**：兼容 2025–2026 `lockupViewModel` 与传统 `videoRenderer`，精准容器防抖渲染已看角标与悬停暂存按钮，通过 Shadow DOM 提供自适应深浅色胶囊与侧滑抽屉。
4. **Layer 4 · 无状态 MV3 Service Worker (`src/background/service-worker.js`)**：提供右键菜单暂存、`Alt+Shift+T` 全局快捷键、角标计数与 6 份 LRU 本地首页快照库。

---

## 本地安装使用

### 在 Chrome / Edge / Brave 中免费加载（30 秒）

1. 克隆仓库或前往 [Releases](https://github.com/qiao-obs/TideLock/releases) 下载 `tidelock-v2.0.0.zip` 解压：
   ```bash
   git clone https://github.com/qiao-obs/TideLock.git
   ```
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
3. 开启右上角 **「开发者模式」**。
4. 点击左上角 **「加载已解压的扩展程序」**，选中 `TideLock` 文件夹（如果已装过 v1.0.0，在扩展卡片点一下 **🔄 重新加载** 即可无损升级到 v2.0.0）。
5. 刷新一次 YouTube 页面即刻生效。

---

## 开发与校验

```bash
# 运行全部 10 项单元测试（InnerTube 解析、翻页拼接、撤回重放、同屏邻近算法、双语搜索、Markdown 导出、CSP/MV3 合规）
npm test

# 校验清单与图标尺寸并构建商店包 dist/tidelock-v2.0.0.zip
npm run build
```

> 💡 **\$0 免费上架**：`dist/tidelock-v2.0.0.zip` 可直接 **免费** 提交至 **Microsoft Edge 外接程序商店**；未来提交 Chrome 商店所需全部文案与权限说明见 [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)。

## License

[MIT](LICENSE)
