// ==================== 云开发环境配置 ====================
//
// 【Mock 模式】（默认）：CLOUD_ENV_ID 留空，数据存手机本地，无需云环境即可预览
//
// 【云端模式】：填入你的云环境 ID（如 'your-env-id-1a2b3c'），步骤如下：
//   1. 微信开发者工具 → 顶部「云开发」→ 创建环境 → 复制环境ID
//   2. 将环境ID填入下方 CLOUD_ENV_ID
//   3. 右键 cloudfunctions/ 下每个云函数 → 「上传并部署：云端安装依赖」
//   4. 云开发控制台 → 数据库 → 创建以下集合：
//      users / stores / suppliers / goods / orders / categories
//      （另可选：inventories / messages / feedbacks / auditLogs / backups）
//   5. 每个集合权限设为「仅创建者可读写」
//   6. 用管理员账号登录 → 自动初始化分类数据与管理员账号
//
const CLOUD_ENV_ID = ''

// 角色定义
const ROLES = {
  ADMIN:    { id: 'admin',    name: '管理员', color: '#4f46e5', bg: '#eef2ff' },
  MANAGER:  { id: 'manager',  name: '店长',   color: '#0f766e', bg: '#f0fdfa' },
  SUPPLIER: { id: 'supplier', name: '供货商',  color: '#ea580c', bg: '#fff7ed' }
}

// 货品分类（默认分类，云端模式从数据库动态读取）
const CATEGORIES = [
  { id: 'meat',     name: '肉类',   icon: '\ud83e\udd69' },
  { id: 'seafood',  name: '海鲜',   icon: '\ud83d\udc1f' },
  { id: 'veggie',   name: '蔬菜',   icon: '\ud83e\udd55' },
  { id: 'fruit',    name: '水果',   icon: '\ud83c\udf4e' },
  { id: 'grain',    name: '粮油',   icon: '\ud83c\udf3e' },
  { id: 'drink',    name: '酒水',   icon: '\ud83c\udf7a' },
  { id: 'other',    name: '其他',   icon: '\ud83d\udce6' }
]

// ==================== 订阅消息配置 ====================
//
// 留空即自动关闭订阅消息推送，不影响其它功能。
// 店长下单后通知供货商，需在公众平台后台配置订阅消息模板：
//   1. 登录 mp.weixin.qq.com → 「功能」→「订阅消息」→「添加」→「公共模板库」
//   2. 搜索"新订单提醒"或"订单通知"，选用一个包含以下字段的模板：
//      - 订单编号 (character_string 类型)
//      - 门店名称 (thing 类型)
//      - 订单金额 (amount 类型)
//      - 下单时间 (time 类型)
//      - 商品摘要 (thing 类型)
//   3. 复制模板ID填入下方 ORDER_NOTIFY_TMPL_ID
//   4. 重新部署 cloudfunctions/api 云函数
//
const ORDER_NOTIFY_TMPL_ID = ''

// 供应商接单后通知店长
// 模板建议："订单状态更新"或"受理结果通知"，含字段：订单编号、供应商名称、订单金额、处理时间、订单状态
const MANAGER_ACCEPT_TMPL_ID = ''

// 供应商配送后通知店长
// 模板建议："订单配送通知"或"物流配送通知"，含字段：订单编号、供应商名称、配送时间、运单号/凭证、订单金额
const MANAGER_SHIP_TMPL_ID = ''

// ==================== 管理员初始账号 ====================
//
// ⚠️ 仅供本地演示 / 首次初始化使用。
//    正式部署前请务必修改为强密码，并同步修改 cloudfunctions/login 与
//    cloudfunctions/api 中同名的两个常量（云函数无法直接引用本文件）。
//
const BOOTSTRAP_ADMIN_PHONE = '13800000000'
const BOOTSTRAP_ADMIN_PASSWORD = 'admin123'

module.exports = {
  CLOUD_ENV_ID, ROLES, CATEGORIES,
  ORDER_NOTIFY_TMPL_ID, MANAGER_ACCEPT_TMPL_ID, MANAGER_SHIP_TMPL_ID,
  BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD
}
