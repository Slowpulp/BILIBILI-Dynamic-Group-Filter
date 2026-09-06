# PROJECT_FILES

本项目使用半自动文件生命周期管理。所有不确定的新文件先进入 `00_Inbox`，由规则生成预览；只有高置信度文件会在确认后移动，低置信度文件继续留在 Inbox。

## 目录职责

| 目录 | 用途 |
|---|---|
| `00_Inbox` | 新收到、待判断或低置信度文件 |
| `01_Source` | 原始输入；原则上只读，不直接改写 |
| `02_Working` | 当前编辑中的非代码工程文件 |
| `03_Versions` | 二进制工程文件的阶段性快照；代码版本交给 Git |
| `04_Deliverables` | 已确认、可对外交付的最终输出 |
| `05_References` | 标准、说明书、竞品和其他只读参考资料 |

## 使用方式

在 Codex 中可以说“扫描项目文件”“预览整理 Inbox”“按刚才的计划执行”或“撤销最近一次整理”。命令行统一初始化入口：

```powershell
& "$env:USERPROFILE\.codex\bin\project-bootstrap.ps1" -Root .
```

运行记录位于 `.project-files/manifests` 和 `.project-files/operations`。重复文件只报告，不自动删除。

<!-- project-file-manager:inventory:start -->
## 当前库存（自动生成）

更新时间：`2026-09-06T17:00:42.319789Z`
最近动作：生成 dry-run 计划 `plan-20260906T170042110975Z`（未移动文件）

| 目录 | 文件数 | 字节数 |
|---|---:|---:|
| `00_Inbox` | 0 | 0 |
| `01_Source` | 0 | 0 |
| `02_Working` | 0 | 0 |
| `03_Versions` | 0 | 0 |
| `04_Deliverables` | 1 | 734960 |
| `05_References` | 1 | 3964 |

Git：Git 工作区干净
<!-- project-file-manager:inventory:end -->
