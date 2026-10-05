# 餐饮供货管理小程序

一个基于 **微信小程序原生框架 + 微信云开发** 的餐饮供应链协作管理小程序，面向「管理员 / 店长 / 供货商」三种角色，覆盖采购下单、订单流转、月末盘点、报表统计与账号审核的完整闭环。

本仓库为**空白模板版**：只保留完整可用的业务代码，不包含任何真实门店、供货商、货品与订单数据，也不包含任何私有凭据。

---

## 功能概览

### 三种角色

| 角色 | 主题色 | 主要能力 |
| --- | --- | --- |
| 管理员 admin | `#4f46e5` | 全局数据总览、账号审核与停用、门店/供货商/货品管理、操作日志、数据备份 |
| 店长 manager | `#0f766e` | 采购下单、购物车、订单跟踪与收货、月末盘点、报表统计 |
| 供货商 supplier | `#ea580c` | 接单、发货、商品维护、销售报表 |

### 核心功能

- **三角色权限体系**：自定义 tabBar 按角色渲染不同导航，接口层做角色与数据归属校验
- **采购下单**：供货商维度 + 分类维度双 Tab 选品，步进器支持小数数量，悬浮购物车入口
- **购物车**：跨页面共享状态，按供货商自动拆单结算
- **订单全流程**：`待确认 → 已接单 → 配送中 → 部分收货 / 已收货`，支持取消；含批次号关联、图片发货凭证、部分收货数量回填
- **订单详情编辑**：待确认/已接单阶段可改数量，发货前后可改收货信息
- **月末盘点**：按分类分组录入，单价自动计算小计，同店铺同月 upsert，支持历史详情
- **报表统计**：7 天 / 本月 / 近一年时间段筛选，分类与商品维度统计，趋势柱状图
- **Excel 导入导出**：云函数生成与解析标准 `xlsx`，覆盖订单、商品、供货商；含可直接下载的导入模板
- **单设备登录**：`sessionToken` 机制实现同一账号后登录踢先登录
- **站内消息中心**：下单、接单、发货等节点自动写入消息
- **意见反馈**：写入云数据库，可选邮件通知（默认关闭）
- **审计日志**：关键写操作留痕，支持按时间归档
- **定时任务**：每 5 分钟扫描超时未接单订单并提醒；每日自动备份；每月归档历史日志
- **隐私合规**：首次进入弹窗展示隐私政策，`__usePrivacyCheck__` 开启

---

## 技术栈

- 原生微信小程序（WXML / WXSS / JS / JSON），无第三方 UI 框架
- 微信云开发：云函数（Node.js + `wx-server-sdk`）、云数据库、订阅消息
- 分包加载 + `lazyCodeLoading` 按需注入
- 数据抽象层 `utils/cloud.js`：统一封装 **Mock 模式**（本地存储）与**云开发模式**，业务页面无需关心数据来源

---

## 目录结构

```
├── app.js / app.json / app.wxss     # 小程序入口、全局配置与设计变量
├── pages/
│   ├── login/                       # 角色选择 + 登录 / 注册
│   ├── messages/                    # 站内消息中心
│   ├── feedback/                    # 意见反馈
│   ├── admin/                       # 管理员分包（8 页）
│   ├── manager/                     # 店长分包（11 页）
│   └── supplier/                    # 供货商分包（5 页）
├── components/
│   ├── tabbar/                      # 按角色渲染的自定义 tabBar
│   ├── empty/                       # 空状态占位
│   └── privacy-popup/               # 隐私政策弹窗
├── utils/
│   ├── cloud.js                     # 数据抽象层（Mock / 云开发双模式）
│   ├── config.js                    # 环境与模板配置（需自行填写）
│   ├── constants.js                 # 订单状态、用户状态常量
│   ├── excel.js                     # 前端 Excel 调用封装
│   └── util.js                      # 通用工具函数
├── images/tabbar/                   # tabBar 图标
└── cloudfunctions/
    ├── api/                         # 通用业务 API（带权限校验，约 30 个 action）
    ├── login/                       # 登录 / 注册 / 会话校验
    ├── register/                    # 注册
    ├── excel/                       # xlsx 生成与解析
    ├── messages/                    # 站内消息读写
    ├── feedback/                    # 意见反馈（可选邮件通知）
    ├── staleOrderCheck/             # 定时：超时未接单提醒（每 5 分钟）
    ├── dailyBackup/                 # 定时：每日数据备份
    └── archiveOldLogs/              # 定时：每月归档历史日志
```

共 27 个页面、9 个云函数、3 个公共组件。

---

## 快速开始

### 方式一：Mock 模式（零配置，推荐先跑通）

Mock 模式下所有数据存在手机本地存储（`syx_cloud_db`），无需云环境即可完整体验。

1. 用微信开发者工具「导入项目」，选择本目录
2. AppID 选择「测试号」或直接使用 `project.config.json` 中的 `touristappid`
3. 编译运行，选择「管理员」角色登录：
   - 手机号 `13800000000`
   - 密码 `admin123`
4. 登录后可在管理后台创建门店、供货商与货品，再注册店长/供货商账号体验完整流程

### 方式二：云开发模式

1. 在 `project.config.json` 中把 `appid` 换成你自己的小程序 AppID
2. 微信开发者工具 → 顶部「云开发」→ 创建环境，复制环境 ID
3. 将环境 ID 填入 `utils/config.js` 的 `CLOUD_ENV_ID`
4. 右键 `cloudfunctions/` 下**每个**云函数 → 「上传并部署：云端安装依赖」
5. 云开发控制台 → 数据库，创建集合：

   ```
   users  stores  suppliers  goods  orders  categories
   inventories  messages  feedbacks  auditLogs  backups
   ```

   权限统一设为「仅创建者可读写」
6. 为 `api` 与 `login` 云函数配置环境变量 `PASSWORD_SALT`（**两者必须一致**，见下方安全说明）
7. 用管理员账号登录一次，系统会自动初始化默认分类

---

## 配置说明

所有需要你自行填写的配置集中在 `utils/config.js`：

| 配置项 | 说明 |
| --- | --- |
| `CLOUD_ENV_ID` | 云开发环境 ID。留空即使用 Mock 模式 |
| `ORDER_NOTIFY_TMPL_ID` | 供货商「新订单提醒」订阅消息模板 ID，留空则关闭推送 |
| `MANAGER_ACCEPT_TMPL_ID` | 店长「订单已接单」模板 ID，留空则关闭推送 |
| `MANAGER_SHIP_TMPL_ID` | 店长「订单已发货」模板 ID，留空则关闭推送 |
| `BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_PASSWORD` | 管理员初始账号，**上线前务必修改** |

订阅消息模板需在 [微信公众平台](https://mp.weixin.qq.com) → 功能 → 订阅消息 → 公共模板库中添加，字段要求见 `utils/config.js` 内的注释。

可选配置：

- `cloudfunctions/feedback/mailConfig.js`：反馈邮件通知的收件人与 SMTP（默认关闭，支持改用环境变量注入）
- `cloudfunctions/staleOrderCheck/index.js` 的 `ACCEPT_NOTIFY_TMPL_ID` 环境变量：超时提醒所用模板 ID
- `cloudfunctions/login/index.js` 的 `REGISTER_NOTIFY_TMPL_ID` 环境变量：新用户注册待审核通知模板 ID

---

## 数据模型

| 集合 | 说明 |
| --- | --- |
| `users` | `_id / openid / role / name / phone / storeId / supplierId / status / password / sessionToken / createTime` |
| `stores` | 门店：`name / address / phone / managerId` |
| `suppliers` | 供货商：`name / contact / phone / address / categories[] / status` |
| `goods` | 货品：`code / name / category / unit / price / specWeight / specCount / image / description / supplierId` |
| `orders` | 订单：`no / storeId / supplierId / items[] / total / status / remark / shipImage / batchNo / receiver / receiveTime` |
| `categories` | 货品分类：`id / name / icon / sort` |
| `inventories` | 月末盘点：`storeId / month / items[]` |
| `messages` | 站内消息：`userId / type / title / content / status` |
| `auditLogs` | 审计日志：`action / userId / targetId / detail / createTime` |

订单状态流转：

```
pending（待确认） ──▶ accepted（已接单） ──▶ shipped（配送中） ──▶ received（已收货）
      │                    │                      └──────────▶ partial（部分收货）──▶ received
      └────────────────────┴──▶ cancelled（已取消）
```

---

## 安全说明

本模板已做以下处理，但**正式上线前请务必自行加固**：

1. **密码加盐哈希**：`api` 与 `login` 云函数使用 `SHA-256(salt + password)`。盐值通过云函数环境变量 `PASSWORD_SALT` 注入，仓库内不包含真实盐值。两个云函数必须使用相同盐值。
2. **管理员初始账号**：`utils/config.js` 与 `cloudfunctions/login/index.js` 中的 `BOOTSTRAP_ADMIN_*` 仅用于数据库中还没有管理员时的首次初始化。**请在上线前修改为强密码**；管理员已存在时，该初始账号不再具备任何特权。
3. **凭据不落仓库**：AppID、云环境 ID、订阅消息模板 ID、SMTP 授权码、管理员密码均以占位符或环境变量形式提供。
4. **单设备登录**：`sessionToken` 校验可防止账号多端同时在线。
5. **接口鉴权**：所有写操作均校验调用者身份、角色与数据归属。

> 提示：微信小程序端的代码对用户可见，**不要把任何密钥写在 `utils/` 中**。敏感逻辑应放在云函数并通过环境变量配置。

---

## 开发约定

- 业务页面统一通过 `utils/cloud.js` 访问数据，不要在页面里直接调用 `wx.cloud`
- 校验代码：`node --check <file>` 检查 JS 语法，`JSON.parse` 检查 JSON 合法性
- 各页面 `index.json` 使用 `usingComponents` 按需引入组件

---

## License

[MIT](./LICENSE)
