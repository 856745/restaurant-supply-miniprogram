/**
 * 店长 - 个人中心
 */
const cloud = require('../../../utils/cloud.js')

Page({
  data: {
    userName: '',
    storeName: '',
    storeAddress: '',
    storePhone: '',
    goodsCount: 0,
    orderCount: 0,
    unreadMsgCount: 0,
    showPrivacyModal: false,
    // 修改密码
    showPwdModal: false,
    oldPwd: '',
    newPwd: '',
    confirmPwd: ''
  },

  async onShow() {
    await this.loadData()
    this.loadUnreadMsg()
  },

  async loadData() {
    const user = cloud.getCurrentUser()
    if (!user) return
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getStoreData()
      const store = data ? data.store : null
      const goods = data ? data.goods || [] : []
      const orders = data ? data.orders || [] : []

      this.setData({
        userName: user.name || '店长',
        storeName: store ? store.name : '',
        storeAddress: store ? store.address : '',
        storePhone: store ? store.phone : '',
        goodsCount: goods.length,
        orderCount: orders.length
      })
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  goSuppliers() {
    wx.navigateTo({ url: '/pages/manager/suppliers/index' })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  },

  loadUnreadMsg() {
    cloud.getUnreadMessageCount().then(count => {
      this.setData({ unreadMsgCount: count || 0 })
    }).catch(() => {})
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/index' })
  },

  // ===== 修改密码 =====
  openPwdModal() {
    this.setData({ showPwdModal: true, oldPwd: '', newPwd: '', confirmPwd: '' })
  },

  closePwdModal() {
    this.setData({ showPwdModal: false })
  },

  onOldPwdInput(e) { this.setData({ oldPwd: e.detail.value }) },
  onNewPwdInput(e) { this.setData({ newPwd: e.detail.value }) },
  onConfirmPwdInput(e) { this.setData({ confirmPwd: e.detail.value }) },

  async submitPassword() {
    const { oldPwd, newPwd, confirmPwd } = this.data
    if (!oldPwd) { wx.showToast({ title: '请输入原密码', icon: 'none' }); return }
    if (!newPwd) { wx.showToast({ title: '请输入新密码', icon: 'none' }); return }
    if (newPwd.length < 6) { wx.showToast({ title: '密码至少6位', icon: 'none' }); return }
    if (newPwd !== confirmPwd) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return }

    const user = cloud.getCurrentUser()
    if (!user) return
    try {
      const result = await cloud.changePassword(user._id, oldPwd, newPwd)
      if (result.ok) {
        wx.showToast({ title: '密码已修改', icon: 'success' })
        this.setData({ showPwdModal: false })
      } else {
        wx.showToast({ title: result.msg || '修改失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '修改失败: ' + String(e.message || e).slice(0, 30), icon: 'none' })
    }
  },

  showPrivacy() {
    this.setData({ showPrivacyModal: true })
  },

  onClosePrivacy() {
    this.setData({ showPrivacyModal: false })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定退出登录？',
      success: (res) => {
        if (res.confirm) {
          getApp().logout()
        }
      }
    })
  }
})
