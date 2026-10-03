# 可复现验证摘要 · 1.0.0（实验性）

核对日期：2026-10-03。此摘要只列出随公开技能一起提供、可在本地复现的检查，不是对任意项目或生产可靠性的保证。

## 环境

本轮使用 Python 3.12.14、Node.js 24.19.0。工具声明最低 Python 3.10+ / Node.js 18+，尚未逐一测试最低版本或全部操作系统。

标准验证、测试与生成不需要额外的 Python / Node 包。`doctor` 显示 Python 版本、Node 是否可见及所需资源是否存在，不安装软件、不检查 Node 最低版本，也不验证浏览器。

## 命令与结果

在技能目录执行：

```sh
python3 scripts/diagram.py doctor
python3 scripts/diagram.py validate examples/greenhouse.json
python3 scripts/diagram.py validate examples/release-pipeline.json
python3 scripts/diagram.py test examples/greenhouse.json
python3 scripts/diagram.py test examples/release-pipeline.json
node tests/runtime.test.js
python3 tests/package.test.py
```

结果：

- 温室灌溉：15 节点、12 边，6 个用例通过，覆盖干燥/湿润输入、传感器失败、等待停止、批准及拒绝
- 软件发布：14 节点、12 边，6 个用例通过，覆盖正常发布、不同输入、失败重试与耗尽、等待停止、批准及拒绝
- `runtime.test.js`：1,507 个断言、120 轮重复运行通过，覆盖真实轨迹边、后退与重播、取消与重开、等待决定、歧义/缺失出边、异常回滚、状态隔离、总迁移预算及标签转义
- `package.test.py`：6 组通过，覆盖两份示例、12 类无效输入、原生图内完整规格、作者文档保真、施工文件 SHA-256、非空输出拒绝、技能目录内输出拒绝、入口资源及 viewer 字节保真

两份示例均是合成业务模型，不包含真实服务接入。技能的 runtime、脚本、测试、Schema 和原有第三方文件与 1.0.0 源快照保持相同字节；公共文档单独整理，并新增第一方 MIT 许可证副本。文件清单与相应哈希随之更新。

## 必须区分的验证

这轮公共目录检查没有启动 Codex、Hermes 或图形浏览器。不能把文件存在、引擎测试通过或 HTML 生成成功描述为宿主已成功调用、按钮已手动检查或布局适合任意项目。

每个新项目应自行进行视觉与交互验收：节点文档、父子关系、条件路径、等待批准/拒绝、多轮回放、暂停/单步/后退、取消/重开、拖动及连线、平移/缩放、播放中的局部详情、结束时视角保持。

## 运行边界

默认 500 次迁移、硬上限 1,000；所有前进入口共用预算，后退不退还，重开才重置。到限报错并保留已执行前缀，不把截断当成成功。回退保存完整快照，内存随轨迹长度可能近似平方增长。

未充分验证超大图、全部浏览器/屏幕/操作系统、最低运行时版本、移动端与完整无障碍。执行器只改变本地声明式状态，不代表真实外部系统已经实现。网页刷新会重置会话；原生图导出保留布局和规格，不保留会话状态。

## 第三方字节与条款

随包 draw.io viewer 31.7.0 的 SHA-256：

```text
53a25e8f766e759835a3a6a35d7e88742cb41762ed631ddd6944e38723dade33
```

第三方文件继续适用各自许可；请保留 `THIRD_PARTY_NOTICES.md` 和完整 `licenses/`。来源记录不构成对所有嵌入图标和模板的穷尽法律审查。
