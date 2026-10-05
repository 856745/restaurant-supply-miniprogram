/**
 * 店长 - 采购（浏览货品 + 加入购物车）
 * 供应商 Tab + 商品种类分类筛选 → 货品卡片 + 加减步进器
 * 购物车独立导航页，此处只负责加货
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
    // 供应商 Tab
    suppliers: [],
    activeSupplierId: '',
    allGoods: [],

    // 商品种类分类
    catList: [{ id: 'all', name: '全部' }],
    activeCat: 'all',

    // 搜索
    keyword: '',

    // 货品列表（筛选后）
    goodsList: [],

    // 购物车数量（来自全局）
    cartCount: 0,
    cartQty: {}  // { goodsId: qty } 用于显示每项已选数量
  },

  onLoad(options) {
    if (options && options.cat) {
      this.setData({ activeCat: options.cat })
    }
  },

  async onShow() {
    await this.loadData()
    this.syncCartCount()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      const data = await cloud.getStoreData()
      if (!data) return

      // 获取当前用户门店ID
      const user = cloud.getCurrentUser()
      const storeId = user ? user.storeId : ''

      // 过滤不可见供应商：visibleStores 为空=全部可见，非空=仅指定门店可见
      const allSuppliers = data.suppliers || []
      const visibleSupplierIds = allSuppliers
        .filter(s => s.status === 'active' && (!s.visibleStores || s.visibleStores.length === 0 || s.visibleStores.indexOf(storeId) > -1))
        .map(s => s._id)

      // 汇总可见供应商
      const supSet = {}
      const suppliers = [{ _id: '', name: '全部' }]

      // 从数据库动态加载分类
      const dbCats = await cloud.getCategories()
      const catList = [{ id: 'all', name: '全部' }].concat(dbCats.map(c => ({ id: c.id, name: c.name })))
      this._catMap = {}
      dbCats.forEach(c => { this._catMap[c.id] = c })

      // 仅显示可见供应商的商品，且过滤已下架商品（onShelf === false）
      const allGoods = (data.goods || []).filter(g => visibleSupplierIds.indexOf(g.supplierId) > -1 && g.onShelf !== false).map(g => ({
        ...g,
        icon: (this._catMap[g.category] || {}).icon || (CAT_MAP[g.category] || {}).icon || '📦',
        catName: (this._catMap[g.category] || {}).name || (CAT_MAP[g.category] || {}).name || '其他',
        hasImage: !!(g.image && g.image.length > 0)
      }))

      allGoods.forEach(g => {
        if (g.supplierId && !supSet[g.supplierId]) {
          supSet[g.supplierId] = true
          suppliers.push({ _id: g.supplierId, name: g.supplierName || '未知供应商' })
        }
      })

      // 保持已选供应商
      let activeId = this.data.activeSupplierId
      if (activeId && !suppliers.find(s => s._id === activeId)) {
        activeId = ''
      }

      this.setData({ suppliers, allGoods, catList })
      this.filterGoods(activeId, this.data.activeCat)
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  // 同步全局购物车数量
  syncCartCount() {
    const app = getApp()
    const cart = app.getCart()
    let count = 0
    const cartQty = {}
    Object.values(cart).forEach(item => {
      count += item.qty
      cartQty[item.goodsId] = item.qty
    })
    this.setData({ cartCount: count, cartQty })
  },

  // 切换供应商
  onSupplierTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeSupplierId: id })
    this.filterGoods(id, this.data.activeCat, this.data.keyword)
  },

  // 切换商品种类分类
  onCatTap(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeCat: id })
    this.filterGoods(this.data.activeSupplierId, id, this.data.keyword)
  },

  // 搜索
  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.filterGoods(this.data.activeSupplierId, this.data.activeCat, e.detail.value)
  },

  filterGoods(supplierId, catId, keyword) {
    const all = this.data.allGoods || []
    let list = all
    if (supplierId) {
      list = list.filter(g => g.supplierId === supplierId)
    }
    if (catId && catId !== 'all') {
      list = list.filter(g => g.category === catId)
    }
    if (keyword) {
      const kw = keyword.toLowerCase()
      list = list.filter(g =>
        (g.name && g.name.toLowerCase().includes(kw)) ||
        (g.code && g.code.toLowerCase().includes(kw)) ||
        (g.supplierName && g.supplierName.toLowerCase().includes(kw)) ||
        (g.specWeight && g.specWeight.toLowerCase().includes(kw)) ||
        (g.specCount && g.specCount.toLowerCase().includes(kw)) ||
        (g.description && g.description.toLowerCase().includes(kw))
      )
    }
    this.setData({ goodsList: list })
  },

  // 加减数量 —— 直接写入全局购物车
  onAdd(e) {
    const idx = e.currentTarget.dataset.idx
    const g = this.data.goodsList[idx]
    if (!g) return
    this.updateCartItem(g, 1)
  },

  onSub(e) {
    const idx = e.currentTarget.dataset.idx
    const g = this.data.goodsList[idx]
    if (!g) return
    const app = getApp()
    const cart = app.getCart()
    const item = cart[g._id]
    if (!item || item.qty <= 0) return
    this.updateCartItem(g, -1)
  },

  updateCartItem(goods, delta) {
    const app = getApp()
    const cart = app.getCart()
    const gid = goods._id
    if (!cart[gid]) {
      cart[gid] = {
        goodsId: goods._id,
        code: goods.code || '',
        name: goods.name,
        unit: goods.unit,
        price: goods.price,
        specWeight: goods.specWeight || '',
        specCount: goods.specCount || '',
        image: goods.image || '',
        hasImage: !!(goods.image && goods.image.length > 0),
        icon: goods.icon || '📦',
        supplierName: goods.supplierName || '',
        supplierId: goods.supplierId || '',
        qty: 0
      }
    }
    cart[gid].qty += delta
    if (cart[gid].qty <= 0) {
      delete cart[gid]
    }
    app.saveCart(cart)
    this.syncCartCount()

    // 加货时轻提示
    if (delta > 0) {
      wx.showToast({ title: '已加入购物车', icon: 'none', duration: 800 })
    }
  },

  // 直接输入数量（支持小数，如 0.5 斤）
  onStepperInput(e) {
    const idx = e.currentTarget.dataset.idx
    const g = this.data.goodsList[idx]
    if (!g) return
    const val = e.detail.value
    const num = parseFloat(val) || 0
    const app = getApp()
    const cart = app.getCart()
    if (num <= 0) {
      delete cart[g._id]
    } else {
      if (!cart[g._id]) {
        cart[g._id] = {
          goodsId: g._id,
          code: g.code || '',
          name: g.name,
          unit: g.unit,
          price: g.price,
          specWeight: g.specWeight || '',
          specCount: g.specCount || '',
          image: g.image || '',
          hasImage: !!(g.image && g.image.length > 0),
          icon: g.icon || '📦',
          supplierName: g.supplierName || '',
          supplierId: g.supplierId || '',
          qty: 0
        }
      }
      cart[g._id].qty = num
    }
    app.saveCart(cart)
    // 只更新角标数，不 setData cartQty（避免 input 被重置打断小数输入）
    let count = 0
    Object.values(cart).forEach(item => { count += item.qty })
    this.setData({ cartCount: Math.round(count * 100) / 100 })
  },

  // 跳转购物车页
  goToCart() {
    wx.reLaunch({ url: '/pages/manager/cart/index' })
  }
})
