const cloud = require('../../../../utils/cloud.js')
const { r2 } = require('../../../../utils/util.js')

Page({
  data: {
    order: null,
    statusLabels: { pending: '待确认', accepted: '已接单', shipped: '配送中', partial: '部分收货', received: '已收货', cancelled: '已取消' },
    statusSteps: [],
    showReceive: false,
    receiveItems: []
  },

  onLoad(options) {
    this.loadOrder(options.id)
  },

  loadOrder(orderId) {
    try {
    this._orderId = orderId
    const order = cloud.getById('orders', orderId)
    if (!order) {
      wx.showToast({ title: '订单不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1000)
      return
    }

    // 状态时间线
    var isPartial = order.status === 'partial'
    var isReceived = order.status === 'received'
    var isShipped = order.status === 'shipped' || isPartial || isReceived
    const steps = [
      { label: '创建订单', time: order.createTime, done: true },
      { label: '供货商接单', time: order.status === 'pending' ? '' : (order.createTime), done: order.status !== 'pending' },
      { label: '配送中', time: '', done: isShipped },
      { label: isPartial ? '部分收货' : '已收货', time: (isPartial || isReceived) ? order.updateTime : '', done: isPartial || isReceived }
    ]
    if (order.status === 'cancelled') {
      steps[1] = { label: '已取消', time: order.updateTime, done: true }
      steps[2] = { label: '配送中', time: '', done: false }
      steps[3] = { label: '已收货', time: '', done: false }
    }

    this.setData({ order, statusSteps: steps })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // ============ 部分收货 ============
  openReceivePopup() {
    const items = (this.data.order && this.data.order.items) || []
    const receiveItems = items.map(it => ({
      goodsId: it.goodsId,
      name: it.name,
      unit: it.unit,
      qty: it.qty,
      price: it.price,
      receivedQty: it.qty,
      _displayVal: String(it.qty),
      receivedAmount: r2(it.qty * it.price)
    }))
    this.setData({ showReceive: true, receiveItems })
  },

  onRecvInput(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.receiveItems
    const val = e.detail.value
    // 保留原始字符串给 input 显示，避免 ".5" 被 parseFloat 吃掉
    items[idx]._displayVal = val
    var num = parseFloat(val) || 0
    items[idx].receivedQty = num > items[idx].qty ? items[idx].qty : num
    items[idx].receivedAmount = r2(items[idx].receivedQty * items[idx].price)
    this.setData({ receiveItems: items })
  },

  onRecvAdd(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.receiveItems
    const current = parseFloat(items[idx].receivedQty) || 0
    if (current >= items[idx].qty) return
    let newQty = r2(current + 1)
    if (newQty > items[idx].qty) newQty = items[idx].qty
    items[idx].receivedQty = newQty
    items[idx]._displayVal = String(newQty)
    items[idx].receivedAmount = r2(newQty * items[idx].price)
    this.setData({ receiveItems: items })
  },

  onRecvSub(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.receiveItems
    const current = parseFloat(items[idx].receivedQty) || 0
    if (current <= 0) return
    let newQty = r2(current - 1)
    if (newQty < 0) newQty = 0
    items[idx].receivedQty = newQty
    items[idx]._displayVal = String(newQty)
    items[idx].receivedAmount = r2(newQty * items[idx].price)
    this.setData({ receiveItems: items })
  },

  closeReceive() {
    this.setData({ showReceive: false, receiveItems: [] })
  },

  async confirmReceive() {
    const receiveItems = this.data.receiveItems
    const total = receiveItems.reduce((s, r) => s + (parseFloat(r.receivedQty) || 0), 0)
    if (total === 0) {
      wx.showToast({ title: '请至少收一件货品', icon: 'none' })
      return
    }
    wx.showLoading({ title: '处理中...' })
    try {
      await cloud.confirmReceive(this._orderId, receiveItems.map(r => ({
        goodsId: r.goodsId,
        receivedQty: parseFloat(r.receivedQty) || 0,
        receivedAmount: r.receivedAmount
      })))
      wx.hideLoading()
      wx.showToast({ title: '已确认收货', icon: 'success' })
      this.setData({ showReceive: false, receiveItems: [] })
      setTimeout(() => this.loadOrder(this._orderId), 800)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '收货失败: ' + String(e.message || e).slice(0, 30), icon: 'none' })
    }
  },

  // 取消订单
  cancelOrder() {
    wx.showModal({
      title: '取消订单',
      content: '确认取消该订单？取消后不可恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            const updated = await cloud.updateOrderStatus(this._orderId, 'cancelled')
            if (updated) {
              wx.showToast({ title: '订单已取消', icon: 'success' })
              this.loadOrder(this._orderId)
            }
          } catch (e) {
            wx.showToast({ title: '取消失败', icon: 'none' })
          }
        }
      }
    })
  },

  goBack() {
    wx.navigateBack()
  }
})
