/**
 * 店长 - 订单管理（独立页面，分页加载）
 */
const cloud = require('../../../utils/cloud.js')
const excel = require('../../../utils/excel.js')
const { ORDER_STATUS } = require('../../../utils/constants.js')

const STATUS_MAP = {}
Object.values(ORDER_STATUS).forEach(function (s) { STATUS_MAP[s.id] = s })

const STATUS_TABS = [
  { id: 'all', name: '全部' },
  { id: 'pending', name: '待确认' },
  { id: 'accepted', name: '已接单' },
  { id: 'shipped', name: '配送中' },
  { id: 'partial', name: '部分收货' },
  { id: 'received', name: '已收货' },
  { id: 'cancelled', name: '已取消' }
]

Page({
  data: {
    statusTabs: STATUS_TABS,
    activeStatus: 'all',
    orders: [],
    filteredOrders: [],
    keyword: '',
    page: 1,
    pageSize: 20,
    hasMore: true,
    loadingMore: false,
    batchMap: {},
    staleCount: 0
  },

  onLoad: function (options) {},

  async onShow() {
    await this.loadData(true)
  },

  async loadData(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, orders: [], filteredOrders: [] })
    }
    var page = reset ? 1 : this.data.page
    if (this.data.loadingMore) return
    this.setData({ loadingMore: true })
    try {
      if (page === 1) wx.showLoading({ title: '加载中...' })
      var status = this.data.activeStatus !== 'all' ? this.data.activeStatus : ''
      var res = await cloud.getOrdersByPage('manager', page, this.data.pageSize, status)
      var now = Date.now()
      var THIRTY_MIN = 30 * 60 * 1000
      var newOrders = (res.orders || []).map(function (o) {
        var isStale = o.status === 'pending' &&
          o.createTime && (now - new Date(o.createTime).getTime() > THIRTY_MIN)
        return {
          ...o,
          statusName: (STATUS_MAP[o.status] || {}).name || o.status,
          tagClass: 'tag-' + o.status + (isStale ? ' tag-stale' : ''),
          itemCount: o.items ? o.items.length : 0,
          isStale: isStale
        }
      })
      newOrders.sort(function (a, b) { return (b.createTime || '').localeCompare(a.createTime || '') })
      var orders = page === 1 ? newOrders : this.data.orders.concat(newOrders)
      var hasMore = newOrders.length >= this.data.pageSize && orders.length < (res.total || 0)

      // 统计每个 batchNo 的订单数（在已加载的数据中）
      var batchMap = {}
      orders.forEach(function (o) {
        if (o.batchNo) {
          batchMap[o.batchNo] = (batchMap[o.batchNo] || 0) + 1
        }
      })
      var staleCount = orders.filter(function (o) { return o.isStale }).length

      this.setData({
        orders: orders,
        batchMap: batchMap,
        staleCount: staleCount,
        page: page + 1,
        hasMore: hasMore
      })
      this.filterOrders()
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
      this.loadData(false)
    }
  },

  onStatusTap: function (e) {
    this.setData({ activeStatus: e.currentTarget.dataset.id })
    this.loadData(true)
  },

  onSearch: function (e) {
    this.setData({ keyword: e.detail.value })
    this.filterOrders()
  },

  filterOrders: function () {
    var list = this.data.orders
    if (this.data.keyword) {
      var kw = this.data.keyword.toLowerCase()
      list = list.filter(function (o) {
        return (o.no && o.no.toLowerCase().indexOf(kw) !== -1) ||
          (o.supplierName && o.supplierName.toLowerCase().indexOf(kw) !== -1) ||
          (o.items && o.items.some(function (it) { return it.name && it.name.toLowerCase().indexOf(kw) !== -1 }))
      })
    }
    this.setData({ filteredOrders: list })
  },

  viewDetail: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/manager/orders/detail/index?id=' + id })
  },

  // 导出当前列表订单为 Excel
  exportOrders: function () {
    var list = this.data.filteredOrders || []
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
  },

  cancelOrder: function (e) {
    var id = e.currentTarget.dataset.id
    var that = this
    wx.showModal({
      title: '确认取消',
      content: '取消后订单不可恢复，确定？',
      success: async function (res) {
        if (res.confirm) {
          try {
            await cloud.updateOrderStatus(id, 'cancelled')
            wx.showToast({ title: '已取消', icon: 'success' })
            await that.loadData(true)
          } catch (e) {
            wx.showToast({ title: '取消失败: ' + String(e.message || e).slice(0, 30), icon: 'none' })
          }
        }
      }
    })
  },

  receiveOrder: function (e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/manager/orders/detail/index?id=' + id })
  }
})
