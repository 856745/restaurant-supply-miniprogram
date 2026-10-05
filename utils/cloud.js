/**
 * 数据抽象层 - 统一云开发 / Mock 双模式 API
 * 所有数据函数返回 Promise，调用方统一用 async/await
 */

const { CLOUD_ENV_ID, ROLES, CATEGORIES, ORDER_NOTIFY_TMPL_ID, MANAGER_ACCEPT_TMPL_ID, MANAGER_SHIP_TMPL_ID, BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_PASSWORD } = require('./config.js')
const { genId, formatTime, orderNo, r2 } = require('./util.js')
const { ORDER_STATUS } = require('./constants.js')

const USE_CLOUD = CLOUD_ENV_ID && CLOUD_ENV_ID !== 'mock'

// ===================== 初始化 =====================
let _user = null

// 云模式下的本地数据缓存（getAdminData/getStoreData/getSupplierData 调用后自动填充）
// getById / list 在云模式下从缓存读取，避免事件处理中写大量 async
let _cache = {}

// TTL 数据缓存（毫秒）：避免短时间内重复请求云函数
const CACHE_TTL = {
  adminData: 30000,     // 管理员数据 30 秒
  storeData: 30000,     // 店长数据 30 秒
  supplierData: 30000,  // 供货商数据 30 秒
  categories: 60000     // 分类数据 60 秒（几乎不变）
}
let _cacheTimestamps = {}

// 检查缓存是否有效
function _isCacheValid(key) {
  const ts = _cacheTimestamps[key]
  if (!ts) return false
  return (Date.now() - ts) < (CACHE_TTL[key] || 30000)
}

// 缓存 key 对应的数据集合映射
var _cacheKeyCollections = {
  adminData: ['users', 'stores', 'suppliers', 'orders', 'goods'],
  storeData: ['goods', 'orders', 'suppliers', 'stores'],
  supplierData: ['orders', 'suppliers'],
  categories: ['categories']
}

// 使指定缓存失效（不传 key 则全部失效）
function invalidateCache(key) {
  if (key) {
    delete _cacheTimestamps[key]
    // 同时删除关联的缓存数据，避免 list/getById 同步函数返回旧数据
    var cols = _cacheKeyCollections[key]
    if (cols) {
      for (var i = 0; i < cols.length; i++) {
        if (_cache[cols[i]]) delete _cache[cols[i]]
      }
    }
  } else {
    _cacheTimestamps = {}
    _cache = {}
  }
}

// 批量失效三种角色业务缓存（最常用的模式：adminData + storeData + supplierData）
function _invalidateBusinessCaches() {
  invalidateCache('adminData')
  invalidateCache('storeData')
  invalidateCache('supplierData')
}

// 失效管理员+店长缓存（货品/店铺/供货商操作常用）
function _invalidateAdminStoreCaches() {
  invalidateCache('adminData')
  invalidateCache('storeData')
}

// 运行时检测 wx.cloud 是否可用（PC 端旧版微信可能不支持云开发）
function _cloudReady() {
  return typeof wx !== 'undefined' && typeof wx.cloud !== 'undefined' && typeof wx.cloud.callFunction === 'function'
}

function initCloud() {
  if (!USE_CLOUD) return
  if (!_cloudReady()) {
    console.warn('[cloud] wx.cloud 不可用，当前微信版本可能不支持云开发')
    return
  }
  try {
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
    // 检查订阅消息模板配置
    var missingTmpls = []
    if (!ORDER_NOTIFY_TMPL_ID) missingTmpls.push('供货商订单通知')
    if (!MANAGER_ACCEPT_TMPL_ID) missingTmpls.push('店长接单通知')
    if (!MANAGER_SHIP_TMPL_ID) missingTmpls.push('店长配送通知')
    if (missingTmpls.length > 0) {
      console.warn('[cloud] 订阅消息模板未配置: ' + missingTmpls.join('、') + '，请在 utils/config.js 中填入模板ID')
    }
  } catch (e) {
    console.error('[cloud] wx.cloud.init 失败:', e)
  }
}

// ===================== 云函数调用封装 =====================

// 会话过期回调（app.js 注册，触发后自动登出跳转登录页）
var _sessionExpiredCallback = null
function onSessionExpired(cb) { _sessionExpiredCallback = cb }

// 获取本地存储的 sessionToken
function getSessionToken() {
  try { return wx.getStorageSync('syx_session_token') || '' } catch (e) { return '' }
}

function setSessionToken(token) {
  try { wx.setStorageSync('syx_session_token', token) } catch (e) {}
}

function clearSessionToken() {
  try { wx.removeStorageSync('syx_session_token') } catch (e) {}
}

function callApi(action, data) {
  // 自动附带当前用户 ID + sessionToken
  var payload = Object.assign({}, data || {})
  if (_user && _user._id) {
    payload.callerUserId = _user._id   // 用于 api 云函数鉴权兜底，不可覆盖业务参数 userId
  }
  var token = getSessionToken()
  if (token) {
    payload.sessionToken = token
  }
  return new Promise((resolve, reject) => {
    if (!_cloudReady()) {
      reject(new Error('当前微信版本不支持云开发，请升级微信至最新版本'))
      return
    }
    wx.cloud.callFunction({
      name: 'api',
      data: { action: action, data: payload },
      success: function (res) {
        if (res.result && res.result.success !== false) {
          resolve(res.result)
        } else {
          var msg = (res.result && res.result.message) || '操作失败'
          // 会话过期：触发全局登出
          if (res.result && res.result.sessionExpired) {
            console.warn('[callApi] 会话过期:', msg)
            clearSessionToken()
            if (_sessionExpiredCallback) _sessionExpiredCallback(msg)
          }
          console.error('[callApi] ' + action + ' 失败:', msg)
          reject(new Error(msg))
        }
      },
      fail: function (err) {
        console.error('[callApi] ' + action + ' 云函数调用失败:', err)
        reject(err)
      }
    })
  })
}

function callLogin(action, payload) {
  return new Promise((resolve, reject) => {
    if (!_cloudReady()) {
      reject(new Error('当前微信版本不支持云开发，请升级微信至最新版本'))
      return
    }
    wx.cloud.callFunction({
      name: 'login',
      data: { action, ...payload },
      success: res => {
        if (res.result && res.result.success !== false) {
          resolve(res.result)
        } else {
          reject(new Error((res.result && res.result.message) || '登录失败'))
        }
      },
      fail: err => reject(err)
    })
  })
}

// 调用 feedback 云函数（意见反馈），鉴权方式与 callApi 一致
function callFeedback(action, payload) {
  var data = Object.assign({}, payload || {})
  if (_user && _user._id) {
    data.callerUserId = _user._id
  }
  var token = getSessionToken()
  if (token) {
    data.sessionToken = token
  }
  return new Promise((resolve, reject) => {
    if (!_cloudReady()) {
      reject(new Error('当前微信版本不支持云开发，请升级微信至最新版本'))
      return
    }
    wx.cloud.callFunction({
      name: 'feedback',
      data: { action: action, data: data },
      success: function (res) {
        if (res.result && res.result.success !== false) {
          resolve(res.result)
        } else {
          var msg = (res.result && res.result.message) || '操作失败'
          if (res.result && res.result.sessionExpired) {
            console.warn('[callFeedback] 会话过期:', msg)
            clearSessionToken()
            if (_sessionExpiredCallback) _sessionExpiredCallback(msg)
          }
          reject(new Error(msg))
        }
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

// 调用 messages 云函数（站内消息），鉴权方式与 callApi 一致
function callMessages(action, payload) {
  var data = Object.assign({}, payload || {})
  if (_user && _user._id) {
    data.callerUserId = _user._id
  }
  var token = getSessionToken()
  if (token) {
    data.sessionToken = token
  }
  return new Promise((resolve, reject) => {
    if (!_cloudReady()) {
      reject(new Error('当前微信版本不支持云开发，请升级微信至最新版本'))
      return
    }
    wx.cloud.callFunction({
      name: 'messages',
      data: { action: action, data: data },
      success: function (res) {
        if (res.result && res.result.success !== false) {
          resolve(res.result)
        } else {
          var msg = (res.result && res.result.message) || '操作失败'
          if (res.result && res.result.sessionExpired) {
            clearSessionToken()
            if (_sessionExpiredCallback) _sessionExpiredCallback(msg)
          }
          reject(new Error(msg))
        }
      },
      fail: function (err) {
        reject(err)
      }
    })
  })
}

// ===================== Mock 数据存储 =====================
const STORE_KEY = 'syx_cloud_db'
let _db = null

function getDB() {
  if (_db) return _db
  try {
    const raw = wx.getStorageSync(STORE_KEY) || '{}'
    _db = JSON.parse(raw)
    if (!_db || typeof _db !== 'object') _db = {}
  } catch (_) { _db = {} }
  return _db
}

function refresh() {
  _db = null
  _cache = {}
  _cacheTimestamps = {}
  if (!USE_CLOUD) getDB()
}

function setDB(db) {
  if (db !== undefined) _db = db
  wx.setStorageSync(STORE_KEY, JSON.stringify(_db))
}

function save() {
  wx.setStorageSync(STORE_KEY, JSON.stringify(_db))
}

function coll(name) {
  const db = getDB()
  if (!db[name]) db[name] = []
  return {
    data: () => db[name],
    push: (doc) => { db[name].push(doc); setDB(db) },
    set: (docs) => { db[name] = docs; setDB(db) },
    find: (fn) => db[name] && db[name].find(fn),
    filter: (fn) => db[name] && db[name].filter(fn),
    findIndex: (fn) => db[name] && db[name].findIndex(fn)
  }
}

// ===================== 种子数据 =====================
function seedIfEmpty() {
  const db = getDB()
  if (db._seeded) return

  db.users = [{
    _id: 'u_admin', openid: '', role: 'admin', name: '系统管理员',
    phone: BOOTSTRAP_ADMIN_PHONE, storeId: '', supplierId: '',
    password: BOOTSTRAP_ADMIN_PASSWORD, status: 'active', createTime: formatTime(new Date())
  }]

  // 空白模板：不预置任何门店 / 供货商业务数据，由管理员登录后自行创建
  db.stores = []
  db.suppliers = []

  db.categories = CATEGORIES.map((c, i) => ({ ...c, _id: c.id, sort: i }))

  // 空白模板：不预置任何货品 / 订单业务数据，由管理员登录后自行创建
  db.goods = []
  db.orders = []

  db._seeded = true
  setDB(db)
}

// ===================== 登录 =====================
async function loginAs(role, phone, password) {
  if (USE_CLOUD) {
    try {
      const res = await callLogin('loginAs', { role, phone, password })
      if (!res.user) return null
      _user = res.user
      // 保存 sessionToken
      if (res.user.sessionToken) {
        setSessionToken(res.user.sessionToken)
      }
      return res.user
    } catch (e) {
      return null
    }
  }
  // Mock 模式（本地存储，无多设备问题，跳过 sessionToken）
  initCloud()
  seedIfEmpty()
  const users = coll('users')
  let user = users.find(u => u.role === role && u.phone === phone && u.password === password)
  // 空白模板：除管理员外不自动创建任何账号，
  // 店长 / 供货商需在小程序内注册，并由管理员审核通过后才能登录
  if (!user && role === 'admin' && phone === BOOTSTRAP_ADMIN_PHONE && password === BOOTSTRAP_ADMIN_PASSWORD) {
    user = users.find(u => u._id === 'u_admin')
  }
  if (!user) return null
  if (user.status !== 'active') return null
  _user = user
  return user
}

// 校验当前会话是否有效（仅云端模式有效）
// 返回 true=会话有效，false=会话失效需重新登录
async function checkSession() {
  if (!USE_CLOUD) return true
  var token = getSessionToken()
  if (!token) return false
  try {
    var res = await callLogin('checkSession', { sessionToken: token })
    if (res.success && res.user) {
      _user = res.user
      return true
    }
    return false
  } catch (e) {
    // sessionExpired 类错误
    return false
  }
}

// 注册（新用户）
async function register(role, name, phone, password) {
  if (USE_CLOUD) {
    try {
      const res = await callLogin('register', { role, name, phone, password })
      return res.success ? res.user : null
    } catch (e) {
      return null
    }
  }
  // Mock 模式
  initCloud()
  seedIfEmpty()
  const users = coll('users')
  const exist = users.find(u => u.phone === phone && u.role === role)
  if (exist) return null
  const user = {
    _id: genId('u'), openid: 'mock_' + role + '_' + Date.now(),
    role, name: name || '新用户', phone,
    password: password || '123456',
    storeId: role === 'manager' ? 's1' : '',
    supplierId: role === 'supplier' ? 'sp1' : '',
    status: 'active', createTime: formatTime(new Date())
  }
  users.push(user)
  save()
  return user
}

function getCurrentUser() { return _user }

function setCurrentUser(user) { _user = user }

// ===================== 数据查询 =====================
async function getAdminData(forceRefresh) {
  // TTL 缓存检查：未过期且缓存有数据则直接返回
  if (!forceRefresh && _isCacheValid('adminData') && _cache.users) {
    return _cache
  }

  if (USE_CLOUD) {
    const res = await callApi('getAdminData')
    const data = {
      users: res.users || [],
      stores: res.stores || [],
      suppliers: res.suppliers || [],
      orders: res.orders || [],
      goods: res.goods || [],
      categories: res.categories || []
    }
    _cache = data
    _cacheTimestamps['adminData'] = Date.now()
    return data
  }
  seedIfEmpty()
  _cacheTimestamps['adminData'] = Date.now()
  return {
    users: (list('users') || []).filter(u => u.status !== 'deleted'),
    stores: list('stores'),
    suppliers: (list('suppliers') || []).filter(s => s.status !== 'deleted'),
    orders: list('orders'),
    goods: list('goods'),
    categories: list('categories')
  }
}

async function getStoreData(forceRefresh) {
  // TTL 缓存检查
  if (!forceRefresh && _isCacheValid('storeData') && _cache.store) {
    return {
      store: _cache.store || null,
      goods: _cache.goods || [],
      orders: _cache.orders || [],
      suppliers: _cache.suppliers || []
    }
  }

  if (USE_CLOUD) {
    const res = await callApi('getStoreData')
    const data = {
      store: res.store || null,
      goods: res.goods || [],
      orders: res.orders || [],
      suppliers: res.suppliers || []
    }
    // 缓存同时存单数和复数形式，供 getById/list 同步读取
    _cache = { ...data, stores: data.store ? [data.store] : [] }
    _cacheTimestamps['storeData'] = Date.now()
    // 同步用户 storeId（云函数可能自动分配了店铺）
    if (data.store && _user && _user.storeId !== data.store._id) {
      _user.storeId = data.store._id
      _user.storeName = data.store.name
      try {
        wx.setStorageSync('syx_user', _user)
        var app = getApp()
        if (app && app.globalData) app.globalData.user = _user
      } catch (e) {}
    }
    return data
  }
  seedIfEmpty()
  if (!_user || !_user.storeId) return null
  _cacheTimestamps['storeData'] = Date.now()
  return {
    store: getById('stores', _user.storeId),
    goods: list('goods'),
    orders: list('orders', o => o.storeId === _user.storeId),
    suppliers: (list('suppliers') || []).filter(s => s.status !== 'deleted')
  }
}

async function getSupplierData(forceRefresh) {
  // TTL 缓存检查
  if (!forceRefresh && _isCacheValid('supplierData') && _cache.supplier) {
    return {
      supplier: _cache.supplier || null,
      orders: _cache.orders || [],
      goods: _cache.goods || []
    }
  }

  if (USE_CLOUD) {
    const res = await callApi('getSupplierData')
    const data = {
      supplier: res.supplier || null,
      orders: res.orders || [],
      goods: res.goods || []
    }
    // 缓存同时存单数和复数形式
    _cache = { ..._cache, ...data, suppliers: data.supplier ? [data.supplier] : (_cache.suppliers || []) }
    _cacheTimestamps['supplierData'] = Date.now()
    // 同步用户 supplierId
    if (data.supplier && _user && _user.supplierId !== data.supplier._id) {
      _user.supplierId = data.supplier._id
      try {
        wx.setStorageSync('syx_user', _user)
        var app = getApp()
        if (app && app.globalData) app.globalData.user = _user
      } catch (e) {}
    }
    return data
  }
  seedIfEmpty()
  if (!_user || !_user.supplierId) return null
  _cacheTimestamps['supplierData'] = Date.now()
  return {
    supplier: getById('suppliers', _user.supplierId),
    orders: list('orders', o => o.supplierId === _user.supplierId),
    goods: list('goods', g => g.supplierId === _user.supplierId)
  }
}

// 底层查询（mock 模式从本地存储，cloud 模式从缓存读取）
function list(collection, filterFn) {
  if (USE_CLOUD && _cache[collection]) {
    return filterFn ? _cache[collection].filter(filterFn) : _cache[collection]
  }
  const c = coll(collection)
  return filterFn ? c.filter(filterFn) : c.data()
}

function getById(collection, id) {
  if (USE_CLOUD && _cache[collection]) {
    return _cache[collection].find(doc => doc._id === id)
  }
  return coll(collection).find(doc => doc._id === id)
}

// ===================== 业务操作 =====================
async function createOrder(data) {
  if (USE_CLOUD) {
    const res = await callApi('createOrder', { ...data, notifyTmplId: ORDER_NOTIFY_TMPL_ID })
    _invalidateBusinessCaches()
    return res.order || res
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
    _id: genId('o'), no: orderNo(),
    storeId: data.storeId, storeName: data.storeName,
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
    createBy: _user ? _user._id : '',
    createTime: formatTime(new Date()), updateTime: formatTime(new Date())
  }
  coll('orders').push(order)
  _invalidateBusinessCaches()
  return order
}

async function updateOrderStatus(orderId, newStatus) {
  if (USE_CLOUD) {
    const payload = { orderId, status: newStatus }
    // 供应商接单时，传递接单通知模板ID
    if (newStatus === 'accepted' && MANAGER_ACCEPT_TMPL_ID) {
      payload.acceptTmplId = MANAGER_ACCEPT_TMPL_ID
    }
    const res = await callApi('updateOrderStatus', payload)
    _invalidateBusinessCaches()
    return res.order || res
  }
  const orders = coll('orders')
  const idx = orders.findIndex(o => o._id === orderId)
  if (idx === -1) return null
  const order = orders.data()[idx]
  order.status = newStatus
  order.updateTime = formatTime(new Date())
  save()
  _invalidateBusinessCaches()
  return order
}

async function shipOrder(orderId, shipImage) {
  if (USE_CLOUD) {
    let fileID = shipImage || ''
    // 本地临时文件需上传到云存储
    if (shipImage && !shipImage.startsWith('cloud://')) {
      try {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: 'ship/' + orderId + '_' + Date.now() + '.jpg',
          filePath: shipImage
        })
        fileID = uploadRes.fileID
      } catch (e) {
        fileID = shipImage
      }
    }
    const payload = { orderId, shipImage: fileID }
    if (MANAGER_SHIP_TMPL_ID) payload.shipTmplId = MANAGER_SHIP_TMPL_ID
    const res = await callApi('shipOrder', payload)
    _invalidateBusinessCaches()
    return res.order || res
  }
  const orders = coll('orders')
  const idx = orders.findIndex(o => o._id === orderId)
  if (idx === -1) return null
  const order = orders.data()[idx]
  order.status = 'shipped'
  order.shipImage = shipImage || ''
  order.shipTime = formatTime(new Date())
  order.updateTime = formatTime(new Date())
  save()
  _invalidateBusinessCaches()
  return order
}

// 修改订单货品数量（未发货前）
async function updateOrderItems(orderId, items) {
  if (USE_CLOUD) {
    const res = await callApi('updateOrderItems', { orderId, items })
    _invalidateBusinessCaches()
    return res.order || res
  }
  const orders = coll('orders')
  const idx = orders.findIndex(o => o._id === orderId)
  if (idx === -1) return null
  const order = orders.data()[idx]
  order.items = items.map(it => ({
    goodsId: it.goodsId, name: it.name, unit: it.unit,
    qty: Number(it.qty), price: Number(it.price),
    amount: r2(Number(it.qty) * Number(it.price)),
    code: it.code || '', specWeight: it.specWeight || '', specCount: it.specCount || ''
  }))
  order.total = r2(order.items.reduce((s, i) => s + i.amount, 0))
  order.updateTime = formatTime(new Date())
  save()
  _invalidateBusinessCaches()
  return order
}

// 确认收货（支持部分收货）
async function confirmReceive(orderId, receiveItems) {
  // receiveItems: [{ goodsId, receivedQty, receivedAmount }]
  if (USE_CLOUD) {
    const res = await callApi('confirmReceive', { orderId, receiveItems })
    _invalidateBusinessCaches()
    return res.order || res
  }
  const orders = coll('orders')
  const idx = orders.findIndex(o => o._id === orderId)
  if (idx === -1) return null
  const order = orders.data()[idx]
  
  let allReceived = true
  let newTotal = 0
  order.items.forEach(it => {
    const ri = receiveItems.find(r => r.goodsId === it.goodsId)
    if (ri) {
      it.receivedQty = Number(ri.receivedQty)
      // 根据实收数量重新计算金额
      it.receivedAmount = r2(it.receivedQty * it.price)
      newTotal += it.receivedAmount
      if (it.receivedQty < it.qty) allReceived = false
    } else {
      it.receivedQty = it.qty
      it.receivedAmount = it.amount
      newTotal += Number(it.amount) || 0
    }
  })
  order.total = r2(newTotal)
  order.status = allReceived ? 'received' : 'partial'
  order.receiveTime = formatTime(new Date())
  order.updateTime = formatTime(new Date())
  save()
  _invalidateBusinessCaches()
  return order
}

// ===================== 修改收货信息 =====================
async function updateOrderReceiver(orderId, receiverInfo) {
  // receiverInfo: { receiver, receiverPhone, deliveryAddress }
  if (USE_CLOUD) {
    const res = await callApi('updateOrderReceiver', { orderId, receiverInfo })
    _invalidateBusinessCaches()
    return res.order || res
  }
  const orders = coll('orders')
  const idx = orders.findIndex(o => o._id === orderId)
  if (idx === -1) return null
  const order = orders.data()[idx]
  // 已收货/已取消 不可修改
  if (order.status === 'received' || order.status === 'cancelled') return null
  if (receiverInfo.receiver !== undefined) order.receiver = receiverInfo.receiver
  if (receiverInfo.receiverPhone !== undefined) order.receiverPhone = receiverInfo.receiverPhone
  if (receiverInfo.deliveryAddress !== undefined) order.deliveryAddress = receiverInfo.deliveryAddress
  order.updateTime = formatTime(new Date())
  save()
  _invalidateBusinessCaches()
  return order
}

// ===================== 货品 CRUD =====================
function generateGoodsCode() {
  if (USE_CLOUD) return callApi('generateGoodsCode').then(res => res.code)
  const goodsColl = coll('goods')
  let maxNum = 0
  goodsColl.data().forEach(g => {
    const m = /^SP(\d+)$/.exec(g.code || '')
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]))
  })
  return Promise.resolve('SP' + String(maxNum + 1).padStart(4, '0'))
}

async function saveGoods(data) {
  if (USE_CLOUD) {
    let goodsData = { ...data }
    // 本地图片上传到云存储（非 cloud:// 文件ID 且非空 且非 data:base64）
    if (goodsData.image && !goodsData.image.startsWith('cloud://') && !goodsData.image.startsWith('data:')) {
      try {
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: 'goods/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.jpg',
          filePath: goodsData.image
        })
        goodsData.image = uploadRes.fileID
      } catch (e) { /* 保留原值 */ }
    }
    const res = await callApi('saveGoods', { goods: goodsData })
    _invalidateAdminStoreCaches()
    return res.goods || goodsData
  }
  const goodsColl = coll('goods')
  if (data._id) {
    const idx = goodsColl.findIndex(g => g._id === data._id)
    if (idx !== -1) Object.assign(goodsColl.data()[idx], data)
  } else {
    data._id = genId('g')
    data.code = data.code || generateGoodsCodeSync()
    data.createTime = formatTime(new Date())
    goodsColl.push(data)
  }
  save()
  _invalidateAdminStoreCaches()
  return data
}

/**
 * 批量导入商品
 * @param {Array} items - 商品数组，字段同 saveGoods
 * @returns {Object} { success, failed, errors }
 */
async function batchImportGoods(items) {
  if (USE_CLOUD) {
    const res = await callApi('batchImportGoods', { items })
    _invalidateAdminStoreCaches()
    return res
  }
  // mock 模式
  const results = { success: 0, failed: 0, errors: [] }
  const goodsColl = coll('goods')
  let maxCodeNum = 0
  goodsColl.data().forEach(g => {
    const m = /^SP(\d+)$/.exec(g.code || '')
    if (m) maxCodeNum = Math.max(maxCodeNum, parseInt(m[1]))
  })
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      if (!item.name || !item.name.trim()) {
        results.failed++
        results.errors.push('第' + (i + 2) + '行: 名称为空')
        continue
      }
      // 解析供应商
      if (item.supplierName && item.supplierName.trim()) {
        const suppliers = coll('suppliers')
        const existing = suppliers.find(s => s.name === item.supplierName.trim())
        if (existing) {
          item.supplierId = existing._id
        } else {
          const sup = {
            _id: genId('sp'), name: item.supplierName.trim(), contact: '', phone: '',
            address: '', categories: [], status: 'active', createTime: formatTime(new Date())
          }
          suppliers.push(sup)
          item.supplierId = sup._id
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
      item._id = genId('g')
      item.createTime = formatTime(new Date())
      goodsColl.push(item)
      results.success++
    } catch (e) {
      results.failed++
      results.errors.push('第' + (i + 2) + '行: ' + (e.message || '导入失败'))
    }
  }
  save()
  _invalidateAdminStoreCaches()
  return results
}

function generateGoodsCodeSync() {
  const goodsColl = coll('goods')
  let maxNum = 0
  goodsColl.data().forEach(g => {
    const m = /^SP(\d+)$/.exec(g.code || '')
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]))
  })
  return 'SP' + String(maxNum + 1).padStart(4, '0')
}

async function deleteGoods(goodsId) {
  if (USE_CLOUD) {
    const res = await callApi('deleteGoods', { goodsId })
    _invalidateAdminStoreCaches()
    return res
  }
  const goodsColl = coll('goods')
  const idx = goodsColl.findIndex(g => g._id === goodsId)
  if (idx !== -1) goodsColl.data().splice(idx, 1)
  save()
  _invalidateAdminStoreCaches()
}

// 库存调整（已废弃）

// ===================== 用户管理 =====================
async function approveUser(userId) {
  if (USE_CLOUD) {
    const res = await callApi('approveUser', { userId })
    invalidateCache('adminData')
    return res
  }
  const usersColl = coll('users')
  const idx = usersColl.findIndex(u => u._id === userId)
  if (idx !== -1) usersColl.data()[idx].status = 'active'
  save()
  invalidateCache('adminData')
}

async function rejectUser(userId) {
  if (USE_CLOUD) {
    const res = await callApi('rejectUser', { userId })
    invalidateCache('adminData')
    return res
  }
  const usersColl = coll('users')
  const idx = usersColl.findIndex(u => u._id === userId)
  if (idx !== -1) usersColl.data()[idx].status = 'disabled'
  save()
  invalidateCache('adminData')
}

async function addUser(data) {
  if (USE_CLOUD) {
    const res = await callApi('addUser', { user: data })
    invalidateCache('adminData')
    return res.user || data
  }
  const usersColl = coll('users')
  const user = {
    _id: genId('u'), openid: '', role: data.role,
    name: data.name || '', phone: data.phone,
    password: data.password || '123456',
    storeId: data.storeId || '', supplierId: data.supplierId || '',
    status: 'active', createTime: formatTime(new Date())
  }
  usersColl.push(user)
  invalidateCache('adminData')
  return user
}

async function updateUser(userId, data) {
  if (USE_CLOUD) {
    const res = await callApi('updateUser', { userId, data })
    invalidateCache('adminData')
    return res.user || data
  }
  const usersColl = coll('users')
  const idx = usersColl.findIndex(u => u._id === userId)
  if (idx !== -1) {
    const user = usersColl.data()[idx]
    if (data.name !== undefined) user.name = data.name
    if (data.phone !== undefined) user.phone = data.phone
    if (data.role !== undefined) user.role = data.role
    if (data.storeId !== undefined) user.storeId = data.storeId
    if (data.supplierId !== undefined) user.supplierId = data.supplierId
    if (data.status !== undefined) user.status = data.status
    if (data.password !== undefined && data.password !== '') user.password = data.password
  }
  save()
  invalidateCache('adminData')
  return usersColl.data()[idx]
}

async function deleteUser(userId) {
  if (USE_CLOUD) {
    const res = await callApi('deleteUser', { userId })
    invalidateCache('adminData')
    return res
  }
  const usersColl = coll('users')
  const idx = usersColl.findIndex(u => u._id === userId)
  if (idx !== -1) usersColl.data()[idx].status = 'deleted'
  save()
  invalidateCache('adminData')
}

async function deleteSupplier(supplierId) {
  if (USE_CLOUD) {
    const res = await callApi('deleteSupplier', { supplierId })
    _invalidateAdminStoreCaches()
    return res
  }
  const suppliersColl = coll('suppliers')
  const idx = suppliersColl.findIndex(s => s._id === supplierId)
  if (idx !== -1) suppliersColl.data()[idx].status = 'deleted'
  // 同步禁用关联账号
  var usersColl = coll('users')
  var linkedUser = usersColl.find(function (u) { return u.supplierId === supplierId && u.role === 'supplier' })
  if (linkedUser) linkedUser.status = 'disabled'
  save()
  _invalidateAdminStoreCaches()
}

async function batchImportSuppliers(items) {
  if (USE_CLOUD) {
    const res = await callApi('batchImportSuppliers', { items })
    _invalidateAdminStoreCaches()
    return res
  }
  // Mock 模式
  const results = { success: 0, failed: 0, errors: [] }
  const suppliersColl = coll('suppliers')
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    try {
      if (!item.name || !item.name.trim()) {
        results.failed++
        results.errors.push('第' + (i + 1) + '行: 名称为空')
        continue
      }
      // 检查是否重名
      var existing = suppliersColl.find(function (s) { return s.name === item.name.trim() })
      if (existing) {
        results.failed++
        results.errors.push('第' + (i + 1) + '行: 名称「' + item.name + '」已存在')
        continue
      }
      var sup = {
        _id: genId('sp'),
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
        createTime: formatTime(new Date())
      }
      suppliersColl.push(sup)
      // 自动创建关联账号
      _syncSupplierUserMock(sup._id, sup.name, sup.phone, sup.contact)
      results.success++
    } catch (e) {
      results.failed++
      results.errors.push('第' + (i + 1) + '行: ' + (e.message || '导入失败'))
    }
  }
  save()
  _invalidateAdminStoreCaches()
  return results
}

// ===================== 店铺/供货商管理 =====================
async function saveStore(data) {
  if (USE_CLOUD) {
    const res = await callApi('saveStore', { store: data })
    invalidateCache('adminData')
    return res.store || data
  }
  const storesColl = coll('stores')
  if (data._id) {
    const idx = storesColl.findIndex(s => s._id === data._id)
    if (idx !== -1) Object.assign(storesColl.data()[idx], data)
  } else {
    data._id = genId('s')
    data.createTime = formatTime(new Date())
    storesColl.push(data)
  }
  save()
  invalidateCache('adminData')
  return data
}

async function deleteStore(storeId) {
  if (USE_CLOUD) {
    await callApi('deleteStore', { storeId })
    invalidateCache('adminData')
    return
  }
  const storesColl = coll('stores')
  const idx = storesColl.findIndex(s => s._id === storeId)
  if (idx !== -1) storesColl.data().splice(idx, 1)
  save()
  invalidateCache('adminData')
}

async function saveSupplier(data) {
  if (USE_CLOUD) {
    const res = await callApi('saveSupplier', { supplier: data })
    _invalidateAdminStoreCaches()
    return res.supplier || data
  }
  const suppliersColl = coll('suppliers')
  var supplierId = data._id
  if (data._id) {
    const idx = suppliersColl.findIndex(s => s._id === data._id)
    if (idx !== -1) Object.assign(suppliersColl.data()[idx], data)
  } else {
    supplierId = genId('sp')
    data._id = supplierId
    data.createTime = formatTime(new Date())
    suppliersColl.push(data)
  }
  // 同步关联账号
  _syncSupplierUserMock(supplierId, data.name, data.phone, data.contact)
  save()
  _invalidateAdminStoreCaches()
  return data
}

// Mock 模式：同步供货商关联账号
function _syncSupplierUserMock(supplierId, supplierName, supplierPhone, supplierContact) {
  if (!supplierId) return
  var usersColl = coll('users')
  var existing = usersColl.find(function (u) { return u.supplierId === supplierId && u.role === 'supplier' })
  if (existing) {
    if (supplierName) existing.name = supplierName
    if (supplierPhone) existing.phone = supplierPhone
  } else if (supplierPhone && supplierPhone.trim()) {
    // 有手机号才创建账号
    usersColl.push({
      _id: genId('u'), openid: '', role: 'supplier',
      name: supplierName || supplierContact || '供货商',
      phone: supplierPhone.trim(), password: '12345678',
      storeId: '', supplierId: supplierId,
      status: 'active', sessionToken: '',
      createTime: formatTime(new Date())
    })
  }
}

// ===================== 按名称解析供货商 =====================
async function resolveSupplier(name) {
  if (!name || !name.trim()) return null
  if (USE_CLOUD) {
    const res = await callApi('resolveSupplier', { name: name.trim() })
    return res.supplierId || null
  }
  var trimmed = name.trim()
  var suppliers = coll('suppliers')
  var existing = suppliers.find(function (s) { return s.name === trimmed })
  if (existing) return existing._id
  var sup = {
    _id: genId('sp'), name: trimmed, contact: '', phone: '', address: '',
    categories: [], status: 'active', createTime: formatTime(new Date())
  }
  suppliers.push(sup)
  save()
  return sup._id
}

// ===================== 分类管理 =====================
async function getCategories(forceRefresh) {
  // TTL 缓存检查
  if (!forceRefresh && _isCacheValid('categories') && _cache.categories && _cache.categories.length > 0) {
    return _cache.categories
  }

  if (USE_CLOUD) {
    const res = await callApi('getCategories')
    const cats = res.categories || []
    _cache.categories = cats
    _cacheTimestamps['categories'] = Date.now()
    return cats
  }
  var cats = list('categories')
  if (!cats || cats.length === 0) {
    cats = CATEGORIES.map(function (c, i) {
      return { _id: c.id, id: c.id, name: c.name, icon: c.icon, sort: i }
    })
  }
  _cacheTimestamps['categories'] = Date.now()
  return cats.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0) })
}

async function addCategory(data) {
  if (USE_CLOUD) {
    const res = await callApi('addCategory', { category: data })
    invalidateCache('categories')
    invalidateCache('adminData')
    return res.category || data
  }
  var cats = coll('categories')
  var existing = cats.find(function (c) { return c.id === data.id || c.name === data.name })
  if (existing) return null
  var cat = {
    _id: data.id || genId('cat'), id: data.id || genId('cat'),
    name: data.name, icon: data.icon || '\ud83d\udce6', sort: cats.data().length
  }
  cats.push(cat)
  save()
  invalidateCache('categories')
  invalidateCache('adminData')
  return cat
}

async function deleteCategory(catId) {
  if (USE_CLOUD) {
    const res = await callApi('deleteCategory', { catId })
    invalidateCache('categories')
    invalidateCache('adminData')
    return res
  }
  var cats = coll('categories')
  var idx = cats.findIndex(function (c) { return c._id === catId || c.id === catId })
  if (idx !== -1) cats.data().splice(idx, 1)
  save()
  invalidateCache('categories')
  invalidateCache('adminData')
}

async function updateCategory(catId, data) {
  if (USE_CLOUD) {
    const res = await callApi('updateCategory', { catId, data })
    invalidateCache('categories')
    invalidateCache('adminData')
    return res.category || data
  }
  var cats = coll('categories')
  var cat = cats.find(function (c) { return c._id === catId || c.id === catId })
  if (!cat) return null
  if (data.name) cat.name = data.name
  if (data.icon) cat.icon = data.icon
  save()
  invalidateCache('categories')
  invalidateCache('adminData')
  return cat
}

// ===================== 供货商信息更新 =====================
async function updateSupplier(supplierId, data) {
  if (USE_CLOUD) {
    const res = await callApi('updateSupplier', { supplierId, data })
    _invalidateAdminStoreCaches()
    return res.supplier || data
  }
  var suppliersColl = coll('suppliers')
  var idx = suppliersColl.findIndex(function (s) { return s._id === supplierId })
  if (idx === -1) return null
  var sup = suppliersColl.data()[idx]
  if (data.name !== undefined) sup.name = data.name
  if (data.contact !== undefined) sup.contact = data.contact
  if (data.phone !== undefined) sup.phone = data.phone
  if (data.address !== undefined) sup.address = data.address
  if (data.categories !== undefined) sup.categories = data.categories
  save()
  _invalidateAdminStoreCaches()
  return sup
}

// ===================== 修改密码 =====================
async function changePassword(userId, oldPassword, newPassword) {
  if (USE_CLOUD) {
    try {
      await callApi('changePassword', { userId, oldPassword, newPassword })
      return { ok: true }
    } catch (e) {
      return { ok: false, msg: e.message }
    }
  }
  var usersColl = coll('users')
  var idx = usersColl.findIndex(function (u) { return u._id === userId })
  if (idx === -1) return { ok: false, msg: '用户不存在' }
  var user = usersColl.data()[idx]
  if (user.password !== oldPassword) return { ok: false, msg: '原密码不正确' }
  user.password = newPassword
  save()
  return { ok: true }
}

// ===================== 盘点管理 =====================
async function getInventories() {
  if (USE_CLOUD) {
    var res = await callApi('getInventories')
    return res.inventories || []
  }
  // Mock 模式
  var invColl = coll('inventories')
  if (!_user || !_user.storeId) return []
  return (invColl.filter(function (inv) { return inv.storeId === _user.storeId }) || [])
    .sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || '') })
}

async function saveInventory(data) {
  if (USE_CLOUD) {
    var res = await callApi('saveInventory', { inventory: data })
    return res.inventory || data
  }
  // Mock 模式
  var invColl = coll('inventories')
  var existing = invColl.find(function (inv) {
    return inv.storeId === data.storeId && inv.month === data.month
  })
  var now = formatTime(new Date())
  if (existing) {
    Object.assign(existing, {
      items: data.items || [],
      remark: data.remark || '',
      storeName: data.storeName || existing.storeName,
      updateTime: now
    })
    save()
    return existing
  }
  var inv = {
    _id: genId('inv'),
    storeId: data.storeId,
    storeName: data.storeName || '',
    month: data.month,
    items: data.items || [],
    remark: data.remark || '',
    createBy: _user ? _user._id : '',
    createTime: now,
    updateTime: now
  }
  invColl.push(inv)
  return inv
}

// 供货商订阅订单通知（调用 wx.requestSubscribeMessage）
function subscribeOrderNotify() {
  return new Promise((resolve, reject) => {
    if (!ORDER_NOTIFY_TMPL_ID) {
      wx.showToast({ title: '通知模板未配置', icon: 'none' })
      reject(new Error('模板未配置'))
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [ORDER_NOTIFY_TMPL_ID],
      success: (res) => {
        const result = res[ORDER_NOTIFY_TMPL_ID]
        if (result === 'accept') {
          resolve({ subscribed: true })
        } else {
          var reasonMap = { reject: '用户拒绝', ban: '已被封禁', filter: '模板过滤' }
          resolve({ subscribed: false, reason: (reasonMap[result] || result) })
        }
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

// 店长订阅消息（接单提醒 + 配送提醒）
function subscribeManagerNotify() {
  return new Promise((resolve, reject) => {
    const tmplIds = []
    if (MANAGER_ACCEPT_TMPL_ID) tmplIds.push(MANAGER_ACCEPT_TMPL_ID)
    if (MANAGER_SHIP_TMPL_ID) tmplIds.push(MANAGER_SHIP_TMPL_ID)
    if (tmplIds.length === 0) {
      wx.showToast({ title: '通知模板未配置', icon: 'none' })
      reject(new Error('模板未配置'))
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: tmplIds,
      success: (res) => {
        const result = {
          accept: res[MANAGER_ACCEPT_TMPL_ID] === 'accept',
          ship: res[MANAGER_SHIP_TMPL_ID] === 'accept'
        }
        resolve({ subscribed: result.accept || result.ship, result })
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

// ===================== 审计日志查询（仅管理员） =====================
async function getAuditLogs(page, pageSize) {
  if (USE_CLOUD) {
    var res = await callApi('getAuditLogs', { page: page || 1, pageSize: pageSize || 50 })
    return res
  }
  return { logs: [], total: 0 }
}

// ===================== 分页订单查询（各角色） =====================
async function getOrdersByPage(role, page, pageSize, status) {
  if (USE_CLOUD) {
    var actionMap = { admin: 'getAdminOrders', manager: 'getStoreOrders', supplier: 'getSupplierOrders' }
    var action = actionMap[role]
    if (!action) return { orders: [], total: 0, page: 1, pageSize: 20 }
    var res = await callApi(action, { page: page || 1, pageSize: pageSize || 20, status: status || '' })
    return res
  }
  // Mock 模式：全量过滤 + 内存分页
  seedIfEmpty()
  var orders = list('orders')
  if (role === 'manager' && _user) orders = orders.filter(function(o) { return o.storeId === _user.storeId })
  if (role === 'supplier' && _user) orders = orders.filter(function(o) { return o.supplierId === _user.supplierId })
  if (status) orders = orders.filter(function(o) { return o.status === status })
  orders.sort(function(a, b) { return new Date(b.createTime) - new Date(a.createTime) })
  var p = page || 1
  var ps = pageSize || 20
  var start = (p - 1) * ps
  return { orders: orders.slice(start, start + ps), total: orders.length, page: p, pageSize: ps }
}

// ===================== 审计日志维护（清理90天前旧日志，仅管理员） =====================
async function cleanOldAuditLogs() {
  if (USE_CLOUD) {
    var res = await callApi('cleanOldAuditLogs')
    return res
  }
  return { deleted: 0 }
}

// ===================== 未读订单计数（站内红点） =====================
async function getUnreadOrderCount(user) {
  if (USE_CLOUD) {
    var res = await callApi('getUnreadOrderCount')
    return res.count || 0
  }
  // mock 模式从本地数据算
  var orders = coll('orders')
  if (user.role === 'manager') {
    return orders.filter(function(o) { return o.storeId === user.storeId && o.status === 'shipped' }).length
  } else if (user.role === 'supplier') {
    return orders.filter(function(o) { return o.supplierId === user.supplierId && o.status === 'pending' }).length
  } else if (user.role === 'admin') {
    return orders.filter(function(o) { return o.status === 'pending' || o.status === 'shipped' }).length
  }
  return 0
}

async function exportAllData(startDate) {
  if (!USE_CLOUD) return { success: false, message: '仅云端模式支持' }
  return callApi('exportAllData', { startDate: startDate || '' })
}

// ===================== 意见反馈 =====================
// 提交反馈（type: bug/suggest/other）
async function submitFeedback(data) {
  if (USE_CLOUD) {
    var res = await callFeedback('submitFeedback', data)
    return res.feedback || res
  }
  // Mock 模式：本地存储
  var fbColl = coll('feedbacks')
  var fb = {
    _id: genId('fb'),
    userId: _user ? _user._id : '',
    userName: _user ? _user.name : '',
    userRole: _user ? _user.role : '',
    type: data.type || 'other',
    content: data.content || '',
    contact: data.contact || '',
    status: 'unread',
    createTime: formatTime(new Date())
  }
  fbColl.push(fb)
  return fb
}

// 管理员查询反馈列表（分页）
async function getFeedbacks(page, pageSize) {
  if (USE_CLOUD) {
    var res = await callFeedback('listFeedbacks', { page: page || 1, pageSize: pageSize || 50 })
    return res
  }
  var all = (coll('feedbacks').data() || []).sort(function (a, b) {
    return (b.createTime || '').localeCompare(a.createTime || '')
  })
  var p = page || 1
  var ps = pageSize || 50
  var start = (p - 1) * ps
  return { feedbacks: all.slice(start, start + ps), total: all.length, page: p, pageSize: ps }
}

// 标记反馈已读
async function markFeedbackRead(id) {
  if (USE_CLOUD) return callFeedback('markFeedbackRead', { id })
  var fbColl = coll('feedbacks')
  var idx = fbColl.findIndex(function (f) { return f._id === id })
  if (idx !== -1) {
    fbColl.data()[idx].status = 'read'
    save()
  }
}

// 删除反馈
async function deleteFeedback(id) {
  if (USE_CLOUD) return callFeedback('deleteFeedback', { id })
  var fbColl = coll('feedbacks')
  var idx = fbColl.findIndex(function (f) { return f._id === id })
  if (idx !== -1) {
    fbColl.data().splice(idx, 1)
    save()
  }
}

// ===================== 站内消息 =====================
// 当前用户消息列表（分页）
async function getMessages(page, pageSize) {
  if (USE_CLOUD) {
    var res = await callMessages('getMessages', { page: page || 1, pageSize: pageSize || 20 })
    return res
  }
  var uid = _user ? _user._id : ''
  var all = (coll('messages').data() || []).filter(function (m) { return m.userId === uid })
    .sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || '') })
  var p = page || 1
  var ps = pageSize || 20
  var start = (p - 1) * ps
  return { messages: all.slice(start, start + ps), total: all.length, page: p, pageSize: ps }
}

// 未读消息数
async function getUnreadMessageCount() {
  if (USE_CLOUD) {
    var res = await callMessages('getUnreadCount')
    return res.count || 0
  }
  var uid = _user ? _user._id : ''
  return (coll('messages').data() || []).filter(function (m) { return m.userId === uid && m.status === 'unread' }).length
}

// 标记单条已读
async function markMessageRead(id) {
  if (USE_CLOUD) return callMessages('markRead', { id })
  var msgColl = coll('messages')
  var idx = msgColl.findIndex(function (m) { return m._id === id })
  if (idx !== -1) {
    msgColl.data()[idx].status = 'read'
    save()
  }
}

// 全部已读
async function markAllMessagesRead() {
  if (USE_CLOUD) return callMessages('markAllRead')
  var uid = _user ? _user._id : ''
  coll('messages').data().forEach(function (m) {
    if (m.userId === uid && m.status === 'unread') m.status = 'read'
  })
  save()
}

// 删除单条消息
async function deleteMessage(id) {
  if (USE_CLOUD) return callMessages('deleteMessage', { id })
  var msgColl = coll('messages')
  var idx = msgColl.findIndex(function (m) { return m._id === id })
  if (idx !== -1) {
    msgColl.data().splice(idx, 1)
    save()
  }
}

module.exports = {
  USE_CLOUD,
  initCloud,
  loginAs, register, getCurrentUser, setCurrentUser,
  checkSession, onSessionExpired, getSessionToken, setSessionToken, clearSessionToken,
  list, getById,
  getStoreData, getSupplierData, getAdminData,
  createOrder, updateOrderStatus, shipOrder,
  updateOrderItems, updateOrderReceiver, confirmReceive,
  saveGoods, deleteGoods, generateGoodsCode, batchImportGoods,
  approveUser, rejectUser,
  addUser, updateUser, deleteUser,
  saveStore, deleteStore, saveSupplier, deleteSupplier, batchImportSuppliers,
  refresh, invalidateCache,
  resolveSupplier,
  getCategories, addCategory, deleteCategory, updateCategory,
  updateSupplier,
  changePassword,
  getInventories, saveInventory,
  subscribeOrderNotify, subscribeManagerNotify,
  getAuditLogs, cleanOldAuditLogs, getUnreadOrderCount, getOrdersByPage, exportAllData,
  submitFeedback, getFeedbacks, markFeedbackRead, deleteFeedback,
  getMessages, getUnreadMessageCount, markMessageRead, markAllMessagesRead, deleteMessage
}
