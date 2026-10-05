const cloud = require('../../../utils/cloud.js')
const excel = require('../../../utils/excel.js')

var STATUS_LABELS = { pending: '待接单', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }

Page({
  data: {
    orders: [],
    filteredOrders: [],
    filterStatus: '',
    keyword: '',
    page: 1,
    pageSize: 20,
    hasMore: true,
    loadingMore: false,
    statusLabels: STATUS_LABELS,
    detailOrder: null,
    showDetail: false,
    showShipModal: false,
    shipOrderId: '',
    shipOrder: null,
    shipImage: '',
    shipUploading: false
  },

  async onShow() { await this.loadOrders(true) },

  async loadOrders(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, orders: [], filteredOrders: [] })
    }
    var page = reset ? 1 : this.data.page
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      if (page === 1) wx.showLoading({ title: '加载中...' })
      var res = await cloud.getOrdersByPage('supplier', page, this.data.pageSize, this.data.filterStatus)
      var newOrders = res.orders || []
      newOrders.sort(function (a, b) { return new Date(b.createTime) - new Date(a.createTime) })
      var orders = page === 1 ? newOrders : this.data.orders.concat(newOrders)
      var hasMore = newOrders.length >= this.data.pageSize && orders.length < (res.total || 0)
      this.setData({ orders: orders, page: page + 1, hasMore: hasMore })
      this.applyFilters()
    } catch (e) {
      console.error('加载失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
      this.setData({ loadingMore: false })
    }
  },

  onReachBottom: function () {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadOrders(false)
    }
  },

  applyFilters: function () {
    var list = this.data.orders
    var kw = (this.data.keyword || '').trim().toLowerCase()
    if (kw) {
      list = list.filter(function (o) {
        return (o.no || '').toLowerCase().indexOf(kw) !== -1 ||
          (o.storeName || '').toLowerCase().indexOf(kw) !== -1 ||
          (o.items || []).some(function (it) { return (it.name || '').toLowerCase().indexOf(kw) !== -1 })
      })
    }
    this.setData({ filteredOrders: list })
  },

  filterStatus: function (e) {
    var status = e.currentTarget.dataset.status || ''
    this.setData({ filterStatus: status })
    this.loadOrders(true)
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value })
    this.applyFilters()
  },

  acceptOrder: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '确认接单',
      content: '确认接受该订单？接单后请尽快安排发货。',
      success: async function (res) {
        if (res.confirm) {
          try {
            await cloud.updateOrderStatus(id, 'accepted')
            wx.showToast({ title: '已接单', icon: 'success' })
            that.loadOrders(true)
          } catch (e) {
            wx.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  rejectOrder: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '确认退单',
      content: '确认退回该订单？退单后无法恢复。',
      confirmColor: '#ef4444',
      success: async function (res) {
        if (res.confirm) {
          try {
            await cloud.updateOrderStatus(id, 'cancelled')
            wx.showToast({ title: '已退单', icon: 'none' })
            that.loadOrders(true)
          } catch (e) {
            wx.showToast({ title: '操作失败', icon: 'none' })
          }
        }
      }
    })
  },

  openShipModal: function (e) {
    var id = e.currentTarget.dataset.id
    var order = this.data.orders.find(function (o) { return o._id === id })
    this.setData({
      showShipModal: true,
      shipOrderId: id,
      shipOrder: order || null,
      shipImage: ''
    })
  },

  closeShipModal: function () {
    this.setData({ showShipModal: false, shipOrderId: '', shipOrder: null, shipImage: '' })
  },

  onChooseShipImage: function () {
    var that = this
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        // 直接存临时路径，由 cloud.js shipOrder 上传到云存储（避免 base64 写入数据库导致超限）
        that.setData({ shipImage: res.tempFilePaths[0] })
      }
    })
  },

  onRemoveShipImage: function () {
    this.setData({ shipImage: '' })
  },

  confirmShip: async function () {
    if (this.data.shipUploading) return
    this.setData({ shipUploading: true })
    try {
      await cloud.shipOrder(this.data.shipOrderId, this.data.shipImage)
      this.setData({
        showShipModal: false,
        shipOrderId: '',
        shipOrder: null,
        shipImage: '',
        shipUploading: false
      })
      wx.showToast({ title: '已发货', icon: 'success' })
      this.loadOrders(true)
    } catch (e) {
      wx.showToast({ title: '发货失败', icon: 'none' })
      this.setData({ shipUploading: false })
    }
  },

  viewDetail: function (e) {
    var id = e.currentTarget.dataset.id
    var order = this.data.orders.find(function (o) { return o._id === id })
    this.setData({ detailOrder: order, showDetail: true })
  },

  // 导出当前列表订单为 Excel
  exportOrders: function () {
    var list = this.data.filteredOrders || []
    if (!list.length) { wx.showToast({ title: '暂无订单可导出', icon: 'none' }); return }
    wx.showLoading({ title: '生成中...' })
    var headers = ['订单号', '门店', '供货商', '金额(¥)', '状态', '下单时间']
    var rows = list.map(function (o) {
      return [o.no || '', o.storeName || '', o.supplierName || '', (Number(o.total) || 0).toFixed(2), STATUS_LABELS[o.status] || o.status, o.createTime || '']
    })
    var totalAmount = list.reduce(function (s, o) { return s + (Number(o.total) || 0) }, 0)
    excel.exportExcel({
      filename: '订单导出_' + new Date().toISOString().slice(0, 10),
      title: '订单列表',
      headers: headers,
      rows: rows,
      summaryRows: [['合计', '', '', totalAmount.toFixed(2), list.length + '笔', '']]
    }).then(function () { wx.hideLoading() }).catch(function () { wx.hideLoading() })
  },

  closeDetail: function () {
    this.setData({ showDetail: false, detailOrder: null })
  }
})
