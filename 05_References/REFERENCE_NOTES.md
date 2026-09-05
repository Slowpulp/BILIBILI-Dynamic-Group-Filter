# 参考资料与实现边界

本页记录“B站动态净览”在需求分析、用户脚本元数据和 B 站关注分组接口方面的参考来源。链接与说明核对日期为 2026-09-05。

## 参考链接

| 资料 | 用途与备注 |
|---|---|
| [Greasy Fork 541882：bilibili时间线筛选——分组查看b站动态（布局优化，修复失效，原脚本作者hi94740）](https://greasyfork.org/zh-CN/scripts/541882-bilibili%E6%97%B6%E9%97%B4%E7%BA%BF%E7%AD%9B%E9%80%89-%E5%88%86%E7%BB%84%E6%9F%A5%E7%9C%8Bb%E7%AB%99%E5%8A%A8%E6%80%81-%E5%B8%83%E5%B1%80%E4%BC%98%E5%8C%96-%E4%BF%AE%E5%A4%8D%E5%A4%B1%E6%95%88-%E5%8E%9F%E8%84%9A%E6%9C%AC%E4%BD%9C%E8%80%85hi94740) | 用户指定的对照脚本。仅用于了解“按关注分组查看时间线”的功能目标和已知适配方向。 |
| [Greasy Fork 396032：bilibili时间线筛选——分组查看b站动态](https://greasyfork.org/zh-CN/scripts/396032-bilibili%E6%97%B6%E9%97%B4%E7%BA%BF%E7%AD%9B%E9%80%89-%E5%88%86%E7%BB%84%E6%9F%A5%E7%9C%8Bb%E7%AB%99%E5%8A%A8%E6%80%81) | 541882 所说明的历史原版；仅作产品背景和功能语义参考。 |
| [SocialSisterYi/bilibili-API-collect（非官方，已归档）](https://github.com/SocialSisterYi/bilibili-API-collect) | 历史性的 B 站非官方 API 资料索引。原仓库已于 2026 年归档并移除原文档，不应视为当前官方契约。 |
| [B 站用户关系 API 非官方文档社区镜像](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/user/relation.md) | 用于核对关注分组列表 `GET /x/relation/tags` 和分组成员 `GET /x/relation/tag` 的历史参数与返回形状。这是社区资料，不是 B 站对外承诺。 |
| [Tampermonkey 官方文档：用户脚本元数据](https://www.tampermonkey.net/documentation.php?locale=zh_CN) | 核对 `@name`、`@namespace`、`@version`、`@match`、`@run-at`、`@grant`、`@sandbox` 和 `@noframes` 等元数据字段。 |
| [Violentmonkey 官方文档：Metadata Block](https://violentmonkey.github.io/api/metadata-block/) | 核对元数据块格式、`@match`、`@run-at`、`@grant`、`@inject-into` 和 `@noframes` 的兼容性语义。 |

## 独立实现声明

本项目为从头重写的独立实现。开发过程中未复制 541882 或 396032 的源代码、样式、资源或文案；参考脚本仅提供功能层面的问题背景。当前的筛选核心、DOM 提取、请求封装、本地存储、界面、样式、构建和测试均为本项目自行设计与编写。

参考脚本各自的许可信息不构成对其代码的重用，也不改变本独立实现采用的 MIT 许可证。

## B 站内部接口边界

当前实现只读请求以下 B 站地址：

| 请求 | 用途 |
|---|---|
| `GET https://api.bilibili.com/x/web-interface/nav` | 确认当前登录状态和账号 `mid` |
| `GET https://api.bilibili.com/x/relation/tags` | 读取当前账号的关注分组列表 |
| `GET https://api.bilibili.com/x/relation/tag?tagid=...&pn=...&ps=...` | 分页读取被用于筛选的分组成员 |

请求由浏览器使用当前 B 站会话发出，实现中没有写操作，也不会持久化保存登录 Cookie。脚本可能从当前页面 Cookie 读取非秘密的 `DedeUserID` 作为登录检查异常时的本地账号分区依据，但不会读取或导出认证令牌。

## 变更风险

- 上述接口没有稳定的公开契约，路径、参数、返回字段、认证和访问策略都可能随时变更或停用。
- B 站动态卡片和布局 DOM 也不是对用户脚本提供的公开 API，CSS 类名、层级、链接和数据属性变化都可能影响识别。
- 本实现在分组成员尚未就绪、作者无法识别或卡片类型未知时默认保留动态，以降低改版导致大量误隐藏的风险。
- 社区非官方文档可能滞后于站点现状。维护时应优先在自有会话中以最小化、只读方式验证，并遵守 B 站当前的服务条款和访问限制。
