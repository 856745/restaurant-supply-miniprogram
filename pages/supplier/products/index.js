const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')

function catName(id) {
  const c = CATEGORIES.find(c => c.id === id)
  return c ? c.name : '其他'
}

function catIcon(id) {
  const c = CATEGORIES.find(c => c.id === id)
  return c ? c.icon : '📦'
}

Page({
  data: {
    goods: [],
    keyword: '',
    filterCategory: '',
    categories: CATEGORIES,
    showModal: false,
    editForm: { _id: '', name: '', category: 'meat', unit: '斤', price: '', specWeight: '', specCount: '', image: '', description: '' }
  },

  async onShow() { await this.loadGoods() },

  async loadGoods() {
    try {
    const data = await cloud.getSupplierData()
    if (!data) return
    let goods = data.goods || []
    if (this.data.filterCategory) {
      goods = goods.filter(g => g.category === this.data.filterCategory)
    }
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      goods = goods.filter(g => g.name.toLowerCase().indexOf(kw) !== -1)
    }
    goods = goods.map(g => ({
      ...g,
      categoryName: catName(g.category),
      categoryIcon: catIcon(g.category),
      hasImage: !!(g.image && g.image.length > 0)
    }))
    this.setData({ goods })
    } catch (e) {
      console.error('loadGoods error:', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, async () => { await this.loadGoods() })
  },

  filterCategory(e) {
    this.setData({ filterCategory: e.currentTarget.dataset.id || '' }, async () => { await this.loadGoods() })
  },

  openAdd() {
    this.setData({
      showModal: true,
      editForm: { _id: '', name: '', category: 'meat', unit: '斤', price: '', specWeight: '', specCount: '', image: '', description: '' }
    })
  },

  openEdit(e) {
    const g = e.currentTarget.dataset.item
    this.setData({
      showModal: true,
      editForm: {
        _id: g._id, name: g.name, category: g.category, unit: g.unit,
        price: String(g.price || ''),
        specWeight: g.specWeight || '',
        specCount: g.specCount || '',
        image: g.image || '',
        description: g.description || ''
      }
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    const form = this.data.editForm
    form[field] = e.detail.value
    this.setData({ editForm: form })
  },

  pickCategory(e) {
    const form = this.data.editForm
    form.category = e.currentTarget.dataset.id
    this.setData({ editForm: form })
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFilePaths[0]
        // 直接存临时路径，由 cloud.js saveGoods 上传到云存储（避免 base64 写入数据库导致超限）
        const form = this.data.editForm
        form.image = tempPath
        this.setData({ editForm: form })
      }
    })
  },

  onRemoveImage() {
    const form = this.data.editForm
    form.image = ''
    this.setData({ editForm: form })
  },

  async saveGoods() {
    const f = this.data.editForm
    if (!f.name.trim()) {
      wx.showToast({ title: '请输入货品名称', icon: 'none' })
      return
    }
    if (!f.price || isNaN(Number(f.price)) || Number(f.price) <= 0) {
      wx.showToast({ title: '请输入有效价格', icon: 'none' })
      return
    }
    try {
    const user = cloud.getCurrentUser()
    const data = await cloud.getSupplierData()
    const supplier = data ? data.supplier : null
    if (!supplier) {
      wx.showToast({ title: '无法获取供应商信息', icon: 'none' })
      return
    }
    await cloud.saveGoods({
      _id: f._id || undefined,
      name: f.name.trim(),
      category: f.category,
      unit: f.unit.trim() || '斤',
      price: Number(f.price),
      specWeight: f.specWeight.trim(),
      specCount: f.specCount.trim(),
      image: f.image || '',
      description: f.description.trim(),
      supplierId: supplier._id,
      supplierName: supplier.name
    })
    wx.showToast({ title: f._id ? '已更新' : '已新增', icon: 'success' })
    this.setData({ showModal: false }, () => { this.loadGoods() })
    } catch (e) {
      wx.showToast({ title: '保存失败: ' + String(e.message || e).slice(0, 40), icon: 'none', duration: 3000 })
    }
  },

  deleteGoods(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除货品',
      content: '确认删除该货品？删除后不可恢复。',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (res.confirm) {
          try {
            await cloud.deleteGoods(id)
            wx.showToast({ title: '已删除', icon: 'none' })
            this.setData({ showModal: false }, () => { this.loadGoods() })
          } catch (e) {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  closeModal() {
    this.setData({ showModal: false })
  }
})
