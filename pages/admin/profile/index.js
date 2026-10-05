const cloud = require('../../../utils/cloud.js')
const excel = require('../../../utils/excel.js')

// 订单状态中文映射
const ORDER_STATUS_MAP = {
  pending: '待处理', accepted: '已接单', shipped: '已配送',
  partial: '部分收货', received: '已收货', cancelled: '已取消'
}
// 优惠券类型映射
const COUPON_TYPE_MAP = { none: '无', fixed: '满减', percent: '折扣' }
// 角色映射
const ROLE_MAP = { admin: '管理员', manager: '店长', supplier: '供货商' }

function fmtTime(t) {
  if (!t) return ''
  try {
    var d = new Date(t)
    if (isNaN(d.getTime())) return String(t)
    var pad = function (n) { return n < 10 ? '0' + n : '' + n }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  } catch (e) { return String(t) }
}

Page({
  data: {
    userInfo: {},
    stats: { userCount: 0, storeCount: 0, supplierCount: 0 },
    isCloud: cloud.USE_CLOUD,
    unreadMsgCount: 0,
    showPrivacyModal: false
  },

  async onShow() {
    try {
      wx.showLoading({ title: '加载中...' })
      const app = getApp()
      const user = app.globalData.user || {}
      const data = await cloud.getAdminData()
      this.setData({
        userInfo: user,
        stats: {
          userCount: data.users.filter(u => u.status === 'active').length,
          storeCount: data.stores.length,
          supplierCount: data.suppliers.filter(s => s.status === 'active').length
        }
      })
    } catch (e) {
      console.error('加载数据失败', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
    this.loadUnreadMsg()
  },

  loadUnreadMsg() {
    cloud.getUnreadMessageCount().then(count => {
      this.setData({ unreadMsgCount: count || 0 })
    }).catch(() => {})
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/index' })
  },

  // 导出操作审计日志
  async exportAuditLogs() {
    wx.showModal({
      title: '导出操作日志',
      content: '将导出最近的操作审计日志（创建订单/状态变更/用户管理等），确认？',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '加载日志...' })
        try {
          const result = await cloud.getAuditLogs(1, 1000)
          const logs = result.logs || []
          const headers = ['时间', '操作', '操作人', '角色', '目标', '详情']
          const rows = logs.map(l => [
            fmtTime(l.createTime),
            l.action || '',
            l.userName || '',
            l.userRole || '',
            l.targetName || l.targetId || '',
            l.detail || ''
          ])
          await excel.exportExcel({
            filename: '操作日志_' + new Date().toISOString().slice(0, 10),
            title: '操作审计日志',
            headers: headers,
            rows: rows,
            summaryRows: [['', '', '', '', '共 ' + logs.length + ' 条记录', '']]
          })
        } catch (e) {
          console.error('导出日志失败:', e)
          wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '导出失败', icon: 'none', duration: 4000 })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  // 清理90天前的旧操作日志
  cleanOldLogs() {
    var that = this
    wx.showModal({
      title: '清理旧日志',
      content: '将删除90天前的操作审计日志，每次最多1000条。当前日志仍可导出。确认清理？',
      success: async function (res) {
        if (!res.confirm) return
        wx.showLoading({ title: '清理中...' })
        try {
          var result = await cloud.cleanOldAuditLogs()
          wx.showToast({ title: '已清理 ' + (result.deleted || 0) + ' 条旧日志', icon: 'success', duration: 3000 })
        } catch (e) {
          console.error('清理日志失败:', e)
          wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '清理失败', icon: 'none', duration: 4000 })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  exportData() {
    wx.showActionSheet({
      itemList: ['本周', '本月', '本年', '全部'],
      success: async (res) => {
        var now = new Date()
        var startDate = ''
        if (res.tapIndex === 0) {
          var day = now.getDay() || 7
          var monday = new Date(now)
          monday.setDate(now.getDate() - day + 1)
          monday.setHours(0, 0, 0, 0)
          startDate = monday.toISOString()
        } else if (res.tapIndex === 1) {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        } else if (res.tapIndex === 2) {
          startDate = new Date(now.getFullYear(), 0, 1).toISOString()
        }
        var label = ['本周', '本月', '本年', '全部'][res.tapIndex]
        wx.showLoading({ title: '服务端生成(' + label + ')...' })
        try {
          var ret = await cloud.exportAllData(startDate)
          if (!ret.success || !ret.fileID) throw new Error(ret.message || '导出失败')
          wx.showLoading({ title: '下载中...' })
          var dlRes = await wx.cloud.downloadFile({ fileID: ret.fileID })
          if (dlRes.statusCode !== 200) throw new Error('下载失败')
          wx.hideLoading()
          wx.openDocument({
            filePath: dlRes.tempFilePath, fileType: 'xls', showMenu: true,
            success: function () {},
            fail: function () {
              wx.showToast({ title: '无可用应用打开', icon: 'none', duration: 3000 })
            }
          })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: String(e.message || e).slice(0, 40) || '导出失败', icon: 'none', duration: 4000 })
        }
      }
    })
  },

  goFeedbackList() {
    wx.navigateTo({ url: '/pages/admin/feedback/index' })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' })
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
          const app = getApp()
          app.logout()
        }
      }
    })
  }
})
