const cloud = require('../../../utils/cloud.js')
const excel = require('../../../utils/excel.js')

Page({
  data: {
    allOrders: [],
    orders: [],
    keyword: '',
    filterStatus: '',
    page: 1,
    pageSize: 20,
    hasMore: true,
    loadingMore: false,
    statusLabels: { pending: '待确认', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }
  },

  async onShow() { await this.loadOrders(true) },

  async loadOrders(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, allOrders: [], orders: [] })
    }
    var page = reset ? 1 : this.data.page
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      if (page === 1) wx.showLoading({ title: '加载中...' })
      var res = await cloud.getOrdersByPage('admin', page, this.data.pageSize, this.data.filterStatus)
      var newOrders = (res.orders || []).map(function (o) {
        o.createTime = o.createTime || ''
        return o
      })
      newOrders.sort(function (a, b) { return new Date(b.createTime) - new Date(a.createTime) })
      var allOrders = page === 1 ? newOrders : this.data.allOrders.concat(newOrders)
      this.setData({
        allOrders: allOrders,
        page: page + 1,
        hasMore: newOrders.length >= this.data.pageSize && allOrders.length < (res.total || 0)
      })
      this.filterOrders()
    } catch (e) {
      console.error('加载数据失败', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
      this.setData({ loadingMore: false })
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadOrders(false)
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.filterOrders()
  },

  filterOrders() {
    var list = this.data.allOrders
    if (this.data.keyword) {
      var kw = this.data.keyword.toLowerCase()
      list = list.filter(function (o) {
        return (o.no && o.no.toLowerCase().indexOf(kw) !== -1) ||
          (o.storeName && o.storeName.toLowerCase().indexOf(kw) !== -1) ||
          (o.supplierName && o.supplierName.toLowerCase().indexOf(kw) !== -1) ||
          (o.items && o.items.some(function (it) { return it.name && it.name.toLowerCase().indexOf(kw) !== -1 }))
      })
    }
    this.setData({ orders: list })
  },

  filterStatus(e) {
    var status = e.currentTarget.dataset.status || ''
    this.setData({ filterStatus: status })
    this.loadOrders(true)
  },

  cancelOrder(e) {
    var that = this
    wx.showModal({
      title: '取消订单',
      content: '确认取消该采购订单？',
      success: async function (res) {
        if (res.confirm) {
          await cloud.updateOrderStatus(e.currentTarget.dataset.id, 'cancelled')
          wx.showToast({ title: '已取消', icon: 'success' })
          await that.loadOrders(true)
        }
      }
    })
  },

  viewDetail(e) {
    wx.navigateTo({ url: '/pages/admin/orders/detail/index?id=' + e.currentTarget.dataset.id })
  },

  // 导出当前列表订单为 Excel
  exportOrders() {
    var list = this.data.orders || []
    if (!list.length) { wx.showToast({ title: '暂无订单可导出', icon: 'none' }); return }
    wx.showLoading({ title: '生成中...' })
    var statusText = { pending: '待确认', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }
    var headers = ['订单号', '门店', '供货商', '金额(¥)', '状态', '下单时间']
    var rows = list.map(function (o) {
      return [o.no || '', o.storeName || '', o.supplierName || '', (Number(o.total) || 0).toFixed(2), statusText[o.status] || o.status, o.createTime || '']
    })
    var totalAmount = list.reduce(function (s, o) { return s + (Number(o.total) || 0) }, 0)
    excel.exportExcel({
      filename: '订单导出_' + new Date().toISOString().slice(0, 10),
      title: '订单列表',
      headers: headers,
      rows: rows,
      summaryRows: [['合计', '', '', totalAmount.toFixed(2), list.length + '笔', '']]
    }).then(function () { wx.hideLoading() }).catch(function () { wx.hideLoading() })
  }
})
