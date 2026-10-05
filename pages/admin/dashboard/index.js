const cloud = require('../../../utils/cloud.js')
const { exportExcel } = require('../../../utils/excel.js')
const { r2 } = require('../../../utils/util.js')

Page({
  data: {
    stats: { userCount: 0, storeCount: 0, supplierCount: 0, orderCount: 0, pendingUsers: 0, pendingOrders: 0 },
    recentOrders: [],
    pendingUsers: [],

    // 报表筛选
    reportStore: '',        // 空=全部
    reportStoreName: '全部店铺',
    reportRange: '7',       // '1'=今天 '7'=近7天 '30'=近30天 '365'=近一年
    reportRangeName: '近7天',
    storeOptions: [],
    storePickerIndex: 0,

    // 报表数据
    reportOrders: 0,
    reportAmount: 0,
    reportAvg: 0,
    storeList: [],          // [{name, count, amount}]
    supplierList: [],       // 供应商统计 [{name, count, amount}]
    chartData: [],          // [{label, amount, max}]
    chartMax: 0,
    chartWidthStyle: '',
    _allOrders: [],
    _allStores: []
  },

  async onShow() {
    await this.loadData()
    this.loadReport()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getAdminData()
      wx.hideLoading()
      const users = data.users
      const stores = data.stores
      const suppliers = data.suppliers
      const orders = data.orders

      const storeOpts = [{ name: '全部店铺', value: '' }]
      stores.forEach(s => storeOpts.push({ name: s.name, value: s._id }))

      this.setData({
        stats: {
          userCount: users.filter(u => u.status === 'active').length,
          storeCount: stores.length,
          supplierCount: suppliers.filter(s => s.status === 'active').length,
          orderCount: orders.length,
          pendingUsers: users.filter(u => u.status === 'pending').length,
          pendingOrders: orders.filter(o => o.status === 'pending').length
        },
        recentOrders: orders.sort((a, b) => new Date(b.createTime) - new Date(a.createTime)).slice(0, 5),
        pendingUsers: users.filter(u => u.status === 'pending').slice(0, 5),
        storeOptions: storeOpts,
        _allOrders: orders,
        _allStores: stores
      })
    } catch (e) {
      wx.hideLoading()
      console.error('loadData error', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    }
  },

  // ========== 报表 ==========
  loadReport() {
    const allOrders = this.data._allOrders || []
    const stores = this.data._allStores || []

    // 时间筛选
    const now = new Date()
    let rangeStart = new Date()
    const range = this.data.reportRange
    if (range === '1') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (range === '7') {
      rangeStart = new Date(now.getTime() - 7 * 86400000)
    } else if (range === '30') {
      rangeStart = new Date(now.getTime() - 30 * 86400000)
    } else if (range === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      rangeStart = new Date(now.getTime() - 365 * 86400000)
    }

    let filtered = allOrders.filter(o => new Date(o.createTime) >= rangeStart)
    if (this.data.reportStore) {
      filtered = filtered.filter(o => o.storeId === this.data.reportStore)
    }

    const totalAmount = filtered.reduce((s, o) => s + o.total, 0)
    const reportAvg = filtered.length > 0 ? (totalAmount / filtered.length).toFixed(0) : 0

    // 按店铺统计
    const storeMap = {}
    filtered.forEach(o => {
      if (!storeMap[o.storeId]) storeMap[o.storeId] = { name: o.storeName, count: 0, amount: 0 }
      storeMap[o.storeId].count++
      storeMap[o.storeId].amount += Number(o.total)
    })
    const storeList = Object.values(storeMap).sort((a, b) => b.amount - a.amount).map(s => ({ ...s, amountText: s.amount.toFixed(0) }))

    // 按供应商统计
    const supplierMap = {}
    filtered.forEach(o => {
      if (!supplierMap[o.supplierId]) supplierMap[o.supplierId] = { name: o.supplierName, count: 0, amount: 0 }
      supplierMap[o.supplierId].count++
      supplierMap[o.supplierId].amount += Number(o.total)
    })
    const supplierList = Object.values(supplierMap).sort((a, b) => b.amount - a.amount).map(s => ({ ...s, amountText: s.amount.toFixed(0) }))

    // 趋势图数据
    const rangeVal = this.data.reportRange
    const chartData = []
    let chartMax = 0
    if (rangeVal === '365') {
      // 近一年：按月聚合
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const label = (d.getMonth() + 1) + '月'
        const monthOrders = filtered.filter(o => {
          const ot = new Date(o.createTime)
          return ot.getFullYear() === d.getFullYear() && ot.getMonth() === d.getMonth()
        })
        const amount = monthOrders.reduce((s, o) => s + o.total, 0)
        chartData.push({ label: label, amount: amount, count: monthOrders.length })
        if (amount > chartMax) chartMax = amount
      }
    } else if (rangeVal === 'month' || rangeVal === '30') {
      const today = now.getDate()
      const startDay = rangeVal === 'month' ? 1 : Math.max(1, today - 29)
      const endDay = today
      for (let d = startDay; d <= endDay; d++) {
        const dateStr = (now.getMonth() + 1) + '/' + d
        const dayOrders = filtered.filter(o => {
          const ot = new Date(o.createTime)
          return ot.getFullYear() === now.getFullYear() && ot.getMonth() === now.getMonth() && ot.getDate() === d
        })
        const amount = dayOrders.reduce((s, o) => s + o.total, 0)
        chartData.push({ label: dateStr, amount: amount, count: dayOrders.length })
        if (amount > chartMax) chartMax = amount
      }
    } else {
      const days = rangeVal === '1' ? 1 : parseInt(rangeVal)
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000)
        const dateStr = (d.getMonth() + 1) + '/' + d.getDate()
        const dayOrders = filtered.filter(o => {
          const ot = new Date(o.createTime)
          return ot.getFullYear() === d.getFullYear() && ot.getMonth() === d.getMonth() && ot.getDate() === d.getDate()
        })
        const amount = dayOrders.reduce((s, o) => s + o.total, 0)
        chartData.push({ label: dateStr, amount: amount, count: dayOrders.length })
        if (amount > chartMax) chartMax = amount
      }
    }
    // 给 chartMax 加 20% 头部空间
    chartMax = Math.ceil(chartMax * 1.2) || 100

    this.setData({
      reportOrders: filtered.length,
      reportAmount: totalAmount.toFixed(0),
      reportAvg: reportAvg,
      storeList: storeList,
      supplierList: supplierList,
      chartData: chartData,
      chartMax: chartMax,
      chartWidthStyle: chartData.length > 7 ? `min-width:${chartData.length * 52}rpx;` : 'width:100%;'
    })
  },

  // 切换店铺筛选
  onStoreChange(e) {
    const idx = parseInt(e.detail.value)
    const opt = this.data.storeOptions[idx]
    this.setData({
      reportStore: opt.value,
      reportStoreName: opt.name,
      storePickerIndex: idx
    }, () => this.loadReport())
  },

  // 切换时间范围
  onRangeChange(e) {
    const range = e.currentTarget.dataset.range
    const map = { '1': '今天', '7': '近7天', '30': '近30天', 'month': '本月', '365': '近一年' }
    this.setData({
      reportRange: range,
      reportRangeName: map[range]
    }, () => this.loadReport())
  },

  // ========== Excel 导出 ==========
  exportStoreReport() {
    var stats = this.data.storeList
    if (!stats.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }

    wx.showLoading({ title: '生成中...' })
    var headers = ['门店名称', '订单数', '采购金额(¥)']
    var rows = stats.map(function (s) {
      return [s.name, s.count + '笔', s.amountText]
    })
    var totalCount = stats.reduce(function (s, r) { return s + r.count }, 0)
    var totalAmount = stats.reduce(function (s, r) { return s + Number(r.amount) }, 0)
    var summaryRows = [['合计', totalCount + '笔', r2(totalAmount)]]

    var title = '门店采购统计（' + this.data.reportRangeName
    if (this.data.reportStoreName !== '全部店铺') title += '·' + this.data.reportStoreName
    title += '）'

    exportExcel({
      filename: '门店采购统计_' + this.data.reportRangeName,
      title: title,
      headers: headers,
      rows: rows,
      summaryRows: summaryRows
    }).then(function () {
      wx.hideLoading()
    }).catch(function () {
      wx.hideLoading()
    })
  },

  exportOrderDetail() {
    var allOrders = this.data._allOrders || []
    if (!allOrders.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }

    wx.showLoading({ title: '生成中...' })
    var self = this

    // 时间筛选（复用 loadReport 的逻辑）
    var now = new Date()
    var rangeStart = new Date()
    var range = this.data.reportRange
    if (range === '1') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    } else if (range === '7') {
      rangeStart = new Date(now.getTime() - 7 * 86400000)
    } else if (range === '30') {
      rangeStart = new Date(now.getTime() - 30 * 86400000)
    } else if (range === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      rangeStart = new Date(now.getTime() - 365 * 86400000)
    }

    var filtered = allOrders.filter(function (o) { return new Date(o.createTime) >= rangeStart })
    if (this.data.reportStore) {
      filtered = filtered.filter(function (o) { return o.storeId === self.data.reportStore })
    }

    var statusText = { pending: '待确认', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' }

    var headers = ['订单号', '门店', '供货商', '金额(¥)', '状态', '下单时间']
    var rows = filtered.sort(function (a, b) { return new Date(b.createTime) - new Date(a.createTime) }).map(function (o) {
      var d = new Date(o.createTime)
      var dateStr = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes()
      return [o.no || '', o.storeName || '', o.supplierName || '', r2(Number(o.total) || 0), statusText[o.status] || o.status, dateStr]
    })
    var totalAmount = filtered.reduce(function (s, o) { return s + (Number(o.total) || 0) }, 0)
    var summaryRows = [['合计', '', '', r2(totalAmount), filtered.length + '笔', '']]

    var title = '订单明细报表（' + this.data.reportRangeName
    if (this.data.reportStoreName !== '全部店铺') title += '·' + this.data.reportStoreName
    title += '）'

    exportExcel({
      filename: '订单明细报表_' + this.data.reportRangeName,
      title: title,
      headers: headers,
      rows: rows,
      summaryRows: summaryRows
    }).then(function () {
      wx.hideLoading()
    }).catch(function () {
      wx.hideLoading()
    })
  },

  exportSupplierReport() {
    var stats = this.data.supplierList
    if (!stats.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中...' })
    var headers = ['供货商名称', '订单数', '采购金额(¥)']
    var rows = stats.map(function (s) {
      return [s.name, s.count + '笔', s.amountText]
    })
    var totalCount = stats.reduce(function (s, r) { return s + r.count }, 0)
    var totalAmount = stats.reduce(function (s, r) { return s + Number(r.amount) }, 0)
    var title = '供应商采购统计（' + this.data.reportRangeName
    if (this.data.reportStoreName !== '全部店铺') title += '·' + this.data.reportStoreName
    title += '）'
    exportExcel({
      filename: '供应商采购统计_' + this.data.reportRangeName,
      title: title,
      headers: headers,
      rows: rows,
      summaryRows: [['合计', totalCount + '笔', r2(totalAmount)]]
    }).then(function () {
      wx.hideLoading()
    }).catch(function () {
      wx.hideLoading()
    })
  },

  goTo(e) {
    wx.reLaunch({ url: e.currentTarget.dataset.url })
  }
})
