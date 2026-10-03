# build-interactive-diagrams

把项目资料变成可以展开、播放、检查和交付的交互式工程图。

**版本：1.0.0（实验性）**。版本号用于识别当前快照，不代表生产就绪、任意项目都能直接适用，或已经在 Codex / Hermes 中完成端到端验证。

第一方代码、文档与合成示例采用 [MIT 许可证](LICENSE)。第三方组件继续适用其各自条款，详见文末许可说明。

## 你会得到什么

- 原生 draw.io 单画布、可展开的父子节点、节点拖动、平移和缩放
- 基于同一份 JSON 规格的本地确定性模拟，支持逐步、播放、暂停、后退、取消、重开，以及明确建模的正常、失败、等待与重试路径
- 与主流程状态同步的局部详情，查看详情不会主动暂停运行
- 每个节点的目标、输入输出、规则、权限、施工说明和验收条件
- 可导出的原生图，以及包含规格、节点文档、执行约定、验收用例和文件哈希的 `construction.zip`

**只有一个 skill**：`skills/build-interactive-diagrams/`。整个目录一起安装，不能只复制 `SKILL.md`；也不需要多技能拼装。生成网页使用随包提供的资源，无需 CDN。

它执行的是声明式本地模拟。自然语言节点说明不会自动变成业务代码；真实服务、数据库和外部账号必须另行实现、接入并授权。

## 先准备什么

- 一个能加载 `SKILL.md`、读取项目资料并运行本地命令的宿主，例如 Codex 或 Hermes
- Python **3.10+**：验证、生成和本地预览服务
- Node.js **18+**：执行模拟验收及回归测试
- 一个现代桌面浏览器；浏览器必须能访问启动预览服务的同一个本地环境
- 技能目录以外的可写工作目录，用来保存项目规格和生成结果

标准验证、测试、生成不需要安装 npm / pip 包，也不需要联网。宿主本身的模型服务和安装要求另计。

先检查 `python3 --version` 和 `node --version`。`doctor` 只检查环境，不安装软件，也不检查 Node 是否达到最低版本。下列 shell 示例适用于 macOS、Linux 或 WSL；Windows 可按实际环境改用 `python`，Node 测试所用 Python 命令可通过 `PYTHON` 环境变量指定。最低版本及所有平台尚未逐一测试。

## 安装

先下载本仓库并进入仓库根目录。若使用 Git：

```sh
git clone https://github.com/coins504-boop/build-interactive-diagrams.git
cd build-interactive-diagrams
```

安装前可以检查 [技能入口](skills/build-interactive-diagrams/SKILL.md) 和 `scripts/`。以下复制命令会在同名目录已存在时停止，避免覆盖已有修改。

### Codex

复制到用户级技能目录：

```sh
mkdir -p "$HOME/.agents/skills"
test ! -e "$HOME/.agents/skills/build-interactive-diagrams" && \
  cp -R skills/build-interactive-diagrams "$HOME/.agents/skills/"
```

在 Codex 中确认技能可见，然后用 `$build-interactive-diagrams` 明确调用。也可按官方文档使用项目级 `.agents/skills/`。发现目录依据 [Codex 官方说明](https://learn.chatgpt.com/docs/build-skills)，核对日期为 2026-10-03。

### Hermes

独立安装到默认用户技能目录：

```sh
mkdir -p "$HOME/.hermes/skills"
test ! -e "$HOME/.hermes/skills/build-interactive-diagrams" && \
  cp -R skills/build-interactive-diagrams "$HOME/.hermes/skills/"
```

也可以复用上面 Codex 的完整目录，在现有 `~/.hermes/config.yaml` 的 `skills` 配置下合并这一项，不要覆盖其他配置：

```yaml
skills:
  external_dirs:
    - ~/.agents/skills
```

然后在 Hermes 对话中明确要求使用 `build-interactive-diagrams`。不要同时安装两个同名副本。外部目录与安装规则参见 [Hermes 官方技能文档](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md)，核对日期为 2026-10-03。

上述说明是目录与格式兼容的安装方法，不是已在两个宿主中实际调用成功的声明。宿主更新后，请以相应官方文档为准。

## 推荐提示词

替换三个方括号中的内容即可使用；在 Codex 中也可将第一句技能名写作 `$build-interactive-diagrams`。

> 请使用 build-interactive-diagrams skill，为【项目名称】制作交互式工程图。项目资料是【文件或目录】，目标是【希望实现和验证的效果】。
> 先依据资料确定模块、工具、内部步骤及父子关系，再生成图。不同业务输入要有对应路线，并覆盖正常、失败、等待、重试及拒绝等适用情况。每个节点补齐目标、职责、输入输出、规则、权限、施工要求和验收条件。缺失信息明确标注，不要编造。
> 沿用 skill 的完整画布和动态演示能力。交付前检查层级、分支、反复播放，以及图与施工资料的一致性；说明哪些已验证、哪些仍待确认。

第一次体验可以补充：“先用技能自带的温室灌溉示例生成到一个新的空目录，完成 CLI 测试，再启动本地预览；不连接真实设备。”

项目资料只提供已获授权的文件和目录。不要把密码、令牌或个人隐私放进规格，生成结果会包含原始规格和节点说明。

## 五分钟教程：温室灌溉

以下命令从仓库根目录执行。`greenhouse-output` 必须不存在或为空，且不能放在技能目录内；重复试验请换一个新输出目录。

### 1. 检查、验证和测试

```sh
python3 skills/build-interactive-diagrams/scripts/diagram.py doctor
python3 skills/build-interactive-diagrams/scripts/diagram.py validate skills/build-interactive-diagrams/examples/greenhouse.json
python3 skills/build-interactive-diagrams/scripts/diagram.py test skills/build-interactive-diagrams/examples/greenhouse.json
```

温室示例有 6 个验收用例，覆盖土壤干燥、无需灌溉、传感器失败、等待、批准与拒绝。第二个完整示例是 `examples/release-pipeline.json`，涵盖发布、失败重试及耗尽、人工决定。

### 2. 生成并预览

```sh
python3 skills/build-interactive-diagrams/scripts/diagram.py build skills/build-interactive-diagrams/examples/greenhouse.json --out greenhouse-output
python3 skills/build-interactive-diagrams/scripts/diagram.py serve greenhouse-output --port 8000
```

在运行服务的同一环境中打开 `http://127.0.0.1:8000`。服务只绑定本地回环地址，用 `Ctrl+C` 停止。不支持直接双击 `index.html` 使用 `file://` 打开；远程浏览器的 localhost 可能不是这台机器，不能据此判断生成失败。

### 3. 在图上检查

1. 查看主图的模块与工具归属，点击节点读取文档，进入容器查看内部
2. 选择不同场景和运行模式，测试播放、暂停、单步与后退
3. 让流程停在等待节点，再分别测试批准和拒绝；失败路径应走作者定义的实际条件边
4. 在播放中查看角落局部图，展开后进入更深容器，确认它仍跟随同一次运行
5. 反复取消、重开；拖动节点后检查连线与视角；查看最终状态和实际轨迹

检查通过后，可交付整个输出目录及其中的 `construction.zip`。单独分发 `construction.zip` 时，也请附带 `licenses/PROJECT-MIT-LICENSE.txt`；分发网页运行目录时保留完整 `licenses/` 和 `THIRD_PARTY_NOTICES.md`。原生图导出保存布局和原始规格，不保存播放中的会话状态。

### 4. 换成你的项目

把示例复制到技能目录外的新文件，再依据真实项目资料编写规格，不要只替换标题：

```sh
cp skills/build-interactive-diagrams/examples/greenhouse.json project-spec.json
python3 skills/build-interactive-diagrams/scripts/diagram.py validate project-spec.json
python3 skills/build-interactive-diagrams/scripts/diagram.py test project-spec.json
python3 skills/build-interactive-diagrams/scripts/diagram.py build project-spec.json --out project-output
```

请先阅读 [执行约定](skills/build-interactive-diagrams/references/contract.md) 与 [JSON Schema](skills/build-interactive-diagrams/references/spec.schema.json)。示例只提供格式，不替你的项目决定业务规则。`validate` 检查结构及跨字段约束；`test` 才会执行 `acceptance` 中的结构化断言，`docs.tests` 只是说明。

## “第 1–4 层”究竟是什么

层级、步骤和分支是三件不同的事。

### 父子层级：谁包含谁

层级由节点的 `parent` 关系决定。顶层没有 `parent`，子节点指向真实的 `container`。例如：

- 第 1 层：维修模块
  - 第 2 层：诊断工具
    - 第 3 层：接收与预处理
      - 第 4 层：格式校验

这只是解释结构的示意，并非新增的可运行示例。只有确实包含子节点时才建容器；容器不执行动作。项目只需要两层、三层就按真实结构建模，**不强迫凑四层**，也不要求每个分支同样深。

默认主画布以第 1 层模块及其第 2 层节点为主；更深的容器先折叠。运行时角落局部图跟随当前第 2 层范围，显示其内部第 3 层；展开局部图后再点击内部容器，可深入查看第 4 层及更深结构。没有更深子节点时显示当前最小步骤，不凭空生成层级。

### 执行步骤：这次运行先做什么

运行轨迹中的“第 N 步”表示一次执行访问顺序，与第 N 层无关。一个第 4 层叶节点可以是整次运行的第 2 步；第 1 层容器本身不能冒充可执行步骤。控制边连接可执行节点，`kind: data` 的数据边只表示依赖，不会推进运行。

### 条件分支：为什么走这条边

分支由边上的 `when` 条件决定。正常、失败、等待是输入模式；选择模式不会自动补齐相应业务路线。重试次数、耗尽、等待批准与拒绝，都要在规格里明确建模并写验收。

同一节点有多个明确条件同时匹配会报错；没有匹配且没有默认边也会报错。引擎不会靠边的排列顺序偷偷选路。分支数量既不是层数，也不是固定执行步数。

## 测试与验证范围

在 Python 3.12.14、Node.js 24.19.0 环境运行本仓库附带检查：

- 两个公开示例共 **12 个验收用例通过**
- 运行时回归：**1,507 个断言、120 轮重复运行通过**
- 包与生成器检查：**6 组通过**，包含 12 类无效输入、原始文档保真、原生图内完整规格、施工文件哈希、非空输出拒绝及 viewer 字节保真

复现命令：

```sh
cd skills/build-interactive-diagrams
python3 scripts/diagram.py test examples/greenhouse.json
python3 scripts/diagram.py test examples/release-pipeline.json
node tests/runtime.test.js
python3 tests/package.test.py
```

详情见 [可复现验证摘要](skills/build-interactive-diagrams/references/VALIDATION.md)。本次公共目录检查没有启动 Codex、Hermes 或 GUI；自动化通过不代表视觉可读性、任意项目正确性或宿主端到端兼容已经证明。

## 已知边界

- 仅支持执行约定中的声明式状态动作，不执行任意脚本、自然语言或真实外部副作用
- 需要项目自己的输入、条件、施工细节、验收用例及视觉检查；不会从仓库自动推断全部业务语义
- 默认每次运行最多 500 次迁移，硬上限 1,000；单步、决定和运行共用预算，后退不退还预算，重开才重置；到限报错，不当作成功
- 后退保存完整快照，内存开销随轨迹长度可能近似平方增长；步数上限不是大规模性能承诺
- 网页运行状态只在内存中，刷新会重置；图导出不是会话存档
- 超大图、密集连线、长标签、移动端、完整无障碍和所有浏览器组合尚未充分验证；以桌面宽屏为主
- 本地预览不是网站发布；安装技能不代表授权外部服务调用或数据上传
- 随包第三方图形资源的许可条款需要继续保留；现有来源记录不是对全部嵌入图标和模板的穷尽法律审查

## 仓库结构与许可

```text
skills/build-interactive-diagrams/
├── SKILL.md                 技能入口
├── scripts/                 Python 生成器与 Node 运行器
├── assets/                  自包含界面与原生 draw.io viewer
├── examples/                温室灌溉、软件发布两份合成示例
├── references/              约定、Schema、使用说明与验证摘要
├── tests/                   可复现回归检查
├── licenses/                第三方许可证及来源声明
├── THIRD_PARTY_NOTICES.md
└── MANIFEST.json            技能文件哈希
```

仓库只保留一个完整技能副本；生成网页、运行截图、缓存与打包 ZIP 不进入源代码树。

第一方代码、文档与合成示例采用 [MIT 许可证](LICENSE)，同一许可证也保留在技能的 `licenses/PROJECT-MIT-LICENSE.txt` 中，安装与生成输出时一并携带。draw.io viewer 31.7.0 及其组件保留原始字节和独立许可，详见 [第三方说明](skills/build-interactive-diagrams/THIRD_PARTY_NOTICES.md) 和 [完整许可目录](skills/build-interactive-diagrams/licenses/)。复制技能或分发生成结果时应保留相关声明；第一方许可不会覆盖或重许可第三方组件。
