/**
 * 店长 - 月末盘点
 * 每月末记录每个商品的库存数量
 * 自动计算总价（单价 × 剩余量），支持导出盘点报表
 */
var cloud = require('../../../utils/cloud.js')
var { CATEGORIES } = require('../../../utils/config.js')
var { exportExcel } = require('../../../utils/excel.js')
var { r2 } = require('../../../utils/util.js')

var CAT_MAP = {}
CATEGORIES.forEach(function (c) { CAT_MAP[c.id] = c })

function currentMonth() {
  var d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

function monthLabel(month) {
  if (!month) return ''
  var parts = month.split('-')
  return parts[0] + '年' + parseInt(parts[1]) + '月'
}

Page({
  data: {
    // 页面模式: overview | checking | detail
    mode: 'overview',
    storeName: '',
    currentMonth: '',
    currentMonthLabel: '',
    // 当前月盘点记录
    currentInv: null,
    currentInvTotal: 0,
    // 历史记录
    historyList: [],
    // 盘点中的货品列表（按分类分组）
    checkGroups: [],
    checkTotalValue: 0,
    checkFilledCount: 0,
    // 盘点备注
    checkRemark: '',
    // 搜索
    keyword: '',
    filteredGroups: [],
    // 查看详情
    detailInv: null,
    detailGroups: [],
    detailTotalValue: 0
  },

  async onLoad() {
    var m = currentMonth()
    this.setData({
      currentMonth: m,
      currentMonthLabel: monthLabel(m)
    })
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      var storeData = await cloud.getStoreData()
      var inventories = await cloud.getInventories()

      var storeName = (storeData && storeData.store) ? storeData.store.name : ''
      var goods = (storeData && storeData.goods) ? storeData.goods : []
      this._allGoods = goods
      this._storeData = storeData

      // 构建商品价格映射
      this._priceMap = {}
      goods.forEach(function (g) { this._priceMap[g._id] = Number(g.price) || 0 }.bind(this))

      // 查找当前月是否已有盘点
      var m = this.data.currentMonth
      var currentInv = inventories.find(function (inv) { return inv.month === m })
      if (currentInv) {
        currentInv.totalItems = (currentInv.items || []).length
        currentInv.filledCount = (currentInv.items || []).filter(function (it) { return it.countQty > 0 }).length
      }

      // 计算当前盘点总价
      var currentInvTotal = 0
      if (currentInv && currentInv.items) {
        currentInv.items.forEach(function (it) {
          var price = Number(it.price) || 0
          if (!price && this._priceMap[it.goodsId]) price = this._priceMap[it.goodsId]
          currentInvTotal += price * (Number(it.countQty) || 0)
        }.bind(this))
      }

      // 历史记录（排除当前月）
      var self = this
      var historyList = inventories.filter(function (inv) { return inv.month !== m }).map(function (inv) {
        var itemCount = (inv.items || []).filter(function (it) { return it.countQty > 0 }).length
        // 计算历史盘点总价
        var totalValue = 0
        ;(inv.items || []).forEach(function (it) {
          var price = Number(it.price) || 0
          if (!price && self._priceMap[it.goodsId]) price = self._priceMap[it.goodsId]
          totalValue += price * (Number(it.countQty) || 0)
        })
        return {
          _id: inv._id,
          month: inv.month,
          monthLabel: monthLabel(inv.month),
          itemCount: itemCount,
          totalItems: (inv.items || []).length,
          totalValue: r2(totalValue),
          createTime: inv.createTime,
          remark: inv.remark || ''
        }
      })

      this._allInventories = inventories

      this.setData({
        storeName: storeName,
        currentInv: currentInv || null,
        currentInvTotal: r2(currentInvTotal),
        historyList: historyList
      })
    } catch (e) {
      console.error('盘点数据加载失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ============ 开始盘点 ============
  startCheck() {
    var goods = this._allGoods || []
    var existingInv = this.data.currentInv

    // 按分类分组
    var groups = {}
    goods.forEach(function (g) {
      var catId = g.category || 'other'
      if (!groups[catId]) {
        groups[catId] = {
          catId: catId,
          catName: (CAT_MAP[catId] || {}).name || '其他',
          icon: (CAT_MAP[catId] || {}).icon || '📦',
          items: []
        }
      }
      // 如果已有盘点数据，预填
      var existingItem = null
      if (existingInv && existingInv.items) {
        existingItem = existingInv.items.find(function (it) { return it.goodsId === g._id })
      }
      var price = existingItem ? (Number(existingItem.price) || 0) : (Number(g.price) || 0)
      groups[catId].items.push({
        goodsId: g._id,
        name: g.name,
        code: g.code || '',
        unit: g.unit || '',
        specWeight: g.specWeight || '',
        price: price,
        countQty: existingItem ? existingItem.countQty : 0,
        subtotal: r2(price * (existingItem ? (Number(existingItem.countQty) || 0) : 0)),
        remark: existingItem ? (existingItem.remark || '') : ''
      })
    })

    var checkGroups = Object.values(groups).sort(function (a, b) {
      return (a.catId === 'other' ? 999 : 0) - (b.catId === 'other' ? 999 : 0)
    })

    this.setData({
      mode: 'checking',
      checkGroups: checkGroups,
      filteredGroups: checkGroups,
      checkRemark: existingInv ? (existingInv.remark || '') : '',
      keyword: ''
    })
    this.recalcTotal()
  },

  // ============ 重新计算总价 ============
  recalcTotal() {
    var groups = this.data.checkGroups
    var total = 0
    var filled = 0
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        var num = parseFloat(it.countQty) || 0
        var sub = (Number(it.price) || 0) * num
        it.subtotal = r2(sub)
        total += sub
        if (num > 0) filled++
      })
    })
    this.setData({
      checkGroups: groups,
      filteredGroups: this.applySearch(groups),
      checkTotalValue: r2(total),
      checkFilledCount: filled
    })
  },

  applySearch(groups) {
    var kw = (this.data.keyword || '').toLowerCase().trim()
    if (!kw) return groups
    return groups.map(function (g) {
      return {
        catId: g.catId,
        catName: g.catName,
        icon: g.icon,
        items: g.items.filter(function (it) {
          return it.name.toLowerCase().includes(kw) || (it.code || '').toLowerCase().includes(kw)
        })
      }
    }).filter(function (g) { return g.items.length > 0 })
  },

  // ============ 盘点中：数量输入 ============
  onQtyInput(e) {
    var gIdx = e.currentTarget.dataset.gidx
    var iIdx = e.currentTarget.dataset.iidx
    var val = e.detail.value
    var groups = this.data.checkGroups
    // 保留原始字符串，支持小数输入中间状态（如 "3." "0.5"）
    // parseFloat 会把 "3." 转成 3，setData 回去后打断小数点输入
    groups[gIdx].items[iIdx].countQty = val
    this.setData({ checkGroups: groups })
    this.recalcTotal()
  },

  onRemarkInput(e) {
    var gIdx = e.currentTarget.dataset.gidx
    var iIdx = e.currentTarget.dataset.iidx
    var val = e.detail.value
    var groups = this.data.checkGroups
    groups[gIdx].items[iIdx].remark = val
    this.setData({ checkGroups: groups })
  },

  onCheckRemarkInput(e) {
    this.setData({ checkRemark: e.detail.value })
  },

  // ============ 搜索 ============
  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.setData({ filteredGroups: this.applySearch(this.data.checkGroups) })
  },

  // ============ 保存盘点 ============
  async saveCheck() {
    var groups = this.data.checkGroups
    var items = []
    groups.forEach(function (g) {
      g.items.forEach(function (it) {
        items.push({
          goodsId: it.goodsId,
          name: it.name,
          code: it.code,
          unit: it.unit,
          specWeight: it.specWeight,
          price: Number(it.price) || 0,
          countQty: Number(it.countQty) || 0,
          subtotal: r2((Number(it.price) || 0) * (Number(it.countQty) || 0)),
          remark: it.remark || ''
        })
      })
    })

    var filledCount = items.filter(function (it) { return it.countQty > 0 }).length
    if (filledCount === 0) {
      wx.showToast({ title: '请至少录入一个商品数量', icon: 'none' })
      return
    }

    var storeData = this._storeData
    var store = storeData ? storeData.store : null

    wx.showLoading({ title: '保存中...' })
    try {
      await cloud.saveInventory({
        storeId: store ? store._id : '',
        storeName: store ? store.name : '',
        month: this.data.currentMonth,
        items: items,
        remark: this.data.checkRemark
      })

      wx.showToast({ title: '盘点保存成功', icon: 'success' })
      this.setData({ mode: 'overview' })
      await this.loadData()
    } catch (e) {
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  cancelCheck() {
    wx.showModal({
      title: '提示',
      content: '确定放弃当前盘点？已录入的数据将丢失',
      success: (res) => {
        if (res.confirm) {
          this.setData({ mode: 'overview' })
        }
      }
    })
  },

  // ============ 查看历史详情 ============
  viewDetail(e) {
    var id = e.currentTarget.dataset.id
    var inv = this.data.historyList.find(function (h) { return h._id === id })
    if (!inv) return
    this.loadDetail(inv)
  },

  async loadDetail(historyItem) {
    wx.showLoading({ title: '加载中...' })
    try {
      var inventories = await cloud.getInventories()
      var inv = inventories.find(function (i) { return i._id === historyItem._id })
      if (!inv) {
        wx.showToast({ title: '记录不存在', icon: 'none' })
        return
      }

      var self = this
      // 按分类分组
      var groups = {}
      var totalValue = 0
      ;(inv.items || []).forEach(function (it) {
        var goods = null
        if (self._allGoods) {
          goods = self._allGoods.find(function (g) { return g._id === it.goodsId })
        }
        var catId = goods ? (goods.category || 'other') : 'other'
        // 兼容旧数据：如果没有 price，从 goods 中取
        var price = Number(it.price) || 0
        if (!price && goods) price = Number(goods.price) || 0

        if (!groups[catId]) {
          groups[catId] = {
            catId: catId,
            catName: (CAT_MAP[catId] || {}).name || '其他',
            icon: (CAT_MAP[catId] || {}).icon || '📦',
            items: []
          }
        }
        var subtotal = r2(price * (Number(it.countQty) || 0))
        totalValue += price * (Number(it.countQty) || 0)
        groups[catId].items.push({
          goodsId: it.goodsId,
          name: it.name,
          code: it.code || '',
          unit: it.unit || '',
          specWeight: it.specWeight || '',
          price: price,
          countQty: Number(it.countQty) || 0,
          subtotal: subtotal,
          remark: it.remark || ''
        })
      })

      var detailGroups = Object.values(groups).sort(function (a, b) {
        return (a.catId === 'other' ? 999 : 0) - (b.catId === 'other' ? 999 : 0)
      })

      this.setData({
        mode: 'detail',
        detailInv: {
          _id: inv._id,
          month: inv.month,
          monthLabel: monthLabel(inv.month),
          createTime: inv.createTime,
          remark: inv.remark || '',
          filledCount: (inv.items || []).filter(function (it) { return it.countQty > 0 }).length,
          totalItems: (inv.items || []).length
        },
        detailGroups: detailGroups,
        detailTotalValue: r2(totalValue)
      })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ============ 导出盘点报表 ============

  // 通用导出：根据盘点记录对象生成 Excel
  _doExport(inv) {
    if (!inv || !inv.items || !inv.items.length) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' })
      return
    }
    wx.showLoading({ title: '生成中...' })
    var self = this
    var goods = this._allGoods || []

    // 按分类分组
    var groups = {}
    var totalValue = 0
    inv.items.forEach(function (it) {
      var goodsItem = goods.find(function (g) { return g._id === it.goodsId })
      var catId = goodsItem ? (goodsItem.category || 'other') : 'other'
      var price = Number(it.price) || 0
      if (!price && goodsItem) price = Number(goodsItem.price) || 0
      var subtotal = r2(price * (Number(it.countQty) || 0))
      totalValue += price * (Number(it.countQty) || 0)

      if (!groups[catId]) {
        groups[catId] = { catName: (CAT_MAP[catId] || {}).name || '其他', items: [] }
      }
      groups[catId].items.push({
        name: it.name, code: it.code || '', specWeight: it.specWeight || '',
        unit: it.unit || '', price: price,
        countQty: Number(it.countQty) || 0,
        subtotal: subtotal, remark: it.remark || ''
      })
    })

    var headers = ['商品名称', '编号', '规格', '单位', '单价(¥)', '盘点数量', '金额(¥)', '备注']
    var rows = []
    var totalQty = 0
    Object.values(groups).forEach(function (g) {
      g.items.forEach(function (it) {
        if (it.countQty > 0) {
          rows.push([it.name, it.code, it.specWeight, it.unit, it.price, it.countQty, it.subtotal, it.remark])
          totalQty += it.countQty
        }
      })
    })

    var summaryRows = [['合计', '', '', '', '', totalQty, r2(totalValue), '']]
    var title = monthLabel(inv.month) + '盘点报表 - ' + this.data.storeName
    if (inv.remark) title += '（' + inv.remark + '）'

    exportExcel({
      filename: '盘点报表_' + inv.month,
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

  // 从总览页导出当月盘点
  exportCurrentMonth() {
    if (!this.data.currentInv) {
      wx.showToast({ title: '本月暂无盘点数据', icon: 'none' })
      return
    }
    var inv = (this._allInventories || []).find(function (i) {
      return i._id === this.data.currentInv._id
    }.bind(this))
    if (!inv) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      return
    }
    this._doExport(inv)
  },

  // 从历史列表导出指定记录
  exportRecordById(e) {
    var id = e.currentTarget.dataset.id
    var inv = (this._allInventories || []).find(function (i) { return i._id === id })
    if (!inv) {
      wx.showToast({ title: '记录不存在', icon: 'none' })
      return
    }
    // 阻止冒泡到 viewDetail
    this._doExport(inv)
  },

  // 导出全部盘点记录汇总
  exportAllRecords() {
    var allInv = this._allInventories || []
    if (!allInv.length) {
      wx.showToast({ title: '暂无盘点记录', icon: 'none' })
      return
    }

    wx.showLoading({ title: '生成中...' })
    var self = this
    var goods = this._allGoods || []

    var headers = ['盘点月份', '商品名称', '编号', '单位', '单价(¥)', '盘点数量', '金额(¥)', '备注']
    var rows = []
    var grandTotal = 0
    var grandQty = 0

    // 按月份倒序排列
    var sortedInv = allInv.slice().sort(function (a, b) {
      return (b.month || '').localeCompare(a.month || '')
    })

    sortedInv.forEach(function (inv) {
      ;(inv.items || []).forEach(function (it) {
        var price = Number(it.price) || 0
        if (!price) {
          var g = goods.find(function (gg) { return gg._id === it.goodsId })
          if (g) price = Number(g.price) || 0
        }
        var qty = Number(it.countQty) || 0
        var subtotal = r2(price * qty)
        grandTotal += price * qty
        grandQty += qty
        if (qty > 0) {
          rows.push([
            monthLabel(inv.month), it.name, it.code || '', it.unit || '',
            price, qty, subtotal, it.remark || ''
          ])
        }
      })
    })

    var summaryRows = [['合计', '', '', '', '', grandQty, r2(grandTotal), '']]
    var title = '全部盘点记录汇总 - ' + this.data.storeName

    exportExcel({
      filename: '盘点记录汇总',
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

  // 从详情页导出（使用已加载的详情数据）
  exportInventoryReport() {
    if (!this.data.detailInv) return
    var inv = (this._allInventories || []).find(function (i) {
      return i._id === this.data.detailInv._id
    }.bind(this))
    if (inv) this._doExport(inv)
  },

  backToOverview() {
    this.setData({ mode: 'overview', detailInv: null, detailGroups: [] })
  }
})
