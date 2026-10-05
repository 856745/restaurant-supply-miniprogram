// 云函数 - 登录（支持手机号+密码登录 & OPENID自动登录）
// 单设备登录：通过 sessionToken 实现同一账号同时只能一个设备在线
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 密码加盐哈希：盐值请通过云函数环境变量 PASSWORD_SALT 配置
// 云开发控制台 → 云函数 → 本函数 → 配置 → 环境变量，添加 PASSWORD_SALT
const SALT = process.env.PASSWORD_SALT || 'REPLACE_WITH_YOUR_OWN_SALT'

// ⚠️ 管理员初始账号：仅用于首次初始化（数据库中还没有管理员时）。
//    正式部署前请务必修改，并与 utils/config.js 中同名常量保持一致。
const BOOTSTRAP_ADMIN_PHONE = '13800000000'
const BOOTSTRAP_ADMIN_PASSWORD = 'admin123'

// 订阅消息模板ID（可选）：在云函数环境变量中配置，留空则不发送订阅消息
const REGISTER_NOTIFY_TMPL_ID = process.env.REGISTER_NOTIFY_TMPL_ID || ''

// SHA-256 + salt 哈希
function hashPassword(password) {
  return crypto.createHash('sha256').update(SALT + password).digest('hex')
}

// 验证密码：兼容旧明文密码（自动迁移为哈希）
function verifyPassword(input, stored) {
  if (!stored) return false
  // 如果存储的是哈希（64位hex），直接比较
  if (stored.length === 64 && /^[a-f0-9]+$/.test(stored)) {
    return hashPassword(input) === stored
  }
  // 旧明文密码，匹配则返回 true（调用方负责迁移）
  return input === stored
}

// 生成唯一会话令牌
function genSessionToken() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, role, phone, password, name, storeId, supplierId, sessionToken } = event

  // === 手机号+密码登录 ===
  if (action === 'loginAs') {
    // 按手机号+角色查找（不再用密码做查询条件）
    const res = await db.collection('users').where({ phone, role }).get()
    if (res.data.length > 0) {
      const user = res.data[0]
      if (user.status !== 'active') {
        return { success: false, message: '账号已禁用或待审核' }
      }
      if (!verifyPassword(password, user.password)) {
        return { success: false, message: '手机号或密码错误' }
      }
      // 旧明文密码自动迁移为哈希
      if (user.password.length !== 64) {
        await db.collection('users').doc(user._id).update({ data: { password: hashPassword(password) } })
      }
      // 生成新 sessionToken，覆盖旧会话
      const token = genSessionToken()
      await db.collection('users').doc(user._id).update({
        data: { openid: OPENID, sessionToken: token, lastLoginTime: new Date() }
      })
      user.openid = OPENID
      user.sessionToken = token
      delete user.password
      return { success: true, user }
    }

    // 首次初始化：数据库中还没有管理员时，用初始账号创建管理员
    if (role === 'admin' && phone === BOOTSTRAP_ADMIN_PHONE && password === BOOTSTRAP_ADMIN_PASSWORD) {
      const token = genSessionToken()
      const newAdmin = {
        openid: OPENID, role: 'admin', name: name || '系统管理员',
        phone, password: hashPassword(password), storeId: '', supplierId: '',
        status: 'active', sessionToken: token,
        createTime: new Date().toISOString(), lastLoginTime: new Date()
      }
      const addRes = await db.collection('users').add({ data: newAdmin })
      newAdmin._id = addRes._id
      delete newAdmin.password
      return { success: true, user: newAdmin }
    }

    return { success: false, message: '手机号或密码错误' }
  }

  // === OPENID 自动登录（校验 sessionToken） ===
  if (!action || action === 'autoLogin') {
    const res = await db.collection('users').where({ openid: OPENID, status: 'active' }).get()
    if (res.data.length > 0) {
      const user = res.data[0]
      // 如果客户端传了 sessionToken，校验是否一致
      if (sessionToken && user.sessionToken && sessionToken !== user.sessionToken) {
        return { success: false, message: '您的账号已在其他设备登录，请重新登录', sessionExpired: true }
      }
      delete user.password
      return { success: true, user }
    }
    return { success: false, message: '未登录', newUser: true }
  }

  // === 校验会话（checkSession） ===
  if (action === 'checkSession') {
    if (!sessionToken) {
      return { success: false, message: '会话无效', sessionExpired: true }
    }
    // 按 OPENID 查找用户
    const res = await db.collection('users').where({ openid: OPENID, status: 'active' }).get()
    if (res.data.length === 0) {
      return { success: false, message: '用户不存在或已禁用', sessionExpired: true }
    }
    const user = res.data[0]
    // 校验 sessionToken
    if (!user.sessionToken || user.sessionToken !== sessionToken) {
      return { success: false, message: '您的账号已在其他设备登录，请重新登录', sessionExpired: true }
    }
    delete user.password
    return { success: true, user }
  }

  // === 注册 ===
  if (action === 'register') {
    if (!role || !phone) {
      return { success: false, message: '角色和手机号不能为空' }
    }
    // 按手机号+角色检查是否已注册（同一微信可注册不同角色）
    const existRes = await db.collection('users').where({ phone, role }).get()
    if (existRes.data.length > 0) {
      return { success: false, message: '该手机号已注册此角色，请直接登录' }
    }
    const user = {
      openid: OPENID, role, name: name || phone,
      phone: phone || '',
      password: hashPassword(password || '123456'),
      storeId: storeId || '',
      supplierId: supplierId || '',
      status: 'pending',
      sessionToken: '',
      createTime: new Date().toISOString()
    }
    const addRes = await db.collection('users').add({ data: user })
    user._id = addRes._id
    delete user.password
    // 通知管理员有新注册待审核（未配置模板ID时自动跳过）
    try {
      if (!REGISTER_NOTIFY_TMPL_ID) return { success: true, user, message: '注册成功，请等待管理员审核' }
      var adminRes = await db.collection('users').where({ role: 'admin', status: 'active' }).get()
      var roleNames = { admin: '管理员', manager: '店长', supplier: '供货商' }
      for (var a of adminRes.data) {
        if (!a.openid) continue
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: a.openid,
            templateId: REGISTER_NOTIFY_TMPL_ID,
            page: 'pages/admin/users/index',
            miniprogramState: 'formal',
            data: {
              character_string1: { value: phone },
              thing2: { value: '【餐饮供货】新用户注册待审核' },
              amount3: { value: (roleNames[role] || role) },
              time4: { value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) },
              phrase5: { value: '待审核注册' }
            }
          })
        } catch (e) {
          console.warn('[register] 通知管理员失败:', e.errCode || e.errMsg || e.message)
        }
      }
    } catch (e) {
      console.warn('[register] 查管理员失败:', e.message)
    }
    return { success: true, user, message: '注册成功，请等待管理员审核' }
  }

  return { success: false, message: '未知操作' }
}
