/**
 * 供货商 - 个人中心
 */
const cloud = require('../../../utils/cloud.js')

Page({
  data: {
    userInfo: {},
    supplier: {},
    stats: { orderCount: 0, totalSales: 0 },
    unreadMsgCount: 0,
    showPrivacyModal: false,
    // 修改地址
    showAddrModal: false,
    editAddr: '',
    editContact: '',
    editPhone: '',
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
    wx.showLoading({ title: '加载中...' })
    try {
      const app = getApp()
      const user = app.globalData.user || {}
      const data = await cloud.getSupplierData()
      const orders = data ? (data.orders || []) : []
      const totalSales = orders
        .filter(o => o.status !== 'cancelled')
        .reduce((s, o) => s + (Number(o.total) || 0), 0)

      this.setData({
        userInfo: user,
        supplier: data ? (data.supplier || {}) : {},
        stats: {
          orderCount: orders.length,
          totalSales: Math.round(totalSales * 100) / 100
        }
      })
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  // ===== 修改地址/联系信息 =====
  openAddrModal() {
    const s = this.data.supplier
    this.setData({
      showAddrModal: true,
      editAddr: s.address || '',
      editContact: s.contact || '',
      editPhone: s.phone || ''
    })
  },

  closeAddrModal() {
    this.setData({ showAddrModal: false })
  },

  onAddrInput(e) { this.setData({ editAddr: e.detail.value }) },
  onContactInput(e) { this.setData({ editContact: e.detail.value }) },
  onPhoneInput(e) { this.setData({ editPhone: e.detail.value }) },

  async submitAddr() {
    const { editAddr, editContact, editPhone } = this.data
    const supplier = this.data.supplier
    if (!supplier._id) {
      wx.showToast({ title: '供货商信息异常', icon: 'none' })
      return
    }
    try {
      await cloud.updateSupplier(supplier._id, {
        address: editAddr.trim(),
        contact: editContact.trim(),
        phone: editPhone.trim()
      })
      wx.showToast({ title: '保存成功', icon: 'success' })
      this.setData({ showAddrModal: false })
      this.loadData()
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
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
      wx.showToast({ title: '修改失败', icon: 'none' })
    }
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

  showPrivacy() {
    this.setData({ showPrivacyModal: true })
  },

  onClosePrivacy() {
    this.setData({ showPrivacyModal: false })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: res => {
        if (res.confirm) {
          getApp().logout()
        }
      }
    })
  }
})
