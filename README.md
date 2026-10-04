# build-interactive-diagrams

把项目资料变成可以展开、播放、检查和交付的交互式工程图。

**版本：1.4.0**。一个完整技能，支持需求设计与授权源码解释：按需选择职责概览、重点流程或深入复核，保留来源证据、覆盖限制和实际构建收据。更新源码呈现、等待/终态说明与原生导出保真。版本号不代表任意项目都能直接适用，或已经在 Codex / Hermes 中完成端到端验证。

第一方代码、文档与合成示例采用 [MIT 许可证](LICENSE)。第三方组件继续适用其各自条款，详见文末许可说明。

## 你会得到什么

- 原生 draw.io 单画布、可展开的父子节点、节点拖动、平移和缩放；每个容器试算横向/纵向布局，再紧凑排列实际区域
- 基于同一份 JSON 规格的本地确定性模拟，支持逐步、播放、暂停、后退、取消、重开，以及明确建模的正常、失败、等待与重试路径
- 与主流程状态同步的局部详情，以及来自真实状态的短讲解；当前节点和最后真实边用青色细线、近白亮芯及克制光晕标示
- 标题、工具栏、讲解、侧栏和局部图可分别收起；专注模式恢复原组合，侧栏隐藏后仍可操作同一次运行
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

先检查 `python3 --version` 和 `node --version`。`doctor` 只检查环境，不安装软件，也不检查 Node 是否达到最低版本。下列 shell 示例适用于 macOS、Linux 或 WSL；Windows 可按实际环境改用 `python`，Node 测试所用 Python 命令可通过 `PYTHON` 环境变量指定。最低版本及所有平台尚未逐一测试。保留普通克隆/解压后的目录权限；将源 assets 目录改成不可写模式（如 chmod 555）会使生成目录继承该模式并构建失败。

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


### 已安装旧版本

先更新仓库，再备份现有的完整技能目录，并用 `skills/build-interactive-diagrams/` 整目录替换旧副本。不要把新版零散文件叠加到改过的旧版，也不要只替换 `SKILL.md`。重新打开宿主并确认加载的是清单版本 1.4.0；这一步需要在实际使用的 Codex/Hermes 环境中完成。

## 推荐提示词

在 Codex 中先明确调用 `$build-interactive-diagrams`，再选择需要的深度。替换方括号中的内容：

**从需求设计**

> 用 $build-interactive-diagrams 把【需求或授权资料目录】画成一张中文交互式工程图。先讲清职责和端到端流程，标出假设；为适用分支做本地演示，交付工作区和施工包。

**从源码解释重点流程**

> 用 $build-interactive-diagrams，只读【授权仓库目录/版本】，用中文解释【重点流程】和周边职责。重点流程可连续播放；保留源码证据、失败与未知边界，不运行上游项目，明确实际覆盖范围。完成源码构建与验证流程，交付实际构建收据，并检查浏览器交互。

**先做概览**

> 用 $build-interactive-diagrams 给【项目】做职责概览，并演示【一个流程】。未深入的地方明确标注，不把概览说成全仓库验证。

**按需复核已有图**

> 对已有图的【具体范围】深入复核源码、默认行为、所有权/异步边界和反例；只修证据确认的问题，保留旧版及验证限制。

第一次体验可以补充：“先用技能自带的温室灌溉示例生成到一个新的空目录，完成 CLI 测试，再启动本地预览；不连接真实设备。”

请保留技能提供的原生画布与运行器，不要用静态截图或临时重写的演示替代。源码哈希、模拟通过和构建收据证明的范围不同，都不能证明全部源码行为或生产等价。完整说明见 [使用说明](skills/build-interactive-diagrams/references/使用说明.md)。

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
5. 分别收起五类面板并恢复，检查专注模式、隐藏侧栏后的播放/单步/后退及等待决定
6. 反复取消、重开；拖动节点后检查连线与视角；查看最终状态和实际轨迹

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

日常画图按 [技能入口](skills/build-interactive-diagrams/SKILL.md) 运行相应的验证/构建流程；不必每次执行完整包维护测试。源码重建须使用 [源码重建指南](skills/build-interactive-diagrams/references/repository-reconstruction.md) 的构建与验证流程，并交付真实收据。

发布文件可用 `MANIFEST.json` 中的 SHA-256 核对；清单不包含其自身。源码、模型验收、包完整性与浏览器检查应分别报告，不能相互替代。维护与回归命令见 [验证说明](skills/build-interactive-diagrams/references/VALIDATION.md)。

自动化检查不启动 Codex、Hermes 或上游项目。通过不代表任意项目的语义正确性、视觉可读性或宿主端到端兼容已经证明。原生导出仍有完整编辑器编辑/保存/重导入未经全面验证等边界；不要把模型收据称为生产认证。

## 已知边界

- 仅支持执行约定中的声明式状态动作，不执行任意脚本、自然语言或真实外部副作用
- 需要项目自己的输入、条件、施工细节、验收用例及视觉检查；不会从仓库自动推断全部业务语义
- 默认每次运行最多 500 次迁移，硬上限 1,000；单步、决定和运行共用预算，后退不退还预算，重开才重置；到限报错，不当作成功
- 后退保存完整快照，内存开销随轨迹长度可能近似平方增长；步数上限不是大规模性能承诺
- 网页运行状态只在内存中，刷新会重置；图导出不是会话存档
- 原生几何测试覆盖 300 / 600 / 1,000 节点的固定合成图，3 层容器 / 4 层顶点（含叶节点）、单容器最多 38 个直接子节点；不保证任意复杂度、连线无交叉或长标签总能避让
- 600 节点浏览器检查出现过较慢的加载和重新布局；几何通过不等于响应速度保证。移动端、完整无障碍和所有浏览器组合尚未充分验证，以桌面宽屏为主
- 顶部讲解是实际运行状态的短说明，不是完整的分镜演示或自动镜头动画
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
