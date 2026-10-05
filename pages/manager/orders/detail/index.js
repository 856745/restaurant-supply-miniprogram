/**
 * 店长 - 订单详情（独立页面）
 * 显示完整订单信息 + 同批次关联订单
 * 未发货前可修改货品数量
 * 确认收货支持部分收货
 */
const cloud = require('../../../../utils/cloud.js')
const { ORDER_STATUS } = require('../../../../utils/constants.js')
const { r2 } = require('../../../../utils/util.js')

const STATUS_MAP = {}
Object.values(ORDER_STATUS).forEach(s => { STATUS_MAP[s.id] = s })

Page({
  data: {
    order: null,
    batchOrders: [],   // 同批次的其他订单
    statusName: '',
    tagClass: '',
    // 货品编辑
    editable: false,      // 是否可编辑货品数量（pending/accepted）
    editing: false,       // 是否正在编辑货品
    editItems: [],        // 编辑中的货品列表
    // 收货信息编辑
    receiverEditable: false,  // 是否可编辑收货信息（pending/accepted/shipped/partial）
    editingReceiver: false,
    editReceiver: '',
    editReceiverPhone: '',
    editAddress: '',
    // 部分收货弹窗
    showReceive: false,
    receiveItems: []      // [{goodsId,name,unit,qty,receivedQty}]
  },

  async onLoad(options) {
    this.orderId = options.id || ''
    await this.loadDetail()
  },

  async loadDetail() {
    if (!this.orderId) return
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getStoreData()
      if (!data) return

      const allOrders = data.orders || []
      const order = allOrders.find(o => o._id === this.orderId)
      if (!order) {
        wx.showToast({ title: '订单不存在', icon: 'none' })
        return
      }

      // 查找同批次订单
      let batchOrders = []
      if (order.batchNo) {
        batchOrders = allOrders.filter(o => o.batchNo === order.batchNo && o._id !== order._id)
      }

      const editable = order.status === 'pending' || order.status === 'accepted'
      // 收货信息在待确认/已接单/配送中/部分收货 均可修改
      const receiverEditable = order.status === 'pending' || order.status === 'accepted' ||
                               order.status === 'shipped' || order.status === 'partial'

      this.setData({
        order: {
          ...order,
          statusName: (STATUS_MAP[order.status] || {}).name || order.status,
          tagClass: 'tag-' + order.status,
          itemCount: order.items ? order.items.length : 0
        },
        batchOrders: batchOrders.map(o => ({
          ...o,
          statusName: (STATUS_MAP[o.status] || {}).name || o.status,
          tagClass: 'tag-' + o.status
        })),
        statusName: (STATUS_MAP[order.status] || {}).name || order.status,
        tagClass: 'tag-' + order.status,
        editable: editable,
        receiverEditable: receiverEditable,
        editing: false,
        editingReceiver: false
      })
    } catch (e) {
      console.error('加载失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  // ============ 货品数量编辑 ============
  startEdit() {
    const items = this.data.order.items.map(it => ({
      goodsId: it.goodsId, name: it.name, unit: it.unit,
      qty: it.qty, price: it.price,
      code: it.code || '', specWeight: it.specWeight || '', specCount: it.specCount || ''
    }))
    this.setData({ editing: true, editItems: items })
  },

  cancelEdit() {
    this.setData({ editing: false, editItems: [] })
  },

  onItemAdd(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.editItems
    items[idx].qty = (parseFloat(items[idx].qty) || 0) + 1
    this.setData({ editItems: items })
  },

  onItemSub(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.editItems
    const current = parseFloat(items[idx].qty) || 0
    if (current <= 1) {
      wx.showToast({ title: '数量不能少于1', icon: 'none', duration: 800 })
      return
    }
    items[idx].qty = current - 1
    this.setData({ editItems: items })
  },

  // 直接输入数量（支持小数，如 0.5 斤）
  onItemInput(e) {
    const idx = e.currentTarget.dataset.idx
    const val = e.detail.value
    const num = parseFloat(val) || 0
    const items = this.data.editItems
    // 保留原始值到内存，不 setData editItems（避免 input 被重置打断小数输入）
    items[idx].qty = num > 0 ? num : 1
  },

  // 输入失焦时更新金额显示
  onItemBlur(e) {
    this.setData({ editItems: this.data.editItems })
  },

  async saveEdit() {
    const items = this.data.editItems
    if (!items.length) return

    wx.showLoading({ title: '保存中...' })
    try {
      await cloud.updateOrderItems(this.orderId, items)
      wx.hideLoading()
      wx.showToast({ title: '修改成功', icon: 'success' })
      this.setData({ editing: false, editItems: [] })
      setTimeout(() => this.loadDetail(), 800)
    } catch (e) {
      wx.hideLoading()
      console.error('修改失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '修改失败', icon: 'none', duration: 4000 })
    }
  },

  // ============ 部分收货（支持小数） ============
  openReceivePopup() {
    const items = this.data.order.items || []
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

  // 小数输入：_displayVal 保留原始字符串给 input，receivedQty 存数字用于计算
  onRecvInput(e) {
    const idx = e.currentTarget.dataset.idx
    const items = this.data.receiveItems
    const val = e.detail.value
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
    // 校验至少收一件（receivedQty 可能是字符串，需 parseFloat）
    const total = receiveItems.reduce((s, r) => s + (parseFloat(r.receivedQty) || 0), 0)
    if (total === 0) {
      wx.showToast({ title: '请至少收一件货品', icon: 'none' })
      return
    }

    wx.showLoading({ title: '处理中...' })
    try {
      await cloud.confirmReceive(this.orderId, receiveItems.map(r => ({
        goodsId: r.goodsId,
        receivedQty: parseFloat(r.receivedQty) || 0,
        receivedAmount: r.receivedAmount
      })))
      wx.hideLoading()
      wx.showToast({ title: '已确认收货', icon: 'success' })
      this.setData({ showReceive: false, receiveItems: [] })
      setTimeout(() => this.loadDetail(), 800)
    } catch (e) {
      wx.hideLoading()
      console.error('收货失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '收货失败', icon: 'none', duration: 4000 })
    }
  },

  // ============ 收货信息编辑 ============
  startEditReceiver() {
    const o = this.data.order
    this.setData({
      editingReceiver: true,
      editReceiver: o.receiver || '',
      editReceiverPhone: o.receiverPhone || '',
      editAddress: o.deliveryAddress || ''
    })
  },

  cancelEditReceiver() {
    this.setData({ editingReceiver: false })
  },

  onReceiverInput(e) {
    this.setData({ editReceiver: e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ editReceiverPhone: e.detail.value })
  },

  onAddressInput(e) {
    this.setData({ editAddress: e.detail.value })
  },

  async saveReceiver() {
    const receiver = this.data.editReceiver.trim()
    const phone = this.data.editReceiverPhone.trim()
    const address = this.data.editAddress.trim()

    if (!receiver) {
      wx.showToast({ title: '请填写收货人', icon: 'none' })
      return
    }
    if (!phone) {
      wx.showToast({ title: '请填写联系电话', icon: 'none' })
      return
    }
    if (!address) {
      wx.showToast({ title: '请填写收货地址', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })
    try {
      await cloud.updateOrderReceiver(this.orderId, {
        receiver, receiverPhone: phone, deliveryAddress: address
      })
      wx.hideLoading()
      wx.showToast({ title: '修改成功', icon: 'success' })
      this.setData({ editingReceiver: false })
      setTimeout(() => this.loadDetail(), 800)
    } catch (e) {
      wx.hideLoading()
      console.error('修改收货信息失败:', e)
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '修改失败', icon: 'none', duration: 4000 })
    }
  },

  // ============ 其他操作 ============
  viewBatchOrder(e) {
    const id = e.currentTarget.dataset.id
    wx.redirectTo({ url: '/pages/manager/orders/detail/index?id=' + id })
  },

  cancelOrder() {
    wx.showModal({
      title: '确认取消',
      content: '取消后订单不可恢复，确定？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          try {
            await cloud.updateOrderStatus(this.orderId, 'cancelled')
            wx.showToast({ title: '已取消', icon: 'success' })
            setTimeout(() => this.loadDetail(), 800)
          } catch (e) {
            wx.showToast({ title: '取消失败: ' + String(e.message || e).slice(0, 30), icon: 'none' })
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  // 预览发货凭证大图
  previewImage(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({ urls: [url] })
  }
})
