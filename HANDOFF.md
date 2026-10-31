# Number Bomb 开发交接文档

记录日期：2026-10-30（America/Chicago）
项目目录：C:\handshake-game
当前版本：1.0.0，已完成可试玩原型，尚未完成长期线上托管。

## 1. 项目目标与当前结论

这是 Handshake「Create a Multiplayer Game」任务项目，主题为猜数字炸弹。目标是让至少两名玩家从不同设备加入同一房间，按照页面上明确的规则完成游戏，并通过外部可访问的网址试玩。

目前已完成中文界面、2–8 人房间、服务器权威状态机、实时同步、淘汰胜负、刷新恢复身份和手机适配。上一轮开发已通过六项自动测试及本机与外网两个浏览器身份的操作验证。

最优先的交接任务是正式部署和准备提交封面，而不是继续堆叠玩法。临时链接不能作为长期展示的可靠入口。

本交接仅核对当前文件并整理历史验证记录，没有重新运行测试或确认临时网址此刻仍然在线。

## 2. 已确定的玩法

- 2–8 人；昵称 1–16 个字符；六位大写十六进制房间码。
- 房主创建房间，其他玩家输入房间码或打开邀请链接加入。
- 全员准备且至少两人后，由房主开始。
- 每轮服务器随机选择 1–100 的整数作为炸弹，范围包含两端。
- 玩家按加入顺序轮流猜整数。安全猜测缩小范围，下一位存活玩家继续。
- 每次作答限时 30 秒；猜中炸弹或超时淘汰。
- 每次输入后进入 2.2 秒结算，期间锁定猜数。
- 淘汰后若仍有至少两人，重置范围与炸弹，进入下一轮。新一轮从加入顺序中第一位存活玩家开始。
- 只剩一人时结束；该玩家本房间累计胜场加一。没有每次猜数的积分，也没有固定三轮制。
- 房主可在结束后返回大厅，再次全员准备后开局。
- 大厅或结束阶段可主动离开；房主主动离开时顺位转交房主。
- 游戏中不能主动离开；关闭页面不暂停计时，超时仍会淘汰。淘汰玩家可以观战。

## 3. 文件导航

| 文件 | 职责 |
| --- | --- |
| game.js | Game 类；房间、玩家、规则、状态转换、状态版本、公开视图 |
| server.js | HTTP 静态资源、JSON 操作接口、SSE 广播、定时推进、房间清理 |
| public/index.html | 页面骨架、标题、资源入口 |
| public/app.js | 页面渲染、房间操作、SSE、轮询、身份恢复、邀请链接 |
| public/style.css | 深色与荧光绿设计、桌面和手机布局；使用 Google Fonts 外链 |
| test/game.test.js | Node 原生测试，含双 HTTP 客户端 SSE 集成测试 |
| package.json / package-lock.json | ESM 项目、启动与测试脚本，无运行时第三方依赖 |
| start.cmd | Windows 双击启动，固定 PORT=4317 |
| Dockerfile | Node 24 Alpine，单进程运行，使用 node 非 root 用户 |
| README.md | 面向使用者的规则、启动和托管说明 |
| work/ | 临时 cloudflared 程序、服务日志和验证截图，不属于源码交付 |
| .playwright-cli/ | 浏览器验证记录，不属于生产代码 |

项目目前没有 Git 仓库元数据，不应假设已有远程仓库、提交历史或 CI。

## 4. 状态与同步设计

阶段值是 lobby、playing、resolving、gameover。

- lobby → playing：房主开始，至少两人且全员 ready。
- playing → resolving：当前玩家提交合法数字，或服务器判定超时。
- resolving → playing：安全猜测切换玩家；淘汰后重新生成一轮。
- resolving → gameover：只剩一名存活玩家。
- gameover → lobby：房主 restart。

所有决定由服务器作出。浏览器不生成炸弹，不决定淘汰或赢家。

房间存在 Game.rooms 内存 Map 中。主要字段包括 code、host、players、phase、round、low、high、bomb、turn、version、deadline、result、log、winner、updated。

每次改变状态递增 version。ready/start/guess/leave/restart 要携带当前版本；过期请求被拒绝，客户端提示重试，避免重复提交或并发覆盖。

公开视图移除当前 bomb 和所有玩家 token；结算命中或超时后可以公开已结束那轮的炸弹。玩家身份使用随机令牌，保存在 sessionStorage 的 number-bomb 项中。刷新同一标签页恢复身份；新设备需要重新加入。复制标签页可能复制初始 sessionStorage，测试多人优先用独立浏览器上下文。

服务器每 200ms 检查到期阶段。客户端用 serverTime 校准倒计时显示。SSE 提供更新，并每 15 秒发送保活。客户端另有每秒 resume 轮询，当前实现即使 SSE 正常也会继续轮询；它不是仅在 SSE 断开时才运行。六小时无状态变更的房间会被清理；只读轮询不会延长该期限。

## 5. 接口约定

### POST /api/game

JSON 参数共有 type，可按操作带 name、code、token、version、value。

| type | 参数及行为 |
| --- | --- |
| create | name；创建房间，返回 state、playerId、token |
| join | code、name；仅大厅可加入，返回身份和 state |
| resume | code、token；返回当前 state 和已有身份，不修改版本 |
| ready | code、token、version；切换自己的准备状态 |
| start | code、token、version；房主开始 |
| guess | code、token、version、整数 value；当前回合玩家猜数 |
| leave | code、token、version；大厅或结束后离开 |
| restart | code、token、version；房主在结束后重置到大厅 |

成功返回 JSON。当前所有捕获到的操作错误都返回 HTTP 400 和 error 文本，没有细分错误码。请求体限制为约 4096 个字符串字符。带 Origin 的请求会核对协议与 Host；反向代理部署需要正确保留 Host 并设置 X-Forwarded-Proto。

### GET /api/events?code=...&token=...

鉴权后返回 text/event-stream。首条消息为当前完整公开状态，后续也是完整状态。令牌在查询参数中，部署日志应避免记录完整带参数地址。

## 6. 本地启动与测试

要求 Node.js 20+；开发时使用 Node.js 24.18.0。

在项目根目录运行：

```powershell
npm start
npm test
```

也可以双击 start.cmd。默认访问 http://localhost:4317；npm start 可通过 PORT 环境变量覆盖端口。服务器监听 0.0.0.0。若端口占用，先识别进程归属，不要结束其他项目服务。更改服务器代码后需要重启服务；重启会清空房间。更改前端文件后刷新页面。

无构建步骤，不需要安装运行时依赖。静态页面本身不能完成多人游戏，必须同时启动 server.js。

### 上一轮已通过的六项自动测试

1. 四人三轮淘汰、最终赢家、胜场累计和再来一局。
2. 范围缩小、轮次同步、非法数字、非当前玩家、重复版本和结算锁定。
3. 超时保留当前范围、仅淘汰一人并进入新轮。
4. 公开状态不包含未揭晓炸弹和玩家令牌。
5. 八人上限、房主权限、主动离开后的房主转移。
6. 两个 HTTP 客户端收到一致 SSE 状态，并恢复已有玩家身份。

### 上一轮浏览器验证

- 本地桌面页面创建房间，外网手机尺寸页面用独立身份加入。
- 玩家一猜 50 后，玩家二显示同一结果。
- 玩家二刷新后恢复同一房间及身份。
- 390px 手机视口检查无横向溢出，已查看截图。
- 外网首页返回 200，外网创建房间接口成功。

没有做大规模并发、长时间弱网、完整跨实体手机矩阵或正式托管环境验证。

### 已修复的问题

- 超时传 null 时被当作数字处理，导致下界错误重置为 1。
- URL 解析不在 try 内，异常可能逃逸请求错误处理。
- 加入后立刻点准备时连接标记尚未更新，点击被阻止。
- resume 轮询不再向全房间重复广播。
- 默认 3000 端口被占用，统一改用 4317。

## 7. 当前上线方式与恢复

上一轮建立的临时地址：
https://manchester-dos-customs-boots.trycloudflare.com

该地址由本机 work/cloudflared.exe 转发至 http://127.0.0.1:4317。服务和隧道以隐藏窗口后台进程运行；它们不是已安装的开机自启服务，也不是永久托管。

相关文件：
- work/server.log、work/server-error.log
- work/tunnel.log、work/tunnel-out.log
- work/mobile.png、work/desktop.png

需要新的临时链接时，先确认游戏已启动，再运行：

```powershell
.\work\cloudflared.exe tunnel --url http://127.0.0.1:4317 --protocol http2
```

读取该次输出的新地址，不要默认旧地址可以复用。关闭电脑、休眠、网络中断或结束进程都会影响可用性。

长期部署应选择支持持续运行 Node HTTP 服务的主机，可使用 Dockerfile。当前只能部署一个实例；多实例没有共享房间数据，会破坏同步。普通静态文件上传、直接放到只支持无状态函数的环境，都不能原样承载本项目。

## 8. 已知限制与后续优先级

### P0：提交前

- 完成稳定公网部署；取得可长期访问的 HTTPS 地址，重新测双人流程。
- 制作真正的游戏关键画面截图作为封面：推荐 3:2、宽度至少 1200px。现有 mobile.png 是窄幅手机长截图，不符合推荐封面规格。
- 准备 Handshake 标题、游戏链接和不超过 500 字符的描述。

### P1：房间可靠性

- 关闭网页不会自动 leave。大厅中未准备的离线玩家会阻止开始；房主直接关闭页面不会自动交接，可能阻止开始或再来一局。需要在线状态、宽限期、房主自动交接或踢人机制。
- 服务器重启丢失所有房间和胜场；如需长期保留，应设计持久化与迁移。
- 房间失效时，已有页面的轮询失败可能只显示重新连接，缺少明确的退出与重新加入流程。
- 当前同时运行 SSE 和每秒轮询，需按实际部署网络测量和调整，避免不必要请求。
- 公开服务尚无专门的房间创建限流、连接数量限制和总体资源配额。
- 玩家离开时客户端会关闭自己的 SSE，但服务端没有专门按玩家撤销已打开的订阅；后续增强身份生命周期时一并处理。

### P2：体验和维护

- 音效、震动反馈、可配置范围与回合时间、昵称去重等均未实现。
- 排行榜仅为当前房间内存胜场，没有跨房间账号或永久排行。
- 将目前较紧凑的代码格式化并拆分模块；保持行为不变并运行测试。
- 增加断线、快速连续点击、同时准备、房主离开、房间过期等浏览器回归覆盖。
- 按需把外链字体改成本地资源，减少外网依赖。

## 8.5 2026-10-30 界面美化（立体风格）

- 只改了 public/style.css 和 public/app.js 的模板；游戏规则、接口和服务端没有改，六项测试仍全部通过。
- 新增：透视网格背景、立体炸弹（带引线火花）、叠层卡片、按键式按钮、立体荧光数字、1–100 范围进度条（结算时标出猜测或炸弹位置）、倒计时进度条（剩 10 秒内变红）、玩家头像分色、淘汰时卡片抖动和红光。
- 动画只用位移和缩放，不从透明开始，避免后台标签页卡在第一帧时内容消失；支持 prefers-reduced-motion。
- 原始文件备份在 work/ui-backup-2026-10-30/。

## 8.6 2026-10-30 可靠性优化与提交准备

- 在线状态：Game 记录每位玩家 seen；任何带令牌的请求和打开中的 SSE 连接都会刷新。大厅离线 60 秒移出，结束阶段房主离线 60 秒转交在线玩家。公开视图带 online，不含 seen。
- 房间失效或被移出：错误带 gone 标记，前端回到首页并提示，不再一直显示"正在重新连接"。
- 推送：SSE 每 10 秒发 ping 事件；离开或被移出的玩家推送连接会被关闭。前端只有在 SSE 收到数据后才停止轮询。注意：Cloudflare 快速隧道会缓冲 SSE（curl 看到响应头但没有数据），所以临时外网地址实际靠每秒轮询同步，本机或正式主机走 SSE。
- 防护：按 IP（优先 cf-connecting-ip / x-forwarded-for）限流，全服房间上限 500，每房间推送连接上限 24；新增 /healthz；收到 SIGTERM 时正常退出。
- 测试增至 9 项并全部通过。外网临时地址用两个独立浏览器身份完成创建、加入、准备、开始、猜数同步验证。
- 新增 start-public.ps1（启动服务和快速隧道并打印地址）、render.yaml（Render 免费单实例部署）。
- 封面：submission/cover-gameplay.png（1980×1320，3:2，四人对局进行中）为主封面；submission/cover-landing.png 为备选首页图。

## 9. Handshake 提交资料

提交页：
https://app.joinhandshake.com/learn/create-a-multiplayer-game-8d7d59b5/submit

用户提供的表单要求：项目标题、可试玩链接、关键画面封面、最多 500 字符的描述。Share to Showcase 为可选；选中后公开展示并参与页面所述挑战，不选则发布到个人主页。不要把令牌或个人隐私信息写入展示资料。

建议标题：Number Bomb — A Real-Time Multiplayer Game

已准备的英文描述：

> Number Bomb is a real-time multiplayer game for 2–8 players. Players join by room code and take turns guessing a hidden number. Each safe guess narrows the range; hitting the bomb eliminates you. The biggest challenge was keeping every screen synchronized. I learned how server-controlled game states, input validation, and reconnection work together. Testing across browser sessions was especially rewarding. Next, I want to add sound effects, custom rules, and persistent leaderboards.

当前尚未替用户提交或发布到 Handshake，也未决定是否勾选 Showcase。

## 10. 给接手开发者的建议

先阅读 game.js 和 test/game.test.js，再启动本机服务，使用两个独立浏览器身份走完一局。沿用服务器权威状态与版本校验，不要把炸弹生成或胜负判断搬到客户端。优先处理稳定部署、断线房主与封面交付。部署后再次验证真实外网入口，不能仅凭本地测试宣布可提交。
