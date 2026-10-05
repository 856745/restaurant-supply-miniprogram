/**
 * 店长 - 购物车（独立导航页）
 * 展示已选货品 → 调整数量/删除 → 结算（按供应商拆单）
 */
const cloud = require('../../../utils/cloud.js')

Page({
  data: {
    // 按供应商分组
    allGroups: [],
    groups: [],
    keyword: '',
    cartCount: 0,
    cartTotal: 0,
    selectedCount: 0,
    selectedTotal: 0,
    allSelected: false,
    remark: '',
    submitting: false,
    isEmpty: true,
    // 收货确认弹窗
    showConfirm: false,
    receiver: '',
    receiverPhone: '',
    deliveryAddress: ''
  },

  onShow() {
    this.loadCart()
  },

  loadCart() {
    const app = getApp()
    const cart = app.getCart()
    const remark = app.getCartRemark()

    // 获取供应商列表（含起送价、优惠券信息）
    const suppliers = cloud.list('suppliers') || []
    const supMap = {}
    suppliers.forEach(s => { supMap[s._id] = s })

    // 按供应商分组
    const groupMap = {}
    let count = 0
    let total = 0
    Object.values(cart).forEach(item => {
      const supKey = item.supplierId || '_none'
      const supName = item.supplierName || '未知供应商'
      if (!groupMap[supKey]) {
        const supInfo = supMap[item.supplierId]
        groupMap[supKey] = {
          supplierId: item.supplierId,
          supplierName: supName,
          items: [],
          subTotal: 0,
          minOrderAmount: supInfo ? (supInfo.minOrderAmount || 0) : 0,
          couponType: supInfo ? (supInfo.couponType || 'none') : 'none',
          couponValue: supInfo ? (supInfo.couponValue || 0) : 0,
          settlementType: supInfo ? (supInfo.settlementType || 'monthly') : 'monthly'
        }
      }
      groupMap[supKey].items.push(item)
      groupMap[supKey].subTotal += item.qty * item.price
      count += item.qty
      total += item.qty * item.price
    })

    const groups = Object.values(groupMap).map(g => {
      // 标记每个item的选中状态
      g.items = g.items.map(it => ({
        ...it,
        selected: it.selected !== false  // 默认选中
      }))
      // 计算优惠券折扣
      let discount = 0
      if (g.couponType === 'fixed') {
        discount = Math.min(g.couponValue, g.subTotal)
      } else if (g.couponType === 'percent') {
        discount = Math.round(g.subTotal * (100 - g.couponValue) / 100 * 100) / 100
      }
      const afterDiscount = Math.round((g.subTotal - discount) * 100) / 100
      // 是否达到起送价
      const belowMin = g.minOrderAmount > 0 && g.subTotal < g.minOrderAmount
      return {
        ...g,
        subTotal: Math.round(g.subTotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        afterDiscount: afterDiscount,
        belowMin: belowMin
      }
    })

    // 计算选中项的统计
    let selectedCount = 0
    let selectedTotal = 0
    let totalItemCount = 0
    groups.forEach(g => {
      g.items.forEach(it => {
        totalItemCount++
        if (it.selected) {
          selectedCount++
          selectedTotal += it.qty * it.price
        }
      })
    })

    this.setData({
      allGroups: groups,
      groups,
      cartCount: totalItemCount,
      cartTotal: Math.round(total * 100) / 100,
      selectedCount: selectedCount,
      selectedTotal: Math.round(selectedTotal * 100) / 100,
      allSelected: selectedCount === totalItemCount && totalItemCount > 0,
      remark,
      isEmpty: totalItemCount === 0
    })
    this.filterGroups()
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.filterGroups()
  },

  filterGroups() {
    if (!this.data.keyword) {
      this.setData({ groups: this.data.allGroups })
      return
    }
    const kw = this.data.keyword.toLowerCase()
    const filtered = this.data.allGroups.map(g => {
      const items = g.items.filter(item =>
        (item.name && item.name.toLowerCase().includes(kw)) ||
        (item.supplierName && item.supplierName.toLowerCase().includes(kw)) ||
        (item.specWeight && item.specWeight.toLowerCase().includes(kw)) ||
        (item.specCount && item.specCount.toLowerCase().includes(kw))
      )
      if (items.length === 0) return null
      const subTotal = items.reduce((s, it) => s + it.qty * it.price, 0)
      return { ...g, items, subTotal: Math.round(subTotal * 100) / 100 }
    }).filter(g => g !== null)
    this.setData({ groups: filtered })
  },

  // 加减数量
  onAdd(e) {
    const gid = e.currentTarget.dataset.id
    const app = getApp()
    const cart = app.getCart()
    if (!cart[gid]) return
    cart[gid].qty += 1
    app.saveCart(cart)
    this.loadCart()
  },

  onSub(e) {
    const gid = e.currentTarget.dataset.id
    const app = getApp()
    const cart = app.getCart()
    if (!cart[gid]) return
    cart[gid].qty -= 1
    if (cart[gid].qty <= 0) {
      delete cart[gid]
    }
    app.saveCart(cart)
    this.loadCart()
  },

  // 直接输入数量（支持小数，如 0.5 斤）
  onStepperInput(e) {
    const gid = e.currentTarget.dataset.id
    const val = e.detail.value
    const num = parseFloat(val) || 0
    const app = getApp()
    const cart = app.getCart()
    if (!cart[gid]) return
    if (num <= 0) {
      delete cart[gid]
      app.saveCart(cart)
      this.loadCart()
      return
    }
    cart[gid].qty = num
    app.saveCart(cart)
    // 只更新统计，不重建 groups（避免 input 被重置打断小数输入）
    this._updateStats()
  },

  // 轻量更新统计（不重建 groups）
  _updateStats() {
    const cart = getApp().getCart()
    let selectedCount = 0
    let selectedTotal = 0
    let totalItemCount = 0
    let total = 0
    Object.values(cart).forEach(item => {
      totalItemCount++
      total += item.qty * item.price
      if (item.selected !== false) {
        selectedCount++
        selectedTotal += item.qty * item.price
      }
    })
    this.setData({
      cartCount: totalItemCount,
      cartTotal: Math.round(total * 100) / 100,
      selectedCount,
      selectedTotal: Math.round(selectedTotal * 100) / 100,
      allSelected: selectedCount === totalItemCount && totalItemCount > 0,
      isEmpty: totalItemCount === 0
    })
  },

  // 删除单项
  onDeleteItem(e) {
    const gid = e.currentTarget.dataset.id
    const app = getApp()
    const cart = app.getCart()
    delete cart[gid]
    app.saveCart(cart)
    this.loadCart()
    wx.showToast({ title: '已移除', icon: 'none', duration: 800 })
  },

  // 切换单项选中状态
  onToggleItem(e) {
    const gid = e.currentTarget.dataset.id
    const app = getApp()
    const cart = app.getCart()
    if (!cart[gid]) return
    cart[gid].selected = cart[gid].selected === false ? true : false
    app.saveCart(cart)
    this.loadCart()
  },

  // 全选/取消全选
  onToggleAll() {
    const app = getApp()
    const cart = app.getCart()
    const allSelected = this.data.allSelected
    Object.values(cart).forEach(item => {
      item.selected = !allSelected
    })
    app.saveCart(cart)
    this.loadCart()
  },

  // 清空购物车
  onClearAll() {
    if (this.data.cartCount === 0) return
    wx.showModal({
      title: '提示',
      content: '确定清空购物车吗？',
      success: res => {
        if (res.confirm) {
          const app = getApp()
          app.saveCart({})
          app.saveCartRemark('')
          this.loadCart()
          wx.showToast({ title: '已清空', icon: 'none' })
        }
      }
    })
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value })
    getApp().saveCartRemark(e.detail.value)
  },

  // 点击"去结算" → 弹出收货确认
  onSettle() {
    if (this.data.submitting) return
    const cart = getApp().getCart()
    const selectedItems = Object.values(cart).filter(item => item.selected !== false)
    if (!selectedItems.length) {
      wx.showToast({ title: '请选择要结算的商品', icon: 'none' })
      return
    }

    // 检查起送价（仅检查选中商品的供应商分组）
    const selectedSupIds = {}
    selectedItems.forEach(it => {
      const sid = it.supplierId || '_none'
      if (!selectedSupIds[sid]) selectedSupIds[sid] = { name: it.supplierName || '未知', total: 0, minOrderAmount: 0 }
      selectedSupIds[sid].total += it.qty * it.price
    })
    // 获取供应商起送价
    const suppliers = cloud.list('suppliers') || []
    suppliers.forEach(s => {
      if (selectedSupIds[s._id]) selectedSupIds[s._id].minOrderAmount = s.minOrderAmount || 0
    })
    const belowMinGroups = Object.values(selectedSupIds).filter(g => g.minOrderAmount > 0 && g.total < g.minOrderAmount)
    if (belowMinGroups.length) {
      const names = belowMinGroups.map(g => g.name + '(起送¥' + g.minOrderAmount + ')').join('、')
      wx.showModal({
        title: '未达起送价',
        content: '以下供应商未达到起送价：' + names + '。确定要继续下单吗？',
        confirmText: '继续下单',
        cancelText: '返回修改',
        success: res => {
          if (res.confirm) {
            this._openConfirmPopup()
          }
        }
      })
      return
    }

    this._openConfirmPopup()
  },

  _openConfirmPopup() {
    // 预填收货信息
    const user = cloud.getCurrentUser()
    const store = user.storeId ? cloud.getById('stores', user.storeId) : null
    this.setData({
      showConfirm: true,
      receiver: this.data.receiver || (user ? user.name : '') || '',
      receiverPhone: this.data.receiverPhone || (user ? user.phone : '') || '',
      deliveryAddress: this.data.deliveryAddress || (store ? store.address : '') || ''
    })
  },

  onReceiverInput(e) { this.setData({ receiver: e.detail.value }) },
  onPhoneInput(e) { this.setData({ receiverPhone: e.detail.value }) },
  onAddressInput(e) { this.setData({ deliveryAddress: e.detail.value }) },

  // 确认下单
  async confirmSubmit() {
    if (this.data.submitting) return

    // 校验
    if (!this.data.receiver.trim()) {
      wx.showToast({ title: '请填写收货人姓名', icon: 'none' })
      return
    }
    if (!this.data.receiverPhone.trim()) {
      wx.showToast({ title: '请填写收货人电话', icon: 'none' })
      return
    }
    if (!this.data.deliveryAddress.trim()) {
      wx.showToast({ title: '请填写收货地址', icon: 'none' })
      return
    }

    const app = getApp()
    const cart = app.getCart()
    // 仅结算选中的商品
    const selectedItems = Object.values(cart).filter(item => item.selected !== false)
    if (!selectedItems.length) {
      wx.showToast({ title: '请选择要结算的商品', icon: 'none' })
      return
    }

    // 按供应商分组
    const groups = {}
    selectedItems.forEach(item => {
      const supKey = item.supplierId || '_none'
      const supName = item.supplierName || '未知供应商'
      const supId = item.supplierId || ''
      if (!groups[supKey]) groups[supKey] = { supplierName: supName, supplierId: supId, items: [], goodsIds: [] }
      groups[supKey].items.push(item)
      groups[supKey].goodsIds.push(item.goodsId)
    })

    // 获取供应商信息（优惠券等）
    const suppliers = cloud.list('suppliers') || []
    const supMap = {}
    suppliers.forEach(s => { supMap[s._id] = s })

    const user = cloud.getCurrentUser()
    const store = cloud.getById('stores', user.storeId)

    // 生成批次号：同一批次结算的所有订单共享
    const batchNo = 'BAT' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase()

    this.setData({ submitting: true })
    wx.showLoading({ title: '正在下单', mask: true })

    const successIds = []
    const successNames = []
    let failedName = ''

    try {
      const groupKeys = Object.keys(groups)
      for (const key of groupKeys) {
        const g = groups[key]
        // 计算原价
        const itemsData = g.items.map(it => ({
          goodsId: it.goodsId, name: it.name, unit: it.unit,
          qty: it.qty, price: it.price,
          amount: Math.round(it.qty * it.price * 100) / 100,
          code: it.code || '', specWeight: it.specWeight || '', specCount: it.specCount || ''
        }))
        let orderTotal = itemsData.reduce((s, i) => s + i.amount, 0)
        orderTotal = Math.round(orderTotal * 100) / 100

        // 应用优惠券
        const supInfo = supMap[g.supplierId]
        let discount = 0
        let couponType = 'none'
        let couponValue = 0
        if (supInfo) {
          couponType = supInfo.couponType || 'none'
          couponValue = supInfo.couponValue || 0
          if (couponType === 'fixed') {
            discount = Math.min(couponValue, orderTotal)
          } else if (couponType === 'percent') {
            discount = Math.round(orderTotal * (100 - couponValue) / 100 * 100) / 100
          }
        }
        const finalTotal = Math.round((orderTotal - discount) * 100) / 100

        try {
          await cloud.createOrder({
            storeId: user.storeId,
            storeName: store ? store.name : '',
            supplierId: g.supplierId,
            supplierName: g.supplierName,
            items: itemsData,
            total: finalTotal,
            originalTotal: orderTotal,
            discount: Math.round(discount * 100) / 100,
            couponType: couponType,
            couponValue: couponValue,
            remark: this.data.remark,
            batchNo: batchNo,
            receiver: this.data.receiver.trim(),
            receiverPhone: this.data.receiverPhone.trim(),
            deliveryAddress: this.data.deliveryAddress.trim()
          })
          // 记录成功的订单商品ID
          ;(g.goodsIds || []).forEach(gid => successIds.push(gid))
          successNames.push(g.supplierName)
        } catch (e) {
          failedName = g.supplierName
          throw e
        }
      }
      // 全部成功，清空已结算的商品
      const cartAfter = app.getCart()
      successIds.forEach(gid => { delete cartAfter[gid] })
      app.saveCart(cartAfter)
      this.setData({ showConfirm: false })
      wx.hideLoading()
      wx.showToast({ title: '下单成功', icon: 'success' })
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/manager/orders/index' })
      }, 1200)
    } catch (e) {
      console.error('下单失败:', e)
      wx.hideLoading()
      // 部分成功：移除已成功的商品，保留失败的商品在购物车
      if (successIds.length > 0) {
        const cartAfter2 = app.getCart()
        successIds.forEach(gid => { delete cartAfter2[gid] })
        app.saveCart(cartAfter2)
        wx.showModal({
          title: '部分下单成功',
          content: '已成功下单：' + successNames.join('、') + '\n失败：' + failedName + '，商品已保留在购物车，可重试',
          showCancel: false,
          confirmText: '知道了'
        })
      } else {
        wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '下单失败', icon: 'none', duration: 4000 })
      }
    } finally {
      this.setData({ submitting: false })
    }
  },

  cancelConfirm() {
    this.setData({ showConfirm: false })
  },

  // 去采购
  goPurchase() {
    wx.reLaunch({ url: '/pages/manager/purchase/index' })
  }
})
