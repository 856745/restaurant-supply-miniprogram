/**
 * 店长工作台首页
 */
const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')
const { ORDER_STATUS } = require('../../../utils/constants.js')

const CAT_MAP = {}
CATEGORIES.forEach(c => { CAT_MAP[c.id] = c })

const STATUS_MAP = {}
Object.values(ORDER_STATUS).forEach(s => { STATUS_MAP[s.id] = s })

Page({
  data: {
    storeName: '',
    goodsCount: 0,
    totalOrders: 0,
    pendingOrders: 0,
    totalSpent: 0,
    goodsOverview: [],
    recentOrders: [],
    inventoryTip: '点击查看盘点记录'
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getStoreData()
      if (!data) return

      const goods = data.goods || []
      const orders = data.orders || []

      const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'accepted' || o.status === 'shipped' || o.status === 'partial').length
      const totalOrders = orders.length
      const totalSpent = orders
        .filter(o => o.status !== 'cancelled')
        .reduce((s, o) => s + (Number(o.total) || 0), 0)

      // 货品总览（按分类聚合）
      const catStats = {}
      goods.forEach(g => {
        const catId = g.category || 'other'
        if (!catStats[catId]) catStats[catId] = { catId, count: 0, icon: (CAT_MAP[catId] || {}).icon || '📦', name: (CAT_MAP[catId] || {}).name || '其他' }
        catStats[catId].count++
      })
      const goodsOverview = Object.values(catStats).sort((a, b) => b.count - a.count).slice(0, 6)

      const recentOrders = orders.slice(0, 5).map(o => ({
        ...o,
        statusName: (STATUS_MAP[o.status] || {}).name || o.status,
        tagClass: 'tag-' + o.status
      }))

      this.setData({
        storeName: data.store ? data.store.name : '',
        goodsCount: goods.length,
        totalOrders,
        pendingOrders,
        totalSpent: Math.round(totalSpent * 100) / 100,
        goodsOverview,
        recentOrders
      })

      // 加载盘点提示
      this.loadInventoryTip()
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  goPurchase() {
    wx.reLaunch({ url: '/pages/manager/purchase/index' })
  },

  goOrders() {
    wx.reLaunch({ url: '/pages/manager/orders/index' })
  },

  goReports() {
    wx.navigateTo({ url: '/pages/manager/reports/index' })
  },

  async loadInventoryTip() {
    try {
      var inventories = await cloud.getInventories()
      var d = new Date()
      var m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      var currentInv = inventories.find(function (inv) { return inv.month === m })
      if (currentInv) {
        this.setData({ inventoryTip: '本月已盘点，点击查看' })
      } else if (inventories.length > 0) {
        var last = inventories[0]
        var parts = (last.month || '').split('-')
        var label = parts.length === 2 ? parts[0] + '年' + parseInt(parts[1]) + '月' : ''
        this.setData({ inventoryTip: '上次盘点：' + label + '，本月待盘点' })
      } else {
        this.setData({ inventoryTip: '暂无盘点记录，点击开始' })
      }
    } catch (e) {
      // 静默失败，不影响主界面
    }
  },

  goInventoryCheck() {
    wx.navigateTo({ url: '/pages/manager/inventory-check/index' })
  },

  goCategory(e) {
    const catId = e.currentTarget.dataset.id
    wx.reLaunch({ url: '/pages/manager/purchase/index?cat=' + catId })
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.reLaunch({ url: '/pages/manager/orders/index?id=' + id })
  },

  // 订阅消息（接单提醒 + 配送提醒）
  async subscribeNotify() {
    try {
      const result = await cloud.subscribeManagerNotify()
      if (result.subscribed) {
        wx.showToast({ title: '已开启通知', icon: 'success' })
      } else {
        wx.showToast({ title: '下次再开也行', icon: 'none' })
      }
    } catch (err) {
      if (err.errCode !== 20004) {
        wx.showToast({ title: '开启失败，请重试', icon: 'none' })
      }
    }
  }
})
