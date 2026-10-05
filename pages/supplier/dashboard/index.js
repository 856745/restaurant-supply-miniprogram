const cloud = require('../../../utils/cloud.js')

const STATUS_LABELS = { pending: '待接单', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }

Page({
  data: {
    supplier: {},
    stats: { orderCount: 0, pendingCount: 0, shippedCount: 0, monthSales: 0 },
    pendingOrders: [],
    recentOrders: [],
    _allOrders: [],
    statusLabels: STATUS_LABELS,
    notifySubscribed: false
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getSupplierData()
      if (!data) return

      const orders = (data.orders || []).sort((a, b) => new Date(b.createTime) - new Date(a.createTime))

      const now = new Date()
      const month = now.getMonth()
      const year = now.getFullYear()
      let monthSales = 0
      orders.forEach(o => {
        const d = new Date(o.createTime)
        if (o.status !== 'cancelled' && d.getFullYear() === year && d.getMonth() === month) {
          monthSales += Number(o.total) || 0
        }
      })

      const pending = orders.filter(o => o.status === 'pending')

      this.setData({
        supplier: data.supplier || {},
        _allOrders: orders,
        stats: {
          orderCount: orders.length,
          pendingCount: pending.length,
          shippedCount: orders.filter(o => o.status === 'shipped').length,
          monthSales: Math.round(monthSales * 100) / 100
        },
        pendingOrders: pending,
        recentOrders: orders.slice(0, 5),
        settlementName: this.getSettlementName(data.supplier),
        couponText: this.getCouponText(data.supplier)
      })
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  goTo(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url })
  },

  // 开启订单通知订阅
  async onSubscribeNotify() {
    try {
      const res = await cloud.subscribeOrderNotify()
      if (res.subscribed) {
        wx.showToast({ title: '已开启通知', icon: 'success' })
        this.setData({ notifySubscribed: true })
      } else {
        wx.showToast({ title: '未开启通知', icon: 'none' })
      }
    } catch (e) {
      console.error('订阅失败:', e)
      if (e && e.errMsg && e.errMsg.indexOf('cancel') > -1) {
        wx.showToast({ title: '已取消', icon: 'none' })
      } else {
        wx.showToast({ title: '订阅失败', icon: 'none' })
      }
    }
  },

  getSettlementName(supplier) {
    if (!supplier) return '月结'
    var t = supplier.settlementType
    if (t === 'current') return '现结'
    if (t === 'prepay') return '先款后货'
    return '月结'
  },

  getCouponText(supplier) {
    if (!supplier) return ''
    var type = supplier.couponType
    var val = supplier.couponValue || 0
    if (type === 'fixed') return '固定减¥' + val
    if (type === 'percent') return val + '折优惠'
    return ''
  }
})
