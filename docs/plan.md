# Aoroza 规划

## 文件关联（双击 md 文件打开应用）

**目标**：双击 .md 文件时用 Aoroza 打开，不改变已保存的文件夹路径。

**方案**：临时切换工作区
- `single_instance` 检测到文件参数 → 用文件所在目录作为临时 `notesFolder`
- 调用 `setNotesFolder` 的内存路径，**不调 `save_config`**
- 下次正常启动恢复原来的配置路径

**待定**：临时目录是否需要特殊标识以防止用户误以为工作区已被修改。

---

## 多文件夹聚合导航

**现状**：Sidebar 绑定单个文件夹，有 FolderPicker 配置页。

**方向 A：多文件夹管理**（见下）
**方向 B：自动跟随**（本方案）

### 方向 B：自动跟随（Auto-follow）

**思路**：不做多文件夹管理，每次打开文件时自动把 Sidebar
切到文件所在目录。不存盘，下次重启恢复原配置。

```
双击 ch1.md → set folder = ~/novel（内存） → 文件树刷新
双击 灵感.md → set folder = ~/ideas（内存） → 文件树刷新
关闭重启 → 回到用户配置的默认文件夹
```

**为什么务实**：
- 只需改一行 Rust（setNotesFolder 不调 save_config）
- 不需要多文件夹管理 UI
- 和现有单文件夹架构完全兼容

**代价**：Sidebar 永远只显示一个文件夹，不能同时浏览两个。

---

### 方向 A：多文件夹管理
```
Sidebar 空状态：[Add a folder]

添加后：
├─ ~/Documents/novel-drafts      [×]
├─ ~/Dropbox/world-building      [×]
└─ [+ Add folder]
```

- 右键文件夹 → Remove（仅从 sidebar 移除，不删磁盘）
- 双击文件打开 → 若文件所在文件夹不在 sidebar，自动加入"最近访问"临时列表
- Ctrl+P 跨所有文件夹搜索
- 新建文件 → 创建在当前选中的文件夹下

**性能**：2-3 次 WalkDir + metadata 缓存，几百个文件毫秒级。QuickOpen 前端过滤，不受影响。

**待解决**：
- 同名文件显示需要带上父文件夹名（`novel-drafts/ch1.md` vs `world-building/ch1.md`）
- `notesFolder: Option<String>` → `notesFolders: Vec<String>` 的 Rust 重构
- 新建文件时需指定归属文件夹
- `state.watcher` 改成 `HashMap<String, RecommendedWatcher>`，每个文件夹独立 watcher 线程
- `start_file_watcher` / `stop_file_watcher` 按文件夹增删，文件变动事件携带路径

---

## 编辑器与文件树解耦

**目标**：编辑器不绑定 Sidebar 的工作区。编辑器只管当前打开的文件（或未保存的新文档），Sidebar 只管文件导航。

**方案**：
```
编辑器状态：
  - 无文件打开 → 空白，header 显示 "Untitled · Unsaved"（带指示器）
  - 有文件路径 → 显示内容 + 文件名，自动保存无感
  - Ctrl+N 新建 → 同上 Untitled 状态
      → Ctrl+S：若 sidebar 已配文件夹 → 自动保存到首个文件夹 (Untitled-N.md)
                若 sidebar 为空 → 弹出系统保存对话框

Sidebar 操作：
  - 点击文件 → 调 open_file(abs_path) → 编辑器加载
  - 右键 → New Note → 文件落盘 → 自动打开 → 后续保存无感
  - 双击外部 .md 文件 → 直接打开，路径已知，保存无感
```

**Why**：无痛解决双击打开文件；Sidebar 不再是"库"，只是导航；
90% 场景自动保存不弹框，兜底用对话框。

---

## 待定 / 低优先级

- 滚动位置记忆：切走文件时保存滚动位置，切回时恢复（替代 Tab 的方案）
- Tab 多文件编辑（不建议，破坏纵向写作体验）
- 代码表格式增强（够用，不动）
- 社交 / 协作（不需要）
