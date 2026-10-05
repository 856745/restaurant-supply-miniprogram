const cloud = require('./utils/cloud.js')
// 显式引用 excel 工具，避免分包共用后被微信打包器误判为「主包未使用」
require('./utils/excel.js')

App({
  globalData: {
    user: null,    // { _id, role, name, ... }
    isLoggedIn: false,
    cart: {},      // 购物车 { goodsId: { goodsId, name, unit, price, qty, ... } }
    cartRemark: '', // 购物车备注
    orderUnreadCount: 0  // 未读订单数（站内红点）
  },

  // ==================== 购物车持久化 ====================
  // 仅首次调用时从 Storage 恢复，之后始终返回内存引用。
  // 否则每次都反序列化出新对象，页面里「先 getCart 改属性 → 再 loadCart（内部又 getCart）」
  // 会把内存中的修改用 Storage 旧数据覆盖回去，导致勾选/数量变更丢失。
  getCart() {
    if (!this._cartLoaded) {
      this._cartLoaded = true
      try {
        var stored = wx.getStorageSync('syx_cart')
        if (stored && typeof stored === 'object') {
          this.globalData.cart = stored
        }
      } catch (e) {}
    }
    if (!this.globalData.cart) this.globalData.cart = {}
    return this.globalData.cart
  },
  saveCart(cart) {
    this.globalData.cart = cart || {}
    try { wx.setStorageSync('syx_cart', this.globalData.cart) } catch (e) {}
  },
  getCartRemark() {
    try {
      var stored = wx.getStorageSync('syx_cart_remark')
      if (typeof stored === 'string') {
        this.globalData.cartRemark = stored
        return stored
      }
    } catch (e) {}
    return this.globalData.cartRemark || ''
  },
  saveCartRemark(remark) {
    this.globalData.cartRemark = remark || ''
    try { wx.setStorageSync('syx_cart_remark', remark || '') } catch (e) {}
  },

  onLaunch() {
    // 尝试云初始化（若无云环境或当前平台不支持则静默回退）
    try {
      cloud.initCloud()
    } catch (e) {
      console.error('[app] 云初始化失败:', e)
    }

    // 注册会话过期回调：任何 API 调用返回 sessionExpired 时自动登出
    cloud.onSessionExpired((msg) => {
      this.forceLogout(msg || '您的账号已在其他设备登录')
    })

    // 隐私授权处理（微信强制要求，无此弹窗审核不过）
    this._privacyResolves = []
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this._privacyResolves.push(resolve)
        if (!this._privacyShowing) this._showPrivacyPopup()
      })
    }

    this.checkLogin()
  },

  // 显示隐私协议弹窗
  _showPrivacyPopup() {
    var self = this
    self._privacyShowing = true
    wx.showModal({
      title: '隐私政策提示',
      content: '餐饮供货管理小程序会使用您的手机号和姓名用于账号登录与身份识别。订单数据（采购记录、收货信息）用于正常的供货业务流程。以上信息仅在本小程序内使用，不会提供给第三方。\n\n点击「同意」即表示您已阅读并同意以上隐私政策。如不同意，将无法使用本小程序。',
      confirmText: '同意',
      cancelText: '不同意',
      success: function (res) {
        self._privacyShowing = false
        if (res.confirm) {
          // 同意：调用所有待处理的 resolve
          var resolves = self._privacyResolves.splice(0)
          resolves.forEach(function (r) {
            r({ event: 'agree', buttonId: 'agree' })
          })
        } else {
          // 不同意：拒绝所有待处理的请求
          var resolves = self._privacyResolves.splice(0)
          resolves.forEach(function (r) {
            r({ event: 'disagree' })
          })
        }
      },
      fail: function () {
        self._privacyShowing = false
      }
    })
  },

  async checkLogin() {
    try {
      const user = wx.getStorageSync('syx_user')
      if (user) {
        // 云端模式：校验 sessionToken 是否仍然有效
        if (cloud.USE_CLOUD) {
          const valid = await cloud.checkSession()
          if (!valid) {
            this.forceLogout('您的账号已在其他设备登录')
            return
          }
        }
        this.setUser(user)
        this.goHome()
      } else {
        wx.reLaunch({ url: '/pages/login/index' })
      }
    } catch (e) {
      console.error('[app] checkLogin 异常:', e)
      wx.reLaunch({ url: '/pages/login/index' })
    }
  },

  setUser(user) {
    this.globalData.user = user
    this.globalData.isLoggedIn = true
    cloud.setCurrentUser(user)
  },

  // 正常登出
  logout() {
    cloud.clearSessionToken()
    wx.removeStorageSync('syx_user')
    this.globalData.user = null
    this.globalData.isLoggedIn = false
    wx.reLaunch({ url: '/pages/login/index' })
  },

  // 被迫登出（账号在其他设备登录）
  forceLogout(msg) {
    cloud.clearSessionToken()
    wx.removeStorageSync('syx_user')
    this.globalData.user = null
    this.globalData.isLoggedIn = false
    wx.showModal({
      title: '登录失效',
      content: msg,
      showCancel: false,
      confirmText: '重新登录',
      success: () => {
        wx.reLaunch({ url: '/pages/login/index' })
      }
    })
  },

  // 刷新未读订单计数（站内红点）
  async refreshOrderUnread() {
    const user = this.globalData.user
    if (!user) return
    try {
      const count = await cloud.getUnreadOrderCount(user)
      this.globalData.orderUnreadCount = count || 0
    } catch (e) {}
  },

  goHome() {
    const role = this.globalData.user.role
    const routes = {
      admin:    '/pages/admin/dashboard/index',
      manager:  '/pages/manager/dashboard/index',
      supplier: '/pages/supplier/dashboard/index'
    }
    const url = routes[role] || '/pages/login/index'
    wx.reLaunch({ url })
  },

  // 全局异常捕获 — 记录最近 20 条错误到 Storage 供排查
  onError(error) {
    console.error('[app] 全局异常:', error)
    try {
      var errors = wx.getStorageSync('syx_error_logs') || []
      errors.unshift({
        time: new Date().toISOString(),
        msg: String(error),
        stack: error && error.stack ? String(error.stack).slice(0, 500) : ''
      })
      if (errors.length > 20) errors.length = 20
      wx.setStorageSync('syx_error_logs', errors)
    } catch (e) {}
  },

  // 未处理的 Promise 拒绝
  onUnhandledRejection(res) {
    console.error('[app] 未处理的Promise拒绝:', res.reason)
    try {
      var errors = wx.getStorageSync('syx_error_logs') || []
      errors.unshift({
        time: new Date().toISOString(),
        msg: 'UnhandledRejection: ' + String(res.reason),
        stack: res.reason && res.reason.stack ? String(res.reason.stack).slice(0, 500) : ''
      })
      if (errors.length > 20) errors.length = 20
      wx.setStorageSync('syx_error_logs', errors)
    } catch (e) {}
  }
})
