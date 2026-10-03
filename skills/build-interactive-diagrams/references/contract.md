# 通用执行与施工约定 · 1.0

这是一个本地、确定性的声明式模拟协议，不是自动连接项目系统的工作流服务。生成器、网页和 Node 运行器使用同一个 spec；不从截图推测业务规则。

## 规格与权威关系

spec.schema.json 说明结构；diagram.py validate 还验证唯一 ID、父级/边端点、父级无环、真实可执行入口、条件/动作安全边界等跨字段不变量。两者都应通过，但内置 validator 是随包可直接运行的检查入口。未知业务元数据可以保存，不能改变执行语义。

nodes 中每项的 id、label、role、docs.goal 必填。ID 是英文字母开头的 1–80 位字母、数字、下划线或连字符；全图节点与边的 ID 不重复。顶层省略 parent；非顶层的 parent 必须是 container 的 ID，不能用 null 或空串。container 不执行动作，必须有真实子节点。source、step、router、wait、store 可执行；terminal 到达后结束；可用status字符串声明结束状态，省略时默认为completed。终点的任意status文字（包括waiting）不会把终点变成人工等待节点。store 无控制出边时是只读资料，不得作为控制入口/控制边目标。数据边 kind=data 只表示依赖，不执行。

每个 docs 应包含 goal、inputs、outputs、rules、permissions、construction、tests。除 goal 字符串外，允许嵌套对象/数组；缺少其余字段会给 warning，避免凭空补写未知约束。机器生成的 composition / machine 保存在独立 generated 属性，原作者的同名 docs 字段无损保存。construction/NODE_INDEX.md 和原生图来自相同输入。

节点动作是本地状态变更，不是自然语言文档的自动实现。docs.tests 是说明；只有 acceptance 中的结构化断言实际执行。

## 条件与分支

边包含 id、source、target，可选 label、kind、when。控制边必须连接可执行节点，容器不能代替内部步骤。每条出边一次仅代表一个迁移；进入目标后执行该目标的 actions。

when 支持：
- {"field":"mode","op":"eq","value":"failure"}
- {"field":"decision","op":"eq","value":"approve"}
- {"field":"context.retryCount","op":"lt","value":2}
- {"all":[条件,条件]}、{"any":[条件,条件]}、{"not":条件}

运算符 eq/ne 深比较 JSON 值（对象键顺序不影响相等；数组按顺序比较）；gt/gte/lt/lte 仅比较数字；exists 的 value 是布尔值；in 的 value 是数组。无 when 的边是 fallback，只有所有明确条件不匹配时使用，每个源节点最多一条。明确条件同时匹配超过一条时失败，禁止依赖数组顺序偷偷选路。没有匹配边也失败并保留原状态。

normal/failure/wait 只是运行输入 mode，必须由作者在真实条件边中定义实际失败、等待、恢复、重试和耗尽路径。选择“失败运行”不会神奇调用外部服务或自动新增失败节点。kind 用于呈现；除 data 以外，kind 不替代 when。

wait 节点进入后停在 waiting；明确 decide(approve/reject) 才沿边前进。decision 仅供离开当前 wait 的条件使用，进入下一节点后清空。每条 wait 的批准和拒绝分支都应验收。

## 声明式动作

context 是 JSON 对象。scenario.context 浅覆盖 spec.context 的顶层字段，不做深合并。

- set: {"op":"set","path":"order.status","value":"ready"}
- copy: {"op":"copy","path":"output","from":"input"}；来源必须存在
- increment: {"op":"increment","path":"tries","by":1}；缺失从 0 开始，by 默认 1；null 与非数值报错
- append: {"op":"append","path":"events","value":"checked"}；缺失从空数组开始；null 与非数组报错
- delete: {"op":"delete","path":"temporary"}

delete 路径不存在时不修改状态。路径由点分隔，不能包含 __proto__、prototype、constructor；数值必须有限；不允许 eval、脚本、shell、网络、外部账号或秘密。单次迁移在克隆上完成，所有动作成功才提交，异常回滚该迁移；不回滚此前已经成功的迁移。一次返回快照还原 context、节点、状态、决定与轨迹。

## CLI 行为

python3 scripts/diagram.py validate spec.json
python3 scripts/diagram.py build spec.json --out /chosen/new-output
python3 scripts/diagram.py test spec.json

Node 18+ 运行器先调用 Python 校验，再从 stdin 读取一个 JSON 对象。完整调用示例（在技能目录内）：

```sh
printf '%s\n' '{"commands":[{"op":"start","scenario":"dry-bed","mode":"wait"},{"op":"run"},{"op":"decide","value":"approve"},{"op":"run"}]}' | node scripts/run.js examples/greenhouse.json
```

输入对象示例：
{"commands":[{"op":"start","scenario":"my-case","mode":"normal"},{"op":"step"},{"op":"run"},{"op":"inspect"}]}

命令为 start、step、run、decide(value=approve/reject)、back、cancel、reset、inspect。start 验证后重新开始，重置 context 和回退历史；step 在终点或等待时不变。run 推进至等待/终点，默认总迁移预算 maxSteps=500，硬上限1000；step、decide和run共用同一累计预算，后退不退还预算，重新start才重置，limit 可显式指定 1–1000。超过上限报错并保留已完成前缀，不能报告为正常结束。每条命令输出 {ok,state} 或 {ok:false,error,state}；命令失败不停止后续命令，进程退出码为 1。未开始时 inspect 为 null。

## 验收

acceptance 项：id、scenario、mode(默认 normal)、decisions(默认空数组)、expect。先开始并运行至等待/终点，再逐个应用 decisions，每次继续推进。expect 支持 status、nodeId、context(点路径到期望值)、traceIncludes、traceExcludes；未知断言键必须拒绝，避免拼写错误导致空验收。

公开用例不是穷尽证明。应增加独立未见输入、分支冲突、缺失分支、异常动作回滚、连续重开/取消、等待批准/拒绝、后退重播、视角保持和数据边不执行的验证。施工包包含规格、原生图、schema、本执行约定、节点文档、公开用例、SHA-256 文件清单；不包含原项目的生产实现。

## 已知限制

任意业务领域可建模，但只覆盖上述声明式动作；真实业务必须另行实现/授权。不会从仓库自动推断完整业务语义。复杂布局和标签需人工视觉验收；大量节点/长标签不保证无需调整。回退保存完整快照，内存随轨迹近似平方增长，默认500步，1000上限不是性能承诺；达到预算会明确报错且不继续提交迁移。网页不持久化运行；导出原生图保存布局/原规格，不保存当前运行状态。浏览器本地 HTTP 服务只绑定127.0.0.1，无部署动作。建议桌面宽屏，移动端布局未充分验证。
