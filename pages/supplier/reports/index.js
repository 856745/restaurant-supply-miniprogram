/**
 * 供货商 - 销售报表（单次遍历优化）
 * 支持时间范围筛选（7天/本月/1年）+ 店铺筛选 + 商品分类/商品筛选
 * 商品销售统计：订单次数 + 每次明细 + 总量 + 总金额
 * 支持 Excel 导出
 */
var cloud = require('../../../utils/cloud.js')
var { ORDER_STATUS } = require('../../../utils/constants.js')
var { exportExcel } = require('../../../utils/excel.js')
var { r2 } = require('../../../utils/util.js')

var STATUS_MAP = {}
Object.values(ORDER_STATUS).forEach(function (s) { STATUS_MAP[s.id] = s })

Page({
  data: {
    reportRange: '7',
    reportRangeName: '近7天',
    reportStore: '',
    reportStoreName: '全部店铺',
    storeOptions: [],
    storePickerIndex: 0,
    reportCategory: '',
    reportCategoryName: '全部分类',
    categoryOptions: [],
    categoryPickerIndex: 0,
    reportGoods: '',
    reportGoodsName: '全部商品',
    goodsOptions: [],
    goodsPickerIndex: 0,
    totalOrders: 0,
    totalSales: 0,
    avgOrder: 0,
    receivedCount: 0,
    pendingCount: 0,
    cancelledCount: 0,
    storeStats: [],
    categoryStats: [],
    statusStats: [],
    chartData: [],
    chartMax: 0,
    chartWidthStyle: '',
    allGoods: [],
    keyword: '',
    goodsStats: [],
    expandedGoodsId: ''
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      var data = await cloud.getSupplierData()
      if (!data) return

      this._allOrders = data.orders || []
      this._categories = await cloud.getCategories()

      // 提取店铺选项
      var storeMap = {}
      this._allOrders.forEach(function (o) {
        if (o.storeId && o.storeName && !storeMap[o.storeId]) {
          storeMap[o.storeId] = o.storeName
        }
      })
      var opts = [{ name: '全部店铺', value: '' }]
      Object.keys(storeMap).forEach(function (sid) {
        opts.push({ name: storeMap[sid], value: sid })
      })

      var catOpts = [{ id: '', name: '全部分类' }]
      ;(this._categories || []).forEach(function (c) { catOpts.push({ id: c.id, name: c.name }) })

      this.setData({
        storeOptions: opts,
        categoryOptions: catOpts,
        allGoods: data.goods || []
      }, function () { this.loadReport() }.bind(this))
    } catch (e) {
      console.error('加载失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  // ========== 报表计算（单次遍历优化） ==========
  loadReport: function () {
    var allOrders = this._allOrders || []
    var goods = this.data.allGoods
    var self = this

    // 构建商品快速查找 Map
    var goodsById = {}
    goods.forEach(function (g) { goodsById[g._id] = g })

    // 时间筛选
    var now = new Date()
    var rangeStart = new Date()
    var range = this.data.reportRange
    if (range === '7') {
      rangeStart = new Date(now.getTime() - 7 * 86400000)
    } else if (range === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      rangeStart = new Date(now.getTime() - 365 * 86400000)
    }
    var rangeStartTime = rangeStart.getTime()

    var storeFilter = this.data.reportStore
    var catFilter = this.data.reportCategory
    var goodsFilter = this.data.reportGoods

    // ===== 单次遍历 =====
    var filteredCount = 0
    var receivedCount = 0
    var pendingCount = 0
    var cancelledCount = 0
    var totalSales = 0
    var validCount = 0

    var storeMap = {}
    var catMap = {}
    var statusCountMap = {}
    var gMap = {}
    var chartBucket = {}

    allOrders.forEach(function (o) {
      var ot = new Date(o.createTime)
      if (ot.getTime() < rangeStartTime) return
      if (storeFilter && o.storeId !== storeFilter) return

      filteredCount++

      var status = o.status || 'pending'
      if (status === 'received') receivedCount++
      else if (status === 'cancelled') cancelledCount++
      else pendingCount++
      statusCountMap[status] = (statusCountMap[status] || 0) + 1

      if (status === 'cancelled') return

      validCount++
      var orderTotal = Number(o.total) || 0
      totalSales += orderTotal

      // 店铺统计
      var stName = o.storeName || '未知'
      if (!storeMap[stName]) storeMap[stName] = { name: stName, count: 0, total: 0 }
      storeMap[stName].count++
      storeMap[stName].total += orderTotal

      // 趋势图分组
      var bucketKey = ''
      if (range === '365') {
        bucketKey = ot.getFullYear() + '-' + (ot.getMonth() + 1)
      } else {
        bucketKey = (ot.getMonth() + 1) + '/' + ot.getDate()
      }
      if (!chartBucket[bucketKey]) chartBucket[bucketKey] = 0
      chartBucket[bucketKey] += orderTotal

      // 商品明细
      ;(o.items || []).forEach(function (it) {
        if (catFilter || goodsFilter) {
          var gi = goodsById[it.goodsId]
          if (catFilter && (!gi || gi.category !== catFilter)) return
          if (goodsFilter && it.goodsId !== goodsFilter) return
        }

        // 分类统计
        var gi2 = goodsById[it.goodsId]
        var catId = gi2 ? gi2.category : 'other'
        if (!catMap[catId]) {
          catMap[catId] = {
            catId: catId,
            catName: self.getCatName(catId),
            catIcon: self.getCatIcon(catId),
            count: 0,
            total: 0
          }
        }
        catMap[catId].count += Number(it.qty) || 0
        catMap[catId].total += Number(it.amount) || 0

        // 商品销售统计
        var key = it.goodsId || it.name
        if (!gMap[key]) {
          gMap[key] = {
            goodsId: it.goodsId || '',
            name: it.name,
            unit: it.unit || '',
            orderCount: 0,
            totalQty: 0,
            totalAmount: 0,
            orders: []
          }
        }
        gMap[key].orderCount++
        gMap[key].totalQty += Number(it.qty) || 0
        gMap[key].totalAmount += Number(it.amount) || 0
        gMap[key].orders.push({
          date: formatDateShort(o.createTime),
          no: o.no || '',
          qty: Number(it.qty) || 0,
          amount: r2(Number(it.amount) || 0),
          storeName: o.storeName || ''
        })
      })
    })

    // 店铺统计排序
    var storeStats = Object.values(storeMap).sort(function (a, b) { return b.total - a.total }).map(function (s) {
      return { name: s.name, count: s.count, total: s.total, totalText: r2(s.total) }
    })

    // 分类统计排序
    var categoryStats = Object.values(catMap).sort(function (a, b) { return b.total - a.total }).map(function (c) {
      return { catId: c.catId, catName: c.catName, catIcon: c.catIcon, count: c.count, total: c.total, totalText: r2(c.total) }
    })

    // 状态统计
    var statusStats = Object.values(ORDER_STATUS).map(function (s) {
      return { id: s.id, name: s.name, color: s.color, count: statusCountMap[s.id] || 0 }
    })

    // 趋势图
    var chartData = []
    var chartMax = 0
    if (range === '365') {
      for (var i = 11; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        var key = d.getFullYear() + '-' + (d.getMonth() + 1)
        var amount = chartBucket[key] || 0
        chartData.push({ label: (d.getMonth() + 1) + '月', amount: r2(amount), count: 0 })
        if (amount > chartMax) chartMax = amount
      }
    } else if (range === 'month') {
      var todayDate = now.getDate()
      for (var j = 0; j < todayDate; j++) {
        var dd = new Date(now.getFullYear(), now.getMonth(), j + 1)
        var key2 = (dd.getMonth() + 1) + '/' + dd.getDate()
        var dayAmount = chartBucket[key2] || 0
        chartData.push({ label: key2, amount: r2(dayAmount), count: 0 })
        if (dayAmount > chartMax) chartMax = dayAmount
      }
    } else {
      var days = parseInt(range)
      for (var k = days - 1; k >= 0; k--) {
        var dd2 = new Date(now.getTime() - k * 86400000)
        var key3 = (dd2.getMonth() + 1) + '/' + dd2.getDate()
        var dayAmount2 = chartBucket[key3] || 0
        chartData.push({ label: key3, amount: r2(dayAmount2), count: 0 })
        if (dayAmount2 > chartMax) chartMax = dayAmount2
      }
    }
    chartMax = Math.ceil(chartMax * 1.2) || 100

    // 商品统计排序
    var goodsStats = Object.values(gMap).sort(function (a, b) { return b.totalAmount - a.totalAmount }).map(function (g) {
      return {
        goodsId: g.goodsId,
        name: g.name,
        unit: g.unit,
        orderCount: g.orderCount,
        totalQty: r2(g.totalQty),
        totalAmount: r2(g.totalAmount),
        orders: g.orders,
        qtySummary: summarizeQty(g.orders)
      }
    })

    this.setData({
      totalOrders: filteredCount,
      totalSales: r2(totalSales),
      avgOrder: validCount > 0 ? r2(totalSales / validCount) : 0,
      receivedCount: receivedCount,
      pendingCount: pendingCount,
      cancelledCount: cancelledCount,
      storeStats: storeStats,
      categoryStats: categoryStats,
      statusStats: statusStats,
      chartData: chartData,
      chartMax: chartMax,
      chartWidthStyle: chartData.length > 7 ? 'min-width:' + chartData.length * 52 + 'rpx;' : 'width:100%;',
      goodsStats: goodsStats
    })

    // 关键词搜索过滤
    var kw = this.data.keyword
    if (kw) {
      kw = kw.toLowerCase()
      goodsStats = goodsStats.filter(function (g) {
        return g.name.toLowerCase().indexOf(kw) !== -1 ||
          g.orders.some(function (o) { return o.no.toLowerCase().indexOf(kw) !== -1 || o.storeName.toLowerCase().indexOf(kw) !== -1 })
      })
      this.setData({ goodsStats: goodsStats })
    }
  },

  getCatName: function (catId) {
    var cats = this._categories || []
    var found = cats.find(function (c) { return c.id === catId })
    return found ? found.name : '其他'
  },
  getCatIcon: function (catId) {
    var cats = this._categories || []
    var found = cats.find(function (c) { return c.id === catId })
    return found ? (found.icon || '📦') : '📦'
  },

  // ========== 筛选事件 ==========
  onSearch: function (e) {
    this.setData({ keyword: e.detail.value })
    this.loadReport()
  },
  onRangeChange: function (e) {
    var range = e.currentTarget.dataset.range
    var map = { '7': '近7天', 'month': '本月', '365': '近一年' }
    this.setData({ reportRange: range, reportRangeName: map[range] }, function () { this.loadReport() }.bind(this))
  },
  onStoreChange: function (e) {
    var idx = parseInt(e.detail.value)
    var opt = this.data.storeOptions[idx]
    this.setData({
      reportStore: opt.value,
      reportStoreName: opt.name,
      storePickerIndex: idx
    }, function () { this.loadReport() }.bind(this))
  },
  onCategoryChange: function (e) {
    var idx = parseInt(e.detail.value)
    var opt = this.data.categoryOptions[idx]
    var goodsOpts = [{ _id: '', name: '全部商品' }]
    if (opt.id) {
      goodsOpts = [{ _id: '', name: '全部商品' }].concat(
        this.data.allGoods.filter(function (g) { return g.category === opt.id })
          .map(function (g) { return { _id: g._id, name: g.name } })
      )
    }
    this.setData({
      reportCategory: opt.id,
      reportCategoryName: opt.name,
      categoryPickerIndex: idx,
      goodsOptions: goodsOpts,
      reportGoods: '',
      reportGoodsName: '全部商品',
      goodsPickerIndex: 0
    }, function () { this.loadReport() }.bind(this))
  },
  onGoodsChange: function (e) {
    var idx = parseInt(e.detail.value)
    var opt = this.data.goodsOptions[idx]
    this.setData({
      reportGoods: opt._id,
      reportGoodsName: opt.name,
      goodsPickerIndex: idx
    }, function () { this.loadReport() }.bind(this))
  },
  toggleGoodsDetail: function (e) {
    var id = e.currentTarget.dataset.id
    if (this.data.expandedGoodsId === id) {
      this.setData({ expandedGoodsId: '' })
    } else {
      this.setData({ expandedGoodsId: id })
    }
  },

  // ========== Excel 导出 ==========
  exportGoodsReport: function () {
    var stats = this.data.goodsStats
    if (!stats.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中...' })
    var headers = ['商品名称', '单位', '订单次数', '每次数量', '总数量', '总金额(¥)']
    var rows = stats.map(function (g) {
      return [g.name, g.unit, g.orderCount + '次', g.qtySummary, g.totalQty, g.totalAmount]
    })
    var totalQty = stats.reduce(function (s, g) { return s + g.totalQty }, 0)
    var totalAmount = stats.reduce(function (s, g) { return s + g.totalAmount }, 0)
    var summaryRows = [['合计', '', stats.length + '种商品', '', r2(totalQty), r2(totalAmount)]]
    var title = '商品销售统计（' + this.data.reportRangeName
    if (this.data.reportCategoryName !== '全部分类') title += '·' + this.data.reportCategoryName
    if (this.data.reportGoodsName !== '全部商品') title += '·' + this.data.reportGoodsName
    if (this.data.reportStoreName !== '全部店铺') title += '·' + this.data.reportStoreName
    title += '）'
    exportExcel({
      filename: '商品销售统计_' + this.data.reportRangeName,
      title: title,
      headers: headers,
      rows: rows,
      summaryRows: summaryRows
    }).then(function () { wx.hideLoading() }).catch(function () { wx.hideLoading() })
  },

  exportFullReport: function () {
    var stats = this.data.goodsStats
    if (!stats.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中...' })
    var headers = ['日期', '订单号', '店铺', '商品名称', '单价', '数量', '金额(¥)']
    var rows = []
    var totalAmount = 0
    stats.forEach(function (g) {
      g.orders.forEach(function (o) {
        rows.push([o.date, o.no, o.storeName, g.name, g.unit, o.qty, o.amount])
        totalAmount += Number(o.amount) || 0
      })
    })
    var summaryRows = [['合计', '', '', '', '', '', r2(totalAmount)]]
    var title = '销售明细报表（' + this.data.reportRangeName + '）'
    exportExcel({
      filename: '销售明细报表_' + this.data.reportRangeName,
      title: title,
      headers: headers,
      rows: rows,
      summaryRows: summaryRows
    }).then(function () { wx.hideLoading() }).catch(function () { wx.hideLoading() })
  }
})

// ===== 工具函数 =====
function summarizeQty(orders) {
  if (!orders.length) return ''
  var first = orders[0].qty
  var allSame = orders.every(function (o) { return o.qty === first })
  if (allSame) return '每次' + first
  var min = Math.min.apply(null, orders.map(function (o) { return o.qty }))
  var max = Math.max.apply(null, orders.map(function (o) { return o.qty }))
  return min + '~' + max
}

function formatDateShort(dateStr) {
  var d = new Date(dateStr)
  return (d.getMonth() + 1) + '/' + d.getDate()
}
