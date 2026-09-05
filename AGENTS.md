<!-- project-file-manager:rules:start -->
## 项目文件生命周期

- 本项目采用 `00_Inbox`、`01_Source`、`02_Working`、`03_Versions`、`04_Deliverables`、`05_References` 管理非代码文件。
- 新收到且尚未判断的文件先放入 `00_Inbox`；低置信度项目继续保留在 Inbox。
- `01_Source` 是原始输入，原则上不直接修改；先复制到 `02_Working` 再编辑。
- 代码和文本配置的版本历史交给 Git，不为它们创建 `v2`、`final` 等副本，也不放入 `03_Versions`。
- `03_Versions` 仅用于需要人工保留阶段快照的二进制工程文件。
- 整理前先运行 dry-run 计划并向用户展示；只有明确确认后才能应用移动或建议重命名。
- 不自动删除重复文件。操作记录与撤销信息位于 `.project-files`；项目说明见 `PROJECT_FILES.md`。
<!-- project-file-manager:rules:end -->

## 发布与版本管理

- 每个完成并通过验证的用户需求都必须进入 Git 历史，不得让已交付改动只停留在工作区。
- 以“一次完整需求”为默认发布粒度：需求内可以包含多个实现步骤，但交付前应形成一个可回滚的发布提交并创建 annotated tag。
- 版本号由改动影响按语义化版本决定：兼容性修复或小调整升级 `PATCH`；新增向后兼容功能升级 `MINOR`；不兼容的数据、配置或使用方式变更升级 `MAJOR`。
- 发布前必须同步 `package.json`、`package-lock.json`、`src/userscript.meta.txt`、源码版本常量和 `CHANGELOG.md`，运行 `npm run verify`，并重新生成、纳入 `dist/BilibiliTimeline.user.js`。
- 只有验证通过后才能创建发布提交和版本标签；标签统一使用 `v<major>.<minor>.<patch>`，并写明本次主要变化和验证结果。
- 不把依赖目录、临时文件、账号数据、Cookie 或其他敏感内容加入版本库；提交前必须检查待提交清单。
- 若工作区含有与当前需求无关的用户改动，应保留并排除在本次提交之外，不得擅自覆盖或一起提交。
