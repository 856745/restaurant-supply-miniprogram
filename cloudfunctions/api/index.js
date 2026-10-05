// 云函数 - 通用业务 API（带权限校验）
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 密码加盐哈希：盐值请通过云函数环境变量 PASSWORD_SALT 配置
// 云开发控制台 → 云函数 → 本函数 → 配置 → 环境变量，添加 PASSWORD_SALT
// 注意：必须与 cloudfunctions/login 使用相同的盐值，否则密码校验会失败
const SALT = process.env.PASSWORD_SALT || 'REPLACE_WITH_YOUR_OWN_SALT'

// SHA-256 + salt 哈希
function hashPassword(password) {
  return crypto.createHash('sha256').update(SALT + password).digest('hex')
}

// 验证密码：兼容旧明文密码
function verifyPassword(input, stored) {
  if (!stored) return false
  if (stored.length === 64 && /^[a-f0-9]+$/.test(stored)) {
    return hashPassword(input) === stored
  }
  return input === stored
}

// 分页拉取全部数据（云开发单次最多返回100条，maxLimit 防无限循环）
async function getAll(collection, whereQuery, orderByField, orderDir, maxLimit) {
  const MAX_LIMIT = maxLimit || 5000
  const PAGE_SIZE = 100
  let all = []
  let skip = 0
  while (true) {
    let q = db.collection(collection)
    if (whereQuery) q = q.where(whereQuery)
    if (orderByField) q = q.orderBy(orderByField, orderDir || 'desc')
    q = q.skip(skip).limit(PAGE_SIZE)
    const res = await q.get()
    all = all.concat(res.data)
    if (res.data.length < PAGE_SIZE) break
    skip += PAGE_SIZE
    if (all.length >= MAX_LIMIT) break
  }
  return all
}

// 订单状态合法流转
function isValidStatusTransition(from, to) {
  const transitions = {
    'pending': ['accepted', 'cancelled'],
    'accepted': ['shipped', 'cancelled'],
    'shipped': ['partial', 'received'],
    'partial': ['received']
  }
  const allowed = transitions[from]
  if (!allowed) return false
  return allowed.indexOf(to) !== -1
}

// ===================== 种子数据 =====================
const SEED_CATEGORIES = [
  { id: 'meat', name: '肉类', icon: '\ud83e\udd69', sort: 1 },
  { id: 'seafood', name: '海鲜', icon: '\ud83d\udc1f', sort: 2 },
  { id: 'veggie', name: '蔬菜', icon: '\ud83e\udd55', sort: 3 },
  { id: 'fruit', name: '水果', icon: '\ud83c\udf4e', sort: 4 },
  { id: 'grain', name: '粮油', icon: '\ud83c\udf3e', sort: 5 },
  { id: 'drink', name: '酒水', icon: '\ud83c\udf7a', sort: 6 },
  { id: 'other', name: '其他', icon: '\ud83d\udce6', sort: 7 }
]

async function seedIfEmpty() {
  // 空白模板：仅初始化默认分类；不预置任何门店 / 供货商 / 货品 / 订单
  // 检查是否已有数据（容错：集合可能尚未创建）
  let catCount = 0
  try {
    catCount = (await db.collection('categories').count()).total
  } catch (e) {
    console.log('[seedIfEmpty] categories 集合尚未创建，开始种子化')
  }
  if (catCount > 0) return

  // 创建默认分类
  for (const c of SEED_CATEGORIES) {
    await db.collection('categories').add({ data: c })
  }
}

// ===================== 工具函数 =====================
function r2(n) { return Math.round(Number(n) * 100) / 100 }

function genOrderNo() {
  return 'SYX' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()
}

async function generateGoodsCode() {
  const res = await db.collection('goods').orderBy('code', 'desc').limit(1).get()
  let maxNum = 0
  if (res.data.length > 0) {
    const m = /^SP(\d+)$/.exec(res.data[0].code || '')
    if (m) maxNum = parseInt(m[1])
  }
  return 'SP' + String(maxNum + 1).padStart(4, '0')
}

// ===================== 审计日志 =====================
async function addAuditLog(user, action, targetId, targetName, detail) {
  try {
    await db.collection('auditLogs').add({
      data: {
        action: action,
        userId: user._id,
        userName: user.name || '',
        userRole: user.role,
        targetId: targetId || '',
        targetName: targetName || '',
        detail: detail || '',
        createTime: new Date()
      }
    })
  } catch (e) {
    console.log('[auditLog] 记录失败(不影响业务):', e.message)
  }
}

// ===================== 站内消息 =====================
async function addMessage(userId, type, title, content, orderId, orderNo) {
  try {
    await db.collection('messages').add({
      data: {
        userId: userId,
        type: type || 'order',
        title: title || '',
        content: content || '',
        orderId: orderId || '',
        orderNo: orderNo || '',
        status: 'unread',
        createTime: new Date()
      }
    })
  } catch (e) {
    console.log('[message] 写入失败(不影响业务):', e.message)
  }
}

// 按角色 + 关联字段通知一批用户（如某店铺所有店长、某供应商所有账号）
async function notifyUsers(role, keyField, keyValue, type, title, content, orderId, orderNo) {
  if (!keyValue) return
  try {
    var q = { role: role, status: 'active' }
    q[keyField] = keyValue
    var users = await db.collection('users').where(q).get()
    for (var i = 0; i < users.data.length; i++) {
      await addMessage(users.data[i]._id, type, title, content, orderId, orderNo)
    }
  } catch (e) {
    console.log('[notifyUsers] 通知失败(不影响业务):', e.message)
  }
}

// ===================== 供货商关联账号同步 =====================
async function syncSupplierUser(supplierId, supplierName, supplierPhone, supplierContact) {
  if (!supplierId) return
  // 检查是否已有关联用户
  var userRes = await db.collection('users').where({ supplierId, role: 'supplier' }).get()
  if (userRes.data.length > 0) {
    // 更新已有关联账号的名称和手机号
    var u = userRes.data[0]
    var upd = {}
    if (supplierName && u.name !== supplierName) upd.name = supplierName
    if (supplierPhone && u.phone !== supplierPhone) upd.phone = supplierPhone
    if (Object.keys(upd).length > 0) {
      await db.collection('users').doc(u._id).update({ data: upd })
    }
  } else if (supplierPhone && supplierPhone.trim()) {
    // 有手机号才创建账号（默认密码 12345678）
    await db.collection('users').add({
      data: {
        openid: '', role: 'supplier',
        name: supplierName || supplierContact || '供货商',
        phone: supplierPhone.trim(),
        password: hashPassword('12345678'),
        storeId: '', supplierId: supplierId,
        status: 'active', sessionToken: '',
        createTime: new Date()
      }
    })
  }
}

// ===================== 主函数 =====================
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, data } = event

  // 获取当前用户
  // 优先用前端传递的 userId 精确查找（代表当前登录身份）
  // 因为同一 OPENID 可能关联多个角色账号，OPENID 查找取 data[0] 可能取到错误角色
  var dataObj = data || {}
  let user = null

  // 1. 优先用 callerUserId 精确查找（由 callApi 自动附带）
  //    注意：userId 是业务参数（如操作目标），不可用于鉴权
  var authUserId = dataObj.callerUserId || dataObj.userId
  if (authUserId) {
    try {
      var userResById = await db.collection('users').doc(authUserId).get()
      if (userResById.data) {
        user = userResById.data
        // 同步 openid（如果不存在或不一致）
        if (OPENID && (!user.openid || user.openid !== OPENID)) {
          try {
            await db.collection('users').doc(user._id).update({ data: { openid: OPENID } })
            user.openid = OPENID
          } catch (e) {}
        }
      }
    } catch (e) {
      console.log('[api] userId 查找失败:', e.message)
    }
  }

  // 2. 如果 userId 查不到，用 OPENID 兜底
  if (!user && OPENID) {
    var userResByOpenid = await db.collection('users').where({ openid: OPENID, status: 'active' }).get()
    if (userResByOpenid.data.length > 0) {
      user = userResByOpenid.data[0]
    }
  }

  // 数据查询类 action
  var dataActions = ['getAdminData', 'getStoreData', 'getSupplierData', 'getCategories', 'generateGoodsCode']
  if (!user) {
    return { success: false, message: '未登录(OPENID:' + (OPENID || '空') + ',userId:' + (dataObj.userId || '空') + ')' }
  }

  // 3. 校验 sessionToken（单设备登录）
  //    如果用户记录中有 sessionToken，客户端必须传一致的 sessionToken
  //    不传 sessionToken 不允许跳过校验
  if (user.sessionToken) {
    if (!dataObj.sessionToken || user.sessionToken !== dataObj.sessionToken) {
      return { success: false, message: '您的账号已在其他设备登录', sessionExpired: true }
    }
  }

  try {
    switch (action) {

      // ============ 数据查询 ============
      case 'getAdminData': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        try { await seedIfEmpty() } catch (e) { console.log('[getAdminData] seedIfEmpty 跳过:', e.message) }
        const [users, stores, suppliers, orders, goods, categories] = await Promise.all([
          getAll('users', _.or([{ status: _.neq('deleted') }, { status: _.exists(false) }])),
          getAll('stores'),
          getAll('suppliers', _.or([{ status: _.neq('deleted') }, { status: _.exists(false) }])),
          getAll('orders', null, 'createTime', 'desc'),
          getAll('goods', null, 'createTime', 'desc'),
          getAll('categories', null, 'sort', 'asc')
        ])
        return {
          success: true,
          users: users,
          stores: stores,
          suppliers: suppliers,
          orders: orders,
          goods: goods,
          categories: categories
        }
      }

      case 'getStoreData': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        try { await seedIfEmpty() } catch (e) { console.log('[getStoreData] seedIfEmpty 跳过:', e.message) }
        // 安全获取店铺信息：storeId 可能为空或无效
        let store = null
        if (user.storeId) {
          try {
            const storeRes = await db.collection('stores').doc(user.storeId).get()
            store = storeRes.data
          } catch (e) { /* storeId 无效 */ }
        }
        // 未绑定店铺不自动分配，返回 null 让前端提示联系管理员
        const storeIdForQuery = store ? store._id : ''
        const [goods, orders, suppliers] = await Promise.all([
          getAll('goods', null, 'createTime', 'desc'),
          getAll('orders', { storeId: storeIdForQuery }, 'createTime', 'desc'),
          getAll('suppliers', _.or([{ status: _.neq('deleted') }, { status: _.exists(false) }]))
        ])
        return {
          success: true,
          store,
          goods: goods,
          orders: orders,
          suppliers: suppliers
        }
      }

      case 'getSupplierData': {
        if (user.role !== 'supplier') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        try { await seedIfEmpty() } catch (e) { console.log('[getSupplierData] seedIfEmpty 跳过:', e.message) }
        // 安全获取供货商信息：supplierId 可能为空或无效
        let supplier = null
        if (user.supplierId) {
          try {
            const supRes = await db.collection('suppliers').doc(user.supplierId).get()
            supplier = supRes.data
          } catch (e) { /* supplierId 无效 */ }
        }
        const supplierIdForQuery = supplier ? supplier._id : (user.supplierId || '')
        const ordersData = await getAll('orders', { supplierId: supplierIdForQuery }, 'createTime', 'desc')
        const goodsData = await getAll('goods', { supplierId: supplierIdForQuery })
        return {
          success: true,
          supplier,
          orders: ordersData,
          goods: goodsData
        }
      }

      // ============ 分页订单查询（各角色） ============
      case 'getAdminOrders': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var page = Number(data.page) || 1
        var pageSize = Math.min(Number(data.pageSize) || 20, 100)
        var q = db.collection('orders')
        if (data.status) q = q.where({ status: data.status })
        var [ordersRes, totalRes] = await Promise.all([
          q.orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
          data.status ? db.collection('orders').where({ status: data.status }).count() : db.collection('orders').count()
        ])
        return { success: true, orders: ordersRes.data, total: totalRes.total, page: page, pageSize: pageSize }
      }

      case 'getStoreOrders': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var page = Number(data.page) || 1
        var pageSize = Math.min(Number(data.pageSize) || 20, 100)
        var where = { storeId: user.storeId || '' }
        if (data.status) where.status = data.status
        var [ordersRes, totalRes] = await Promise.all([
          db.collection('orders').where(where).orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
          db.collection('orders').where(where).count()
        ])
        return { success: true, orders: ordersRes.data, total: totalRes.total, page: page, pageSize: pageSize }
      }

      case 'getSupplierOrders': {
        if (user.role !== 'supplier') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var page = Number(data.page) || 1
        var pageSize = Math.min(Number(data.pageSize) || 20, 100)
        var where = { supplierId: user.supplierId || '' }
        if (data.status) where.status = data.status
        var [ordersRes, totalRes] = await Promise.all([
          db.collection('orders').where(where).orderBy('createTime', 'desc').skip((page - 1) * pageSize).limit(pageSize).get(),
          db.collection('orders').where(where).count()
        ])
        return { success: true, orders: ordersRes.data, total: totalRes.total, page: page, pageSize: pageSize }
      }

      case 'getCategories': {
        const catRes = await db.collection('categories').orderBy('sort', 'asc').get()
        return { success: true, categories: catRes.data }
      }

      case 'generateGoodsCode': {
        const code = await generateGoodsCode()
        return { success: true, code }
      }

      // ============ 订单操作 ============
      case 'createOrder': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
          return { success: false, message: '订单商品不能为空' }
        }
        if (!data.supplierId) {
          return { success: false, message: '请选择供货商' }
        }
        const items = data.items.map(it => ({
          goodsId: it.goodsId, name: it.name, unit: it.unit,
          qty: Number(it.qty), price: Number(it.price),
          amount: r2(Number(it.qty) * Number(it.price)),
          code: it.code || '', specWeight: it.specWeight || '', specCount: it.specCount || ''
        }))
        const originalTotal = r2(items.reduce((s, i) => s + i.amount, 0))
        // 如果调用方传了total（已应用优惠券），使用它；否则用原价
        const total = (data.total !== undefined) ? Number(data.total) : originalTotal
        const discount = (data.discount !== undefined) ? Number(data.discount) : 0
        const order = {
          no: genOrderNo(),
          storeId: user.storeId, storeName: data.storeName,
          supplierId: data.supplierId, supplierName: data.supplierName,
          items, total,
          originalTotal: originalTotal,
          discount: discount,
          couponType: data.couponType || 'none',
          couponValue: data.couponValue || 0,
          status: 'pending', remark: data.remark || '',
          batchNo: data.batchNo || '',
          receiver: data.receiver || '',
          receiverPhone: data.receiverPhone || '',
          deliveryAddress: data.deliveryAddress || '',
          shipImage: '', shipTime: '',
          createBy: user._id,
          createTime: new Date(), updateTime: new Date()
        }
        const oRes = await db.collection('orders').add({ data: order })
        order._id = oRes._id

        // 尝试发送订阅消息通知供货商（失败不影响下单）
        try {
          const tmplId = data.notifyTmplId || ''
          if (tmplId) {
            const supUsers = await db.collection('users').where({
              role: 'supplier',
              supplierId: data.supplierId,
              status: 'active'
            }).get()
            const itemSummary = items.map(function(it) {
              return it.name + 'x' + it.qty + it.unit
            }).join(', ').slice(0, 18)
            const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
            for (const su of supUsers.data) {
              if (!su.openid) continue
              try {
                await cloud.openapi.subscribeMessage.send({
                  touser: su.openid,
                  templateId: tmplId,
                  page: 'pages/supplier/orders/index',
                  miniprogramState: 'formal',
                  data: {
                    character_string1: { value: order.no },
                    thing2: { value: '【餐饮供货】' + (data.storeName || '').slice(0, 16) },
                    amount3: { value: '¥' + Number(total).toFixed(2) },
                    time4: { value: timeStr },
                    thing5: { value: '【餐饮供货】' + (itemSummary || '无') }
                  }
                })
              } catch (e) {
                console.log('[createOrder] 通知供货商 openid=' + su.openid + ' 失败:', e.errCode || '', e.errMsg || e.message || '')
              }
            }
          }
        } catch (e) {
          console.log('[createOrder] 通知流程异常(不影响订单):', e.message || '')
        }

        addAuditLog(user, 'createOrder', oRes._id, order.no, '¥' + total.toFixed(2))

        // 站内消息通知供应商
        notifyUsers('supplier', 'supplierId', data.supplierId, 'order', '新订单提醒',
          '【' + (data.storeName || '') + '】向您下了一笔订单 ' + order.no + '，金额 ¥' + Number(total).toFixed(2) + '，请及时接单。',
          oRes._id, order.no)

        return { success: true, order }
      }

      case 'updateOrderStatus': {
        const orderRes = await db.collection('orders').doc(data.orderId).get()
        if (!orderRes.data) return { success: false, message: '订单不存在' }
        // 权限校验
        if (user.role === 'supplier' && orderRes.data.supplierId !== user.supplierId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        if (user.role === 'manager' && orderRes.data.storeId !== user.storeId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        // 状态机校验
        if (!isValidStatusTransition(orderRes.data.status, data.status)) {
          return { success: false, message: '订单状态不可从「' + orderRes.data.status + '」变更为「' + data.status + '」' }
        }
        await db.collection('orders').doc(data.orderId).update({
          data: { status: data.status, updateTime: new Date() }
        })
        orderRes.data.status = data.status
        orderRes.data.updateTime = new Date()

        // 审计日志
        addAuditLog(user, 'updateOrderStatus', data.orderId, orderRes.data.no, data.status)

        // 供应商接单后通知店长
        if (data.status === 'accepted' && user.role === 'supplier' && data.acceptTmplId) {
          try {
            const mgrUsers = await db.collection('users').where({
              role: 'manager', storeId: orderRes.data.storeId
            }).get()
            if (mgrUsers.data.length > 0) {
              const order = orderRes.data
              const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
              for (const mu of mgrUsers.data) {
                if (!mu.openid) continue
                try {
                  await cloud.openapi.subscribeMessage.send({
                    touser: mu.openid,
                    templateId: data.acceptTmplId,
                    page: 'pages/manager/orders/index?id=' + order._id,
                    miniprogramState: 'formal',
                    data: {
                      character_string1: { value: order.no },
                      thing2: { value: '【餐饮供货】' + (order.supplierName || '').slice(0, 16) },
                      amount3: { value: '¥' + Number(order.total).toFixed(2) },
                      time4: { value: timeStr },
                      phrase5: { value: '【餐饮供货】已接单' }
                    }
                  })
                } catch (e) {
                  console.log('[updateOrderStatus] 通知店长接单失败:', e.errCode || '', e.errMsg || e.message || '')
                }
              }
            }
          } catch (e) {
            console.log('[updateOrderStatus] 通知店长异常(不影响订单):', e.message || '')
          }
        }

        // 站内消息
        if (data.status === 'accepted' && user.role === 'supplier') {
          notifyUsers('manager', 'storeId', orderRes.data.storeId, 'order', '订单已接单',
            '【' + (orderRes.data.supplierName || '') + '】已接单 ' + orderRes.data.no + '，请等待发货。',
            data.orderId, orderRes.data.no)
        } else if (data.status === 'cancelled') {
          if (user.role === 'supplier') {
            notifyUsers('manager', 'storeId', orderRes.data.storeId, 'order', '订单已取消',
              '订单 ' + orderRes.data.no + ' 已被供应商取消。', data.orderId, orderRes.data.no)
          } else if (user.role === 'manager') {
            notifyUsers('supplier', 'supplierId', orderRes.data.supplierId, 'order', '订单已取消',
              '订单 ' + orderRes.data.no + ' 已被店长取消。', data.orderId, orderRes.data.no)
          }
        }

        return { success: true, order: orderRes.data }
      }

      case 'shipOrder': {
        if (user.role !== 'supplier') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const shipRes = await db.collection('orders').doc(data.orderId).get()
        if (!shipRes.data) return { success: false, message: '订单不存在' }
        if (shipRes.data.supplierId !== user.supplierId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        if (!isValidStatusTransition(shipRes.data.status, 'shipped')) {
          return { success: false, message: '当前状态不允许发货(当前:' + shipRes.data.status + ')' }
        }
        await db.collection('orders').doc(data.orderId).update({
          data: {
            status: 'shipped',
            shipImage: data.shipImage || '',
            shipTime: new Date().toISOString(),
            updateTime: new Date()
          }
        })
        shipRes.data.status = 'shipped'
        shipRes.data.shipImage = data.shipImage || ''
        shipRes.data.shipTime = new Date().toISOString()

        // 审计日志
        addAuditLog(user, 'shipOrder', data.orderId, shipRes.data.no, '')

        // 站内消息通知店长
        notifyUsers('manager', 'storeId', shipRes.data.storeId, 'order', '订单已发货',
          '【' + (shipRes.data.supplierName || '') + '】已发货 ' + shipRes.data.no + '，请留意收货。',
          data.orderId, shipRes.data.no)

        // 配送后通知店长
        if (data.shipTmplId) {
          try {
            const mgrUsers = await db.collection('users').where({
              role: 'manager', storeId: shipRes.data.storeId
            }).get()
            if (mgrUsers.data.length > 0) {
              const order = shipRes.data
              const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
              const itemSummary = (order.items || []).map(function(it) {
                return it.name + it.qty + it.unit
              }).join('、').slice(0, 18)
              for (const mu of mgrUsers.data) {
                if (!mu.openid) continue
                try {
                  await cloud.openapi.subscribeMessage.send({
                    touser: mu.openid,
                    templateId: data.shipTmplId,
                    page: 'pages/manager/orders/index?id=' + order._id,
                    miniprogramState: 'formal',
                    data: {
                      character_string1: { value: order.no },
                      thing2: { value: '【餐饮供货】' + (order.supplierName || '').slice(0, 16) },
                      time3: { value: timeStr },
                      thing4: { value: '【餐饮供货】' + (itemSummary || '无') },
                      amount5: { value: '¥' + Number(order.total).toFixed(2) }
                    }
                  })
                } catch (e) {
                  console.log('[shipOrder] 通知店长配送失败:', e.errCode || '', e.errMsg || e.message || '')
                }
              }
            }
          } catch (e) {
            console.log('[shipOrder] 通知店长异常(不影响订单):', e.message || '')
          }
        }

        return { success: true, order: shipRes.data }
      }

      case 'updateOrderItems': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const oRes = await db.collection('orders').doc(data.orderId).get()
        if (!oRes.data) return { success: false, message: '订单不存在' }
        if (oRes.data.storeId !== user.storeId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        // 仅允许在 pending/accepted 状态修改
        if (oRes.data.status !== 'pending' && oRes.data.status !== 'accepted') {
          return { success: false, message: '当前状态不可修改货品数量' }
        }
        var newItems = data.items.map(function(it) {
          return {
            goodsId: it.goodsId, name: it.name, unit: it.unit,
            qty: Number(it.qty), price: Number(it.price),
            amount: r2(Number(it.qty) * Number(it.price)),
            code: it.code || '', specWeight: it.specWeight || '', specCount: it.specCount || ''
          }
        })
        var newTotal = r2(newItems.reduce(function(s, i) { return s + i.amount }, 0))
        await db.collection('orders').doc(data.orderId).update({
          data: { items: newItems, total: newTotal, updateTime: new Date() }
        })
        oRes.data.items = newItems
        oRes.data.total = newTotal
        oRes.data.updateTime = new Date()
        addAuditLog(user, 'updateOrderItems', data.orderId, oRes.data.no, '')
        return { success: true, order: oRes.data }
      }

      case 'updateOrderReceiver': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const rRes = await db.collection('orders').doc(data.orderId).get()
        if (!rRes.data) return { success: false, message: '订单不存在' }
        if (rRes.data.storeId !== user.storeId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        // 已收货/已取消 不可修改收货信息
        if (rRes.data.status === 'received' || rRes.data.status === 'cancelled') {
          return { success: false, message: '当前状态不可修改收货信息' }
        }
        var ri = data.receiverInfo || {}
        var updateData = { updateTime: new Date() }
        if (ri.receiver !== undefined) updateData.receiver = ri.receiver
        if (ri.receiverPhone !== undefined) updateData.receiverPhone = ri.receiverPhone
        if (ri.deliveryAddress !== undefined) updateData.deliveryAddress = ri.deliveryAddress
        await db.collection('orders').doc(data.orderId).update({ data: updateData })
        Object.assign(rRes.data, updateData)
        return { success: true, order: rRes.data }
      }

      case 'confirmReceive': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const cRes = await db.collection('orders').doc(data.orderId).get()
        if (!cRes.data) return { success: false, message: '订单不存在' }
        if (cRes.data.storeId !== user.storeId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        // 仅允许 shipped/partial 状态确认收货
        if (cRes.data.status !== 'shipped' && cRes.data.status !== 'partial') {
          return { success: false, message: '当前状态不可确认收货' }
        }
        var allReceived = true
        var newTotal = 0
        cRes.data.items.forEach(function(it) {
          var ri = (data.receiveItems || []).find(function(r) { return r.goodsId === it.goodsId })
          if (ri) {
            it.receivedQty = Number(ri.receivedQty)
            // 根据实收数量重新计算金额
            it.receivedAmount = Math.round(it.receivedQty * Number(it.price) * 100) / 100
            newTotal += it.receivedAmount
            if (it.receivedQty < it.qty) allReceived = false
          } else {
            it.receivedQty = it.qty
            it.receivedAmount = it.amount
            newTotal += Number(it.amount) || 0
          }
        })
        newTotal = Math.round(newTotal * 100) / 100
        var newStatus = allReceived ? 'received' : 'partial'
        await db.collection('orders').doc(data.orderId).update({
          data: {
            items: cRes.data.items,
            total: newTotal,
            status: newStatus,
            receiveTime: new Date().toISOString(),
            updateTime: new Date()
          }
        })
        cRes.data.status = newStatus
        cRes.data.total = newTotal
        addAuditLog(user, 'confirmReceive', data.orderId, cRes.data.no, newStatus)

        // 站内消息通知供应商
        notifyUsers('supplier', 'supplierId', cRes.data.supplierId, 'order', '订单已收货',
          '订单 ' + cRes.data.no + ' 已被【' + (cRes.data.storeName || '') + '】确认收货。',
          data.orderId, cRes.data.no)

        return { success: true, order: cRes.data }
      }

      // ============ 货品操作 ============
      case 'saveGoods': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const g = data.goods
        if (g._id) {
          const gUpdate = Object.assign({}, g)
          delete gUpdate._id
          await db.collection('goods').doc(g._id).update({ data: gUpdate })
          addAuditLog(user, 'saveGoods', g._id, g.name || '', '更新')
          return { success: true, goods: g }
        } else {
          if (!g.code) g.code = await generateGoodsCode()
          g.createTime = new Date()
          const r = await db.collection('goods').add({ data: g })
          g._id = r._id
          addAuditLog(user, 'saveGoods', g._id, g.name || '', '新增')
          return { success: true, goods: g }
        }
      }

      case 'batchImportGoods': {
        if (user.role !== 'admin') return { success: false, message: '无权限' }
        const importItems = data.items || []
        if (importItems.length > 200) {
          return { success: false, message: '单次导入不能超过200条，请分批导入' }
        }
        const importResults = { success: 0, failed: 0, errors: [] }

        // 预查最大编号
        const codeRes = await db.collection('goods').orderBy('code', 'desc').limit(1).get()
        let maxCodeNum = 0
        if (codeRes.data.length > 0) {
          const cm = /^SP(\d+)$/.exec(codeRes.data[0].code || '')
          if (cm) maxCodeNum = parseInt(cm[1])
        }

        // 预加载所有供货商到 Map，避免 N+1 查询
        const allSuppliers = await getAll('suppliers', _.or([{ status: _.neq('deleted') }, { status: _.exists(false) }]))
        const supplierMap = {}
        allSuppliers.forEach(function(s) { supplierMap[s.name] = s._id })

        for (let i = 0; i < importItems.length; i++) {
          const item = importItems[i]
          try {
            if (!item.name || !item.name.trim()) {
              importResults.failed++
              importResults.errors.push('第' + (i + 2) + '行: 名称为空')
              continue
            }
            // 解析供应商（从预加载的 Map 中查找）
            if (item.supplierName && item.supplierName.trim()) {
              const supName = item.supplierName.trim()
              if (supplierMap[supName]) {
                item.supplierId = supplierMap[supName]
              } else {
                const newSup = await db.collection('suppliers').add({ data: {
                  name: supName, contact: '', phone: '', address: '',
                  categories: [], status: 'active', createTime: new Date()
                }})
                item.supplierId = newSup._id
                supplierMap[supName] = newSup._id
              }
            } else {
              item.supplierId = ''
              item.supplierName = ''
            }
            // 自动编号
            if (!item.code || !item.code.trim()) {
              maxCodeNum++
              item.code = 'SP' + String(maxCodeNum).padStart(4, '0')
            }
            item.createTime = new Date()
            delete item._id
            await db.collection('goods').add({ data: item })
            importResults.success++
          } catch (e) {
            importResults.failed++
            importResults.errors.push('第' + (i + 2) + '行: ' + (e.message || '导入失败'))
          }
        }
        addAuditLog(user, 'batchImportGoods', '', '', '成功' + importResults.success + '条/失败' + importResults.failed + '条')
        return { success: true, ...importResults }
      }

      case 'deleteGoods': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        addAuditLog(user, 'deleteGoods', data.goodsId, '', '')
        await db.collection('goods').doc(data.goodsId).remove()
        return { success: true }
      }

      // ============ 用户管理 ============
      case 'approveUser': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        await db.collection('users').doc(data.userId).update({ data: { status: 'active' } })
        addAuditLog(user, 'approveUser', data.userId, '', '')
        return { success: true }
      }

      case 'rejectUser': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        await db.collection('users').doc(data.userId).update({ data: { status: 'disabled' } })
        addAuditLog(user, 'rejectUser', data.userId, '', '')
        return { success: true }
      }

      case 'addUser': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const u = data.user
        const newUser = {
          openid: '', role: u.role, name: u.name || '',
          phone: u.phone, password: hashPassword(u.password || '123456'),
          storeId: u.storeId || '', supplierId: u.supplierId || '',
          status: 'active', createTime: new Date()
        }
        const r = await db.collection('users').add({ data: newUser })
        newUser._id = r._id
        delete newUser.password
        addAuditLog(user, 'addUser', r._id, newUser.name || '', newUser.role)
        return { success: true, user: newUser }
      }

      case 'updateUser': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const updateData = {}
        const d = data.data
        if (d.name !== undefined) updateData.name = d.name
        if (d.phone !== undefined) updateData.phone = d.phone
        if (d.role !== undefined) updateData.role = d.role
        if (d.storeId !== undefined) updateData.storeId = d.storeId
        if (d.supplierId !== undefined) updateData.supplierId = d.supplierId
        if (d.status !== undefined) updateData.status = d.status
        if (d.password !== undefined && d.password !== '') updateData.password = hashPassword(d.password)
        await db.collection('users').doc(data.userId).update({ data: updateData })
        addAuditLog(user, 'updateUser', data.userId, d.name || '', '')
        return { success: true, user: { ...updateData, _id: data.userId } }
      }

      case 'deleteUser': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        await db.collection('users').doc(data.userId).update({ data: { status: 'deleted' } })
        addAuditLog(user, 'deleteUser', data.userId, '', '')
        return { success: true }
      }

      case 'changePassword': {
        const userRes = await db.collection('users').doc(data.userId).get()
        if (!userRes.data) return { success: false, message: '用户不存在' }
        // 权限：本人或管理员
        if (user._id !== data.userId && user.role !== 'admin') {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        if (!verifyPassword(data.oldPassword, userRes.data.password)) {
          return { success: false, message: '原密码不正确' }
        }
        if (!data.newPassword || data.newPassword.length < 6) {
          return { success: false, message: '新密码不能少于6位' }
        }
        await db.collection('users').doc(data.userId).update({ data: { password: hashPassword(data.newPassword) } })
        addAuditLog(user, 'changePassword', data.userId, '', '')
        return { success: true }
      }

      // ============ 店铺管理 ============
      case 'saveStore': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const s = data.store
        if (s._id) {
          const sUpdate = Object.assign({}, s)
          delete sUpdate._id
          await db.collection('stores').doc(s._id).update({ data: sUpdate })
          addAuditLog(user, 'saveStore', s._id, s.name || '', '更新')
          return { success: true, store: s }
        } else {
          s.createTime = new Date()
          const r = await db.collection('stores').add({ data: s })
          s._id = r._id
          addAuditLog(user, 'saveStore', r._id, s.name || '', '新增')
          return { success: true, store: s }
        }
      }

      case 'deleteStore': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        addAuditLog(user, 'deleteStore', data.storeId, '', '')
        await db.collection('stores').doc(data.storeId).remove()
        return { success: true }
      }

      // ============ 供货商管理 ============
      case 'saveSupplier': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const sp = data.supplier
        if (sp._id) {
          const spUpdate = Object.assign({}, sp)
          delete spUpdate._id
          await db.collection('suppliers').doc(sp._id).update({ data: spUpdate })
          addAuditLog(user, 'saveSupplier', sp._id, sp.name || '', '更新')
          // 同步关联账号
          await syncSupplierUser(sp._id, sp.name, sp.phone, sp.contact)
          return { success: true, supplier: sp }
        } else {
          sp.createTime = new Date()
          sp.status = sp.status || 'active'
          const r = await db.collection('suppliers').add({ data: sp })
          sp._id = r._id
          addAuditLog(user, 'saveSupplier', r._id, sp.name || '', '新增')
          // 自动创建关联账号
          await syncSupplierUser(r._id, sp.name, sp.phone, sp.contact)
          return { success: true, supplier: sp }
        }
      }

      case 'deleteSupplier': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        addAuditLog(user, 'deleteSupplier', data.supplierId, '', '')
        await db.collection('suppliers').doc(data.supplierId).update({ data: { status: 'deleted' } })
        // 同步禁用关联账号
        await db.collection('users').where({ supplierId: data.supplierId, role: 'supplier' }).get()
          .then(function (res) {
            if (res.data.length > 0) {
              return db.collection('users').doc(res.data[0]._id).update({ data: { status: 'disabled' } })
            }
          }).catch(function () {})
        return { success: true }
      }

      case 'batchImportSuppliers': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var items = data.items || []
        if (items.length > 200) return { success: false, message: '单次导入不能超过200条' }
        var results = { success: 0, failed: 0, errors: [] }
        for (var i = 0; i < items.length; i++) {
          var item = items[i]
          try {
            if (!item.name || !item.name.trim()) {
              results.failed++
              results.errors.push('第' + (i + 2) + '行: 名称为空')
              continue
            }
            // 检查重名
            var existRes = await db.collection('suppliers').where({ name: item.name.trim(), status: _.neq('deleted') }).get()
            if (existRes.data.length > 0) {
              results.failed++
              results.errors.push('第' + (i + 2) + '行: 名称「' + item.name + '」已存在')
              continue
            }
            var addRes = await db.collection('suppliers').add({
              data: {
                name: item.name.trim(),
                contact: item.contact || '',
                phone: item.phone || '',
                address: item.address || '',
                categories: item.categories || [],
                minOrderAmount: Number(item.minOrderAmount) || 0,
                settlementType: item.settlementType || 'monthly',
                couponType: item.couponType || 'none',
                couponValue: Number(item.couponValue) || 0,
                status: 'active',
                createTime: new Date()
              }
            })
            // 自动创建关联账号
            await syncSupplierUser(addRes._id, item.name, item.phone, item.contact)
            results.success++
          } catch (e) {
            results.failed++
            results.errors.push('第' + (i + 2) + '行: ' + (e.message || '导入失败'))
          }
        }
        addAuditLog(user, 'batchImportSuppliers', '', '', '成功' + results.success + '/失败' + results.failed)
        return { success: true, ...results }
      }

      case 'updateSupplier': {
        // 管理员或供货商本人
        if (user.role !== 'admin' && user.role !== 'supplier') {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        if (user.role === 'supplier' && data.supplierId !== user.supplierId) {
          return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        }
        const updateData = {}
        const d = data.data
        if (d.name !== undefined) updateData.name = d.name
        if (d.contact !== undefined) updateData.contact = d.contact
        if (d.phone !== undefined) updateData.phone = d.phone
        if (d.address !== undefined) updateData.address = d.address
        if (d.categories !== undefined) updateData.categories = d.categories
        await db.collection('suppliers').doc(data.supplierId).update({ data: updateData })
        return { success: true, supplier: { ...updateData, _id: data.supplierId } }
      }

      case 'resolveSupplier': {
        const existRes = await db.collection('suppliers').where({ name: data.name }).get()
        if (existRes.data.length > 0) {
          return { success: true, supplierId: existRes.data[0]._id }
        }
        const newSup = {
          name: data.name, contact: '', phone: '', address: '',
          categories: [], status: 'active', createTime: new Date()
        }
        const r = await db.collection('suppliers').add({ data: newSup })
        return { success: true, supplierId: r._id }
      }

      // ============ 分类管理 ============
      case 'addCategory': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const c = data.category
        const existRes = await db.collection('categories').where({ name: c.name }).get()
        if (existRes.data.length > 0) return { success: false, message: '分类已存在' }
        const count = (await db.collection('categories').count()).total
        const cat = {
          id: c.id || ('cat_' + Date.now()),
          name: c.name, icon: c.icon || '\ud83d\udce6',
          sort: c.sort || count
        }
        const r = await db.collection('categories').add({ data: cat })
        cat._id = r._id
        addAuditLog(user, 'addCategory', r._id, cat.name, '')
        return { success: true, category: cat }
      }

      case 'deleteCategory': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const catRes = await db.collection('categories').where(_.or([{ id: data.catId }, { _id: data.catId }])).get()
        if (catRes.data.length > 0) {
          const cat = catRes.data[0]
          await db.collection('categories').doc(cat._id).remove()
          addAuditLog(user, 'deleteCategory', cat._id, cat.name || '', '')
        }
        return { success: true }
      }

      case 'updateCategory': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        const updRes = await db.collection('categories').where(_.or([{ id: data.catId }, { _id: data.catId }])).get()
        if (updRes.data.length === 0) return { success: false, message: '分类不存在' }
        var upd = {}
        if (data.data.name) upd.name = data.data.name
        if (data.data.icon) upd.icon = data.data.icon
        await db.collection('categories').doc(updRes.data[0]._id).update({ data: upd })
        var updatedCat = Object.assign({}, updRes.data[0], upd)
        return { success: true, category: updatedCat }
      }

      // ============ 盘点管理 ============
      case 'getInventories': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        if (!user.storeId) return { success: true, inventories: [] }
        const invRes = await db.collection('inventories')
          .where({ storeId: user.storeId })
          .orderBy('createTime', 'desc')
          .get()
        return { success: true, inventories: invRes.data }
      }

      case 'saveInventory': {
        if (user.role !== 'manager') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        if (!user.storeId) return { success: false, message: '未关联店铺' }
        var inv = data.inventory || {}
        // 同月已有记录则更新，否则新建
        var existRes = await db.collection('inventories')
          .where({ storeId: user.storeId, month: inv.month })
          .get()
        var now = new Date()
        var invData = {
          storeId: user.storeId,
          storeName: inv.storeName || '',
          month: inv.month,
          items: inv.items || [],
          remark: inv.remark || '',
          updateTime: now
        }
        if (existRes.data.length > 0) {
          await db.collection('inventories').doc(existRes.data[0]._id).update({ data: invData })
          invData._id = existRes.data[0]._id
          invData.createTime = existRes.data[0].createTime
        } else {
          invData.createBy = user._id
          invData.createTime = now
          var addRes = await db.collection('inventories').add({ data: invData })
          invData._id = addRes._id
        }
        addAuditLog(user, 'saveInventory', invData._id || '', invData.month, '')
        return { success: true, inventory: invData }
      }

      // ============ 审计日志查询（仅管理员，数据库端分页） ============
      case 'getAuditLogs': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var page = Number(data.page) || 1
        var pageSize = Math.min(Number(data.pageSize) || 50, 100)
        var logsRes = await db.collection('auditLogs')
          .orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        var totalRes = await db.collection('auditLogs').count()
        return { success: true, logs: logsRes.data, total: totalRes.total, page: page, pageSize: pageSize }
      }

      // ============ 未读订单计数（站内红点） ============
      case 'getUnreadOrderCount': {
        var q = {}
        if (user.role === 'manager') {
          q = { storeId: user.storeId, status: 'shipped' }
        } else if (user.role === 'supplier') {
          q = { supplierId: user.supplierId, status: 'pending' }
        } else if (user.role === 'admin') {
          q = { status: _.in(['pending', 'shipped']) }
        }
        var countRes = await db.collection('orders').where(q).count()
        return { success: true, count: countRes.total }
      }

      // ============ 审计日志维护（清理90天前旧日志，仅管理员） ============
      case 'cleanOldAuditLogs': {
        if (user.role !== 'admin') return { success: false, message: '无权限(当前角色:' + (user.role || '空') + ')' }
        var cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        // 安全限额：每次最多删除1000条
        var delRes = await db.collection('auditLogs')
          .where({ createTime: _.lte(cutoff) })
          .limit(1000)
          .remove()
        return { success: true, deleted: delRes.stats.removed || 0, cutoff: cutoff.toISOString() }
      }

      // ============ 导出全部数据（云函数端生成 Excel，避免前端内存溢出） ============
      case 'exportAllData': {
        if (user.role !== 'admin') return { success: false, message: '无权限' }
        const statusMap = { pending: '待确认', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }
        const roleMap = { admin: '管理员', manager: '店长', supplier: '供货商' }
        const fmt = function (d) { if (!d) return ''; var t = new Date(d); return t.toISOString().slice(0, 19).replace('T', ' ') }
        // 时间筛选
        var startDate = data.startDate || ''
        var orderWhere = startDate ? { createTime: _.gte(startDate) } : undefined

        try {
          const [users, stores, suppliers, orders, goods, categories] = await Promise.all([
            getAll('users', _.or([{ status: _.neq('deleted') }, { status: _.exists(false) }])),
            getAll('stores'),
            getAll('suppliers'),
            getAll('orders', orderWhere),
            getAll('goods'),
            getAll('categories')
          ])

          // 构建多 Sheet 标准 xlsx（惰性引入，未安装依赖时仅导出功能受影响）
          const XLSX = require('xlsx')
          const wb = XLSX.utils.book_new()

          function addSheet(name, headers, rows) {
            const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows))
            if (headers.length) {
              ws['!cols'] = headers.map(function (h) { return { wch: Math.min(40, Math.max(10, String(h).length * 2 + 6)) } })
            }
            XLSX.utils.book_append_sheet(wb, ws, String(name).slice(0, 31))
          }

          addSheet('货品', ['编号', '名称', '分类', '单位', '规格重量', '规格数量', '单价', '供货商', '说明'],
            goods.map(function (g) { return [g.code||'', g.name||'', g.category||'', g.unit||'', g.specWeight||'', g.specCount||'', g.price||0, g.supplierName||'', g.desc||g.description||''] }))

          addSheet('订单', ['订单号', '店铺', '供货商', '状态', '商品明细', '总金额', '下单时间', '备注'],
            orders.map(function (o) { return [o.no||'', o.storeName||'', o.supplierName||'', statusMap[o.status]||o.status||'', (o.items||[]).map(function(it){return it.name+'x'+it.qty+it.unit+'('+it.amount+'元)'}).join('; '), o.total||0, fmt(o.createTime), o.remark||''] }))

          addSheet('供货商', ['名称', '联系人', '电话', '地址', '状态'],
            suppliers.map(function (s) { return [s.name||'', s.contact||'', s.phone||'', s.address||'', s.status==='active'?'启用':(s.status||'')] }))

          addSheet('店铺', ['名称', '地址', '联系人', '电话'],
            stores.map(function (s) { return [s.name||'', s.address||'', s.contact||'', s.phone||''] }))

          addSheet('用户', ['姓名', '角色', '手机号', '状态', '注册时间'],
            users.map(function (u) { return [u.name||'', roleMap[u.role]||u.role||'', u.phone||'', u.status==='active'?'正常':(u.status==='pending'?'待审核':(u.status||'')), fmt(u.createTime)] }))

          addSheet('分类', ['图标', '名称', '排序'],
            categories.map(function (c) { return [c.icon||'', c.name||'', c.sort||0] }))

          const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

          var uploadRes = await cloud.uploadFile({
            cloudPath: 'exports/data_export_' + Date.now() + '.xlsx',
            fileContent: buffer
          })

          return { success: true, fileID: uploadRes.fileID }
        } catch (e) {
          console.error('exportAllData error:', e)
          return { success: false, message: e.message || '导出失败' }
        }
      }

      default:
        return { success: false, message: '未知操作: ' + action }
    }
  } catch (err) {
    console.error('[api] action=' + action + ' error:', err)
    return { success: false, message: err.message || '服务器错误' }
  }
}
